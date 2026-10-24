import { describe, expect, it } from 'vitest';
import { normalizeMessageContent } from './messageFormat';

describe('board game score card context', () => {
  it('exposes the shared result while preserving hidden-information boundaries', () => {
    const text = normalizeMessageContent({
      id: 1, charId: 'a', role: 'assistant', type: 'score_card', content: '', timestamp: 1,
      metadata: { scoreCard: {
        type: 'board_game_liars_bar_card', participants: ['我', 'A', 'B', 'C'], winnerName: 'B',
        participantStats: { plays: 3, challenges: 2, successfulChallenges: 1, shots: 1 }, summary: '共同经历。',
      } },
    } as any, 'A', '我');
    expect(text).toContain('[桌游·骗子酒馆]');
    expect(text).toContain('B获胜');
    expect(text).toContain('不得声称看见任何未翻开的他人暗牌或真实子弹位置');
  });
});
