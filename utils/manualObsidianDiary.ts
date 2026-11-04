/** 公开版: one explicit private-chat click, one read-only draft, one existing Obsidian outbox item. */
import type { APIConfig, CharacterProfile, GroupProfile, Message, RealtimeConfig, UserProfile } from '../types';
import { DB } from './db';
import { ChatPrompts } from './chatPrompts';
import { ContextBuilder } from './context';
import { computeContextRangeSnapshot, getMemoryPalaceHighWaterMarkForContext, resolveContextRangeMode, clampManualContextLimit } from './chatContextRange';
import { flattenImageContentParts } from './promptMessageCleanup';
import { MemoryNodeDB } from './memoryPalace/db';
import { resolveDialogueApi } from './characterApi';
import { completeMainChat } from './mainChatCompletion';
import { isManualRelayEnabled } from './manualModelRelay';
import { extractContent } from './safeApi';
import { extractObsidianDiary } from './obsidianDiaryProtocol';
import {
    diaryStateLabel,
    enqueueObsidianDiary,
    listObsidianDiaries,
    obsidianDiaryTargetIssue,
    prepareObsidianDiaryTarget,
    saveObsidianDiary,
    type ObsidianDiaryRecord,
    type ObsidianDiaryTargetSnapshot,
} from './obsidianDiary';

const RULES = `# 一键写角色日记（覆盖普通聊天输出格式）
你正在以当前角色本人身份写一篇独立私人日记。依据既有人设、世界书、当前合法聊天范围与记忆语境，回望最近真正发生且本人可知的内容；不要扮演用户，不把猜测写成用户现实经历。
只写一篇完整日记，标题、心情与 Markdown 正文都必须非空。允许自然的第一人称口吻、段落、列表与少量 Markdown；不要写客服说明、创作计划、保存结果或对用户的聊天回复。
严格只返回：
[[OBS_DIARY_START: 标题 | 心情]]
Markdown 正文
[[OBS_DIARY_END]]
不要输出第二篇日记、标签外文字、代码围栏、工具调用或任何会触发外部操作的控制指令。应用会先在本机保存原稿，再通过既有目标写入并读回核验；你不能声称已经写入。`;

const stripHistoricalMedia = (value: string) => value
    .replace(/data:(?:image|audio|video)\/[\w.+-]+;base64,[a-z\d+/=]+/gi, '[媒体原件未提供]')
    .replace(/blobref:[a-z\d_-]+/gi, '[媒体原件未提供]');

async function readOnlyHistory(char: CharacterProfile): Promise<{ messages: Message[]; hwm: number }> {
    const hwm = getMemoryPalaceHighWaterMarkForContext(char.id);
    const source = resolveContextRangeMode(char) === 'adaptive'
        ? (await DB.getMessagesFromId(char.id, hwm + 1)).messages
        : (await DB.getRecentMessagesWithCount(char.id, clampManualContextLimit(char.contextLimit))).messages;
    return { messages: computeContextRangeSnapshot(source, char, hwm).messages, hwm };
}

async function buildManualDiaryMessages(input: {
    char: CharacterProfile;
    user: UserProfile;
}): Promise<Array<{ role: string; content: any }>> {
    const range = await readOnlyHistory(input.char);
    const { apiMessages } = ChatPrompts.buildMessageHistory(
        range.messages,
        Math.max(1, range.messages.length),
        input.char,
        input.user,
        [],
        undefined,
        { contextHighWaterMark: range.hwm, protectPendingChatTurn: true, useVisionDescriptions: true },
    );
    const history = flattenImageContentParts(apiMessages).map(message => ({
        ...message,
        content: stripHistoricalMedia(String(message.content)),
    }));
    let palace = '';
    if (input.char.memoryPalaceEnabled) {
        palace = (await MemoryNodeDB.getByCharId(input.char.id))
            .filter(node => !node.archived && !node.storyTimelineScope && !node.groupId && node.content.trim())
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, 12)
            .map(node => `- ${node.content.slice(0, 500)}`)
            .join('\n');
    }
    return ContextBuilder.buildCharacterRequest({
        char: { ...input.char, memoryPalaceInjection: palace, roomPlatesInjection: '' },
        user: input.user,
        includeLifeContext: false,
        instructions: RULES,
    }, [...history, { role: 'user', content: '请在此刻写下这一篇独立私人日记。' }]);
}

