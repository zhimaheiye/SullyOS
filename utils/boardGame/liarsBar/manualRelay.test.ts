import { afterEach, expect, it, vi } from 'vitest';
import { requestLiarsBarJson } from './aiService';
import { parseLiarsBarAction } from './parser';
import type { LiarsBarLegalActions } from './types';
import { armManualRelay, disarmManualRelay, getManualRelayState, noteManualRelayUserAction, submitManualRelay } from '../../manualModelRelay';

const apiConfig = { baseUrl: 'https://paid.invalid/v1', apiKey: 'synthetic', model: 'test' } as any;
const messages = [{ role: 'system', content: '只选择自己的牌' }, { role: 'user', content: '轮到你了' }];
const legal: LiarsBarLegalActions = { canChallenge: false, playableCardIds: ['mine'], minCards: 1, maxCards: 3 };

afterEach(() => { disarmManualRelay(); vi.restoreAllMocks(); localStorage.clear(); });

it('manual invalid action stays in the original parser and cannot trigger a paid retry', async () => {
    const paidFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('paid request'));
    armManualRelay(); noteManualRelayUserAction();
    const task = requestLiarsBarJson({ apiConfig, messages, parse: raw => parseLiarsBarAction(raw, legal) });
    await vi.waitFor(() => expect(getManualRelayState().status).toBe('waiting'));
    expect(submitManualRelay(getManualRelayState().request!.id, '{"action":"play","cardIds":["somebody-else"]}')).toBe(true);
    await expect(task).rejects.toThrow('手动接力后的自动后续模型请求已停止');
    expect(paidFetch).not.toHaveBeenCalled();
});

it('manual legal action passes the original rule validator once', async () => {
    const paidFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('paid request'));
    armManualRelay(); noteManualRelayUserAction();
    const task = requestLiarsBarJson({ apiConfig, messages, parse: raw => parseLiarsBarAction(raw, legal) });
    await vi.waitFor(() => expect(getManualRelayState().status).toBe('waiting'));
    submitManualRelay(getManualRelayState().request!.id, '{"action":"play","cardIds":["mine"],"utterance":"一张。"}');
    await expect(task).resolves.toEqual({ action: 'play', cardIds: ['mine'], utterance: '一张。' });
    expect(paidFetch).not.toHaveBeenCalled();
});
