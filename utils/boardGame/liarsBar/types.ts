import type {
    LiarsBarCard, LiarsBarEvent, LiarsBarPlayerState, LiarsBarRank, LiarsBarSession,
} from '../../../types';

export type LiarsBarAction =
    | { action: 'play'; cardIds: string[]; utterance?: string }
    | { action: 'challenge'; utterance?: string };

export interface LiarsBarLegalActions {
    canChallenge: boolean;
    playableCardIds: string[];
    minCards: 1;
    maxCards: 3;
}

export interface LiarsBarPublicPlayer {
    actorId: string;
    name: string;
    alive: boolean;
    cardCount: number;
    shotsFired: number;
    seat: number;
}

export interface LiarsBarPlayerView {
    sessionId: string;
    revision: number;
    actorId: string;
    round: number;
    targetRank: Exclude<LiarsBarRank, 'JOKER'>;
    currentActorId: string;
    ownHand: LiarsBarCard[];
    players: LiarsBarPublicPlayer[];
    lastPlay?: { actorId: string; declaredCount: number; utterance?: string };
    publicEvents: LiarsBarEvent[];
    legalActions: LiarsBarLegalActions;
}

export type { LiarsBarCard, LiarsBarEvent, LiarsBarPlayerState, LiarsBarRank, LiarsBarSession };
