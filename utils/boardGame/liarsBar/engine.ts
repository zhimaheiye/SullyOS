import type {
    BoardGameActor, LiarsBarCard, LiarsBarEvent, LiarsBarGenerationMode, LiarsBarPlayerState, LiarsBarRank, LiarsBarSession,
} from '../../../types';
import type { LiarsBarAction, LiarsBarLegalActions } from './types';

export type RNG = () => number;

const id = (prefix: string) => globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const clone = <T,>(value: T): T => globalThis.structuredClone(value);
const ranks: Array<Exclude<LiarsBarRank, 'JOKER'>> = ['Q', 'K', 'A'];

const randomIndex = (length: number, rng: RNG) => Math.min(length - 1, Math.max(0, Math.floor(rng() * length)));

export function shuffle<T>(items: T[], rng: RNG): T[] {
    const result = [...items];
    for (let index = result.length - 1; index > 0; index -= 1) {
        const swap = randomIndex(index + 1, rng);
        [result[index], result[swap]] = [result[swap], result[index]];
    }
    return result;
}

export function createLiarsBarDeck(): LiarsBarCard[] {
    const result: LiarsBarCard[] = [];
    for (const rank of ranks) for (let index = 0; index < 6; index += 1) result.push({ id: `${rank.toLowerCase()}-${index + 1}`, rank });
    for (let index = 0; index < 2; index += 1) result.push({ id: `joker-${index + 1}`, rank: 'JOKER' });
    return result;
}

export const actorIdOf = (actor: BoardGameActor): string => actor.type === 'user' ? 'user' : `character:${actor.charId}`;

const addEvent = (session: LiarsBarSession, event: Omit<LiarsBarEvent, 'id' | 'createdAt'>, now: number) => {
    session.events.push({ ...event, id: id('lb-event'), createdAt: now });
};

export function startLiarsBarRound(session: LiarsBarSession, rng: RNG = Math.random, now = Date.now()): LiarsBarSession {
    const next = clone(session);
    const alive = next.players.filter(player => player.alive).sort((a, b) => a.seat - b.seat);
    if (alive.length < 2) return next;
    const deck = shuffle(createLiarsBarDeck(), rng);
    for (const player of next.players) player.hand = [];
    alive.forEach((player, playerIndex) => {
        const target = next.players.find(item => item.actorId === player.actorId)!;
        target.hand = deck.slice(playerIndex * 5, playerIndex * 5 + 5);
    });
    const roundNumber = Math.max(1, (next.round?.number || 0) + 1);
    const targetRank = ranks[randomIndex(ranks.length, rng)];
    const currentActorId = alive[(roundNumber - 1) % alive.length].actorId;
    next.round = { number: roundNumber, targetRank, currentActorId, plays: [] };
    next.revision += 1;
    next.updatedAt = now;
    addEvent(next, { type: 'round_start', round: roundNumber, targetRank }, now);
    return next;
}

export function createLiarsBarSession(input: {
    players: Array<{ actor: BoardGameActor; name: string }>;
    generationMode?: LiarsBarGenerationMode;
    chamberCount?: number;
    rng?: RNG;
    now?: number;
}): LiarsBarSession {
    if (input.players.length !== 4) throw new Error('骗子酒馆首版固定需要 4 名玩家');
    const actorIds = input.players.map(player => actorIdOf(player.actor));
    if (new Set(actorIds).size !== actorIds.length) throw new Error('玩家不能重复');
    const rng = input.rng || Math.random;
    const chamberCount = input.chamberCount ?? 6;
    if (!Number.isInteger(chamberCount) || chamberCount < 1) throw new Error('轮盘膛数必须是正整数');
    const now = input.now ?? Date.now();
    const ordered = shuffle(input.players, rng);
    const players: LiarsBarPlayerState[] = ordered.map((player, seat) => ({
        actorId: actorIdOf(player.actor), actor: player.actor, name: player.name, seat, alive: true, hand: [],
        roulette: { chamberCount, bulletIndex: randomIndex(chamberCount, rng), chamberIndex: 0, shotsFired: 0 },
    }));
    const base: LiarsBarSession = {
        id: id('liars-bar'), gameId: 'liars_bar', status: 'in_progress', revision: 0,
        settings: { generationMode: input.generationMode ?? 'batch' },
        players, round: { number: 0, targetRank: 'Q', currentActorId: '', plays: [] }, events: [],
        createdAt: now, updatedAt: now,
    };
    return startLiarsBarRound(base, rng, now);
}

export function getLegalActions(session: LiarsBarSession, actorId: string): LiarsBarLegalActions {
    const player = session.players.find(item => item.actorId === actorId);
    const isTurn = !!(session.status === 'in_progress' && player?.alive && session.round.currentActorId === actorId);
    const canChallenge = !!(isTurn && session.round.plays.length);
    return {
        canChallenge,
        playableCardIds: isTurn && player!.hand.length > 0 ? player!.hand.map(card => card.id) : [],
        minCards: 1,
        maxCards: 3,
    };
}

