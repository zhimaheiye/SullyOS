import { describe, expect, it } from 'vitest';
import type { Message } from '../types';
import { normalizeMessageContent } from './messageFormat';

describe('辩论赛结果卡上下文化', () => {
  it('把公开辩论结果转成角色可回忆的共同经历', () => {
    const message: Message = {
      id: 1,
      charId: 'char-1',
      role: 'assistant',
      type: 'score_card',
      content: '赛后摘要',
      timestamp: 1,
      metadata: { scoreCard: {
        type: 'debate_card', mode: 'team', topic: '亲密关系是否应该共享手机密码',
        proPosition: '应该共享', conPosition: '不应该共享', proScore: 315, conScore: 328,
        winner: 'con', summary: '反方对隐私边界的定义更稳定。',
        proTeam: ['甲', '乙', '丙', '丁'].map((name, i) => ({ id: `p${i}`, name })),
        conTeam: ['戊', '己', '庚', '辛'].map((name, i) => ({ id: `c${i}`, name })),
        participantSide: 'con', participantRole: 2,
      } },
    };

    const context = normalizeMessageContent(message, '阿澈', '我');
    expect(context).toContain('八人正式辩论');
    expect(context).toContain('反方获胜');
    expect(context).toContain('正方四名：1辩甲、2辩乙、3辩丙、4辩丁');
    expect(context).toContain('反方四名：1辩戊、2辩己、3辩庚、4辩辛');
    expect(context).toContain('没有发言，也不属于正方或反方');
    expect(context).toContain('阿澈担任反方2辩');
    expect(context).toContain('共同经历');
    expect(context).toContain('不得捏造');
  });
});
