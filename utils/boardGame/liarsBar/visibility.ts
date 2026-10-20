import type { LiarsBarEvent, LiarsBarSession } from '../../../types';
import { getLegalActions } from './engine';
import type { LiarsBarPlayerView } from './types';

const projectEvent = (event: LiarsBarEvent, actorId: string): LiarsBarEvent => {
    if (event.type === 'play' && event.actorId !== actorId) {
        const { cardRanks: _privateRanks, ...publicEvent } = event;
        return publicEvent;
    }
    return { ...event };
};

export function buildLiarsBarPlayerView(session: LiarsBarSession, actorId: string): LiarsBarPlayerView {
    const player = session.players.find(item => item.actorId === actorId);
    if (!player) throw new Error('玩家不在本局中');
    const lastPlay = session.round.plays[session.round.plays.length - 1];
    return {
        sessionId: session.id,
        revision: session.revision,
        actorId,
        round: session.round.number,
        targetRank: session.round.targetRank,
        currentActorId: session.round.currentActorId,
        ownHand: player.hand.map(card => ({ ...card })),
        players: session.players.map(item => ({
            actorId: item.actorId, name: item.name, alive: item.alive, cardCount: item.hand.length,
            shotsFired: item.roulette.shotsFired, seat: item.seat,
        })),
        lastPlay: lastPlay ? { actorId: lastPlay.actorId, declaredCount: lastPlay.declaredCount, utterance: lastPlay.utterance } : undefined,
        publicEvents: session.events.map(event => projectEvent(event, actorId)),
        legalActions: getLegalActions(session, actorId),
    };
}