function nextAliveActor(session: LiarsBarSession, actorId: string): string {
    const ordered = [...session.players].sort((a, b) => a.seat - b.seat);
    const start = ordered.findIndex(player => player.actorId === actorId);
    for (let offset = 1; offset <= ordered.length; offset += 1) {
        const candidate = ordered[(start + offset) % ordered.length];
        if (candidate.alive) return candidate.actorId;
    }
    return actorId;
}

export function advanceTurn(session: LiarsBarSession): LiarsBarSession {
    const next = clone(session);
    next.round.currentActorId = nextAliveActor(next, next.round.currentActorId);
    return next;
}

export function playCards(session: LiarsBarSession, actorId: string, cardIds: string[], utterance = '', now = Date.now()): LiarsBarSession {
    const legal = getLegalActions(session, actorId);
    if (!legal.playableCardIds.length) throw new Error('当前不能出牌');
    if (cardIds.length < 1 || cardIds.length > 3) throw new Error('一次只能出 1～3 张牌');
    if (new Set(cardIds).size !== cardIds.length) throw new Error('不能重复选择同一张牌');
    if (cardIds.some(cardId => !legal.playableCardIds.includes(cardId))) throw new Error('只能打出自己手里的牌');
    const next = clone(session);
    const player = next.players.find(item => item.actorId === actorId)!;
    const cards = cardIds.map(cardId => player.hand.find(card => card.id === cardId)!);
    player.hand = player.hand.filter(card => !cardIds.includes(card.id));
    const tableTalk = utterance.trim().slice(0, 120) || undefined;
    next.round.plays.push({ id: id('lb-play'), actorId, cards, declaredCount: cards.length, utterance: tableTalk, createdAt: now });
    addEvent(next, { type: 'play', round: next.round.number, actorId, targetRank: next.round.targetRank, declaredCount: cards.length, cardRanks: cards.map(card => card.rank), utterance: tableTalk }, now);
    next.round.currentActorId = nextAliveActor(next, actorId);
    next.revision += 1;
    next.updatedAt = now;
    return next;
}

export function fireRoulette(session: LiarsBarSession, actorId: string, now = Date.now()): LiarsBarSession {
    const next = clone(session);
    const player = next.players.find(item => item.actorId === actorId);
    if (!player?.alive) throw new Error('无法让已淘汰玩家开枪');
    const bang = player.roulette.chamberIndex === player.roulette.bulletIndex;
    player.roulette.shotsFired += 1;
    player.roulette.chamberIndex = (player.roulette.chamberIndex + 1) % player.roulette.chamberCount;
    addEvent(next, { type: 'roulette', round: next.round.number, actorId, rouletteResult: bang ? 'bang' : 'click' }, now);
    if (bang) {
        player.alive = false;
        player.hand = [];
        addEvent(next, { type: 'elimination', round: next.round.number, actorId }, now);
    }
    return next;
}

export function getWinner(session: LiarsBarSession): string | undefined {
    const alive = session.players.filter(player => player.alive);
    return alive.length === 1 ? alive[0].actorId : undefined;
}

export function startNextRound(session: LiarsBarSession, rng: RNG = Math.random, now = Date.now()): LiarsBarSession {
    return startLiarsBarRound(session, rng, now);
}

export function challengeLastPlay(session: LiarsBarSession, actorId: string, utterance = '', rng: RNG = Math.random, now = Date.now()): LiarsBarSession {
    if (!getLegalActions(session, actorId).canChallenge) throw new Error('当前不能抓骗子');
    let next = clone(session);
    const lastPlay = next.round.plays[next.round.plays.length - 1];
    const truthful = lastPlay.cards.every(card => card.rank === next.round.targetRank || card.rank === 'JOKER');
    const challengeSucceeded = !truthful;
    const punishedActorId = challengeSucceeded ? lastPlay.actorId : actorId;
    const tableTalk = utterance.trim().slice(0, 120) || undefined;
    addEvent(next, { type: 'challenge', round: next.round.number, actorId, targetActorId: lastPlay.actorId, utterance: tableTalk }, now);
    addEvent(next, { type: 'reveal', round: next.round.number, actorId: lastPlay.actorId, targetActorId: actorId, cardRanks: lastPlay.cards.map(card => card.rank), challengeSucceeded }, now);
    next = fireRoulette(next, punishedActorId, now);
    const winnerActorId = getWinner(next);
    if (winnerActorId) {
        next.status = 'completed';
        next.winnerActorId = winnerActorId;
        next.completedAt = now;
        addEvent(next, { type: 'game_over', round: next.round.number, actorId: winnerActorId }, now);
        next.revision += 1;
        next.updatedAt = now;
        return next;
    }
    return startNextRound(next, rng, now);
}

export function applyLiarsBarAction(session: LiarsBarSession, actorId: string, action: LiarsBarAction, rng: RNG = Math.random, now = Date.now()): LiarsBarSession {
    return action.action === 'play'
        ? playCards(session, actorId, action.cardIds, action.utterance, now)
        : challengeLastPlay(session, actorId, action.utterance, rng, now);
}
