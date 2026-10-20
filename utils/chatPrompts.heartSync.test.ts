import { describe, expect, it } from 'vitest';
import { ChatPrompts } from './chatPrompts';

const char = { id: 'char-1', name: '林某' } as any;
const user = { name: '我' } as any;

const eventMessage = (mode: 'psych' | 'questionnaire', contextText: string, displayPayload: any) => [{
  id: 1, charId: char.id, role: 'assistant', type: 'score_card', content: '卡片', timestamp: Date.now(),
  metadata: { scoreCard: { type: 'heart_sync_event_card', mode, title: '测试', contextText, displayPayload } },
}] as any[];

describe('HeartSync event 的主聊天 API 上下文', () => {
  it('心理测试把完整 discussion contextText 交给 Chat API', () => {
    const contextText = '[心心相印·心理测试]\n双方答案\n第 12 轮完整讨论原文';
    const { apiMessages } = ChatPrompts.buildMessageHistory(eventMessage('psych', contextText, {}), 10, char, user, []);
    expect(apiMessages[0].content).toContain(contextText);
  });

  it('问卷只交付 compact contextText，不交付 displayPayload 全文', () => {
    const contextText = '[心心相印·问卷填写]\n结果：82 分\n冻结选择：1B, 2A';
    const displayPayload = { questionnaire: { questions: ['FULL_QUESTION_TEXT'], scoringRules: 'SECRET_SCORING_RULES' } };
    const { apiMessages } = ChatPrompts.buildMessageHistory(eventMessage('questionnaire', contextText, displayPayload), 10, char, user, []);
    expect(apiMessages[0].content).toContain(contextText);
    expect(apiMessages[0].content).not.toContain('FULL_QUESTION_TEXT');
    expect(apiMessages[0].content).not.toContain('SECRET_SCORING_RULES');
  });
});
