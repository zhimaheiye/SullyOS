import type {
    Message,
    StoryTheaterArchive,
    StoryTheaterBranch,
    StoryTheaterEntry,
    StoryTheaterTimelineState,
} from '../types';
import { isVisibleChatMessage } from './chatMessageVisibility';

export const STORY_PARENT_MESSAGE_ID = 'storyParentMessageId';
export const STORY_BRANCH_ID = 'storyBranchId';

export const storyTimelineRootBranchId = (entryId: string): string => `story-root:${entryId}`;
export const storyTimelineVectorPartitionId = (entryId: string, archiveId: string): string => `story-theater:${entryId}:archive:${archiveId}`;

const cleanBranchName = (value: string): string => value
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 28);

export const defaultStoryBranchName = (message?: Message): string => {
    const excerpt = cleanBranchName(message?.content || '');
    return excerpt ? `从「${excerpt}」开始` : '新的可能';
};

export const storyMessageParentId = (message: Message): number | null | undefined => {
    if (!Object.prototype.hasOwnProperty.call(message.metadata || {}, STORY_PARENT_MESSAGE_ID)) return undefined;
    const value = message.metadata?.[STORY_PARENT_MESSAGE_ID];
    if (value === null) return null;
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
};

export const storyMessageBranchId = (message: Message): string | undefined => {
    const value = message.metadata?.[STORY_BRANCH_ID];
    return typeof value === 'string' && value.trim() ? value : undefined;
};

export interface StoryTimelineMigration {
    entry: StoryTheaterEntry;
    messages: Message[];
    changed: boolean;
}

/**
 * 把旧的线性虚构剧情映射为一条根路线。只使用旧楼层顺序做一次迁移，之后不再由 ID 推断拓扑。
 * 真实陪伴明确跳过，保持原有线性合同。
 */
export function migrateStoryTimeline(
    entry: StoryTheaterEntry,
    sourceMessages: Message[],
    now: number = Date.now(),
): StoryTimelineMigration {
    if (entry.writesToCharacterMemory) return { entry, messages: sourceMessages, changed: false };

    const rows = [...sourceMessages].sort((a, b) => a.id - b.id);
    const rootBranchId = entry.timeline?.rootBranchId || storyTimelineRootBranchId(entry.id);
    const existingBranches = entry.timeline?.branches?.filter(branch => branch?.id) || [];
    const rootBranch: StoryTheaterBranch = existingBranches.find(branch => branch.id === rootBranchId) || {
        id: rootBranchId,
        name: '原始路线',
        forkMessageId: null,
        createdAt: Number(entry.createdAt) || now,
        updatedAt: now,
    };
    const branches = existingBranches.length > 0 ? existingBranches : [rootBranch];
    let previousId: number | null = null;
    let messageChanged = false;
    const messages = rows.map(message => {
        const existingParent = storyMessageParentId(message);
        const existingBranch = storyMessageBranchId(message);
        if (existingParent !== undefined && existingBranch) {
            previousId = message.id;
            return message;
        }
        messageChanged = true;
        const migrated = {
            ...message,
            metadata: {
                ...(message.metadata || {}),
                [STORY_PARENT_MESSAGE_ID]: existingParent === undefined ? previousId : existingParent,
                [STORY_BRANCH_ID]: existingBranch || rootBranchId,
            },
        };
        previousId = message.id;
        return migrated;
    });

    const messageIds = new Set(messages.map(message => message.id));
    const migratedArchives = (entry.archives || []).map(archive => {
        if (Array.isArray(archive.messageIds) && archive.messageIds.length > 0) return archive;
        const ids = messages
            .filter(message => message.id >= archive.fromMessageId && message.id <= archive.toMessageId)
            .map(message => message.id);
        return {
            ...archive,
            messageIds: ids,
            branchId: archive.branchId || rootBranchId,
        };
    });
    const archiveChanged = migratedArchives.some((archive, index) => archive !== entry.archives[index]);
    const requestedCursor = entry.timeline?.activeCursorMessageId ?? (messages.at(-1)?.id ?? null);
    const cursor = requestedCursor === null || messageIds.has(requestedCursor) ? requestedCursor : (messages.at(-1)?.id ?? null);
    const cursorMessage = cursor === null ? undefined : messages.find(message => message.id === cursor);
    const activeBranchId = branches.some(branch => branch.id === entry.timeline?.activeBranchId)
        ? entry.timeline!.activeBranchId
        : (cursorMessage ? storyMessageBranchId(cursorMessage) : undefined) || rootBranchId;
    const timeline: StoryTheaterTimelineState = {
        version: 1,
        rootBranchId,
        activeBranchId,
        activeCursorMessageId: cursor,
        branches,
    };
    const timelineChanged = !entry.timeline
        || entry.timeline.version !== 1
        || entry.timeline.activeCursorMessageId !== cursor
        || entry.timeline.activeBranchId !== activeBranchId
        || entry.timeline.branches.length !== branches.length;

    return {
        entry: { ...entry, archives: migratedArchives, timeline, updatedAt: timelineChanged || messageChanged || archiveChanged ? now : entry.updatedAt },
        messages,
        changed: timelineChanged || messageChanged || archiveChanged,
    };
}

