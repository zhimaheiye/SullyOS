import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FullBackupData } from '../types';
import { createEmptyOneChangeSnapshot, createOneChange, submitOneChangeRecord } from './oneChange/engine';
import { DB, DB_VERSION, openDB } from './db';

describe('只做一个改变 IndexedDB（当前 schema）', () => {
  beforeEach(async () => { await DB.deleteDB(); });
  afterEach(async () => { await DB.deleteDB(); });

  it('从真实 v87 老库升级、保留旧数据并创建五张独立表及必要索引', async () => {
    const old = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('AetherOS_Data', 87);
      request.onupgradeneeded = () => request.result.createObjectStore('characters', { keyPath: 'id' }).put({ id: 'legacy-char', name: '旧角色', avatar: '' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    old.close();
    const upgraded = await openDB();
    expect(upgraded.version).toBe(DB_VERSION);
    expect([...upgraded.objectStoreNames]).toEqual(expect.arrayContaining([
      'one_change_changes', 'one_change_records', 'one_change_standard_versions', 'one_change_state_events', 'one_change_settings',
    ]));
    expect([...upgraded.transaction('one_change_records', 'readonly').objectStore('one_change_records').indexNames]).toEqual(expect.arrayContaining(['changeId', 'date']));
    expect([...upgraded.transaction('one_change_state_events', 'readonly').objectStore('one_change_state_events').indexNames]).toEqual(expect.arrayContaining(['changeId', 'effectiveDate']));
    expect((await DB.getAllCharacters()).some(character => character.id === 'legacy-char')).toBe(true);
  });

  it('五类状态在同一快照事务中保存并通过完整备份往返', async () => {
    let snapshot = createEmptyOneChangeSnapshot(1);
    const created = createOneChange(snapshot, {
      name: '锻炼', standard: '每天运动 30 分钟', description: '从容易做到的版本开始', stabilityTargetDays: 30,
    }, { start: true, date: '2026-08-25', now: 2 });
    snapshot = submitOneChangeRecord(created.snapshot, {
      changeId: created.changeId, date: '2026-08-25', result: 'done', feeling: '身体舒服很多',
    }, { currentDate: '2026-08-25', now: 3 }).snapshot;
    await DB.saveOneChangeSnapshotData(snapshot);
    expect(await DB.getOneChangeSnapshotData()).toMatchObject({
      changes: [{ id: created.changeId, totalSuccessDays: 1 }],
      records: [{ result: 'done', feeling: '身体舒服很多' }],
      standardVersions: [{ standard: '每天运动 30 分钟' }],
      stateEvents: [{ type: 'activated' }],
      settings: { id: 'main', defaultStabilityDays: 30 },
    });
    const exported = JSON.parse(JSON.stringify(await DB.exportFullData())) as FullBackupData;
    expect(exported.oneChangeRecords?.[0].feeling).toBe('身体舒服很多');
    await DB.deleteDB();
    await DB.importFullData(exported);
    const restored = await DB.getOneChangeSnapshotData();
    expect(restored.changes[0]).toMatchObject({ id: created.changeId, totalSuccessDays: 1 });
    expect(restored.records[0]).toMatchObject({ result: 'done', feeling: '身体舒服很多' });
    expect(restored.standardVersions).toHaveLength(1);
    expect(restored.stateEvents).toHaveLength(1);
    expect(restored.settings).toMatchObject({ expansionCredit: 0 });
  });
});
