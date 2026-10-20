import { describe, expect, it } from 'vitest';
import type { Message } from '../types';
import { normalizeMessageContent } from './messageFormat';

describe('normalizeMessageContent · my schedule card', () => {
  it('keeps the user note verbatim in later chat context', () => {
    const note = '我今天有点累，但看完之后很踏实。';
    const message = {
      id: 1, charId: 'a', role: 'user', type: 'score_card', content: '', timestamp: 1,
      metadata: { scoreCard: { type: 'my_schedule_card', title: '读书', startAt: 1_786_578_000_000, endAt: 1_786_578_900_000, tag: 'study', note } },
    } as Message;
    const text = normalizeMessageContent(message, '左慈', '芝麻');
    expect(text).toContain('[我的日程]');
    expect(text).toContain('读书');
    expect(text).toContain('【学习】');
    expect(text).toContain(note);
    expect(text).toContain('不得擅自改写用户随笔');
  });
});
