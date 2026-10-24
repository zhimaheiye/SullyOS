import type { APIConfig, CharacterProfile, UserProfile } from '../types';
import { buildGroupSideStoryMessages, type GroupSideStorySource } from './groupSideStory';
import { buildReadOnlyCreationMessages } from './cardCreation';
import { resolveDialogueApi } from './characterApi';
import { extractContent, safeFetchJson } from './safeApi';
import { expandPromptMacros } from './worldbook';
import { makeDebugLogger } from './devDebug';
import { isManualRelayEnabled } from './manualModelRelay';

export type SideStoryStage = 'history' | 'context' | 'http' | 'headers' | 'body';
export interface SideStoryResult { text: string; complete: boolean; finishReason: string | null }
const log = makeDebugLogger('api', 'SideStoryCreation');
const IDLE_MS = 150_000;
const MAX_MS = 900_000;

const RULES = `# 本轮临时番外创作
这是角色专为用户演绎的一次独立、非正史的长篇文字创作。尊重现有角色性格、人设、用户设定、关系阶段、故事知情范围和可见聊天背景；用户本轮指定的题材、视角、文风和篇幅优先。情节不会推进真实聊天，虚构的童年、相遇或未来不成为主线事实。无需状态栏。
自由输出完整可读文字，可有标题、章节、叙事、台词、前言、后记或附言；不要求 HTML、JSON 或固定分隔符。不要调用工具、安排提醒或执行现实活动。尽量满足用户指定篇幅；一轮输出不足时自然停在可续写的位置，不声称已经达标。`;

export function sideStoryErrorMessage(cause: unknown): string {
    const message = cause instanceof Error ? cause.message : String(cause || '');
    if (message === 'SIDE_STORY_IDLE_TIMEOUT') return '长时间没有收到新正文，本轮未完成。可手动继续写或重新生成。';
    if (message === 'SIDE_STORY_MAX_TIMEOUT') return '本轮等待已到上限，正文已保留。可手动继续写。';
    if (message === 'GROUP_SIDE_STORY_CHANGED') return '群聊或成员范围已变化，请关闭后重新打开番外创作。';
    if (cause instanceof Error && cause.name === 'AbortError') return '本轮已停止，已收到的正文仍在此页。';
    if (/\b429\b/.test(message)) return 'API Error 429：服务端暂时繁忙或额度受限，本轮未完成。';
    const status = /\b(?:API Error|HTTP)\s*(\d{3})\b/i.exec(message)?.[1];
    if (status) return `API Error ${status}：本轮未完成，请检查服务状态后手动继续写或重试。`;
    if (/配置当前角色的聊天 API/.test(message)) return '请先配置当前角色的聊天 API';
    if (/没有返回正文/.test(message)) return '模型没有返回正文，本轮未完成';
    return '生成失败，本轮未完成；可手动继续写或重试。';
}

export function countSideStoryCharacters(text: string): number {
    return Array.from(text).filter(char => /[\p{L}\p{N}]/u.test(char)).length;
}

/** Keeps the opening and recent ending; never sends an unbounded chain of previous drafts. */
export function sideStoryContinuationContext(text: string): string {
    if (text.length <= 30_000) return text;
    return `${text.slice(0, 4_000)}\n\n[前文中段已省略；请以结尾承接，不重写开头]\n\n${text.slice(-26_000)}`;
}

export async function buildSideStoryMessages(char: CharacterProfile, user: UserProfile, request: string, previous: string, onHistoryReady?: () => void) {
    const compiled = expandPromptMacros(request, char.name, user.name);
    const messages = await buildReadOnlyCreationMessages(char, user, compiled, RULES, onHistoryReady);
    if (previous) {
        messages.push({ role: 'assistant', content: sideStoryContinuationContext(previous) });
        messages.push({ role: 'user', content: '请从上文结尾继续写，不重写开头或大段复述。保持原始创作要求、角色视角和文风；只写接下来的正文。' });
    }
    return messages;
}

