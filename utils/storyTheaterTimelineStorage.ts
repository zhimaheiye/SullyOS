import type { Message, StoryTheaterArchive, StoryTheaterEntry } from '../types';
import { openDB } from './db';
import {
    migrateStoryTimeline,
    storyBranchFamilyIds,
    storyDescendantIds,
    storyMessageBranchId,
    storyMessageParentId,
} from './storyTheaterTimeline';

const MESSAGE_STORE = 'messages';
const THEATER_STORE = 'story_theaters';

const waitForTransaction = <T>(transaction: IDBTransaction, value: () => T): Promise<T> => new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve(value());
    transaction.onerror = () => reject(transaction.error || new Error('剧情树事务失败'));
    transaction.onabort = () => reject(transaction.error || new Error('剧情树事务已撤销'));
});

/** 首次打开旧虚构剧情时原子地补齐父节点、分支与精确归档范围。 */
export async function ensureStoryTimeline(entry: StoryTheaterEntry): Promise<{ entry: StoryTheaterEntry; messages: Message[]; migrated: boolean }> {
    if (entry.writesToCharacterMemory) {
        const db = await openDB();
        const transaction = db.transaction(MESSAGE_STORE, 'readonly');
        const request = transaction.objectStore(MESSAGE_STORE).index('charId').getAll(IDBKeyRange.only(`story-theater:${entry.id}`));
        let messages: Message[] = [];
        request.onsuccess = () => { messages = (request.result || []).filter((message: Message) => message.metadata?.source === 'story_theater').sort((a: Message, b: Message) => a.id - b.id); };
        await waitForTransaction(transaction, () => undefined);
        return { entry, messages, migrated: false };
    }

    const db = await openDB();
    const transaction = db.transaction([MESSAGE_STORE, THEATER_STORE], 'readwrite');
    const messageStore = transaction.objectStore(MESSAGE_STORE);
    const theaterStore = transaction.objectStore(THEATER_STORE);
    const request = messageStore.index('charId').getAll(IDBKeyRange.only(`story-theater:${entry.id}`));
    let result = { entry, messages: [] as Message[], migrated: false };

    request.onsuccess = () => {
        const rows = (request.result || []).filter((message: Message) => message.metadata?.source === 'story_theater');
        const migration = migrateStoryTimeline(entry, rows);
        result = { entry: migration.entry, messages: migration.messages, migrated: migration.changed };
        if (!migration.changed) return;
        for (const message of migration.messages) messageStore.put(message);
        theaterStore.put(migration.entry);
    };
    request.onerror = () => transaction.abort();
    return waitForTransaction(transaction, () => result);
}

export interface StoryTimelineDeleteResult {
    entry: StoryTheaterEntry;
    deletedMessageIds: number[];
    invalidatedArchives: StoryTheaterArchive[];
}

function entryAfterTimelineDelete(
    entry: StoryTheaterEntry,
    messages: Message[],
    deletedIds: Set<number>,
    removedBranchIds: Set<string>,
): { entry: StoryTheaterEntry; invalidatedArchives: StoryTheaterArchive[] } {
    const timeline = entry.timeline!;
    const byId = new Map(messages.map(message => [message.id, message]));
    let cursor = timeline.activeCursorMessageId;
    while (cursor !== null && deletedIds.has(cursor)) {
        const current = byId.get(cursor);
        const parent = current ? storyMessageParentId(current) : null;
        cursor = typeof parent === 'number' ? parent : null;
    }
    const survivingMessage = cursor === null ? undefined : byId.get(cursor);
    const survivingBranchId = survivingMessage ? storyMessageBranchId(survivingMessage) : undefined;
    const branches = timeline.branches.filter(branch => !removedBranchIds.has(branch.id));
    const activeBranchId = branches.some(branch => branch.id === timeline.activeBranchId)
        ? timeline.activeBranchId
        : (survivingBranchId && branches.some(branch => branch.id === survivingBranchId) ? survivingBranchId : timeline.rootBranchId);
    const invalidatedArchives = entry.archives.filter(archive => archive.messageIds?.some(id => deletedIds.has(id)));
    const invalidatedIds = new Set(invalidatedArchives.map(archive => archive.id));
    return {
        entry: {
            ...entry,
            timeline: { ...timeline, branches, activeBranchId, activeCursorMessageId: cursor },
            archives: entry.archives.filter(archive => !invalidatedIds.has(archive.id)),
            updatedAt: Date.now(),
        },
        invalidatedArchives,
    };
}

async function commitTimelineDelete(
    entry: StoryTheaterEntry,
    messages: Message[],
    deletedIds: Set<number>,
    removedBranchIds: Set<string>,
): Promise<StoryTimelineDeleteResult> {
    const next = entryAfterTimelineDelete(entry, messages, deletedIds, removedBranchIds);
    const db = await openDB();
    const transaction = db.transaction([MESSAGE_STORE, THEATER_STORE], 'readwrite');
    const messageStore = transaction.objectStore(MESSAGE_STORE);
    for (const id of deletedIds) messageStore.delete(id);
    transaction.objectStore(THEATER_STORE).put(next.entry);
    await waitForTransaction(transaction, () => undefined);
    return { entry: next.entry, deletedMessageIds: [...deletedIds], invalidatedArchives: next.invalidatedArchives };
}

/** 删除一个节点及其全部后代；共享祖先不会进入删除集合。 */
export async function deleteStoryTimelineSubtree(
    entry: StoryTheaterEntry,
    messages: Message[],
    rootMessageId: number,
): Promise<StoryTimelineDeleteResult> {
    if (!entry.timeline || entry.writesToCharacterMemory) throw new Error('只有虚构剧情树支持删除子树');
    const deletedIds = new Set(storyDescendantIds(messages, rootMessageId));
    const removedBranchIds = new Set(entry.timeline.branches
        .filter(branch => branch.id !== entry.timeline!.rootBranchId && branch.forkMessageId !== null && deletedIds.has(branch.forkMessageId))
        .map(branch => branch.id));
    return commitTimelineDelete(entry, messages, deletedIds, removedBranchIds);
}

/** 删除一条分支及其子分支，但保留它们共同的岔路祖先。 */
export async function deleteStoryTimelineBranch(
    entry: StoryTheaterEntry,
    messages: Message[],
    branchId: string,
): Promise<StoryTimelineDeleteResult> {
    if (!entry.timeline || entry.writesToCharacterMemory) throw new Error('只有虚构剧情树支持删除分支');
    if (branchId === entry.timeline.rootBranchId) throw new Error('原始路线不能作为整条分支删除');
    const removedBranchIds = storyBranchFamilyIds(entry.timeline, branchId);
    const deletedIds = new Set(messages.filter(message => {
        const messageBranchId = storyMessageBranchId(message);
        return Boolean(messageBranchId && removedBranchIds.has(messageBranchId));
    }).map(message => message.id));
    return commitTimelineDelete(entry, messages, deletedIds, removedBranchIds);
}
