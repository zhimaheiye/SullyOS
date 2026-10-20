import { describe, expect, it } from 'vitest';
import {
  buildLifeReplayTranscript, createLifeReplayPreset, createLifeReplaySession,
  parseLifeReplayBlueprint, parseLifeReplayCharacterBeat, parseLifeReplayWorldBeat,
} from './lifeReplay';

describe('lifeReplay', () => {
  it('normalizes an editable blueprint and gives NPCs stable ids', () => {
    const result = parseLifeReplayBlueprint(JSON.stringify({
      title: '教室里的那天', chronology: ['争执发生', '我离开'],
      pastSelf: { label: '初中时的我', emotionalState: '害怕又委屈' },
      npcs: [{ name: '班主任', role: '老师' }],
    }));
    expect(result.title).toBe('教室里的那天');
    expect(result.pastSelf.label).toBe('初中时的我');
    expect(result.npcs[0].id).toBeTruthy();
    expect(result.npcs[0].knowledge).toContain('当时');
  });

  it('keeps present user, character and past self separate in transcripts', () => {
    const preset = createLifeReplayPreset('原文', parseLifeReplayBlueprint('{"title":"旧事","pastSelf":{"label":"过去的我"}}'));
    const session = createLifeReplaySession(preset, 'char-1');
    const transcript = buildLifeReplayTranscript([{
      id: 'turn-1', kind: 'interaction', userAction: '我走到过去的我身边', createdAt: 1,
      character: { perception: '认出了两个不同年龄的她', action: '站在她身后', speech: '我在这里。' },
      world: { narrative: '教室安静下来', pastSelfReaction: '抬头看向来人', pastSelfSpeech: '你是谁？', npcBeats: [], directionChange: '', sceneState: '', suggestedActions: [] },
    }], '周瑜', '现在的我');
    expect(session.blueprint).not.toBe(preset.blueprint);
    expect(transcript).toContain('现在的我：我走到过去的我身边');
    expect(transcript).toContain('周瑜说：我在这里。');
    expect(transcript).toContain('过去的我说：你是谁？');
  });

  it('rejects unusable model beats', () => {
    expect(() => parseLifeReplayCharacterBeat('{"perception":"只是想了想"}')).toThrow();
    expect(() => parseLifeReplayWorldBeat('{}')).toThrow();
  });
});