/** One explicitly requested completion. All draft data stays with the caller. */
export async function generateSideStory(input: {
    char?: CharacterProfile; group?: GroupSideStorySource; user: UserProfile; api: APIConfig; request: string; previous?: string;
    signal: AbortSignal; stillCurrent?: () => boolean;
    onText?: (text: string) => void; onStage?: (stage: SideStoryStage) => void;
}): Promise<SideStoryResult> {
    const { char, group, user, api, request, previous = '', signal, stillCurrent, onText, onStage } = input;
    if ((!char && !group) || (char && group)) throw new Error('无效的番外创作来源');
    if (!request.trim()) throw new Error('请先写下番外创作需求');
    const selected = group ? api : resolveDialogueApi(api, char!);
    const manualRelay = isManualRelayEnabled();
    if (!manualRelay && (!selected.baseUrl || !selected.model)) throw new Error(group ? '请先配置群聊聊天 API' : '请先配置当前角色的聊天 API');
    const started = performance.now();
    let currentStage: SideStoryStage = 'history';
    let text = '';
    const local = new AbortController();
    let rejectWait!: (reason: Error) => void;
    const waitEnd = new Promise<never>((_resolve, reject) => { rejectWait = reject; });
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const fail = (reason: Error) => { local.abort(); rejectWait(reason); };
    const armIdle = () => {
        if (idleTimer) clearTimeout(idleTimer);
        idleTimer = setTimeout(() => fail(new Error('SIDE_STORY_IDLE_TIMEOUT')), IDLE_MS);
    };
    const stage = (next: SideStoryStage) => {
        if (local.signal.aborted) return;
        currentStage = next;
        onStage?.(next);
        if (!manualRelay) armIdle();
    };
    const abort = () => fail(new DOMException('已停止生成', 'AbortError'));
    if (signal.aborted) abort(); else signal.addEventListener('abort', abort, { once: true });
    const maxTimer = setTimeout(() => fail(new Error('SIDE_STORY_MAX_TIMEOUT')), manualRelay ? 35 * 60_000 : MAX_MS);
    if (!manualRelay) armIdle();
    log.info('start', { stage: currentStage });
    try {
        const task = async () => {
            stage('history');
            const messages = group
                ? await buildGroupSideStoryMessages(group, user, request, () => { local.signal.throwIfAborted(); stage('context'); })
                : await buildSideStoryMessages(char!, user, request, previous, () => { local.signal.throwIfAborted(); stage('context'); });
            if (group && previous) {
                messages.push({ role: 'assistant', content: sideStoryContinuationContext(previous) });
                messages.push({ role: 'user', content: '请从上文结尾继续写，不重写开头或大段复述。保持原始群像创作要求和角色知情边界；只写接下来的正文。' });
            }
            local.signal.throwIfAborted();
            if (group && stillCurrent && !stillCurrent()) throw new Error('GROUP_SIDE_STORY_CHANGED');
            stage('http');
            const hooks = { onDelta: (_delta: string, fullText: string) => {
                if (local.signal.aborted) return;
                if (group && stillCurrent && !stillCurrent()) { local.abort(); return; }
                text = fullText;
                stage('body');
                onText?.(text);
            } };
            const meta = group
                ? { appName: '群聊', purpose: '临时群聊番外创作' }
                : { appName: '消息', charId: char!.id, charName: char!.name, purpose: '临时番外创作' };
            const response = await safeFetchJson(`${selected.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST', signal: local.signal,
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${selected.apiKey || 'sk-none'}` },
                body: JSON.stringify({ model: selected.model, messages, temperature: selected.temperature ?? api.temperature ?? 0.85, max_tokens: 16_000, stream: true }),
            }, 0, 0, meta, hooks, {
                privateTransient: true, onHeaders: () => stage('headers'), onBody: () => stage('body'),
            });
            local.signal.throwIfAborted();
            const rawContent = response?.choices?.[0]?.message?.content;
            const finalText = typeof rawContent === 'string' ? rawContent : extractContent(response);
            if (finalText) text = finalText;
            onText?.(text);
            if (!text.trim()) throw new Error('模型没有返回正文，本轮未完成');
            const finishReason = response?.choices?.[0]?.finish_reason ?? null;
            return { text, complete: finishReason === 'stop', finishReason };
        };
        return await Promise.race([task(), waitEnd]);
    } catch (cause) {
        log.warn('end', { stage: currentStage, elapsedMs: Math.round(performance.now() - started), outcome: cause instanceof Error && cause.name === 'AbortError' ? 'cancelled' : 'failed', status: /\b(429|500)\b/.exec(cause instanceof Error ? cause.message : '')?.[1] });
        throw cause;
    } finally {
        clearTimeout(maxTimer);
        if (idleTimer) clearTimeout(idleTimer);
        signal.removeEventListener('abort', abort);
        log.info('finally', { stage: currentStage, elapsedMs: Math.round(performance.now() - started) });
    }
}
