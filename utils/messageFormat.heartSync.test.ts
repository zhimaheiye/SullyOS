import { describe, expect, it } from 'vitest';
import type { Message } from '../types';
import { normalizeMessageContent } from './messageFormat';

describe('心心相印聊天卡上下文化', () => {
  it('已删除的伴侣测试卡不再把分数和短笺交给上下文', () => {
    const message: Message = {
      id: 1,
      charId: 'char-1',
      role: 'assistant',
      type: 'score_card',
      content: '可见摘要',
      timestamp: 1,
      metadata: {
        scoreCard: {
          type: 'companion_test_card',
          totalCompatibility: 86,
          strongestLabel: '地点偏好',
          growthLabel: '幻想边界',
          characterLetter: '我们可以继续坦诚地聊，也认真尊重彼此的边界。',
        },
      },
    };

    const context = normalizeMessageContent(message, '阿澈', '我');
    expect(context).toBe('[系统卡片]');
    expect(context).not.toContain('86');
    expect(context).not.toContain('地点偏好');
    expect(context).not.toContain('我们可以继续坦诚');
  });

  it('心理测试卡把完整讨论原文交给后续上下文', () => {
    const contextText = '[心心相印·心理测试]\n题目：分歧时怎么办\nTA：先冷静\n我：马上聊\n后续讨论：完整原文';
    const message = {
      id: 2, charId: 'char-1', role: 'assistant' as const, type: 'score_card' as const,
      content: '可见卡片', timestamp: 2,
      metadata: { scoreCard: { type: 'heart_sync_event_card', mode: 'psych', title: '分歧时怎么办', contextText } },
    };
    expect(normalizeMessageContent(message, '阿澈', '我')).toBe(contextText);
  });

  it('问卷卡只把 compact contextText 交给模型，不泄漏展示全文和评分规则', () => {
    const contextText = '[心心相印·问卷填写]\n阿澈完成了《关系问卷》。\n结果：82 分。\n冻结选择：1B, 2A';
    const message = {
      id: 3, charId: 'char-1', role: 'assistant' as const, type: 'score_card' as const,
      content: '可见卡片', timestamp: 3,
      metadata: { scoreCard: {
        type: 'heart_sync_event_card', mode: 'questionnaire', title: '关系问卷', contextText,
        displayPayload: { questionnaire: { questions: ['FULL_QUESTION_TEXT'], scoringRules: 'SECRET_SCORING_RULES' } },
      } },
    };
    const context = normalizeMessageContent(message, '阿澈', '我');
    expect(context).toBe(contextText);
    expect(context).not.toContain('FULL_QUESTION_TEXT');
    expect(context).not.toContain('SECRET_SCORING_RULES');
  });
});
