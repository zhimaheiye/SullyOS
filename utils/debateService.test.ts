import { afterEach, describe, expect, it, vi } from 'vitest';
import type { APIConfig, DebateSession } from '../types';
import { DB } from './db';
import { persistDebateShare, requestDebateCharacter, requestDebateJudgement, requestDebateSummary } from './debateService';
import { createDebateSession } from './debate';
import { buildChatRequestPayload } from './chatRequestPayload';
import { safeFetchJson } from './safeApi';

vi.mock('./amsgStateSync', () => ({ markAmsgStateDirty: vi.fn() }));
vi.mock('./chatRequestPayload', () => ({ buildChatRequestPayload: vi.fn() }));
vi.mock('./safeApi', async importOriginal => ({ ...await importOriginal<typeof import('./safeApi')>(), safeFetchJson: vi.fn() }));

describe('debate entertainment request boundaries', () => {
  const apiConfig = { baseUrl: 'https://example.invalid/v1', model: 'test' } as APIConfig;
  const speech = { id: '1', speakerType: 'character' as const, charId: 'char', speakerName: '角色', side: 'con' as const, round: 1, phase: 'opening' as const, content: '公开论点', score: 70, createdAt: 1 };
  const makeSession = (): DebateSession => ({ ...createDebateSession({ mode: 'solo', topic: '测试', proPosition: '正', conPosition: '反', charId: 'char', userSide: 'pro' }), speeches: [speech] });
  const body = () => JSON.parse(String(vi.mocked(safeFetchJson).mock.calls.at(-1)![1].body));
  afterEach(() => { vi.restoreAllMocks(); vi.clearAllMocks(); });

  it('scores from the public speech only and does not ask for audience comments', async () => {
    vi.mocked(safeFetchJson).mockResolvedValue({ choices: [{ message: { content: '{"score":70,"comment":"反馈"}' } }] });
    const session = makeSession();
    await requestDebateJudgement({ apiConfig, session, speech });
    expect(safeFetchJson).toHaveBeenCalledTimes(1);
    expect(buildChatRequestPayload).not.toHaveBeenCalled();
    const judged = JSON.stringify(body());
    expect(judged).toContain('公开论点');
    expect(judged).not.toContain('audienceComments');
    expect(judged).not.toContain('虚构围观');
    await requestDebateSummary({ apiConfig, session });
    expect(JSON.stringify(body())).toContain('公开论点');
  });

  it('keeps the character voice in a speech and does not add a short-exchange style', async () => {
    vi.spyOn(DB, 'getMessagesByCharId').mockResolvedValue([]);
    vi.spyOn(DB, 'getEmojis').mockResolvedValue([]);
    vi.spyOn(DB, 'getEmojiCategories').mockResolvedValue([]);
    vi.mocked(buildChatRequestPayload).mockResolvedValue({ systemPrompt: '本人的人格与记忆', cleanedApiMessages: [] } as any);
    vi.mocked(safeFetchJson).mockResolvedValue({ choices: [{ message: { content: '我不同意。' } }] });
    const input = { apiConfig, session: makeSession(), char: { id: 'char', name: '角色' } as any, userProfile: {} as any, groups: [], realtimeConfig: {} as any, purpose: 'speech' as const, side: 'con' as const, speech };
    expect(await requestDebateCharacter(input)).toBe('我不同意。');
    const request = JSON.stringify(body());
    expect(request).toContain('本人的人格与记忆');
    expect(request).toContain('必须坚定捍卫');
    expect(request).not.toContain('短句交锋');
    expect(request).not.toContain('散场');
  });

  it('does not start an API call after cancellation', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(requestDebateJudgement({ apiConfig, session: makeSession(), speech, signal: controller.signal })).rejects.toThrow();
    expect(safeFetchJson).not.toHaveBeenCalled();
  });
});

describe('debate share idempotency', () => {
  afterEach(() => vi.restoreAllMocks());

  it('reuses an existing card when the session marker was not saved', async () => {
    vi.spyOn(DB, 'getMessagesByCharId').mockResolvedValue([{
      id: 42, charId: 'char', role: 'assistant', type: 'score_card', content: 'existing', timestamp: 1,
      metadata: { source: 'debate', debateSessionId: 'session' },
    }]);
    const saveMessage = vi.spyOn(DB, 'saveMessage');
    const updateMessage = vi.spyOn(DB, 'updateMessageContentAndMetadata').mockResolvedValue();
    const result = await persistDebateShare({
      char: { id: 'char', name: '角色', memories: [], memoryPalaceEnabled: false } as any,
      session: { id: 'session', mode: 'solo', topic: '辩题', proPosition: '正', conPosition: '反', status: 'completed', stage: 'complete', solo: { charId: 'char', userSide: 'pro', turnIndex: 5 }, speeches: [], createdAt: 1, updatedAt: 1 } as any,
      summary: '总结', scoreCard: { type: 'debate_card' }, userProfile: { name: '我' } as any,
      groups: [], realtimeConfig: {} as any, apiConfig: {} as any, memoryPalaceConfig: {} as any,
    });
    expect(result.messageId).toBe(42);
    expect(saveMessage).not.toHaveBeenCalled();
    expect(updateMessage).toHaveBeenCalledWith(42, '总结', expect.any(Function));
  });
  it('repairs a legacy card identified by debateSessionId without sending another card', async () => {
    vi.spyOn(DB, 'getMessagesByCharId').mockResolvedValue([{
      id: 43, charId: 'char', role: 'assistant', type: 'score_card', content: '我们赢了', timestamp: 1,
      metadata: { debateSessionId: 'session', scoreCard: { type: 'debate_card' } },
    }]);
    const saveMessage = vi.spyOn(DB, 'saveMessage');
    const updateMessage = vi.spyOn(DB, 'updateMessageContentAndMetadata').mockResolvedValue();
    const result = await persistDebateShare({
      char: { id: 'char', name: '角色', memories: [], memoryPalaceEnabled: false } as any,
      session: { id: 'session', mode: 'team', topic: '辩题', proPosition: '正', conPosition: '反', status: 'completed', stage: 'complete', speeches: [], createdAt: 1, updatedAt: 1 } as any,
      summary: '八位角色参赛，用户观赛', scoreCard: { type: 'debate_card', mode: 'team' }, userProfile: { name: '我' } as any,
      groups: [], realtimeConfig: {} as any, apiConfig: {} as any, memoryPalaceConfig: {} as any,
    });
    expect(result.messageId).toBe(43);
    expect(saveMessage).not.toHaveBeenCalled();
    expect(updateMessage).toHaveBeenCalledTimes(1);
    expect(result.memories.filter(memory => memory.id === 'mem-debate-session-char')).toHaveLength(1);
  });
});
