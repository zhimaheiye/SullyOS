import { describe, expect, it, vi } from 'vitest';
import type { LiarsBarSession } from '../../../types';
import { createLiarsBarSession, applyLiarsBarAction } from './engine';
import { buildLiarsBarPlayerView } from './visibility';
import { getLocalLiarsBarAction } from './parser';
import { buildLiarsBarBatchView, executeLiarsBarPlan, getContinuousAiActorsUntilUser, parseLiarsBarBatch } from './batch';

function create() {
  const session = createLiarsBarSession({ players: [
    { actor: { type: 'user' }, name: '我' },
    ...['a', 'b', 'c'].map(charId => ({ actor: { type: 'character' as const, charId }, name: charId })),
  ], rng: () => 0.7 });
  session.players.sort((a, b) => ['user', 'character:a', 'character:b', 'character:c'].indexOf(a.actorId) - ['user', 'character:a', 'character:b', 'character:c'].indexOf(b.actorId));
  session.players.forEach((player, seat) => { player.seat = seat; player.roulette.bulletIndex = 5; });
  session.round.currentActorId = 'character:a';
  return session;
}

const plays = (session: LiarsBarSession) => getContinuousAiActorsUntilUser(session).map(actorId => ({
  actorId, action: 'play', cardIds: [session.players.find(player => player.actorId === actorId)!.hand[0].id], utterance: '一张。',
}));

function harness(snapshot = create()) {
  let stored = structuredClone(snapshot);
  let active = true;
  const save = vi.fn(async (next, expected, isActive) => {
    if (!isActive() || stored.revision !== expected.revision || stored.round.currentActorId !== expected.actorId) return false;
    stored = structuredClone(next);
    return true;
  });
  const onSaved = vi.fn();
  return {
    snapshot, save, onSaved, get stored() { return stored; },
    cancel: () => { active = false; },
    change: (value: LiarsBarSession) => { stored = value; },
    run: (actions: unknown[], sequence = getContinuousAiActorsUntilUser(snapshot)) => executeLiarsBarPlan({
      snapshot, actorSequence: sequence, actions, isActive: () => active,
      load: async () => structuredClone(stored), save, onSaved, rng: () => 0.7,
    }),
  };
}

