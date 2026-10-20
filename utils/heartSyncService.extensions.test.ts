import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { HeartSyncPsychQuestion, HeartSyncQuestionnaire, HeartSyncQuestionnaireSession } from '../types';

const mocks = vi.hoisted(() => ({
  safeFetchJson: vi.fn(),
  saveMessage: vi.fn(),
}));

vi.mock('./chatRequestPayload', () => ({
  buildChatRequestPayload: vi.fn(async () => ({
    systemPrompt: 'BASE_SYSTEM', cleanedApiMessages: [], flags: { thinkingActive: false },
  })),
}));
vi.mock('./db', () => ({ DB: {
  getMessagesByCharId: vi.fn(async () => []), getEmojis: vi.fn(async () => []), getEmojiCategories: vi.fn(async () => []),
  saveMessage: mocks.saveMessage,
} }));
vi.mock('./safeApi', () => ({
  safeFetchJson: mocks.safeFetchJson,
  extractContent: (data: any) => data.choices?.[0]?.message?.content || '',
}));
vi.mock('./thinkingGate', () => ({ shouldSendThinkingParams: () => false }));

import {
  persistHeartSyncEvent,
  requestPsychInitialAnswer,
  requestQuestionnaireAnswers,
  requestQuestionnaireEvaluation,
} from './heartSyncService';

const base = {
  char: { id: 'char', name: '林某', contextLimit: 10 } as any,
  userProfile: { name: '我' } as any,
  groups: [], apiConfig: { baseUrl: 'https://api.example.com', model: 'model' } as any, realtimeConfig: {} as any,
};
const psych: HeartSyncPsychQuestion = {
  id: 'p', kind: 'psych_question', questionType: 'choice', text: '选什么',
  options: [{ key: 'A', label: '甲', interpretation: 'SECRET_INTERPRETATION' }, { key: 'B', label: '乙', interpretation: '' }],
  defaultAnswer: { optionKey: 'A', text: 'SECRET_DEFAULT' }, createdAt: 1, updatedAt: 1,
};
const questionnaire: HeartSyncQuestionnaire = {
  id: 'q', kind: 'questionnaire', formatVersion: 1, title: '问卷',
  questions: [{ id: 'q1', text: '题一', options: [{ key: 'A', label: '甲' }, { key: 'B', label: '乙' }] }],
  scoringRules: 'SECRET_RULES', resultGuide: 'SECRET_GUIDE', createdAt: 1, updatedAt: 1,
};
const session: HeartSyncQuestionnaireSession = {
  id: 's', kind: 'questionnaire_session', questionnaireId: questionnaire.id, questionnaireSnapshot: questionnaire,
  charId: 'char', phase: 'answering', answers: [], answerRound: 0, createdAt: 1, updatedAt: 1,
};

describe('HeartSync 模型请求的数据隔离', () => {
  beforeEach(() => {
    mocks.safeFetchJson.mockReset().mockResolvedValue({ choices: [{ message: { content: '{"answers":[]}' } }] });
    mocks.saveMessage.mockReset().mockResolvedValue(42);
  });

  it('心理盲答 HTTP payload 不含默认答案和参考解释', async () => {
    await requestPsychInitialAnswer({ ...base, question: psych });
    const body = JSON.parse(mocks.safeFetchJson.mock.calls[0][1].body);
    expect(JSON.stringify(body)).not.toContain('SECRET_DEFAULT');
    expect(JSON.stringify(body)).not.toContain('SECRET_INTERPRETATION');
  });

  it('问卷答题 HTTP payload 不含 scoringRules/resultGuide，结算 payload 才包含', async () => {
    await requestQuestionnaireAnswers({ ...base, session });
    const blindBody = JSON.stringify(JSON.parse(mocks.safeFetchJson.mock.calls[0][1].body));
    expect(blindBody).not.toContain('SECRET_RULES');
    expect(blindBody).not.toContain('SECRET_GUIDE');

    await requestQuestionnaireEvaluation({ ...base, session: { ...session, phase: 'evaluating', answers: [{ questionId: 'q1', optionKey: 'A' }] } });
    const evaluationBody = JSON.stringify(JSON.parse(mocks.safeFetchJson.mock.calls[1][1].body));
    expect(evaluationBody).toContain('SECRET_RULES');
    expect(evaluationBody).toContain('SECRET_GUIDE');
  });

  it('新事件只写聊天卡，不创建长期记忆', async () => {
    const card = { type: 'heart_sync_event_card' as const, mode: 'psych' as const, sessionId: 's', title: '题目', charName: '林某', displayPayload: {}, contextText: '完整上下文' };
    expect(await persistHeartSyncEvent('char', card)).toBe(42);
    expect(mocks.saveMessage).toHaveBeenCalledWith(expect.objectContaining({
      charId: 'char', type: 'score_card', content: '完整上下文',
      metadata: expect.objectContaining({ heartSyncEvent: card }),
    }));
  });
});
