import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import type { FullBackupData, TimeCapsuleEntry } from '../types';
import { DB } from './db';

const record: TimeCapsuleEntry = {
  id: 'time-capsule-db-test', kind: 'capsule', title: '给以后', content: '这是封存的正文。',
  source: 'invited', charId: 'char-a', charName: '左慈', createdAt: 1, unlockAt: 2,
};

describe('time capsule IndexedDB and full backup', () => {
  afterEach(async () => { await DB.deleteTimeCapsuleRecord(record.id); });

  it('round-trips capsules through full backup', async () => {
    await DB.saveTimeCapsuleRecord(record);
    expect((await DB.exportFullData()).timeCapsuleRecords).toContainEqual(record);
    await DB.deleteTimeCapsuleRecord(record.id);
    expect((await DB.getTimeCapsuleRecords()).find(item => item.id === record.id)).toBeUndefined();
    await DB.importFullData({ timestamp: 1, version: 1, timeCapsuleRecords: [record] } as FullBackupData);
    expect((await DB.getTimeCapsuleRecords()).find(item => item.id === record.id)).toEqual(record);
  });
});
