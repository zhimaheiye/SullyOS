import { afterEach, describe, expect, it, vi } from 'vitest';
import { DB } from '../../db';
import { createLiarsBarSession } from './engine';
import { persistLiarsBarShare } from './writeback';

vi.mock('../../amsgStateSync', () => ({ markAmsgStateDirty: vi.fn() }));

describe('liars bar writeback', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reuses an existing session card and keeps memory ids stable', async () => {
    vi.spyOn(DB, 'getMessagesByCharId').mockResolvedValue([{
      id: 51, charId: 'a', role: 'assistant', type: 'score_card', content: 'existing', timestamp: 1,
      metadata: { source: 'board_game', boardGameSessionId: 'liars-session' },
    }]);
    const saveMessage = vi.spyOn(DB, 'saveMessage');
    const session = createLiarsBarSession({
      players: [
        { actor: { type: 'user' }, name: '我' },
        { actor: { type: 'character', charId: 'a' }, name: 'A' },
        { actor: { type: 'character', charId: 'b' }, name: 'B' },
        { actor: { type: 'character', charId: 'c' }, name: 'C' },
      ], rng: () => 0.2, now: 1,
    });
    session.id = 'liars-session';
    const result = await persistLiarsBarShare({
      char: { id: 'a', name: 'A', memories: [{ id: 'mem-board-game-liars-bar-liars-session-a', date: 'old', summary: 'old' }], memoryPalaceEnabled: false } as any,
      session, userProfile: { name: '我' } as any, groups: [], realtimeConfig: {} as any,
      apiConfig: {} as any, memoryPalaceConfig: {} as any,
    });
    expect(result.messageId).toBe(51);
    expect(saveMessage).not.toHaveBeenCalled();
    expect(result.memories.filter(memory => memory.id === 'mem-board-game-liars-bar-liars-session-a')).toHaveLength(1);
  });
});
