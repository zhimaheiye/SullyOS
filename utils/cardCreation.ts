import type { APIConfig, CharacterProfile, UserProfile } from '../types';
import { DB } from './db';
import { computeContextRangeSnapshot, getMemoryPalaceHighWaterMarkForContext } from './chatContextRange';
import { ChatPrompts } from './chatPrompts';
import { ContextBuilder } from './context';
import { MemoryNodeDB } from './memoryPalace/db';
import { buildHtmlPrompt } from './htmlPrompt';
import { extractRepairSegments } from './htmlFormatRepair';
import { resolveDialogueApi } from './characterApi';
import { extractContent, safeFetchJson } from './safeApi';
import { flattenImageContentParts } from './promptMessageCleanup';
import { makeDebugLogger } from './devDebug';
import { isManualRelayEnabled } from './manualModelRelay';

export interface CardDraft { html: string; textPreview: string }
export type CardCreationStage = 'history' | 'context' | 'http' | 'headers' | 'body' | 'parse';
const CARD_WAIT_MS = 180_000;
const traceLog = makeDebugLogger('api', 'CardCreation');

// Some old text records contain an inline image token instead of a structured image part.
// Keep the surrounding conversation, but never let the network boundary expand that token.
function stripHistoricalImageTokens(value: string): string {
    return value
        .replace(/data:image\/[\w.+-]+;base64,[a-z\d+/=]+/gi, '[图片原图未提供]')
        .replace(/blobref:[a-z\d_-]+/gi, '[图片原图未提供]');
}