export interface ParsedManualObsidianDiary {
    title: string;
    mood: string;
    content: string;
    incomplete: boolean;
}

export function parseManualObsidianDiary(raw: string, truncated = false): ParsedManualObsidianDiary {
    const parsed = extractObsidianDiary(raw);
    if (parsed.entries.length !== 1 || parsed.text.trim()) throw new Error('没有收到唯一且完整的日记正文，未保存；可以手动重试');
    const entry = parsed.entries[0];
    const header = entry.header.split('|').map(value => value.trim());
    if (header.length !== 2 || !header[0] || !header[1] || !entry.content.trim())
        throw new Error('日记标题、心情或正文格式不完整，未保存；可以手动重试');
    return { title: header[0].slice(0, 120), mood: header[1].slice(0, 120), content: entry.content.trim(), incomplete: truncated || !entry.complete };
}

const safeGuardError = (message: string) => Object.assign(new Error(message), { diarySafe: true });

async function frozenIssue(input: {
    charId: string;
    target: ObsidianDiaryTargetSnapshot;
    isCurrent: () => boolean;
}): Promise<string | null> {
    if (!input.isCurrent()) return '聊天对象或页面已改变；原稿只保留在本机，没有写入 Obsidian';
    return obsidianDiaryTargetIssue(input.target, input.charId);
}

export async function runManualObsidianDiary(input: {
    char: CharacterProfile;
    user: UserProfile;
    api: APIConfig;
    groups: GroupProfile[];
    realtimeConfig?: RealtimeConfig;
    sourceId: string;
    signal: AbortSignal;
    isCurrent: () => boolean;
}): Promise<ObsidianDiaryRecord> {
    const { char, user, api, signal } = input;
    signal.throwIfAborted();
    const target = await prepareObsidianDiaryTarget(char.id);
    const selected = resolveDialogueApi(api, char);
    const manualRelay = isManualRelayEnabled();
    if (!manualRelay && (!selected.baseUrl || !selected.model))
        throw new Error('请先配置当前角色的聊天 API，或开启外部模型接力后重新点击');
    const messages = await buildManualDiaryMessages({ char, user });
    signal.throwIfAborted();
    const data = await completeMainChat({
        body: {
            model: selected.model,
            messages,
            stream: false,
            temperature: selected.temperature ?? api.temperature ?? 0.85,
            max_tokens: 5000,
        },
        url: selected.baseUrl ? `${selected.baseUrl.replace(/\/+$/, '')}/chat/completions` : '',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${selected.apiKey || 'sk-none'}` },
        scope: 'private', signal, retries: 0, privateTransient: true,
        meta: { appName: '消息', appId: 'chat', featureId: 'obsidianDiary', purpose: '一键写角色日记', charId: char.id, charName: char.name, relayPriority: 'user' },
    });
    const choice = data?.choices?.[0];
    if (choice?.message?.tool_calls?.length || choice?.message?.function_call || choice?.message?.refusal)
        throw new Error('模型返回了工具调用或拒绝信息，没有生成可保存的日记');
    const finish = choice?.finish_reason;
    const parsed = parseManualObsidianDiary(extractContent(data), !!finish && finish !== 'stop');
    const issue = await frozenIssue({ charId: char.id, target, isCurrent: input.isCurrent });
    const record = await enqueueObsidianDiary({
        charId: char.id,
        charName: char.name,
        title: parsed.title,
        mood: parsed.mood,
        content: parsed.content,
        sourceId: input.sourceId,
        incomplete: parsed.incomplete,
    }, undefined, { target, initialBlockedMessage: issue || undefined });
    if (record.status !== 'queued') return record;
    const guard = async () => {
        const reason = await frozenIssue({ charId: char.id, target, isCurrent: input.isCurrent });
        if (reason) throw safeGuardError(reason);
    };
    await guard();
    await saveObsidianDiary(record.id, signal, guard);
    return (await listObsidianDiaries()).find(item => item.id === record.id) || {
        ...record,
        status: 'failed',
        message: `${diaryStateLabel.failed}；本地原稿仍在`,
    };
}
