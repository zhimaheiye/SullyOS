import type { LiarsBarPlayerView } from './types';

const eventText = (view: LiarsBarPlayerView) => view.publicEvents.slice(-18).map(event => {
    const name = (id?: string) => view.players.find(player => player.actorId === id)?.name || '未知玩家';
    if (event.type === 'round_start') return `第${event.round}轮开始，目标牌是 ${event.targetRank}`;
    if (event.type === 'play') return `${name(event.actorId)} 声称出了 ${event.declaredCount} 张 ${event.targetRank || view.targetRank}${event.utterance ? `，并说：“${event.utterance}”` : ''}`;
    if (event.type === 'challenge') return `${name(event.actorId)} 质疑 ${name(event.targetActorId)}${event.utterance ? `：“${event.utterance}”` : ''}`;
    if (event.type === 'reveal') return `翻牌：${event.cardRanks?.join('、')}，质疑${event.challengeSucceeded ? '成功' : '失败'}`;
    if (event.type === 'roulette') return `${name(event.actorId)} 扣动扳机：${event.rouletteResult === 'bang' ? '枪响' : '空响'}`;
    if (event.type === 'elimination') return `${name(event.actorId)} 被淘汰`;
    return `${name(event.actorId)} 获胜`;
}).join('\n');

export const LIARS_BAR_RULES = '牌组为 Q/K/A 各6张、Joker两张，每轮存活玩家各5张。暗出1～3张，统一声称为目标牌；Joker合法。下一家可继续出牌或质疑上一手；无牌必须质疑。有假牌则上一家受罚，否则质疑者受罚。质疑即结束本轮，受罚者扣动自己的轮盘；轮盘跨轮保留，淘汰后最后存活者胜。你不能决定任何翻牌、轮盘或胜负结果。';

export function buildLiarsBarPrompt(view: LiarsBarPlayerView): string {
    const names = new Map(view.players.map(player => [player.actorId, player.name]));
    const legal = [
        view.legalActions.playableCardIds.length ? `play：从 [${view.legalActions.playableCardIds.join(', ')}] 选择 1～3 个 cardId` : '',
        view.legalActions.canChallenge ? 'challenge：质疑上一手' : '',
    ].filter(Boolean).join('\n- ');
    return [
        '你正在 SullyOS「桌游」里玩骗子酒馆。规则程序拥有唯一事实权；你只能选择合法动作，不能宣布翻牌、枪或胜负结果。',
        LIARS_BAR_RULES,
        '请根据你一贯的人格、与桌上这些人的真实关系、自己的隐藏手牌和公开行动做判断。可以欺骗、试探、调侃或抓谎，但不要捏造共同经历。每次动作只附一句自然桌上发言，不输出思维过程。',
        `你是：${names.get(view.actorId)}\n本轮：${view.round}\n目标牌：${view.targetRank}\n你的手牌：${view.ownHand.map(card => `${card.id}=${card.rank}`).join('、') || '无'}`,
        `公开玩家：\n${view.players.map(player => `${player.name}：${player.alive ? `剩 ${player.cardCount} 张，已扣扳机 ${player.shotsFired} 次` : '已淘汰'}`).join('\n')}`,
        `公开牌桌记录：\n${eventText(view) || '暂无'}`,
        `合法动作：\n- ${legal}`,
        '只输出 JSON，不要 Markdown：\n出牌：{"action":"play","cardIds":["真实cardId"],"utterance":"一句话"}\n质疑：{"action":"challenge","utterance":"一句话"}',
    ].join('\n\n');
}
