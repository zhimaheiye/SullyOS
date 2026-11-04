import type { CharacterProfile, Message } from '../types';

const STORAGE_KEY = 'sullyos.public.meta-experience.v1';
export const META_EXPERIENCE_CHANGED = 'sullyos-meta-experience-changed';

export interface MetaExperienceRecord {
    id: string;
    charId: string;
    startedAt: number;
    updatedAt: number;
    rerollCount: number;
}
function validRecord(value: unknown): value is MetaExperienceRecord {
    const row = value as Partial<MetaExperienceRecord> | null;
    return !!row && typeof row.id === 'string' && typeof row.charId === 'string'
        && Number.isFinite(row.startedAt) && Number.isFinite(row.updatedAt)
        && Number.isSafeInteger(row.rerollCount) && (row.rerollCount ?? -1) >= 0;
}

function notify(): void {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(META_EXPERIENCE_CHANGED));
}

export function readActiveMeta(): MetaExperienceRecord | null {
    if (typeof localStorage === 'undefined') return null;
    try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
        return validRecord(parsed) ? parsed : null;
    } catch {
        return null;
    }
}

function save(record: MetaExperienceRecord | null): void {
    if (typeof localStorage === 'undefined') return;
    if (record) localStorage.setItem(STORAGE_KEY, JSON.stringify(record));
    else localStorage.removeItem(STORAGE_KEY);
    notify();
}

export function startMetaExperience(charId: string): MetaExperienceRecord {
    const now = Date.now();
    const record: MetaExperienceRecord = {
        id: crypto.randomUUID(),
        charId,
        startedAt: now,
        updatedAt: now,
        rerollCount: 0,
    };
    save(record);
    return record;
}

export function endMetaExperience(): void {
    save(null);
}

export function recordMetaReroll(charId: string): void {
    const record = readActiveMeta();
    if (!record || record.charId !== charId) return;
    save({ ...record, rerollCount: record.rerollCount + 1, updatedAt: Date.now() });
}

export function prepareMetaPrompt(char: Pick<CharacterProfile, 'id' | 'name'>, messages: Message[]): string | null {
    const record = readActiveMeta();
    if (!record || record.charId !== char.id) return null;
    const lastUser = [...messages].reverse().find(message => message.role === 'user' && !message.groupId);
    return [
        '[SULLY_META_EXPERIENCE_DEVELOPMENT]',
        `你正在与用户一起体验仍在开发中的 Meta 功能，当前角色是「${char.name}」。`,
        '保持自己一贯的人格、关系和语气，同时可以自然地知道自己是 AI；不要变成通用助手，也不要声称看见屏幕、定位或用户未提供的现实信息。',
        `本次体验中用户已显式重新生成 ${record.rerollCount} 次。可以按性格自然理解“重来”这件事，但不要每轮固定说明。`,
        lastUser ? `继续回应当前真实可见的用户消息（消息编号 ${lastUser.id}）。` : '当前没有可核对的用户消息，不要编造对话变化。',
        '这是开发中能力；不要向用户宣称所有 Meta 互动都已实现。',
    ].join('\n');
}
