import { describe, expect, it } from 'vitest';
import type { LiarsBarSession } from '../../../types';
import {
  challengeLastPlay, createLiarsBarDeck, createLiarsBarSession, fireRoulette, getLegalActions,
  playCards, startNextRound,
} from './engine';
import { buildLiarsBarPlayerView } from './visibility';

const create = () => createLiarsBarSession({
  players: [
    { actor: { type: 'user' }, name: '我' },
    { actor: { type: 'character', charId: 'a' }, name: 'A' },
    { actor: { type: 'character', charId: 'b' }, name: 'B' },
    { actor: { type: 'character', charId: 'c' }, name: 'C' },
  ],
  rng: () => 0.37,
  now: 1,
});

const arrangePlay = (rank: 'Q' | 'K' | 'A' | 'JOKER', target: 'Q' | 'K' | 'A' = 'K') => {
  const session = create();
  const actor = session.players[0];
  actor.hand = [{ id: 'chosen', rank }, { id: 'spare', rank: 'A' }];
  session.round.targetRank = target;
  session.round.currentActorId = actor.actorId;
  return { session, actorId: actor.actorId, challengerId: session.players[1].actorId };
};

describe('liars bar engine', () => {
  it('persists the selected mode and configurable roulette without changing six-chamber defaults', () => {
    expect(create().settings?.generationMode).toBe('batch');
    const input = { players: create().players.map(({ actor, name }) => ({ actor, name })), generationMode: 'individual' as const, chamberCount: 2, rng: () => 0.9 };
    const session = createLiarsBarSession(input);
    expect(session.settings?.generationMode).toBe('individual');
    expect(session.players.every(player => player.roulette.chamberCount === 2 && player.roulette.bulletIndex === 1)).toBe(true);
    expect(create().players.every(player => player.roulette.chamberCount === 6)).toBe(true);
    expect(() => createLiarsBarSession({ ...input, chamberCount: 0 })).toThrow();
  });
  it('builds the exact 20-card deck with unique ids and deals five to each player', () => {
    const deck = createLiarsBarDeck();
    expect(deck).toHaveLength(20);
    expect(new Set(deck.map(card => card.id)).size).toBe(20);
    expect(deck.filter(card => card.rank === 'Q')).toHaveLength(6);
    expect(deck.filter(card => card.rank === 'K')).toHaveLength(6);
    expect(deck.filter(card => card.rank === 'A')).toHaveLength(6);
    expect(deck.filter(card => card.rank === 'JOKER')).toHaveLength(2);
    expect(create().players.map(player => player.hand.length)).toEqual([5, 5, 5, 5]);
  });

  it('only allows 1-3 unique cards actually held by the current player', () => {
    const { session, actorId } = arrangePlay('K');
    expect(() => playCards(session, actorId, [])).toThrow('1～3');
    expect(() => playCards(session, actorId, ['chosen', 'chosen'])).toThrow('重复');
    expect(() => playCards(session, actorId, ['not-owned'])).toThrow('自己手里');
    expect(playCards(session, actorId, ['chosen']).players.find(player => player.actorId === actorId)?.hand.map(card => card.id)).toEqual(['spare']);
  });

  it('forces a player with no cards to challenge when a last play exists', () => {
    const { session, actorId, challengerId } = arrangePlay('K');
    const afterPlay = playCards(session, actorId, ['chosen']);
    const challenger = afterPlay.players.find(player => player.actorId === challengerId)!;
    challenger.hand = [];
    afterPlay.round.currentActorId = challengerId;
    expect(getLegalActions(afterPlay, challengerId)).toMatchObject({ canChallenge: true, playableCardIds: [] });
  });

  it('punishes a liar when challenged and treats Joker as truthful', () => {
    const lie = arrangePlay('Q', 'K');
    let afterPlay = playCards(lie.session, lie.actorId, ['chosen']);
    afterPlay.round.currentActorId = lie.challengerId;
    const lied = challengeLastPlay(afterPlay, lie.challengerId, '', () => 0.8, 5);
    expect(lied.events.find(event => event.type === 'reveal')?.challengeSucceeded).toBe(true);
    expect(lied.events.filter(event => event.type === 'roulette').at(-1)?.actorId).toBe(lie.actorId);

    const joker = arrangePlay('JOKER', 'K');
    afterPlay = playCards(joker.session, joker.actorId, ['chosen']);
    afterPlay.round.currentActorId = joker.challengerId;
    const truthful = challengeLastPlay(afterPlay, joker.challengerId, '', () => 0.8, 5);
    expect(truthful.events.find(event => event.type === 'reveal')?.challengeSucceeded).toBe(false);
    expect(truthful.events.filter(event => event.type === 'roulette').at(-1)?.actorId).toBe(joker.challengerId);
  });

  it('preserves roulette state across rounds and advances only the punished player', () => {
    const session = create();
    const punished = session.players[0];
    punished.roulette = { chamberCount: 6, bulletIndex: 5, chamberIndex: 0, shotsFired: 0 };
    const fired = fireRoulette(session, punished.actorId, 2);
    expect(fired.players.find(player => player.actorId === punished.actorId)?.roulette).toMatchObject({ chamberIndex: 1, shotsFired: 1 });
    expect(fired.players.slice(1).every(player => player.roulette.shotsFired === 0)).toBe(true);
    const nextRound = startNextRound(fired, () => 0.2, 3);
    expect(nextRound.players.find(player => player.actorId === punished.actorId)?.roulette).toMatchObject({ chamberIndex: 1, shotsFired: 1, bulletIndex: 5 });
  });

  it('marks a hit dead and completes when only one player remains', () => {
    const lie = arrangePlay('Q', 'K');
    lie.session.players.forEach((player, index) => { if (index > 1) player.alive = false; });
    const liar = lie.session.players.find(player => player.actorId === lie.actorId)!;
    liar.roulette = { chamberCount: 6, bulletIndex: 0, chamberIndex: 0, shotsFired: 0 };
    const afterPlay = playCards(lie.session, lie.actorId, ['chosen']);
    afterPlay.round.currentActorId = lie.challengerId;
    const completed = challengeLastPlay(afterPlay, lie.challengerId, '', () => 0.5, 5);
    expect(completed.status).toBe('completed');
    expect(completed.players.find(player => player.actorId === lie.actorId)?.alive).toBe(false);
    expect(completed.winnerActorId).toBe(lie.challengerId);
  });
});

