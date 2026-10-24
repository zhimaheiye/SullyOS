import type { LiarsBarSession } from '../../../types';
import { applyLiarsBarAction, getLegalActions, type RNG } from './engine';
import { validateLiarsBarAction } from './parser';
import { buildLiarsBarPlayerView } from './visibility';

/** A bounded seat cycle also works when the user is eliminated or in a future AI-only game. */
export function getContinuousAiActorsUntilUser(session: LiarsBarSession): string[] {
    if (session.status !== 'in_progress') return [];
    const alive = session.players.filter(player => player.alive).sort((a, b) => a.seat - b.seat);
    const start = alive.findIndex(player => player.actorId === session.round.currentActorId);
    if (start < 0) return [];
    const actors: string[] = [];
    for (let offset = 0; offset < alive.length; offset += 1) {
        const player = alive[(start + offset) % alive.length];
        if (player.actor.type === 'user') break;
        actors.push(player.actorId);
    }
    return actors;
}

export function buildLiarsBarBatchView(session: LiarsBarSession) {
    const actorSequence = getContinuousAiActorsUntilUser(session);
    if (!actorSequence.length) throw new Error('当前没有连续 AI 回合');
    const views = actorSequence.map(actorId => buildLiarsBarPlayerView(session, actorId));
    const first = views[0];
    return {
        sessionId: session.id, revision: session.revision, actorSequence,
        publicTable: {
            round: first.round, targetRank: first.targetRank, currentActorId: first.currentActorId,
            players: first.players, lastPlay: first.lastPlay,
            // No actor's private play history belongs in the shared block.
            events: first.publicEvents.map(event => {
                if (event.type !== 'play') return event;
                const { cardRanks: _hidden, ...publicEvent } = event;
                return publicEvent;
            }),
        },
        privatePlayers: views.map((view, index) => ({
            actorId: view.actorId, ownHand: view.ownHand,
            // Conditional on all earlier actors having played, not challenged.
            legalActions: {
                playableCardIds: view.ownHand.map(card => card.id), minCards: 1 as const, maxCards: 3 as const,
                canChallenge: index > 0 || view.legalActions.canChallenge,
            },
        })),
    };
}

export type LiarsBarBatchView = ReturnType<typeof buildLiarsBarBatchView>;

export function parseLiarsBarBatch(raw: string): unknown[] {
    let value: unknown;
    try { value = JSON.parse(raw); } catch { throw new Error('批量响应不是有效 JSON'); }
    const actions = value && typeof value === 'object' && !Array.isArray(value)
        ? (value as { actions?: unknown }).actions : undefined;
    if (!Array.isArray(actions) || !actions.length || actions.length > 4) throw new Error('批量响应必须包含 1～4 条 actions');
    // Validate each item only when it is about to execute; a bad suffix must not roll back a valid prefix.
    return actions;
}

export async function executeLiarsBarPlan(input: {
    snapshot: LiarsBarSession;
    actorSequence: string[];
    actions: unknown[];
    isActive: () => boolean;
    load: (id: string) => Promise<LiarsBarSession | undefined>;
    save: (next: LiarsBarSession, expected: { revision: number; actorId: string }, isActive: () => boolean) => Promise<boolean>;
    onSaved: (next: LiarsBarSession, previous: LiarsBarSession) => void | Promise<void>;
    rng?: RNG;
}): Promise<void> {
    let expected = input.snapshot;
    for (let index = 0; index < input.actorSequence.length; index += 1) {
        if (!input.isActive()) return;
        const latest = await input.load(expected.id);
        if (!input.isActive() || !latest || latest.id !== expected.id
            || latest.revision !== expected.revision
            || latest.round.currentActorId !== expected.round.currentActorId
            || latest.status !== 'in_progress') return;
        const actorId = input.actorSequence[index];
        if (latest.round.currentActorId !== actorId) throw new Error('行动顺序与当前回合不一致');
        const item = input.actions[index] as Record<string, unknown> | undefined;
        if (!item || item.actorId !== actorId) throw new Error('批量行动缺失或玩家顺序不合法');
        const action = validateLiarsBarAction(item, getLegalActions(latest, actorId));
        const next = applyLiarsBarAction(latest, actorId, action, input.rng);
        if (!await input.save(next, { revision: latest.revision, actorId }, input.isActive)) return;
        if (!input.isActive()) return;
        await input.onSaved(next, latest);
        if (action.action === 'challenge' || next.status === 'completed'
            || next.round.number !== latest.round.number
            || next.players.some((player, seat) => player.alive !== latest.players[seat].alive)
            || next.players.find(player => player.actorId === next.round.currentActorId)?.actor.type === 'user') return;
        expected = next;
    }
}
