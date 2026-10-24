import { afterEach, describe, expect, it } from 'vitest';
import type { StoryTheaterEntry } from '../types';
import { DB } from './db';
import { storyTheaterThreadId } from './storyTheater';
import { storyMessageParentId } from './storyTheaterTimeline';
import { deleteStoryTimelineBranch, ensureStoryTimeline } from './storyTheaterTimelineStorage';

const ENTRY_ID = 'timeline-storage-test';
const savedMessageIds: number[] = [];
const makeEntry = (): StoryTheaterEntry => ({
    id: ENTRY_ID,
    title: '事务迁移',
    premise: '',
    characterIds: [],
    writesToCharacterMemory: false,
    characterMemoryDates: {},
    carryCharacterMemory: false,
    characterContextLimits: {},
    archiveAfter: 20,
    archiveKeepRecent: 5,
    archiveStrategy: 'summary',
    archives: [],
    selectedWorldbookIds: [],
    createdAt: 1,
    updatedAt: 1,
});

afterEach(async () => {
    if (savedMessageIds.length) await DB.deleteMessages(savedMessageIds.splice(0));
    await DB.deleteStoryTheater(ENTRY_ID);
});

describe('剧情树 IndexedDB 事务', () => {
    it('首次打开一次性写回条目和全部旧楼层，重复执行不产生第二次迁移', async () => {
        const old = makeEntry();
        await DB.saveStoryTheater(old);
        savedMessageIds.push(
            await DB.saveMessage({ charId: storyTheaterThreadId(ENTRY_ID), role: 'user', type: 'text', content: '一', metadata: { source: 'story_theater', theaterId: ENTRY_ID } }),
            await DB.saveMessage({ charId: storyTheaterThreadId(ENTRY_ID), role: 'assistant', type: 'text', content: '二', metadata: { source: 'story_theater', theaterId: ENTRY_ID } }),
        );

        const first = await ensureStoryTimeline(old);
        expect(first.migrated).toBe(true);
        expect(first.messages.map(storyMessageParentId)).toEqual([null, savedMessageIds[0]]);
        expect((await DB.getStoryTheaters()).find(item => item.id === ENTRY_ID)?.timeline?.activeCursorMessageId).toBe(savedMessageIds[1]);

        const second = await ensureStoryTimeline(first.entry);
        expect(second.migrated).toBe(false);
        expect(second.messages.map(storyMessageParentId)).toEqual([null, savedMessageIds[0]]);
    });

    it('删除分支时在同一事务更新楼层、游标和分支表，并保留共同祖先', async () => {
        const old = makeEntry();
        await DB.saveStoryTheater(old);
        const rootId = await DB.saveMessage({ charId: storyTheaterThreadId(ENTRY_ID), role: 'user', type: 'text', content: '根', metadata: { source: 'story_theater', theaterId: ENTRY_ID } });
        savedMessageIds.push(rootId);
        const migrated = await ensureStoryTimeline(old);
        const branchId = 'branch-delete';
        const branched: StoryTheaterEntry = {
            ...migrated.entry,
            timeline: {
                ...migrated.entry.timeline!,
                activeBranchId: branchId,
                branches: [...migrated.entry.timeline!.branches, { id: branchId, name: '删掉我', parentBranchId: migrated.entry.timeline!.rootBranchId, forkMessageId: rootId, createdAt: 2, updatedAt: 2 }],
            },
        };
        const branchMessageId = await DB.saveMessage({ charId: storyTheaterThreadId(ENTRY_ID), role: 'assistant', type: 'text', content: '分支', metadata: { source: 'story_theater', theaterId: ENTRY_ID, storyParentMessageId: rootId, storyBranchId: branchId } });
        savedMessageIds.push(branchMessageId);
        branched.timeline!.activeCursorMessageId = branchMessageId;
        await DB.saveStoryTheater(branched);
        const rows = (await DB.getMessagesByCharId(storyTheaterThreadId(ENTRY_ID), true)).filter(message => message.metadata?.source === 'story_theater');

        const result = await deleteStoryTimelineBranch(branched, rows, branchId);
        expect(result.deletedMessageIds).toEqual([branchMessageId]);
        expect(result.entry.timeline?.activeCursorMessageId).toBe(rootId);
        expect(result.entry.timeline?.branches.map(branch => branch.id)).not.toContain(branchId);
        expect((await DB.getMessagesByCharId(storyTheaterThreadId(ENTRY_ID), true)).map(message => message.id)).toEqual([rootId]);
    });
});
