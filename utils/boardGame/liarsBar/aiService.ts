import type { APIConfig, CharacterProfile, GroupProfile, RealtimeConfig, UserProfile } from '../../../types';
import { buildChatRequestPayload } from '../../chatRequestPayload';
import { DB } from '../../db';
import { extractContent, safeFetchJson } from '../../safeApi';
import { parseLiarsBarAction } from './parser';
import { buildLiarsBarPrompt } from './prompt';
import type { LiarsBarAction, LiarsBarPlayerView } from './types';

const endpoint = (config: APIConfig) => {
    const baseUrl = config.baseUrl?.replace(/\/+$/, '');
    if (!baseUrl || !config.model) throw new Error('请先在设置中配置聊天 API');
    return `${baseUrl}/chat/completions`;
};

export interface LiarsBarAIInput {
    char: CharacterProfile;
    userProfile: UserProfile;
    groups: GroupProfile[];
    apiConfig: APIConfig;
    realtimeConfig: RealtimeConfig;
    view: LiarsBarPlayerView;
    signal?: AbortSignal;
}

export async function buildLiarsBarCharacterContext(input: LiarsBarAIInput) {
    const { char, userProfile, groups, realtimeConfig, view, signal } = input;
    signal?.throwIfAborted();
    const [historyMsgs, emojis, categories] = await Promise.all([
        DB.getMessagesByCharId(char.id), DB.getEmojis(), DB.getEmojiCategories(),
    ]);
    const others = view.players.filter(player => player.actorId !== view.actorId).map(player => player.name).join('、');
    const payload = await buildChatRequestPayload({
        char, userProfile, groups, historyMsgs, emojis, categories,
        contextLimit: Math.max(1, char.contextLimit || 500), realtimeConfig,
        stripImages: true, disableMcp: true,
        recallQueryHint: `你正在和用户、${others}一起玩骗子酒馆。可以回忆你们真实存在的关系和相处方式来判断他们，但不要捏造共同经历。`,
    });
    signal?.throwIfAborted();
    return payload;
}

export async function requestLiarsBarJson<T>(input: {
    apiConfig: APIConfig;
    messages: Array<{ role: string; content: unknown }>;
    parse: (raw: string) => T;
    signal?: AbortSignal;
    char?: CharacterProfile;
    batch?: boolean;
}): Promise<T> {
    const { apiConfig, messages, signal, char } = input;
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        signal?.throwIfAborted();
        try {
            const data = await safeFetchJson(endpoint(apiConfig), {
                method: 'POST',
                signal,
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiConfig.apiKey || 'sk-none'}` },
                body: JSON.stringify({
                    model: apiConfig.model,
                    messages: attempt === 0 ? messages : [...messages, { role: 'user', content: '上一次未返回合法行动 JSON，请严格按指定格式重新输出。不要输出思维过程。' }],
                    temperature: apiConfig.temperature ?? 0.75, max_tokens: input.batch ? 2400 : 800, stream: false,
                }),
            }, 0, 90000, { appName: '桌游·骗子酒馆', charId: char?.id, charName: char?.name, purpose: input.batch ? 'liars-bar-batch' : 'liars-bar-action' });
            signal?.throwIfAborted();
            const raw = extractContent(data).trim();
            if (!raw) throw new Error('角色没有返回有效行动');
            return input.parse(raw);
        } catch (error) {
            signal?.throwIfAborted();
            lastError = error;
        }
    }
    throw lastError instanceof Error ? lastError : new Error('角色暂时没有做出有效行动');
}

export async function requestLiarsBarAction(input: LiarsBarAIInput): Promise<LiarsBarAction> {
    const payload = await buildLiarsBarCharacterContext(input);
    return requestLiarsBarJson({
        ...input,
        messages: [
            { role: 'system', content: payload.systemPrompt },
            ...payload.cleanedApiMessages,
            { role: 'user', content: buildLiarsBarPrompt(input.view) },
        ],
        parse: raw => parseLiarsBarAction(raw, input.view.legalActions),
    });
}
