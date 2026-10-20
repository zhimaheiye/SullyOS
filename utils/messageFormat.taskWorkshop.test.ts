import { describe, expect, it } from 'vitest';
import type { Message } from '../types';
import { normalizeMessageContent } from './messageFormat';

describe('normalizeMessageContent · task workshop card', () => {
  it('keeps the advice readable and does not imply tool execution', () => {
    const message = {
      id: 1, charId: 'a', role: 'assistant', type: 'score_card', content: '', timestamp: 1,
      metadata: { scoreCard: { type: 'task_workshop_card', title: '写计划', summary: '先收窄范围', suggestedSteps: ['列出边界'], nextAction: '写三行目标' } },
    } as Message;
    const text = normalizeMessageContent(message, '阿澈', '我');
    expect(text).toContain('写计划');
    expect(text).toContain('列出边界');
    expect(text).toContain('写三行目标');
    expect(text).toContain('不得声称尚未实际执行');
  });
});
