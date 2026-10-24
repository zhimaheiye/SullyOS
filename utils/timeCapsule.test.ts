import { describe, expect, it } from 'vitest';
import type { TimeCapsuleSettings } from '../types';
import {
  createUserTimeCapsule, hasPendingAutoTimeCapsule, isTimeCapsuleVisitDue, maxTimeCapsuleUnlockAt,
  nextTimeCapsuleVisitor, parseCharacterTimeCapsule, validateTimeCapsuleUnlockAt,
} from './timeCapsule';

describe('time capsule rules', () => {
  const now = new Date('2026-08-13T12:00:00+08:00').getTime();

  it('accepts a future time within one year and rejects both boundaries', () => {
    expect(validateTimeCapsuleUnlockAt(now + 60_000, now)).toBeNull();
    expect(validateTimeCapsuleUnlockAt(now, now)).toContain('晚于现在');
    expect(validateTimeCapsuleUnlockAt(maxTimeCapsuleUnlockAt(now) + 1, now)).toContain('不能超过一年');
    expect(createUserTimeCapsule({ title: '未来', content: '别忘了此刻。', unlockAt: now + 60_000, now }).source).toBe('user');
  });

  it('parses fenced character output and clamps the requested delay to one year', () => {
    const capsule = parseCharacterTimeCapsule(
      '```json\n{"title":"先别偷看","content":"等你看到这里时，希望已经轻松一点。","unlockInDays":900}\n```',
      { id: 'char-a', name: '左慈', avatar: 'avatar.png' }, 'invited', now,
    );
    expect(capsule.title).toBe('先别偷看');
    expect(capsule.content).toContain('轻松一点');
    expect(capsule.unlockAt).toBeLessThanOrEqual(maxTimeCapsuleUnlockAt(now));
  });

  it('rotates past characters who already have a pending automatic capsule', () => {
    const settings: TimeCapsuleSettings = { id: 'settings', kind: 'settings', enabled: true, visitorCharIds: ['a', 'b'], intervalMinutes: 60, nextVisitorIndex: 0 };
    expect(nextTimeCapsuleVisitor(settings, ['a'])).toEqual({ charId: 'b', nextIndex: 0 });
    const pending = [{ id: '1', kind: 'capsule', title: 'x', content: 'x', source: 'auto', charId: 'a', createdAt: now, unlockAt: now + 1 }] as any;
    expect(hasPendingAutoTimeCapsule(pending, 'a')).toBe(true);
    expect(isTimeCapsuleVisitDue({ ...settings, lastVisitAt: now - 61 * 60_000 }, now)).toBe(true);
  });
});