describe('liars bar batch planning and execution', () => {
  it('orders by live seats until the user, and bounds an observer/AI-only cycle', () => {
    const session = create();
    expect(getContinuousAiActorsUntilUser(session)).toEqual(['character:a', 'character:b', 'character:c']);
    session.players[2].alive = false;
    expect(getContinuousAiActorsUntilUser(session)).toEqual(['character:a', 'character:c']);
    session.round.currentActorId = 'user';
    expect(getContinuousAiActorsUntilUser(session)).toEqual([]);
    session.players[0].alive = false;
    session.round.currentActorId = 'character:c';
    expect(getContinuousAiActorsUntilUser(session)).toEqual(['character:c', 'character:a']);
    session.status = 'completed';
    expect(getContinuousAiActorsUntilUser(session)).toEqual([]);
  });

  it('projects no user cards, bullets, or private play history into the batch table', () => {
    let session = create();
    session.players[0].hand = [{ id: 'USER_SECRET', rank: 'Q' }];
    session.round.currentActorId = 'user';
    session = applyLiarsBarAction(session, 'user', { action: 'play', cardIds: ['USER_SECRET'] });
    const dto = buildLiarsBarBatchView(session);
    expect(JSON.stringify(dto)).not.toMatch(/USER_SECRET|bulletIndex|chamberIndex/);
    expect(dto.publicTable.events.find(event => event.type === 'play')).not.toHaveProperty('cardRanks');
    expect(dto.privatePlayers).toHaveLength(3);
    expect(dto.privatePlayers[0].ownHand).toEqual(session.players[1].hand);
    expect(dto.privatePlayers[1].legalActions.canChallenge).toBe(true);
  });

  it('requires strict JSON and an array, not prose or arbitrarily long plans', () => {
    expect(parseLiarsBarBatch('{"actions":[{}]}')).toEqual([{}]);
    for (const raw of ['no', 'null', '[]', '{"actions":[]}', 'prefix {"actions":[{}]}', JSON.stringify({ actions: Array(5).fill({}) })]) {
      expect(() => parseLiarsBarBatch(raw)).toThrow();
    }
  });

  it('saves every action before the next and stops at the user', async () => {
    const h = harness();
    h.onSaved.mockImplementation(next => expect(h.stored).toEqual(next));
    await h.run([...plays(h.snapshot), { actorId: 'user', action: 'challenge' }]);
    expect(h.save).toHaveBeenCalledTimes(3);
    expect(h.stored.revision).toBe(h.snapshot.revision + 3);
    expect(h.stored.round.currentActorId).toBe('user');
    expect(h.stored.events.filter(event => event.type === 'play')).toHaveLength(3);
  });

  it.each(['foreign-card', 'wrong-actor', 'duplicate', 'missing', 'unknown-action'])('keeps the saved prefix and stops on %s', async bad => {
    const h = harness();
    const actions: unknown[] = plays(h.snapshot);
    if (bad === 'foreign-card') actions[1] = { ...actions[1] as object, cardIds: ['USER_SECRET'] };
    if (bad === 'wrong-actor') actions[1] = { ...actions[1] as object, actorId: 'character:missing' };
    if (bad === 'duplicate') actions[1] = actions[0];
    if (bad === 'missing') actions.splice(1);
    if (bad === 'unknown-action') actions[1] = { ...actions[1] as object, action: 'win' };
    await expect(h.run(actions)).rejects.toThrow();
    expect(h.save).toHaveBeenCalledTimes(1);
    expect(h.stored.round.currentActorId).toBe('character:b');
    expect(h.stored.revision).toBe(h.snapshot.revision + 1);
  });

  it('revalidates challenge against the state created by the preceding action and drops the suffix', async () => {
    const h = harness();
    const actions: unknown[] = plays(h.snapshot);
    expect(buildLiarsBarPlayerView(h.snapshot, 'character:b').legalActions.canChallenge).toBe(false);
    actions[1] = { actorId: 'character:b', action: 'challenge', utterance: '开。' };
    actions[2] = { actorId: 'not-a-player', action: 'win' };
    await h.run(actions);
    expect(h.save).toHaveBeenCalledTimes(2);
    expect(h.stored.round.number).toBe(h.snapshot.round.number + 1);
    expect(h.stored.events.filter(event => event.type === 'roulette')).toHaveLength(1);
  });

  it('stops on death and game over without consuming another action', async () => {
    const session = create();
    session.players[0].alive = session.players[3].alive = false;
    session.players[1].hand = [{ id: 'liar', rank: 'Q' }];
    session.players[1].roulette.bulletIndex = 0;
    session.round.targetRank = 'K';
    const h = harness(session);
    await h.run([{ actorId: 'character:a', action: 'play', cardIds: ['liar'] }, { actorId: 'character:b', action: 'challenge' }, { actorId: 'user', action: 'win' }]);
    expect(h.stored.status).toBe('completed');
    expect(h.stored.winnerActorId).toBe('character:b');
    expect(h.save).toHaveBeenCalledTimes(2);
  });

  it('drops stale revisions and current-actor changes before any write', async () => {
    for (const change of ['revision', 'actor']) {
      const h = harness();
      const newer = structuredClone(h.snapshot);
      if (change === 'revision') newer.revision += 1;
      else newer.round.currentActorId = 'character:c';
      h.change(newer);
      await h.run(plays(h.snapshot));
      expect(h.save).not.toHaveBeenCalled();
    }
  });

  it('cancels before reply, between actions, and at the write boundary', async () => {
    const cancelled = harness();
    cancelled.cancel();
    await cancelled.run(plays(cancelled.snapshot));
    expect(cancelled.save).not.toHaveBeenCalled();
    const midway = harness();
    midway.onSaved.mockImplementation(() => midway.cancel());
    await midway.run(plays(midway.snapshot));
    expect(midway.save).toHaveBeenCalledTimes(1);
    const boundary = harness();
    boundary.save.mockImplementation(async (_next, _expected, isActive) => { boundary.cancel(); return isActive(); });
    await boundary.run(plays(boundary.snapshot));
    expect(boundary.onSaved).not.toHaveBeenCalled();
    expect(boundary.stored).toEqual(boundary.snapshot);
  });

  it('does not replay an already consumed response', async () => {
    const h = harness();
    const actions = plays(h.snapshot);
    await h.run(actions);
    await h.run(actions);
    expect(h.save).toHaveBeenCalledTimes(3);
  });

  it('plays a complete local-only game and preserves all randomness on restoration', () => {
    let session = create();
    for (let step = 0; step < 600 && session.status !== 'completed'; step += 1) {
      const view = buildLiarsBarPlayerView(session, session.round.currentActorId);
      session = applyLiarsBarAction(session, view.actorId, getLocalLiarsBarAction(view), () => 0.6);
      const restored = JSON.parse(JSON.stringify(session));
      expect(restored).toEqual(session);
      session = restored;
    }
    expect(session.status).toBe('completed');
    expect(session.players.filter(player => player.alive)).toHaveLength(1);
  });
});
