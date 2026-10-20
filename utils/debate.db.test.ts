import { afterEach, describe, expect, it } from 'vitest';
import type { DebateSession, FullBackupData } from '../types';
import { DB } from './db';

const session: DebateSession = {
  id: 'debate-db-test', mode: 'solo', topic: '测试辩题', proPosition: '正方', conPosition: '反方',
  status: 'in_progress', stage: 'debate', solo: { charId: 'char', userSide: 'pro', turnIndex: 0 },
  speeches: [], createdAt: 1, updatedAt: 1,
};

describe('debate IndexedDB and full backup', () => {
  afterEach(async () => { await DB.deleteDebateSession(session.id); });

  it.each([
    session,
    { ...session, status: 'completed', stage: 'complete',
      speeches: [{ id: 'speech', speakerType: 'user', speakerName: '你', side: 'pro', round: 1, phase: 'opening', content: '原文已保存', score: 75, judgeComment: '反馈', createdAt: 1 }],
      report: { proScore: 75, conScore: 0, winner: 'pro', summary: '报告', generatedAt: 2 },
    } as DebateSession,
  ])('round-trips $stage sessions through the full backup contract', async fixture => {
    await DB.saveDebateSession(fixture);
    const exported = await DB.exportFullData();
    expect(exported.debateSessions).toContainEqual(fixture);

    await DB.deleteDebateSession(session.id);
    expect((await DB.getDebateSessions()).some(item => item.id === session.id)).toBe(false);

    await DB.importFullData({ timestamp: 1, version: 1, debateSessions: [fixture] } as FullBackupData);
    expect(await DB.getDebateSessions()).toContainEqual(fixture);
  });
});
