import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { FullBackupData, LiarsBarSession } from '../types';
import { createLiarsBarSession } from './boardGame/liarsBar/engine';
import { DB, DB_VERSION, openDB } from './db';

const session = createLiarsBarSession({
  players: [
    { actor: { type: 'user' }, name: '我' },
    { actor: { type: 'character', charId: 'a' }, name: 'A' },
    { actor: { type: 'character', charId: 'b' }, name: 'B' },
    { actor: { type: 'character', charId: 'c' }, name: 'C' },
  ], rng: () => 0.4, now: 1,
});

describe('board game IndexedDB and backup', () => {
  beforeEach(async () => { await DB.deleteDB(); });
  afterEach(async () => { await DB.deleteDB(); });

  it('upgrades a real v86 database without losing old data', async () => {
    const old = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('AetherOS_Data', 86);
      request.onupgradeneeded = () => request.result.createObjectStore('characters', { keyPath: 'id' }).put({ id: 'legacy-char', name: '旧角色', avatar: '' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    old.close();
    const upgraded = await openDB();
    expect(upgraded.version).toBe(DB_VERSION);
    expect([...upgraded.objectStoreNames]).toContain('board_game_sessions');
    expect((await DB.getAllCharacters()).some(character => character.id === 'legacy-char')).toBe(true);
  });

  it.each(['batch', 'individual', 'legacy'] as const)('round-trips %s sessions and random facts through full backup', async mode => {
    const saved = structuredClone(session);
    if (mode === 'legacy') delete saved.settings;
    else saved.settings = { generationMode: mode };
    await DB.saveBoardGameSession(saved);
    expect(await DB.getBoardGameSession(session.id)).toEqual(saved);
    expect((await DB.exportFullData()).boardGameSessions).toContainEqual(saved);
    await DB.deleteBoardGameSession(session.id);
    await DB.importFullData({ timestamp: 1, version: 1, boardGameSessions: [saved] } as FullBackupData);
    expect(await DB.getBoardGameSessions()).toContainEqual(saved as LiarsBarSession);
  });

  it('rejects stale or cancelled writes without overwriting a committed turn', async () => {
    await DB.saveBoardGameSession(session);
    const expected = { revision: session.revision, actorId: session.round.currentActorId };
    const next = { ...session, revision: session.revision + 1 };
    expect(await DB.saveBoardGameSessionIfCurrent(next, expected, () => false)).toBe(false);
    const results = await Promise.all([
      DB.saveBoardGameSessionIfCurrent(next, expected),
      DB.saveBoardGameSessionIfCurrent({ ...next, updatedAt: 999 }, expected),
    ]);
    expect(results).toEqual([true, false]);
    expect(await DB.getBoardGameSession(session.id)).toEqual(next);
  });
});
