import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import type { FullBackupData, TaskWorkshopUnit } from '../types';
import { DB } from './db';

const record: TaskWorkshopUnit = {
  id: 'task-workshop-db-test', kind: 'unit', title: '整理第一版', description: '验证本地备份',
  status: 'active', tags: ['测试'], linkedToolIds: [], linkedReminderIds: ['life:first', 'life:second'],
  entries: [], steps: [], visits: [], createdAt: 1, updatedAt: 1,
};

describe('task workshop IndexedDB and full backup', () => {
  afterEach(async () => { await DB.deleteTaskWorkshopRecord(record.id); });

  it('round-trips workspace records through the full backup contract', async () => {
    await DB.saveTaskWorkshopRecord(record);
    expect((await DB.exportFullData()).taskWorkshopRecords).toContainEqual(record);

    await DB.deleteTaskWorkshopRecord(record.id);
    expect(await DB.getTaskWorkshopRecord(record.id)).toBeNull();

    await DB.importFullData({ timestamp: 1, version: 1, taskWorkshopRecords: [record] } as FullBackupData);
    expect(await DB.getTaskWorkshopRecord(record.id)).toEqual(record);
  });
});
