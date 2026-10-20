import type { LiarsBarSession } from '../../../types';

export interface LiarsBarPlayerStats {
    actorId: string;
    name: string;
    plays: number;
    challenges: number;
    successfulChallenges: number;
    shots: number;
    eliminatedRound?: number;
}

export function calculateLiarsBarStats(session: LiarsBarSession): LiarsBarPlayerStats[] {
    return session.players.map(player => {
        const challenges = session.events.filter(event => event.type === 'challenge' && event.actorId === player.actorId);
        const successfulChallenges = challenges.filter(challenge => session.events.some(event =>
            event.type === 'reveal'
            && event.round === challenge.round
            && event.targetActorId === player.actorId
            && event.challengeSucceeded,
        )).length;
        return {
            actorId: player.actorId,
            name: player.name,
            plays: session.events.filter(event => event.type === 'play' && event.actorId === player.actorId).length,
            challenges: challenges.length,
            successfulChallenges,
            shots: session.events.filter(event => event.type === 'roulette' && event.actorId === player.actorId).length,
            eliminatedRound: session.events.find(event => event.type === 'elimination' && event.actorId === player.actorId)?.round,
        };
    });
}

export function buildLiarsBarPerspectiveSummary(session: LiarsBarSession, actorId: string): string {
    const stats = calculateLiarsBarStats(session);
    const own = stats.find(item => item.actorId === actorId)!;
    const winner = session.players.find(player => player.actorId === session.winnerActorId)?.name || '未决出';
    const others = session.players.filter(player => player.actorId !== actorId).map(player => player.name).join('、');
    const outcome = session.winnerActorId === actorId ? '我最终赢下了这局。' : own.eliminatedRound ? `我在第 ${own.eliminatedRound} 轮被淘汰，最后由${winner}获胜。` : `最后由${winner}获胜。`;
    return `我和${others}玩过一局骗子酒馆。全局只公开被质疑后真正翻开的牌；没人翻开的暗牌仍是各自的秘密。我出牌 ${own.plays} 次，质疑 ${own.challenges} 次，其中成功 ${own.successfulChallenges} 次，扣过 ${own.shots} 次扳机。${outcome}`;
}
