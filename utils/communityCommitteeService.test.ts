import { afterEach, describe, expect, it, vi } from 'vitest';
import { DB } from './db';
import { persistCommunityCommitteeShare } from './communityCommitteeService';

vi.mock('./amsgStateSync', () => ({ markAmsgStateDirty: vi.fn() }));

describe('community committee share idempotency', () => {
  afterEach(() => vi.restoreAllMocks());

  it('复用已存在的聊天卡，覆盖 marker 尚未保存的中断窗口', async () => {
    vi.spyOn(DB, 'getMessagesByCharId').mockResolvedValue([{
      id: 73,
      charId: 'char',
      role: 'assistant',
      type: 'score_card',
      content: 'existing',
      timestamp: 1,
      metadata: { source: 'community_committee', communityCommitteeSessionId: 'session' },
    }]);
    const saveMessage = vi.spyOn(DB, 'saveMessage');
    const result = await persistCommunityCommitteeShare({
      char: { id: 'char', name: '角色', memories: [], memoryPalaceEnabled: false } as any,
      session: {
        id: 'session', topic: '现实两难', sideA: '一边有道理', sideB: '另一边也有道理',
        charIds: ['char'], stage: 'summary', turns: [], report: '总结', reportGeneratedAt: 1,
        createdAt: 1, updatedAt: 1,
      },
      participantNames: ['角色'],
      userProfile: { name: '我' } as any,
      groups: [], realtimeConfig: {} as any, apiConfig: {} as any, memoryPalaceConfig: {} as any,
    });
    expect(result.messageId).toBe(73);
    expect(saveMessage).not.toHaveBeenCalled();
    expect(result.memories).toHaveLength(1);
  });
});
