import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FullBackupData, HealingMemoryNode, HealingSession } from '../types';
import { DB, DB_VERSION, openDB } from './db';
import { ensureFloat32 } from './memoryPalace/db';

const session: HealingSession = { id: 'heal-1', charId: 'char-a', createdAt: 10, updatedAt: 10 };
const node: HealingMemoryNode = {
  id: 'memory-1', content: '用户下周三有一次重要面试。', tags: ['面试'], importance: 8,
  createdAt: 20, updatedAt: 20, lastAccessedAt: 20, accessCount: 0, embedded: true,
  sourceSessionId: session.id, sourceMessageIds: [1], sourceCharId: 'char-a', origin: 'chat',
};

describe('healing IndexedDB v86', () => {
  beforeEach(async () => { await DB.deleteDB(); });
  afterEach(async () => { await DB.deleteDB(); });

  it('从真实 v85 老库升级、保留旧数据并创建四张独立表及索引', async () => {
    const old = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('AetherOS_Data', 85);
      request.onupgradeneeded = () => request.result.createObjectStore('characters', { keyPath: 'id' }).put({ id: 'legacy-char', name: '旧角色', avatar: '' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    old.close();
    const upgraded = await openDB();
    expect(upgraded.version).toBe(DB_VERSION);
    expect([...upgraded.objectStoreNames]).toEqual(expect.arrayContaining(['healing_sessions', 'healing_messages', 'healing_memory_nodes', 'healing_memory_vectors']));
    expect([...upgraded.transaction('healing_messages', 'readonly').objectStore('healing_messages').indexNames]).toEqual(expect.arrayContaining(['sessionId', 'timestamp']));
    expect((await DB.getAllCharacters()).some(char => char.id === 'legacy-char')).toBe(true);
  });

  it('会话、原文、图片引用和向量 CRUD 独立于普通 messages', async () => {
    await DB.saveHealingSession(session);
    await DB.putBlobAsset('healing-image', new Blob(['image-bytes'], { type: 'image/png' }));
    const first = await DB.saveHealingMessage({ sessionId: session.id, charId: 'char-a', role: 'user', type: 'image', content: 'blobref:healing-image', timestamp: 30 });
    const second = await DB.saveHealingMessage({ sessionId: session.id, charId: 'char-a', role: 'assistant', type: 'text', content: '我在听。', timestamp: 40 });
    await DB.saveHealingMemoryNode(node);
    await DB.saveHealingMemoryVector({ memoryId: node.id, vector: new Float32Array([1, 0, 0]), dimensions: 3, model: 'test' });
    expect(await DB.getHealingSession(session.id)).toEqual(session);
    expect((await DB.getHealingMessages(session.id)).map(message => message.id)).toEqual([first, second]);
    expect((await DB.getHealingMessages(session.id))[0].content).toBe('blobref:healing-image');
    expect(await DB.getBlobAsset('healing-image')).toBeInstanceOf(Blob);
    expect(Array.from(ensureFloat32((await DB.getHealingMemoryVectors())[0].vector))).toEqual([1, 0, 0]);
    expect(await DB.getMessagesByCharId('char-a', true)).toEqual([]);
    await DB.deleteHealingMemory(node.id);
    expect(await DB.getHealingMemoryNodes()).toEqual([]);
    expect(await DB.getHealingMemoryVectors()).toEqual([]);
  });

  it('普通完整导出经 JSON 往返后可恢复四张聊愈表', async () => {
    await DB.saveHealingSession(session);
    await DB.saveHealingMessage({ sessionId: session.id, charId: 'char-a', role: 'user', type: 'text', content: '原话不能摘要', timestamp: 30 });
    await DB.saveHealingMemoryNode(node);
    await DB.saveHealingMemoryVector({ memoryId: node.id, vector: new Float32Array([0.5, 0.25]), dimensions: 2 });
    const exported = JSON.parse(JSON.stringify(await DB.exportFullData())) as FullBackupData;
    expect(exported.healingMessages?.[0].content).toBe('原话不能摘要');
    expect(exported.healingMemoryVectors?.[0].vector).toEqual([0.5, 0.25]);
    await DB.deleteDB();
    await DB.importFullData(exported);
    expect((await DB.getHealingSessions())[0].id).toBe(session.id);
    expect((await DB.getHealingMessages(session.id))[0].content).toBe('原话不能摘要');
    expect(Array.from(ensureFloat32((await DB.getHealingMemoryVectors())[0].vector))).toEqual([0.5, 0.25]);
  });
});
