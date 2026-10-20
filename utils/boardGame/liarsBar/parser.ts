import type { LiarsBarAction, LiarsBarLegalActions } from './types';

export function parseLiarsBarAction(raw: string, legal: LiarsBarLegalActions): LiarsBarAction {
    let json: unknown;
    try { json = JSON.parse(raw); } catch { throw new Error('角色没有返回有效 JSON'); }
    return validateLiarsBarAction(json, legal);
}

export function validateLiarsBarAction(value: unknown, legal: LiarsBarLegalActions): LiarsBarAction {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('角色没有返回有效 JSON 对象');
    const json = value as Record<string, unknown>;
    const action = json.action;
    if (json.utterance !== undefined && typeof json.utterance !== 'string') throw new Error('桌上发言必须是文字');
    const utterance = (json.utterance as string | undefined)?.trim().slice(0, 120) || undefined;
    if (action === 'challenge') {
        if (!legal.canChallenge) throw new Error('当前不允许抓骗子');
        return { action: 'challenge', utterance };
    }
    if (action !== 'play') throw new Error('角色返回了未知动作');
    if (!Array.isArray(json.cardIds) || json.cardIds.some(id => typeof id !== 'string')) throw new Error('cardIds 必须是字符串数组');
    const cardIds = json.cardIds as string[];
    if (cardIds.length < legal.minCards || cardIds.length > legal.maxCards) throw new Error('出牌数量不合法');
    if (new Set(cardIds).size !== cardIds.length) throw new Error('角色重复选择了同一张牌');
    if (cardIds.some(id => !legal.playableCardIds.includes(id))) throw new Error('角色选择了不属于自己的牌');
    return { action: 'play', cardIds, utterance };
}

export function getLocalLiarsBarAction(view: { targetRank: string; ownHand: Array<{ id: string; rank: string }>; legalActions: LiarsBarLegalActions }): LiarsBarAction {
    if (!view.legalActions.playableCardIds.length) return { action: 'challenge', utterance: '开牌吧。' };
    const preferred = view.ownHand.find(card => card.rank === view.targetRank || card.rank === 'JOKER') || view.ownHand[0];
    return { action: 'play', cardIds: [preferred.id], utterance: `一张${view.targetRank}。` };
}
