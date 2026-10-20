import { afterEach, describe, expect, it } from 'vitest';
import type { FullBackupData, LifeReplayPreset } from '../types';
import { emptyLifeReplayBlueprint } from './lifeReplay';
import { DB } from './db';

const preset: LifeReplayPreset = {
  id: 'life-replay-db-test', kind: 'preset', sourceText: '一段只存在本机的过去',
  blueprint: { ...emptyLifeReplayBlueprint(), title: '测试旧事' },
  createdAt: 1, updatedAt: 1,
};

describe('life replay IndexedDB and full backup', () => {
  afterEach(async () => { await DB.deleteLifeReplayRecord(preset.id); });

  it('round-trips private presets through the full backup contract', async () => {
    await DB.saveLifeReplayRecord(preset);
    expect((await DB.exportFullData()).lifeReplayRecords).toContainEqual(preset);

    await DB.deleteLifeReplayRecord(preset.id);
    expect(await DB.getLifeReplayRecords()).not.toContainEqual(preset);

    await DB.importFullData({ timestamp: 1, version: 1, lifeReplayRecords: [preset] } as FullBackupData);
    expect(await DB.getLifeReplayRecords()).toContainEqual(preset);
  });
});
