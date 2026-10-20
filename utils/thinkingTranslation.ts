import type { CharacterProfile, Message } from '../types';
import type { MemoryPalaceGlobalConfig } from '../context/OSContext';
import { normalizeApiBaseUrl, normalizeApiCredential, normalizeApiModel } from './apiConfigNormalize';
import { DB } from './db';
import { safeFetchJson } from './safeApi';
import { resolveFeatureApi } from './featureApi';

const SETTING_KEY = 'sully-thinking-auto-translate-v1';
const MAX_SOURCE_LENGTH = 20_000;
const pending = new Map<string, Promise<ThinkingTranslationCache>>();

export interface ThinkingTranslationCache {
    version: 1;
    source: string;
    text: string;
}

export function loadThinkingAutoTranslate(): boolean {
    try { return localStorage.getItem(SETTING_KEY) === '1'; } catch { return false; }
}

export function saveThinkingAutoTranslate(enabled: boolean): void {
    try {
        if (enabled) localStorage.setItem(SETTING_KEY, '1');
        else localStorage.removeItem(SETTING_KEY);
    } catch { /* storage can be unavailable */ }
}

/** Conservative: Chinese prose with a few English terms is already readable. */
export function shouldTranslateThinking(source: string): boolean {
    const prose = source.replace(/```[\s\S]*?```|`[^`]*`|https?:\/\/\S+/g, ' ');
    const han = (prose.match(/[\u3400-\u9fff]/g) || []).length;
    const latin = (prose.match(/[a-zA-Z]/g) || []).length;
    const kana = (prose.match(/[\u3040-\u30ff]/g) || []).length;
    const hangul = (prose.match(/[\uac00-\ud7af]/g) || []).length;
    if (kana >= 8 && kana >= han) return true;
    if (hangul >= 8 && hangul > han) return true;
    if (han >= 8 && han * 2 >= latin + kana + hangul) return false;
    return latin >= 24 && latin > han * 3;
}

export function thinkingSourceFingerprint(source: string): string {
    // 64-bit FNV-1a, includes every original character and a format version.
    let hash = 0xcbf29ce484222325n;
    for (let i = 0; i < source.length; i++) {
        hash ^= BigInt(source.charCodeAt(i));
        hash = (hash * 0x100000001b3n) & 0xffffffffffffffffn;
    }
    return `v1:${source.length}:${hash.toString(16)}`;
}

export function readThinkingTranslation(message: Message): ThinkingTranslationCache | null {
    const source = message.metadata?.thinkingChain;
    const cache = message.metadata?.thinkingTranslation;
    if (typeof source !== 'string' || !source.trim() || !cache || cache.version !== 1
        || cache.source !== thinkingSourceFingerprint(source) || typeof cache.text !== 'string'
        || !cache.text.trim()) return null;
    return cache as ThinkingTranslationCache;
}

export function freshForeignThinkingMessages(messages: Message[], afterId: number, charId: string, earliestTimestamp = 0): Message[] {
    return messages.filter(message => message.id > afterId && message.charId === charId
        && message.timestamp >= earliestTimestamp && message.role === 'assistant' && message.type === 'text'
        && typeof message.metadata?.thinkingChain === 'string'
        && shouldTranslateThinking(message.metadata.thinkingChain)
        && !readThinkingTranslation(message));
}

type TranslationApi = { baseUrl: string; apiKey: string; model: string };
export function selectThinkingTranslationApi(
    memory: Pick<MemoryPalaceGlobalConfig, 'lightLLM'> | null | undefined,
    character: Pick<CharacterProfile, 'emotionConfig'> | null | undefined,
): TranslationApi | null {
    const selected = resolveFeatureApi('thinkingTranslation', { memoryApi: memory?.lightLLM, character });
    return selected.api ? { baseUrl: normalizeApiBaseUrl(selected.api.baseUrl),
        apiKey: normalizeApiCredential(selected.api.apiKey), model: normalizeApiModel(selected.api.model) } : null;
}

export async function requestThinkingTranslation(
    message: Message,
    memory: Pick<MemoryPalaceGlobalConfig, 'lightLLM'> | null | undefined,
    character: Pick<CharacterProfile, 'emotionConfig'> | null | undefined,
): Promise<ThinkingTranslationCache> {
    const source = message.metadata?.thinkingChain;
    if (!Number.isInteger(message.id) || message.id <= 0 || typeof source !== 'string' || !source.trim()) throw new Error('这条心象没有可翻译的原文');
    if (source.length > MAX_SOURCE_LENGTH) throw new Error('心象太长，暂时无法翻译');
    const fingerprint = thinkingSourceFingerprint(source);
    const key = `${message.charId}:${message.id}:${fingerprint}`;
    const existing = pending.get(key);
    if (existing) return existing;
    const task = (async () => {
        const current = await DB.getMessageById(message.id);
        if (!current || current.charId !== message.charId || current.metadata?.thinkingChain !== source) throw new Error('心象已经更改');
        const currentCache = readThinkingTranslation(current);
        if (currentCache) return currentCache;
        const api = selectThinkingTranslationApi(memory, character);
        if (!api) throw new Error('请先配置心象翻译副 API，或配置记忆轻量/角色情绪副 API');
        let data: any;
        try { data = await safeFetchJson(`${api.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.apiKey}` },
            body: JSON.stringify({
                model: api.model,
                messages: [
                    { role: 'system', content: '请把下一条心象忠实译成自然中文。保持原意、第一人称、称呼、情绪强弱、停顿、碎碎念和换行；专有名词、代码与必要标签原样保留。不要扩写、删减、总结或改写角色关系，不写分析报告。只返回译文。' },
                    { role: 'user', content: source },
                ],
                stream: false,
                temperature: 0.2,
                max_tokens: 12000,
            }),
        }, 0, 45_000, { appName: '私聊', purpose: '心象翻译', featureId: 'thinkingTranslation' }); }
        catch (error) {
            const detail = error instanceof Error ? error.message : '';
            if (/\b401\b|\b403\b/.test(detail)) throw new Error('副 API 凭据无效（HTTP 401/403）');
            if (/\b429\b/.test(detail)) throw new Error('副 API 暂时限流（HTTP 429）');
            if (/\b5\d\d\b/.test(detail)) throw new Error('副 API 暂时不可用，请稍后重试');
            if (/timeout|abort/i.test(detail)) throw new Error('翻译超时，请重试');
            if (/JSON|HTML|空响应/i.test(detail)) throw new Error('副 API 返回格式异常，请重试');
            throw new Error('翻译请求失败，请检查网络后重试');
        }
        const content = data?.choices?.[0]?.message?.content;
        const translated = typeof content === 'string' ? content.trim() : Array.isArray(content)
            ? content.map(part => typeof part?.text === 'string' ? part.text : '').join('').trim() : '';
        if (!translated) throw new Error('副 API 没有返回译文');
        const result: ThinkingTranslationCache = { version: 1, source: fingerprint, text: translated };
        let saved = false;
        await DB.updateMessageMetadata(message.id, (previous, row) => {
            if (row.charId !== message.charId || previous?.thinkingChain !== source) return previous;
            saved = true;
            return { ...(previous || {}), thinkingTranslation: result };
        });
        if (!saved) throw new Error('心象已经更改');
        return result;
    })();
    pending.set(key, task);
    try { return await task; } finally { pending.delete(key); }
}
