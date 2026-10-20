import { describe, expect, it } from 'vitest';
import { parseLiarsBarAction } from './parser';

const legal = { canChallenge: true, playableCardIds: ['c1', 'c2'], minCards: 1 as const, maxCards: 3 as const };

describe('liars bar AI action parser', () => {
  it('accepts only structured legal actions', () => {
    expect(parseLiarsBarAction('{"action":"play","cardIds":["c1"],"utterance":"一张K。"}', legal)).toEqual({ action: 'play', cardIds: ['c1'], utterance: '一张K。' });
    expect(parseLiarsBarAction('{"action":"challenge","utterance":"开。"}', legal)).toEqual({ action: 'challenge', utterance: '开。' });
  });

  it('rejects malformed JSON, foreign cards, duplicates, and illegal challenge', () => {
    expect(() => parseLiarsBarAction('我出一张', legal)).toThrow('JSON');
    expect(() => parseLiarsBarAction('{"action":"play","cardIds":["foreign"]}', legal)).toThrow('不属于自己');
    expect(() => parseLiarsBarAction('{"action":"play","cardIds":["c1","c1"]}', legal)).toThrow('重复');
    expect(() => parseLiarsBarAction('{"action":"challenge"}', { ...legal, canChallenge: false })).toThrow('不允许');
    expect(() => parseLiarsBarAction('说明：{"action":"challenge"}', legal)).toThrow('JSON');
    expect(() => parseLiarsBarAction('{"action":"play","cardIds":[1]}', legal)).toThrow('字符串数组');
    expect(() => parseLiarsBarAction('{"action":"challenge","utterance":{}}', legal)).toThrow('文字');
  });
});
