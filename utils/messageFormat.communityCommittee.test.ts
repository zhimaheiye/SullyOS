import { describe, expect, it } from 'vitest';
import { normalizeMessageContent } from './messageFormat';

describe('community committee score card context', () => {
  it('把确认写回的总结转成共同经历，同时声明逐字倾诉仍不可见', () => {
    const text = normalizeMessageContent({
      id: 1,
      charId: 'a',
      role: 'assistant',
      type: 'score_card',
      content: '',
      timestamp: 1,
      metadata: {
        scoreCard: {
          type: 'community_committee_card',
          topic: '两边都有道理的家庭矛盾',
          sideA: '理解家人的现实压力',
          sideB: '也需要保护自己的边界',
          report: '真正痛苦的是一直替所有人承担。',
          participantNames: ['甲', '乙'],
        },
      },
    } as any, '甲', '我');
    expect(text).toContain('[居委会·议事总结]');
    expect(text).toContain('真正痛苦的是一直替所有人承担');
    expect(text).toContain('完整逐字倾诉仍只在居委会本机记录中');
  });
});
