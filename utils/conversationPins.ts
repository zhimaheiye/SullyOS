import type { ConversationSummary } from './conversationList';

export type ConversationPin = Pick<ConversationSummary, 'kind' | 'id'>;
export const CONVERSATION_PINS_KEY = 'sully-recent-conversation-pins-v1';
export const CONVERSATION_PINS_EVENT = 'sully-recent-conversation-pins-changed';
export const CONVERSATION_PINS_EPOCH = 'sully-recent-conversation-pins-epoch';
export const conversationKey = (item: ConversationPin) => `${item.kind}:${item.id}`;

/** Array order is the successful pin order, newest first. No message data is stored. */
export function normalizeConversationPins(value: unknown): ConversationPin[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value.filter((item): item is ConversationPin => {
        if (!item || !['private', 'group'].includes(item.kind) || typeof item.id !== 'string' || !item.id.trim()) return false;
        const key = conversationKey(item);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    }).map(({ kind, id }) => ({ kind, id }));
}

export function readConversationPins(): { pins: ConversationPin[]; problem: string } {
    try {
        const raw = localStorage.getItem(CONVERSATION_PINS_KEY);
        if (raw === null) return { pins: [], problem: '' };
        const parsed = JSON.parse(raw);
        if (parsed?.version !== 1 || !Array.isArray(parsed.pins)) throw Error('Invalid pin preferences');
        return { pins: normalizeConversationPins(parsed.pins), problem: '' };
    } catch {
        return { pins: [], problem: '置顶设置读取失败，暂按消息时间显示。可重新尝试置顶。' };
    }
}

export function conversationPinsEpoch(): string {
    let epoch = localStorage.getItem(CONVERSATION_PINS_EPOCH);
    if (!epoch) {
        epoch = crypto.randomUUID();
        localStorage.setItem(CONVERSATION_PINS_EPOCH, epoch);
    }
    return epoch;
}

const announce = () => {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(CONVERSATION_PINS_EVENT));
};

/** Invalidates queued UI writes even when an old backup has no pin field. */
export function beginConversationPinsRestore() {
    const epoch = `restoring:${crypto.randomUUID()}`;
    try { localStorage.setItem(CONVERSATION_PINS_EPOCH, epoch); }
    catch {
        // Removing the old capability also invalidates it when storage is full.
        try { localStorage.removeItem(CONVERSATION_PINS_EPOCH); } catch { /* Writes cannot proceed on this surface. */ }
    }
    announce();
    return {
        epoch,
        finish: () => {
            try {
                if (localStorage.getItem(CONVERSATION_PINS_EPOCH) === epoch) localStorage.removeItem(CONVERSATION_PINS_EPOCH);
            } catch {
                // This metadata must not block an otherwise valid old backup.
            } finally { announce(); }
        },
    };
}

/** Existing IDB readwrite scheduling serializes synchronous localStorage merges across tabs.
 * The transaction creates no lock row, schema, or additional copy of these preferences.
 */
async function commitPins(epoch: string, edit?: { target: ConversationPin; pinned: boolean }, restore?: ConversationPin[]) {
    const { openDB } = await import('./db');
    const db = await openDB();
    return new Promise<void>((resolve, reject) => {
        const tx = db.transaction(['assets', 'characters', 'groups'], 'readwrite');
        const characters = tx.objectStore('characters').getAllKeys();
        const groups = tx.objectStore('groups').getAllKeys();
        const gate = tx.objectStore('assets').get(CONVERSATION_PINS_KEY);
        let failure: unknown, changed = false;
        gate.onsuccess = () => {
            try {
                if (conversationPinsEpoch() !== epoch) throw Error('存档已变化，本次置顶未保存，可重试');
                if (epoch.startsWith('restoring:') && restore === undefined) throw Error('正在恢复存档，请完成后重试');
                const current = readConversationPins();
                if (current.problem && !edit && restore === undefined) return;
                const exists = (pin: ConversationPin) => (pin.kind === 'private' ? characters.result : groups.result).includes(pin.id);
                let pins = (restore ?? current.pins).filter(exists);
                if (edit) {
                    if (!exists(edit.target)) throw Error('此会话已删除，本次置顶未保存');
                    const key = conversationKey(edit.target);
                    pins = pins.filter(pin => conversationKey(pin) !== key);
                    if (edit.pinned) pins.unshift({ kind: edit.target.kind, id: edit.target.id });
                }
                if (!edit && restore === undefined && JSON.stringify(pins) === JSON.stringify(current.pins)) return;
                localStorage.setItem(CONVERSATION_PINS_KEY, JSON.stringify({ version: 1, pins }));
                changed = true;
            } catch (error) { failure = error; tx.abort(); }
        };
        tx.oncomplete = () => { if (changed) announce(); resolve(); };
        tx.onabort = tx.onerror = () => reject(failure ?? tx.error ?? Error('置顶未保存，可重试'));
    });
}

export const setConversationPinned = (target: ConversationPin, pinned: boolean, epoch: string) => commitPins(epoch, { target, pinned });
export const pruneConversationPins = (epoch: string) => commitPins(epoch);
export const restoreConversationPins = (pins: unknown, epoch: string) => commitPins(epoch, undefined, normalizeConversationPins(pins));

export function sortPinnedConversations(items: ConversationSummary[], pins: ConversationPin[]) {
    const positions = new Map(pins.map((pin, index) => [conversationKey(pin), index]));
    const time = (value: number) => Number.isFinite(value) ? value : 0;
    return [...items].sort((a, b) => {
        const aPin = positions.get(conversationKey(a)), bPin = positions.get(conversationKey(b));
        if (aPin !== undefined || bPin !== undefined) return (aPin ?? Infinity) - (bPin ?? Infinity);
        const byTime = time(b.timestamp) - time(a.timestamp);
        return byTime || conversationKey(a).localeCompare(conversationKey(b));
    });
}
