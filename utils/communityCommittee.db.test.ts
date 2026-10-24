import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import type { CommunityCommitteeSession, FullBackupData } from '../types';
import { DB } from './db';

const session: CommunityCommitteeSession = {
  id: 'community-committee-db-test',
  topic: '两边都有道理的现实困境',
  sideA: '能理解对方的难处',
  sideB: '也需要保护自己的边界',
  openingText: '我理解对方。\n但我也需要保护自己。',
  openingSegments: [
    { id: 'opening-a', content: '我理解对方。', side: 'a' },
    { id: 'opening-b', content: '但我也需要保护自己。', side: 'b' },
  ],
  charIds: ['char-a', 'char-b'],
  stage: 'summary',
  turns: [{ id: 'turn', speakerType: 'user', speakerName: '我', content: '我还是很痛苦', createdAt: 2 }],
  report: '这次先承认痛苦真实存在。',
  reportGeneratedAt: 3,
  sharedMessageIds: { 'char-a': 11 },
  createdAt: 1,
  updatedAt: 3,
};

describe('community committee IndexedDB and full backup', () => {
  afterEach(async () => { await DB.deleteCommunityCommitteeSession(session.id); });

  it('完整导出、删除并恢复会话和逐角色写回进度', async () => {
    await DB.saveCommunityCommitteeSession(session);
    expect((await DB.exportFullData()).communityCommitteeSessions).toContainEqual(session);

    await DB.deleteCommunityCommitteeSession(session.id);
    expect((await DB.getCommunityCommitteeSessions()).some(item => item.id === session.id)).toBe(false);

    await DB.importFullData({
      timestamp: 1,
      version: 1,
      communityCommitteeSessions: [session],
    } as FullBackupData);
    expect(await DB.getCommunityCommitteeSessions()).toContainEqual(session);
  });
});