export function storyTimelineChildren(messages: Message[]): Map<number | null, Message[]> {
    const result = new Map<number | null, Message[]>();
    const knownIds = new Set(messages.map(message => message.id));
    for (const message of messages) {
        const declared = storyMessageParentId(message);
        const parent = declared !== undefined && declared !== message.id && (declared === null || knownIds.has(declared)) ? declared : null;
        const bucket = result.get(parent) || [];
        bucket.push(message);
        result.set(parent, bucket);
    }
    for (const bucket of result.values()) bucket.sort((a, b) => a.timestamp - b.timestamp || a.id - b.id);
    return result;
}

export function storyPathToMessage(messages: Message[], targetId: number | null): Message[] {
    if (targetId === null) return [];
    const byId = new Map(messages.map(message => [message.id, message]));
    const reversed: Message[] = [];
    const seen = new Set<number>();
    let current = byId.get(targetId);
    while (current && !seen.has(current.id)) {
        seen.add(current.id);
        reversed.push(current);
        const parent = storyMessageParentId(current);
        current = typeof parent === 'number' ? byId.get(parent) : undefined;
    }
    return reversed.reverse();
}

export const activeStoryPath = (entry: StoryTheaterEntry, messages: Message[]): Message[] => (
    entry.writesToCharacterMemory || !entry.timeline
        ? [...messages].sort((a, b) => a.id - b.id)
        : storyPathToMessage(messages, entry.timeline.activeCursorMessageId)
);

export const storyNodeHasChildren = (messages: Message[], messageId: number): boolean => (
    messages.some(message => storyMessageParentId(message) === messageId)
);

export function canAppendToActiveStoryPath(entry: StoryTheaterEntry, messages: Message[]): boolean {
    if (entry.writesToCharacterMemory || !entry.timeline) return true;
    const { activeBranchId, activeCursorMessageId, branches } = entry.timeline;
    const branch = branches.find(item => item.id === activeBranchId);
    const branchHasOwnMessage = messages.some(message => storyMessageBranchId(message) === activeBranchId);
    if (!branchHasOwnMessage && branch?.forkMessageId === activeCursorMessageId) return true;
    if (activeCursorMessageId === null) return messages.length === 0;
    return !storyNodeHasChildren(messages, activeCursorMessageId);
}

export function makeStoryBranch(
    entry: StoryTheaterEntry,
    forkMessage: Message,
    now: number = Date.now(),
): StoryTheaterEntry {
    if (!entry.timeline || entry.writesToCharacterMemory) return entry;
    const id = globalThis.crypto?.randomUUID?.() || `story-branch-${now}-${Math.random().toString(36).slice(2, 8)}`;
    const parentBranchId = storyMessageBranchId(forkMessage) || entry.timeline.rootBranchId;
    const branch: StoryTheaterBranch = {
        id,
        name: defaultStoryBranchName(forkMessage),
        parentBranchId,
        forkMessageId: forkMessage.id,
        createdAt: now,
        updatedAt: now,
    };
    return {
        ...entry,
        timeline: {
            ...entry.timeline,
            activeBranchId: id,
            activeCursorMessageId: forkMessage.id,
            branches: [...entry.timeline.branches, branch],
        },
        updatedAt: now,
    };
}

export function switchStoryTimelineTo(entry: StoryTheaterEntry, message: Message, now: number = Date.now()): StoryTheaterEntry {
    if (!entry.timeline || entry.writesToCharacterMemory) return entry;
    const branchId = storyMessageBranchId(message) || entry.timeline.rootBranchId;
    return {
        ...entry,
        timeline: { ...entry.timeline, activeBranchId: branchId, activeCursorMessageId: message.id },
        updatedAt: now,
    };
}