/** Provider errors can echo private URLs or credentials. Keep the status and useful cause only. */
export function cardCreationErrorMessage(cause: unknown): string {
    const message = cause instanceof Error ? cause.message : String(cause || '');
    if (message === 'CARD_CREATION_TIMEOUT') return '等待已超过 180 秒，已在本地取消等待；服务端是否完成未知。可检查调用记录后手动重试。';
    if (cause instanceof Error && cause.name === 'AbortError') return '请求已中断，可手动重试。';
    if (/\b429\b/.test(message) && /global concurrency limit|server busy/i.test(message)) {
        return 'API Error 429：服务端全局并发繁忙，请稍后手动重试。';
    }
    if (/\b500\b/.test(message) && /image\/gif|mime type is not supported/i.test(message)) {
        return 'API Error 500：中转或模型不支持 image/gif。历史图片已改为仅发送文字；若仍出现请保留调用记录。';
    }
    return (message || '生成失败，请重试')
        .replace(/data:[^\s"']+/gi, '[图片数据已隐藏]')
        .replace(/blobref:[a-z\d_-]+/gi, '[图片引用已隐藏]')
        .replace(/https?:\/\/[^\s"']+/gi, '[链接已隐藏]')
        .replace(/\b(?:sk-|Bearer\s+)[a-z\d._~+/-]{8,}/gi, '[凭据已隐藏]')
        .slice(0, 240);
}

/** The repair scanner checks original tag balance; the creation route additionally requires one exact div envelope. */
export function parseCreatedCard(raw: string): CardDraft {
    const source = raw.trim();
    const wrapped = /^\[html\]([\s\S]*)\[\/html\]$/i.exec(source);
    if (!wrapped) throw new Error('没有收到完整的 [html] 单卡，请重试');
    const segments = extractRepairSegments(source);
    if (segments.length !== 1 || segments[0].kind !== 'html' || !/^<div\b/i.test(segments[0].html)) {
        throw new Error('卡片结构不完整或包含多张卡，请重试');
    }
    const inner = wrapped[1].trim();
    if (segments[0].html !== inner) throw new Error('卡片含有额外文字或结构不完整，请重试');
    if (!segments[0].textPreview.trim()) throw new Error('卡片没有可阅读的文字，请重试');
    return { html: segments[0].html, textPreview: segments[0].textPreview };
}

const CARD_RULES = `\n\n# 本轮卡片创作任务（覆盖普通聊天的输出格式）
用户描述的是创作需求，不是待发送的聊天消息。只输出一张完整卡片，格式必须严格为 [html]<div style="width:270px;">…</div>[/html]。
除这一对标签及其中的单个 div 外，不输出普通台词、说明、第二张卡、Markdown 围栏、工具命令或思考过程。
保持角色身份与可见上下文；不执行任何现实提醒、排程、搜索、生图或其他工具动作。`;

export async function buildReadOnlyCreationMessages(char: CharacterProfile, user: UserProfile, request: string, instructions: string, onHistoryReady?: () => void) {
    // Do not route this through buildChatRequestPayload: appPrompt suppresses htmlActive there,
    // while the ordinary chat path performs mutable memory/vision and reply preparation.
    // Read the raw store without loadCharacterContextRange/ensureHomeContextMessages: those can seal or
    // migrate records. Apply the same range and high-water policy to this immutable snapshot.
    const source = await DB.peekMessagesByCharId(char.id);
    const range = computeContextRangeSnapshot(source, char, getMemoryPalaceHighWaterMarkForContext(char.id));
    const { apiMessages } = ChatPrompts.buildMessageHistory(
        range.messages, Math.max(1, range.messages.length), char, user, [], undefined,
        { contextHighWaterMark: range.hwm, protectPendingChatTurn: true, useVisionDescriptions: true },
    );
    const textHistory = flattenImageContentParts(apiMessages).map(message => ({
        ...message,
        content: stripHistoricalImageTokens(String(message.content))
            .replace(/请结合随附的表情包图片理解它实际表达的语气和含义。/g, '原图未提供，仅可依据表情名称理解。'),
    }));
    onHistoryReady?.();
    // The normal palace recall updates access counts and coactivation. Use a bounded read-only
    // character-scoped snapshot instead; ContextBuilder also includes the character's saved memories.
    let palace = '';
    if (char.memoryPalaceEnabled) {
        const nodes = await MemoryNodeDB.getByCharId(char.id);
        palace = nodes
            .filter(node => !node.archived && !node.storyTimelineScope && !node.groupId && node.content.trim())
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, 12)
            .map(node => `- ${node.content.slice(0, 500)}`)
            .join('\n');
    }
    const messages = await ContextBuilder.buildCharacterRequest({
        char: { ...char, memoryPalaceInjection: palace, roomPlatesInjection: '' },
        user,
        includeLifeContext: false,
        instructions,
    }, [...textHistory, { role: 'user', content: request }] as Array<{ role: 'user' | 'assistant' | 'system'; content: string }>);
    return messages;
}

export async function buildCardCreationMessages(char: CharacterProfile, user: UserProfile, request: string, onHistoryReady?: () => void) {
    return buildReadOnlyCreationMessages(char, user, request, `${buildHtmlPrompt(char.htmlModeCustomPrompt)}${CARD_RULES}`, onHistoryReady);
}

/** A single completion with no tools and no chat lifecycle callbacks. It never persists a draft. */
export async function generateCardDraft(input: {
    char: CharacterProfile; user: UserProfile; api: APIConfig; request: string; signal: AbortSignal;
    traceId?: string; onStage?: (stage: CardCreationStage) => void;
}): Promise<CardDraft> {
    const { char, user, api, request, signal, onStage } = input;
    if (!request.trim()) throw new Error('请先描述想要的卡片');
    const selected = resolveDialogueApi(api, char);
    const manualRelay = isManualRelayEnabled();
    if (!manualRelay && (!selected.baseUrl || !selected.model)) throw new Error('请先配置当前角色的聊天 API');
    const traceId = input.traceId || `card-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const started = performance.now();
    const local = new AbortController();
    let lastStage: CardCreationStage | 'start' = 'start';
    let lastAt = started;
    const stage = (next: CardCreationStage, status?: number) => {
        if (local.signal.aborted) return;
        const now = performance.now();
        traceLog.info('stage', { traceId, stage: next, previousMs: Math.round(now - lastAt), elapsedMs: Math.round(now - started), ...(status == null ? {} : { status }) });
        lastStage = next;
        lastAt = now;
        try { onStage?.(next); } catch { /* progress feedback must not fail generation */ }
    };
    traceLog.info('start', { traceId });
    let rejectWait!: (reason: Error) => void;
    const waitEnd = new Promise<never>((_resolve, reject) => { rejectWait = reject; });
    const cancel = () => { local.abort(); rejectWait(new DOMException('已停止生成', 'AbortError')); };
    if (signal.aborted) cancel();
    else signal.addEventListener('abort', cancel, { once: true });
    const timeout = setTimeout(() => { local.abort(); rejectWait(new Error('CARD_CREATION_TIMEOUT')); }, manualRelay ? 35 * 60_000 : CARD_WAIT_MS);
    try {
        const task = async () => {
            stage('history');
            const messages = await buildCardCreationMessages(char, user, request, () => {
                local.signal.throwIfAborted();
                stage('context');
            });
            local.signal.throwIfAborted();
            stage('http');
            const response = await safeFetchJson(`${selected.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST', signal: local.signal,
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${selected.apiKey || 'sk-none'}` },
                body: JSON.stringify({ model: selected.model, messages, temperature: selected.temperature ?? api.temperature ?? 0.85, max_tokens: 8000, stream: false }),
            }, 0, 0, { appName: '消息', charId: char.id, charName: char.name, purpose: '卡片创作预览' }, undefined, {
                requestId: traceId,
                onHeaders: status => stage('headers', status),
                onBody: status => stage('body', status),
            });
            local.signal.throwIfAborted();
            stage('parse');
            return parseCreatedCard(extractContent(response));
        };
        return await Promise.race([task(), waitEnd]);
    } catch (cause) {
        const message = cause instanceof Error ? cause.message : '';
        traceLog.warn('error', {
            traceId, stage: lastStage, elapsedMs: Math.round(performance.now() - started),
            outcome: message === 'CARD_CREATION_TIMEOUT' ? 'timeout' : cause instanceof Error && cause.name === 'AbortError' ? 'cancelled' : 'failed',
            status: /\b(429|500)\b/.exec(message)?.[1],
        });
        throw cause;
    } finally {
        clearTimeout(timeout);
        signal.removeEventListener('abort', cancel);
        traceLog.info('finally', { traceId, stage: lastStage, elapsedMs: Math.round(performance.now() - started) });
    }
}

export async function publishCardDraft(charId: string, draft: CardDraft): Promise<number> {
    return DB.saveMessage({
        charId, role: 'assistant', type: 'html_card',
        content: `[HTML卡片] ${draft.textPreview}`,
        metadata: { htmlSource: draft.html, htmlTextPreview: draft.textPreview },
    });
}