describe('liars bar player projection', () => {
  it('never exposes another hand, bullet index, or unrevealed dark cards', () => {
    const session = create();
    const actor = session.players[0];
    const opponent = session.players[1];
    actor.hand = [{ id: 'mine', rank: 'K' }];
    opponent.hand = [{ id: 'secret-card-id', rank: 'Q' }];
    opponent.roulette.bulletIndex = 4;
    session.round.currentActorId = opponent.actorId;
    const afterPlay = playCards(session, opponent.actorId, ['secret-card-id']);
    const serialized = JSON.stringify(buildLiarsBarPlayerView(afterPlay, actor.actorId));
    expect(serialized).not.toContain('secret-card-id');
    expect(serialized).not.toContain('bulletIndex');
    expect(JSON.parse(serialized).publicEvents.find((event: { type: string }) => event.type === 'play')).not.toHaveProperty('cardRanks');
  });

  it('makes challenged cards public after the reveal', () => {
    const { session, actorId, challengerId } = arrangePlay('Q', 'K');
    const afterPlay = playCards(session, actorId, ['chosen']);
    afterPlay.round.currentActorId = challengerId;
    const afterChallenge = challengeLastPlay(afterPlay, challengerId, '', () => 0.6, 4);
    const views = afterChallenge.players.map(player => buildLiarsBarPlayerView(afterChallenge, player.actorId));
    expect(views.every(view => view.publicEvents.some(event => event.type === 'reveal' && event.cardRanks?.includes('Q')))).toBe(true);
  });
});