export function renameStoryBranch(entry: StoryTheaterEntry, branchId: string, name: string, now: number = Date.now()): StoryTheaterEntry {
    if (!entry.timeline || entry.writesToCharacterMemory) return entry;
    const trimmed = name.trim().slice(0, 40);
    if (!trimmed) return entry;
    return {
        ...entry,
        timeline: {
            ...entry.timeline,
            branches: entry.timeline.branches.map(branch => branch.id === branchId ? { ...branch, name: trimmed, updatedAt: now } : branch),
        },
        updatedAt: now,
    };
}

export function storyDescendantIds(messages: Message[], rootId: number, includeRoot = true): number[] {
    const children = storyTimelineChildren(messages);
    const result: number[] = [];
    const queue = includeRoot ? [rootId] : (children.get(rootId) || []).map(message => message.id);
    const seen = new Set<number>();
    while (queue.length > 0) {
        const id = queue.shift()!;
        if (seen.has(id)) continue;
        seen.add(id);
        result.push(id);
        for (const child of children.get(id) || []) queue.push(child.id);
    }
    return result;
}

export function storyBranchFamilyIds(timeline: StoryTheaterTimelineState, branchId: string): Set<string> {
    const result = new Set([branchId]);
    let changed = true;
    while (changed) {
        changed = false;
        for (const branch of timeline.branches) {
            if (branch.parentBranchId && result.has(branch.parentBranchId) && !result.has(branch.id)) {
                result.add(branch.id);
                changed = true;
            }
        }
    }
    return result;
}

export function archiveAppliesToStoryPath(archive: StoryTheaterArchive, path: Message[]): boolean {
    const expected = archive.messageIds || [];
    if (expected.length === 0) return false;
    const ids = path.map(message => message.id);
    outer: for (let start = 0; start <= ids.length - expected.length; start += 1) {
        for (let offset = 0; offset < expected.length; offset += 1) {
            if (ids[start + offset] !== expected[offset]) continue outer;
        }
        return true;
    }
    return false;
}

export const applicableStoryArchives = (entry: StoryTheaterEntry, path: Message[]): StoryTheaterArchive[] => (
    entry.writesToCharacterMemory || !entry.timeline
        ? entry.archives
        : entry.archives.filter(archive => archiveAppliesToStoryPath(archive, path))
);

export const storyMessageArchivedOnPath = (messageId: number, archives: StoryTheaterArchive[]): boolean => (
    archives.some(archive => archive.messageIds?.includes(messageId))
);
const TIMESTAMP_VERSION = 1;
export interface StoryTimelineRepairResult {
    repairedCharacterIds: string[];
    unresolvedCount: number;
}
const repairs = new WeakMap<IDBDatabase, Promise<StoryTimelineRepairResult>>();
const validTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0;

/** 剧情设定时间不是现实收发时间；旧孤立副本不能冒充现实日期。 */
export const hasReliableMessageTimestamp = (message: Message): boolean => (
    message.metadata?.source !== 'story_theater_memory'
    || (message.metadata.theaterTimestampVersion === TIMESTAMP_VERSION
        && validTime(message.metadata.theaterReceivedAt)
        && message.timestamp === message.metadata.theaterReceivedAt)
);

export const invalidateStoryTimelineRepair = (db: IDBDatabase): void => { repairs.delete(db); };

