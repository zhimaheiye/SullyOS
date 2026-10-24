import { describe, expect, it } from 'vitest';
import type { CommunityCommitteeSession } from '../types';
import {
  buildCommunityCommitteeTranscript,
  createCommunityCommitteeSession,
  getCommunityCommitteeLayer,
  getCommunityCommitteeRound,
  getPendingCommitteeCharIds,
  makeCommunityCommitteeTurn,
  normalizeCommunityCommitteeOpeningAnalysis,
  splitCommunityCommitteeOpening,
} from './communityCommittee';

const baseSession = (): CommunityCommitteeSession => createCommunityCommitteeSession({
  topic: '家人希望我答应一件事，但我也需要保护自己',
  sideA: '他们有现实压力，我能理解他们为什么着急',
  sideB: '答应会越过我的边界，让我长期承担后果',
  charIds: ['a', 'b', 'c', 'c'],
  now: 100,
});
describe('communityCommittee', () => {
  it('创建会话时清理字段并限制为一到三位不重复角色', () => {
    const session = baseSession();
    expect(session.charIds).toEqual(['a', 'b', 'c']);
    expect(session.stage).toBe('peeling');
    expect(session.updatedAt).toBe(100);
  });

  it('保留一口气写下的原文、段落标色，并直接把原文作为第一轮', () => {
    const openingText = '我能理解他们为什么这样做。\n\n可如果我答应，最后承担后果的还是我。\n这两件事会反复压过彼此。';
    expect(splitCommunityCommitteeOpening(openingText)).toEqual([
      '我能理解他们为什么这样做。',
      '可如果我答应，最后承担后果的还是我。',
      '这两件事会反复压过彼此。',
    ]);
    const analysis = normalizeCommunityCommitteeOpeningAnalysis(openingText, {
      topic: '理解与承担互相拉扯',
      sideA: '理解对方的现实处境，让拒绝显得很难。',
      sideB: '后果会落在自己身上，因此需要保护边界。',
      segmentSides: ['a', 'b', 'both'],
    });
    const session = createCommunityCommitteeSession({
      ...analysis,
      openingSegments: analysis.segments,
      speakerName: '我',
      charIds: ['a', 'b'],
      now: 100,
    });
    expect(session.openingSegments?.map(segment => segment.side)).toEqual(['a', 'b', 'both']);
    expect(session.turns).toHaveLength(1);
    expect(session.turns[0]).toMatchObject({ speakerType: 'user', speakerName: '我', content: analysis.openingText });
    expect(getPendingCommitteeCharIds(session)).toEqual(['a', 'b']);
    expect(getCommunityCommitteeLayer(session.turns).label).toBe('听见两股力量');
  });

  it('一轮中只返回尚未回应的角色，支持部分失败后续传', () => {
    const session = baseSession();
    session.turns = [
      makeCommunityCommitteeTurn({ speakerType: 'user', speakerName: '我', content: '我知道他们也难，但我还是很委屈。', createdAt: 101 }),
      makeCommunityCommitteeTurn({ speakerType: 'character', charId: 'a', speakerName: '甲', content: '你能理解他们，不代表委屈就会消失。', createdAt: 102 }),
    ];
    expect(getPendingCommitteeCharIds(session)).toEqual(['b', 'c']);
    session.turns.push(makeCommunityCommitteeTurn({ speakerType: 'character', charId: 'b', speakerName: '乙', content: '先不用替任何一边判决。', createdAt: 103 }));
    expect(getPendingCommitteeCharIds(session)).toEqual(['c']);
  });

  it('新一轮重新等待全部参与角色', () => {
    const session = baseSession();
    session.turns = [
      makeCommunityCommitteeTurn({ speakerType: 'user', speakerName: '我', content: '第一层', createdAt: 101 }),
      makeCommunityCommitteeTurn({ speakerType: 'character', charId: 'a', speakerName: '甲', content: '回应', createdAt: 102 }),
      makeCommunityCommitteeTurn({ speakerType: 'character', charId: 'b', speakerName: '乙', content: '回应', createdAt: 103 }),
      makeCommunityCommitteeTurn({ speakerType: 'character', charId: 'c', speakerName: '丙', content: '回应', createdAt: 104 }),
      makeCommunityCommitteeTurn({ speakerType: 'user', speakerName: '我', content: '第二层', createdAt: 105 }),
    ];
    expect(getPendingCommitteeCharIds(session)).toEqual(['a', 'b', 'c']);
    expect(getCommunityCommitteeRound(session.turns)).toBe(2);
    expect(getCommunityCommitteeLayer(session.turns).label).toBe('看看痛落在哪里');
  });

  it('转录保留实际顺序与说话人', () => {
    const session = baseSession();
    session.turns = [
      makeCommunityCommitteeTurn({ speakerType: 'user', speakerName: '我', content: '很矛盾', createdAt: 101 }),
      makeCommunityCommitteeTurn({ speakerType: 'character', charId: 'a', speakerName: '甲', content: '我听见了', createdAt: 102 }),
    ];
    expect(buildCommunityCommitteeTranscript(session.turns)).toBe('1. 我：很矛盾\n\n2. 甲：我听见了');
  });
});
