import { describe, expect, it } from 'vitest';
import type { MyScheduleEntry } from '../types';
import {
  anchorPreviousMyScheduleSpan, createMyScheduleArchive, createMyScheduleEntry, editMyScheduleEntry,
  findPreviousMyScheduleEnd, formatMyScheduleDuration, formatMyScheduleTimeRange, myScheduleCardMinHeight,
  myScheduleCurrentEntries, myScheduleEntryState, myScheduleGapPx, myScheduleTagTotals,
  parseMyScheduleCommand, parseMyScheduleCommands, resolveMyScheduleCommand,
} from './mySchedule';

describe('my schedule timeline rules', () => {
  const now = new Date('2026-08-13T12:00:00+08:00').getTime();

  it('resolves an explicit completed duration backwards from now', () => {
    const command = resolveMyScheduleCommand(parseMyScheduleCommand(JSON.stringify({
      action: 'create_completed', title: '读书', durationMinutes: 15, endAt: now, tag: 'study',
    })), [], now);
    expect(command.endAt).toBe(now);
    expect(command.startAt).toBe(now - 15 * 60_000);
    expect(command.estimatedTime).toBe(false);
    expect(command.tag).toBe('study');
  });

  it('keeps future plans open without inventing an end time', () => {
    const startAt = now + 30 * 60_000;
    const command = resolveMyScheduleCommand({ action: 'create_open', title: '去散步', startAt }, [], now);
    expect(command.startAt).toBe(startAt);
    expect(command.endAt).toBeUndefined();
  });

  it('finishes the latest open entry and never changes the note text', () => {
    const open = { id: 'open', title: '学习', startAt: now - 60_000, note: '有一点紧张。', tag: 'study' } as MyScheduleEntry;
    const command = resolveMyScheduleCommand({ action: 'finish_open' }, [open], now);
    expect(command.targetEntryId).toBe('open');
    expect(command.endAt).toBe(now);
    expect(command.tag).toBe('study');
    const entry = createMyScheduleEntry({
      command: { action: 'create_open', title: '学习', startAt: now, estimatedTime: false },
      sourceText: '我要开始学习', note: '  这两个空格也留下。', recipientCharIds: ['a'], now,
    });
    expect(entry.note).toBe('  这两个空格也留下。');
    expect(myScheduleEntryState(entry, now)).toBe('active');
  });

  it('marks duration fallback as estimated for completed events without a start', () => {
    const command = resolveMyScheduleCommand({ action: 'create_completed', title: '吃饭', durationMinutes: 12, estimatedTime: true }, [], now);
    expect(command.startAt).toBe(now - 12 * 60_000);
    expect(command.estimatedTime).toBe(true);
  });

  it('keeps every independently timed event from one sentence', () => {
    const commands = parseMyScheduleCommands(JSON.stringify({ actions: [
      { action: 'create_completed', title: '吃饭', durationMinutes: 12, endAt: now, estimatedTime: true },
      { action: 'create_open', title: '坐车去拿中药', startAt: now, estimatedTime: true },
    ] }));
    const resolved = commands.map(command => resolveMyScheduleCommand(command, [], now));
    expect(resolved).toHaveLength(2);
    expect(resolved.map(command => command.title)).toEqual(['吃饭', '坐车去拿中药']);
    expect(resolved[0].endAt).toBe(now);
    expect(resolved[1].endAt).toBeUndefined();
    expect(parseMyScheduleCommands(JSON.stringify({ action: 'create_open', title: '散步' }))).toHaveLength(1);
  });

  it('anchors 从刚才到现在 to the previous completed timeline end', () => {
    const previousEndAt = now - 95 * 60_000;
    const entries = [
      { id: 'older', startAt: now - 4 * 60 * 60_000, endAt: now - 3 * 60 * 60_000 },
      { id: 'previous', startAt: now - 2 * 60 * 60_000, endAt: previousEndAt },
      { id: 'open', startAt: now - 30 * 60_000 },
    ] as MyScheduleEntry[];
    const anchored = anchorPreviousMyScheduleSpan(
      [{ action: 'create_completed', title: '自由活动', durationMinutes: 30, estimatedTime: true }],
      '从刚才到现在一直在自由活动',
      findPreviousMyScheduleEnd(entries, now),
      now,
    );
    const resolved = resolveMyScheduleCommand(anchored[0], [], now);
    expect(resolved.startAt).toBe(previousEndAt);
    expect(resolved.endAt).toBe(now);
    expect(resolved.estimatedTime).toBe(false);
  });

  it('does not replace an explicit 刚才 duration with the previous timeline end', () => {
    const commands = [{ action: 'create_completed', title: '读书', durationMinutes: 15 }] as const;
    expect(anchorPreviousMyScheduleSpan([...commands], '刚才看了15分钟书', now - 60 * 60_000, now)).toEqual(commands);
  });

  it('uses duration and idle time as layout variables without negative overlap gaps', () => {
    const short = { startAt: now, endAt: now + 15 * 60_000 } as MyScheduleEntry;
    const long = { startAt: now, endAt: now + 60 * 60_000 } as MyScheduleEntry;
    expect(myScheduleCardMinHeight(long)).toBeGreaterThan(myScheduleCardMinHeight(short));
    expect(myScheduleGapPx(short.endAt, now + 45 * 60_000)).toBe(90);
    expect(myScheduleGapPx(long.endAt, now + 30 * 60_000)).toBe(0);
    expect(myScheduleGapPx(now, now + 24 * 60 * 60_000)).toBe(0);
  });

  it('validates structured edits and preserves note text', () => {
    const entry = { id: 'edit', title: '原标题', startAt: now, note: '旧随笔', updatedAt: now } as MyScheduleEntry;
    const updated = editMyScheduleEntry(entry, {
      title: '新标题', note: '  补充内容。', startAt: now - 60 * 60_000,
      endAt: now, estimatedTime: false, tag: 'entertainment', now: now + 1,
    });
    expect(updated.title).toBe('新标题');
    expect(updated.note).toBe('  补充内容。');
    expect(updated.startAt).toBe(now - 60 * 60_000);
    expect(updated.tag).toBe('entertainment');
    expect(() => editMyScheduleEntry(entry, { title: '', note: '', startAt: now, endAt: now, estimatedTime: false })).toThrow();
  });

  it('validates manually supplied fields before creating a timeline card', () => {
    const manual = createMyScheduleEntry({
      command: { action: 'create_completed', title: '手动记录', startAt: now - 30 * 60_000, endAt: now, estimatedTime: false, tag: 'sleep' },
      sourceText: '手动添加', note: '  原样保留。', recipientCharIds: ['a'], now,
    });
    expect(manual.sourceText).toBe('手动添加');
    expect(manual.note).toBe('  原样保留。');
    expect(manual.tag).toBe('sleep');
    expect(() => createMyScheduleEntry({
      command: { action: 'create_completed', title: '错误时间', startAt: now, endAt: now, estimatedTime: false },
      sourceText: '手动添加', note: '', recipientCharIds: [], now,
    })).toThrow('结束时间必须晚于开始时间');
  });

  it('shows exact duration and totals tagged time up to the current cutoff', () => {
    const completed = {
      id: 'study', startAt: now - 65 * 60_000, endAt: now, tag: 'study',
    } as MyScheduleEntry;
    const resting = {
      id: 'rest', startAt: now - 20 * 60_000, tag: 'rest',
    } as MyScheduleEntry;
    const futureSleep = {
      id: 'sleep', startAt: now + 10 * 60_000, tag: 'sleep',
    } as MyScheduleEntry;
    expect(formatMyScheduleTimeRange(completed)).toContain('1h 5min');
    expect(formatMyScheduleDuration(35)).toBe('35min');
    expect(myScheduleTagTotals([completed, resting, futureSleep], now)).toEqual({
      study: 65, entertainment: 0, rest: 20, sleep: 0,
    });
  });

  it('archives the current batch without using midnight as a boundary', () => {
    const yesterday = { id: 'yesterday', startAt: now - 12 * 60 * 60_000 } as MyScheduleEntry;
    const today = { id: 'today', startAt: now - 60 * 60_000 } as MyScheduleEntry;
    const archive = createMyScheduleArchive([yesterday, today], now);
    expect(archive.entryIds).toEqual(['yesterday', 'today']);
    expect(archive.startedAt).toBe(yesterday.startAt);
    expect(archive.archivedAt).toBe(now);
    expect(myScheduleCurrentEntries([yesterday, today], [archive])).toEqual([]);
  });
});