/** 同事务读取中央原件并修复副本，保留 ID、正文和记忆水位线。失败不缓存，可重试。 */
export const ensureStoryTimelineRepair = (db: IDBDatabase): Promise<StoryTimelineRepairResult> => {
    const cached = repairs.get(db);
    if (cached) return cached;
    const repair = new Promise<StoryTimelineRepairResult>((resolve, reject) => {
        const transaction = db.transaction('messages', 'readwrite');
        const store = transaction.objectStore('messages');
        const repaired = new Set<string>();
        let unresolvedCount = 0;
        let failure: unknown;
        transaction.oncomplete = () => resolve({ repairedCharacterIds: [...repaired], unresolvedCount });
        transaction.onerror = () => reject(failure || transaction.error || new Error('剧情时间校正失败'));
        transaction.onabort = () => reject(failure || transaction.error || new Error('剧情时间校正事务已回滚'));
        const guarded = (action: () => void) => {
            try { action(); } catch (error) {
                failure = error;
                try { transaction.abort(); } catch { /* 已经中止 */ }
            }
        };
        const scanMirrors = (request: IDBRequest<IDBCursorWithValue | null>, done: () => void) => {
            request.onsuccess = () => guarded(() => {
                const cursor = request.result;
                if (!cursor) { done(); return; }
                const mirror = cursor.value as Message;
                if (!mirror || mirror.metadata?.source !== 'story_theater_memory' || hasReliableMessageTimestamp(mirror)) {
                    cursor.continue();
                    return;
                }
                const apply = (receivedAt: number | undefined) => {
                    if (!validTime(receivedAt)) { unresolvedCount++; cursor.continue(); return; }
                    store.put({ ...mirror, timestamp: receivedAt, metadata: { ...mirror.metadata,
                        theaterTimelineTimestamp: mirror.metadata.theaterTimelineTimestamp ?? mirror.timestamp,
                        theaterTimestampVersion: TIMESTAMP_VERSION, theaterReceivedAt: receivedAt } });
                    repaired.add(mirror.charId);
                    cursor.continue();
                };
                if (mirror.metadata.theaterTimestampVersion === TIMESTAMP_VERSION && validTime(mirror.metadata.theaterReceivedAt)) {
                    apply(mirror.metadata.theaterReceivedAt);
                    return;
                }
                const centralId = mirror.metadata.theaterCentralId;
                if (!Number.isInteger(centralId) || centralId <= 0 || !mirror.metadata.theaterId) { apply(undefined); return; }
                const centralRead = store.get(centralId);
                centralRead.onsuccess = () => guarded(() => {
                    const central = centralRead.result as Message | undefined;
                    const sameTheater = central?.metadata?.source === 'story_theater'
                        && central.charId === `story-theater:${mirror.metadata.theaterId}`
                        && central.metadata.theaterId === mirror.metadata.theaterId
                        && central.role === mirror.role;
                    apply(sameTheater ? central?.timestamp : undefined);
                });
            });
        };
        // 按角色的唯一键枚举，再精确读取该角色的剧情副本。普通聊天和图片不逐条扫描。
        if (store.indexNames.contains('charId_source') && store.indexNames.contains('charId')) {
            const characters = store.index('charId').openKeyCursor(undefined, 'nextunique');
            characters.onsuccess = () => guarded(() => {
                const cursor = characters.result;
                if (!cursor) return;
                scanMirrors(store.index('charId_source').openCursor(IDBKeyRange.only([cursor.key, 'story_theater_memory'])), () => cursor.continue());
            });
        } else {
            // 兼容缺少复合索引的旧库；无需升级 schema 或改动其他应用数据。
            scanMirrors(store.openCursor(), () => {});
        }
    });
    repairs.set(db, repair);
    void repair.catch(() => { if (repairs.get(db) === repair) repairs.delete(db); });
    return repair;
};

/** 仅兜底旧剧情副本：按持久化 ID 确认它早于待回复输入，再挪回该轮输入之前。 */
export const protectPendingChatTurn = (messages: Message[]): Message[] => {
    const online = messages.filter(message => (message.role === 'user' || message.role === 'assistant') && isVisibleChatMessage(message)
        && !(message.role === 'assistant' && message.metadata?.activeMsg2?.taskId != null));
    const latest = online.reduce<Message | undefined>((last, message) => !last || message.id > last.id ? message : last, undefined);
    if (latest?.role !== 'user') return messages;
    const lastReplyId = online.reduce((id, message) => message.role === 'assistant' && message.id < latest.id ? Math.max(id, message.id) : id, 0);
    const pendingIndex = messages.findIndex(message => message.role === 'user' && isVisibleChatMessage(message)
        && message.id > lastReplyId && message.id <= latest.id);
    if (pendingIndex < 0) return messages;
    const displaced = messages.slice(pendingIndex).filter(message => message.metadata?.source === 'story_theater_memory' && message.id < latest.id);
    if (!displaced.length) return messages;
    const moved = new Set(displaced);
    const ordered = messages.filter(message => !moved.has(message));
    // 放回原来的轮次，而不是一律贴在最新输入前，避免已回复过的剧情重复触发切换。
    for (const story of [...displaced].sort((left, right) => left.id - right.id)) {
        const nextIndex = ordered.findIndex(message => message.id > story.id);
        ordered.splice(nextIndex < 0 ? ordered.length : nextIndex, 0, story);
    }
    return ordered;
};
