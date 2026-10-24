import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIConfig, CharacterProfile, RealtimeConfig, UserProfile } from '../../../types';

const mocks = vi.hoisted(() => ({ context: vi.fn(), fetch: vi.fn(), history: vi.fn() }));
vi.mock('../../chatRequestPayload', () => ({ buildChatRequestPayload: mocks.context }));
vi.mock('../../db', () => ({ DB: {
  getMessagesByCharId: mocks.history, getEmojis: async () => [], getEmojiCategories: async () => [],
} }));
vi.mock('../../safeApi', () => ({ safeFetchJson: mocks.fetch, extractContent: (data: { content: string }) => data.content }));

import { requestLiarsBarAction } from './aiService';
import { requestLiarsBarBatch } from './batchAiService';
import { createLiarsBarSession } from './engine';
import { buildLiarsBarPlayerView } from './visibility';
import { buildLiarsBarBatchView } from './batch';

const characters = ['a', 'b', 'c'].map(id => ({ id, name: id, systemPrompt: `PERSONA_${id}`, memories: [{ id: `memory_${id}`, summary: `MEMORY_${id}` }] } as CharacterProfile));
const common = { apiConfig: { baseUrl: 'https://example.invalid/v1', model: 'test' } as APIConfig, userProfile: { name: '我' } as UserProfile, groups: [], realtimeConfig: {} as RealtimeConfig };

function session() {
  const state = createLiarsBarSession({ players: [{ actor: { type: 'user' }, name: '我' }, ...characters.map(char => ({ actor: { type: 'character' as const, charId: char.id }, name: char.name }))], rng: () => 0.5 });
  state.players.sort((a, b) => ['user', 'character:a', 'character:b', 'character:c'].indexOf(a.actorId) - ['user', 'character:a', 'character:b', 'character:c'].indexOf(b.actorId));
  state.players.forEach((player, seat) => { player.seat = seat; player.hand = [{ id: `HAND_${player.actorId}`, rank: 'K' }]; });
  state.round.currentActorId = 'character:a';
  return state;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.history.mockImplementation(async id => [{ content: `HISTORY_${id}` }]);
  mocks.context.mockImplementation(async ({ char, historyMsgs }) => ({ systemPrompt: `${char.systemPrompt} ${char.memories[0].summary} WORLDBOOK_${char.id}`, cleanedApiMessages: historyMsgs.map((msg: { content: string }) => ({ role: 'user', ...msg })) }));
});

describe('liars bar individual and batch request boundaries', () => {
  it('individual uses only its own character context and player view', async () => {
    const state = session();
    const view = buildLiarsBarPlayerView(state, 'character:a');
    mocks.fetch.mockResolvedValue({ content: JSON.stringify({ action: 'play', cardIds: ['HAND_character:a'], utterance: '一张。' }) });
    await requestLiarsBarAction({ ...common, char: characters[0], view });
    expect(mocks.context).toHaveBeenCalledTimes(1);
    expect(mocks.context.mock.calls[0][0]).toMatchObject({ char: characters[0], stripImages: true, disableMcp: true });
    const body = mocks.fetch.mock.calls[0][1].body as string;
    expect(body).toMatch(/PERSONA_a.*MEMORY_a/);
    expect(body).toContain('HISTORY_a');
    expect(body).toContain('WORLDBOOK_a');
    expect(body).not.toMatch(/PERSONA_b|HISTORY_b|HAND_character:b|HAND_user|bulletIndex/);
  });

  it('batch makes one completion call with separate member blocks and only projected hands', async () => {
    const view = buildLiarsBarBatchView(session());
    mocks.fetch.mockResolvedValue({ content: JSON.stringify({ actions: view.privatePlayers.map(player => ({ actorId: player.actorId, action: 'play', cardIds: [player.ownHand[0].id], utterance: '一张。' })) }) });
    expect(await requestLiarsBarBatch({ ...common, characters, view })).toHaveLength(3);
    expect(mocks.context).toHaveBeenCalledTimes(3);
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
    for (const [args] of mocks.context.mock.calls) expect(args).toMatchObject({ stripImages: true, disableMcp: true });
    const body = mocks.fetch.mock.calls[0][1].body as string;
    for (const id of ['a', 'b', 'c']) {
      expect(body).toContain(`PLAYER character:${id}`);
      expect(body).toContain(`PERSONA_${id}`);
      expect(body).toContain(`HISTORY_${id}`);
      expect(body).toContain(`MEMORY_${id}`);
    }
    expect(body).not.toMatch(/HAND_user|bulletIndex|chamberIndex/);
    expect(body).toContain('严格按 actorSequence 顺序');
    expect(body).toContain('challenge 后立即结束');
  });

  it('retries invalid individual actions twice, then fails without a state mutation', async () => {
    const state = session();
    const before = structuredClone(state);
    mocks.fetch.mockResolvedValue({ content: '{"action":"play","cardIds":["HAND_character:b"]}' });
    await expect(requestLiarsBarAction({ ...common, char: characters[0], view: buildLiarsBarPlayerView(state, 'character:a') })).rejects.toThrow('不属于自己');
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    expect(state).toEqual(before);
  });

  it('whole batch request failures leave the session untouched', async () => {
    const state = session();
    const before = structuredClone(state);
    mocks.fetch.mockRejectedValue(new Error('offline'));
    await expect(requestLiarsBarBatch({ ...common, characters, view: buildLiarsBarBatchView(state) })).rejects.toThrow('offline');
    expect(mocks.fetch).toHaveBeenCalledTimes(3);
    expect(state).toEqual(before);
  });

  it('aborting after context construction prevents the paid completion request', async () => {
    const controller = new AbortController();
    mocks.context.mockImplementation(async () => { controller.abort(); return { systemPrompt: '', cleanedApiMessages: [] }; });
    await expect(requestLiarsBarBatch({ ...common, characters, view: buildLiarsBarBatchView(session()), signal: controller.signal })).rejects.toThrow();
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it('aborting an in-flight request does not retry or return an action', async () => {
    const controller = new AbortController();
    mocks.fetch.mockImplementation(async () => { controller.abort(); return { content: '{"action":"play","cardIds":["HAND_character:a"]}' }; });
    await expect(requestLiarsBarAction({ ...common, char: characters[0], view: buildLiarsBarPlayerView(session(), 'character:a'), signal: controller.signal })).rejects.toThrow();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);
  });
});
