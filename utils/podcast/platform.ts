import { openDB } from '../db';
import type { Message } from '../../types';
export interface PodcastRecord { id: string; kind: string; [key: string]: any }
export type PlatformSnapshot = { rows: PodcastRecord[]; revision: number; epoch: string };
export type PlatformLease = { platform: 'podcast'; revision: number; epoch: string; canonToken: string };
export type PodcastMode = { token: string; playMode: 'normal' };
export const readPodcastMode = async (): Promise<PodcastMode> => ({ token: 'public', playMode: 'normal' });
const announce = () => window.dispatchEvent(new Event('podcast-updated'));
const storeName = 'podcast_records';
export async function readPlatform(_platform: 'podcast'): Promise<PlatformSnapshot> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const request = db.transaction(storeName).objectStore(storeName).getAll();
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
            const rows: PodcastRecord[] = request.result, meta = rows.find(row => row.id === 'podcast:meta');
            resolve({ rows, revision: Number(meta?.revision) || 0, epoch: String(meta?.epoch || 'initial') });
        };
    });
}
export async function freezePlatform(_platform: 'podcast'): Promise<PlatformLease> {
    const data = await readPlatform('podcast');
    return { platform: 'podcast', revision: data.revision, epoch: data.epoch, canonToken: 'public' };
}
export async function mutatePodcast<T>(prefix: string, mutate: (rows: PodcastRecord[]) => { put?: PodcastRecord[]; remove?: string[]; value: T },
    _token?: string, guard?: { name: string; epoch: string; revision?: number; character?: { id: string; fingerprint: string } }): Promise<T> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([storeName, 'characters'], 'readwrite'), store = tx.objectStore(storeName);
        const owner = guard?.character ? tx.objectStore('characters').get(guard.character.id) : undefined;
        const request = store.getAll();
        let result: T, failure: unknown;
        request.onsuccess = () => {
            try {
                const all: PodcastRecord[] = request.result, meta = all.find(row => row.id === 'podcast:meta');
                if (guard && (String(meta?.epoch || 'initial') !== guard.epoch
                    || (guard.revision !== undefined && (Number(meta?.revision) || 0) !== guard.revision)
                    || (guard.character && JSON.stringify(owner?.result) !== guard.character.fingerprint))) {
                    throw new DOMException('内容或角色已更新，请重试', 'AbortError');
                }
                const change = mutate(all.filter(row => row.id.startsWith(prefix)));
                for (const row of change.put || []) { if (!row.id.startsWith(prefix)) throw Error('存储范围不匹配'); store.put(row); }
                for (const id of change.remove || []) { if (!id.startsWith(prefix)) throw Error('存储范围不匹配'); store.delete(id); }
                result = change.value;
            } catch (error) { failure = error; tx.abort(); }
        };
        tx.oncomplete = () => resolve(result);
        tx.onabort = tx.onerror = () => reject(failure || tx.error || Error('小宇宙保存失败'));
    });
}
export async function updatePlatform<T>(_platform: 'podcast', mutate: (rows: PodcastRecord[]) => { put?: PodcastRecord[]; remove?: string[]; value: T }, lease?: PlatformLease, signal?: AbortSignal, character?: { id: string; fingerprint: string }) {
    signal?.throwIfAborted();
    const value = await mutatePodcast('podcast:', rows => {
        signal?.throwIfAborted();
        const meta = rows.find(row => row.id === 'podcast:meta');
        const change = mutate(rows);
        if (change.put?.some(row => row.id === 'podcast:meta') || change.remove?.includes('podcast:meta')) throw Error('保留记录不可修改');
        return { ...change, put: [...(change.put || []), { id: 'podcast:meta', kind: 'meta', epoch: String(meta?.epoch || 'initial'), revision: (Number(meta?.revision) || 0) + 1 }] };
    }, 'public', lease ? { name: 'podcast', epoch: lease.epoch, revision: lease.revision, character } : undefined);
    announce(); return value;
}
export async function assertPlatformLease(lease: PlatformLease, signal?: AbortSignal) {
    signal?.throwIfAborted(); const current = await readPlatform('podcast');
    if (current.revision !== lease.revision || current.epoch !== lease.epoch) throw new DOMException('内容或存档已更新，请重新生成', 'AbortError');
}
export async function invalidatePodcastStorage() {
    await mutatePodcast('podcast:', rows => { const meta = rows.find(row => row.id === 'podcast:meta');
        return { put: [{ ...meta, id: 'podcast:meta', kind: 'meta', epoch: crypto.randomUUID(), revision: (Number(meta?.revision) || 0) + 1 }], value: undefined }; });
    announce();
}
export const rowId = (_platform: 'podcast', kind: string) => `podcast:${kind}:${crypto.randomUUID()}`;
/** Share and deduplicate inside the same transaction as the session revision check. */
export async function sharePodcastMessage(key: string, message: Omit<Message, 'id' | 'timestamp'>, lease: PlatformLease): Promise<number> {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const tx = db.transaction([storeName, 'messages', 'characters'], 'readwrite');
        const store = tx.objectStore(storeName), messages = tx.objectStore('messages');
        const marker = store.get(key), owner = tx.objectStore('characters').get(message.charId);
        const meta = store.get('podcast:meta'); let id = 0; let failure: unknown;
        meta.onsuccess = () => {
            if (!owner.result || String(meta.result?.epoch || 'initial') !== lease.epoch || (Number(meta.result?.revision) || 0) !== lease.revision) {
                failure = new DOMException('内容或角色已更新，请重试', 'AbortError'); tx.abort(); return;
            }
            if (marker.result) { id = marker.result.messageId; return; }
            const saved = messages.add({ ...message, timestamp: Date.now(), metadata: { ...message.metadata, deliveryId: key } });
            saved.onsuccess = () => { id = saved.result as number; store.put({ id: key, kind: 'share', messageId: id }); };
        };
        tx.oncomplete = () => resolve(id);
        tx.onabort = tx.onerror = () => reject(failure || tx.error || Error('分享未保存'));
    });
}
