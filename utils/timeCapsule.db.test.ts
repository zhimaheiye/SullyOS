import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it } from 'vitest';
import type { CharacterProfile, FullBackupData, TimeCapsuleEntry, TimeCapsuleInviteBatch } from '../types';
import { DB } from './db';
import { createTimeCapsuleInviteBatch } from './timeCapsule';

const record: TimeCapsuleEntry = {
  id: 'time-capsule-db-test', kind: 'capsule', title: '给以后', content: '这是封存的正文。',
  source: 'invited', charId: 'char-a', charName: '左慈', createdAt: 1, unlockAt: 2,
};

describe('time capsule IndexedDB and full backup', () => {
  const chars=['a','b'].map(id=>({id:`time-capsule-batch-${id}`,name:`角色${id}`,avatar:'',description:'合成',systemPrompt:`提示${id}`} as CharacterProfile));
  let batchId='';
  afterEach(async () => { await DB.deleteTimeCapsuleRecord(record.id);if(batchId)await DB.deleteTimeCapsuleRecord(batchId);for(const char of chars)await DB.deleteCharacter(char.id);batchId=''; });

  it('round-trips capsules through full backup', async () => {
    await DB.saveTimeCapsuleRecord(record);
    expect((await DB.exportFullData()).timeCapsuleRecords).toContainEqual(record);
    await DB.deleteTimeCapsuleRecord(record.id);
    expect((await DB.getTimeCapsuleRecords()).find(item => item.id === record.id)).toBeUndefined();
    await DB.importFullData({ timestamp: 1, version: 1, timeCapsuleRecords: [record] } as FullBackupData);
    expect((await DB.getTimeCapsuleRecords()).find(item => item.id === record.id)).toEqual(record);
  });

  it('owns a batch in one executor and atomically commits capsule plus item status',async()=>{
    for(const char of chars)await DB.saveCharacter(char);
    const batch=createTimeCapsuleInviteBatch(chars,100);batchId=batch.id;await DB.saveTimeCapsuleRecord(batch);
    const first=await DB.claimTimeCapsuleInviteItem(batch.id,'tab-a');
    await expect(DB.claimTimeCapsuleInviteItem(batch.id,'tab-b')).rejects.toThrow('另一标签页');
    await DB.settleTimeCapsuleInviteItem({batchId:batch.id,itemId:first.item.id,attempt:first.item.attempt,executorId:'tab-a',status:'failed',error:'合成失败',now:110});
    const retry=await DB.claimTimeCapsuleInviteItem(batch.id,'tab-b',first.item.id,120);
    const capsule={...record,id:'time-capsule-batch-result',charId:chars[0].id,charName:chars[0].name};
    await DB.finishTimeCapsuleInviteItem({batchId:batch.id,itemId:retry.item.id,attempt:retry.item.attempt,executorId:'tab-b',capsule,character:chars[0],signal:new AbortController().signal,now:130});
    const rows=await DB.getTimeCapsuleRecords(),stored=rows.find((row):row is TimeCapsuleInviteBatch=>row.kind==='invite_batch'&&row.id===batch.id)!;
    expect(stored.items[0]).toMatchObject({status:'saved',capsuleId:capsule.id,attempt:2});
    expect(rows.filter(row=>row.kind==='capsule'&&row.id===capsule.id)).toHaveLength(1);
    await DB.deleteTimeCapsuleRecord(capsule.id);
  });

  it('turns this tab running work into interrupted on recovery without auto-requesting',async()=>{
    for(const char of chars)await DB.saveCharacter(char);
    const batch=createTimeCapsuleInviteBatch(chars,200);batchId=batch.id;await DB.saveTimeCapsuleRecord(batch);
    await DB.claimTimeCapsuleInviteItem(batch.id,'tab-reload',undefined,210);
    await DB.recoverTimeCapsuleInviteBatches('tab-reload',220);
    const restored=(await DB.getTimeCapsuleRecords()).find((row):row is TimeCapsuleInviteBatch=>row.kind==='invite_batch'&&row.id===batch.id)!;
    expect(restored.items.map(item=>item.status)).toEqual(['interrupted','waiting']);
    expect(restored.items[0].error).toContain('可继续');
  });
});
