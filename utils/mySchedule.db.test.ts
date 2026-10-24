import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import type { FullBackupData, MyScheduleArchive, MyScheduleEntry } from '../types';
import { DB } from './db';
import { editAndSyncMyScheduleEntry, finishAndSyncMyScheduleEntry } from './myScheduleService';

const entry: MyScheduleEntry = {
  id: 'my-schedule-db-test', kind: 'entry', sourceText: '刚才读书十五分钟', title: '读书', note: '很安静。',
  startAt: 1, endAt: 2, recipientCharIds: ['a'], messageIdsByCharId: {}, createdAt: 2, updatedAt: 2,
};
const archive: MyScheduleArchive = {
  id: 'my-schedule-archive-db-test', kind: 'archive', entryIds: [entry.id],
  startedAt: 1, endedAt: 2, archivedAt: 2,
};

describe('my schedule IndexedDB and full backup', () => {
  afterEach(async () => {
    await DB.deleteMyScheduleEntry(entry.id);
    await DB.deleteMyScheduleEntry(archive.id);
  });

  it('round-trips timeline entries through full backup', async () => {
    await DB.saveMyScheduleRecord(entry);
    await DB.saveMyScheduleRecord(archive);
    expect((await DB.exportFullData()).myScheduleRecords).toContainEqual(entry);
    expect((await DB.exportFullData()).myScheduleRecords).toContainEqual(archive);
    await DB.deleteMyScheduleEntry(entry.id);
    await DB.deleteMyScheduleEntry(archive.id);
    await DB.importFullData({ timestamp: 1, version: 1, myScheduleRecords: [entry, archive] } as FullBackupData);
    expect((await DB.getMyScheduleRecords()).find(record => record.id === entry.id)).toEqual(entry);
    expect((await DB.getMyScheduleRecords()).find(record => record.id === archive.id)).toEqual(archive);
  });

  it('finishes an open entry by updating the existing chat card', async () => {
    const messageId = await DB.saveMessage({
      charId: 'a', role: 'user', type: 'score_card', content: '开放中',
      metadata: { source: 'my_schedule', myScheduleEntryId: entry.id, scoreCard: { type: 'my_schedule_card', title: entry.title, startAt: 1 } },
    });
    const open = { ...entry, endAt: undefined, messageIdsByCharId: { a: messageId } };
    const updated = await finishAndSyncMyScheduleEntry(open, 10, '原样追加。');
    const messages = await DB.getMessagesByCharId('a', true);
    const message = messages.find(item => item.id === messageId);
    expect(updated.note).toBe('很安静。\n原样追加。');
    expect(message?.metadata?.scoreCard?.endAt).toBe(10);
    expect(messages.filter(item => item.metadata?.myScheduleEntryId === entry.id)).toHaveLength(1);
    await DB.deleteMessage(messageId);
  });

  it('edits structured fields and updates the original chat card in place', async () => {
    const messageId = await DB.saveMessage({
      charId: 'a', role: 'user', type: 'score_card', content: '旧卡片',
      metadata: { source: 'my_schedule', myScheduleEntryId: entry.id, scoreCard: { type: 'my_schedule_card', title: entry.title, startAt: 1 } },
    });
    const updated = await editAndSyncMyScheduleEntry({ ...entry, messageIdsByCharId: { a: messageId } }, {
      title: '修改后的读书', note: '新增随笔', startAt: 100, endAt: 3_700_000, estimatedTime: false,
      tag: 'study',
    });
    const messages = await DB.getMessagesByCharId('a', true);
    const message = messages.find(item => item.id === messageId);
    expect(updated.startAt).toBe(100);
    expect(updated.tag).toBe('study');
    expect(message?.metadata?.scoreCard?.title).toBe('修改后的读书');
    expect(message?.metadata?.scoreCard?.tag).toBe('study');
    expect(message?.metadata?.scoreCard?.endAt).toBe(3_700_000);
    expect(messages.filter(item => item.metadata?.myScheduleEntryId === entry.id)).toHaveLength(1);
    await DB.deleteMessage(messageId);
  });
});
