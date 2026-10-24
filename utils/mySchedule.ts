import type { MyScheduleArchive, MyScheduleEntry, MyScheduleTag } from '../types';
import { extractJson } from './safeApi';

export type MyScheduleCommandAction = 'create_completed' | 'create_open' | 'finish_open';

export interface MyScheduleCommand {
  action: MyScheduleCommandAction;
  title?: string;
  startAt?: number | string;
  endAt?: number | string;
  durationMinutes?: number;
  targetEntryId?: string;
  estimatedTime?: boolean;
  tag?: MyScheduleTag;
}

export interface ResolvedMyScheduleCommand {
  action: MyScheduleCommandAction;
  title: string;
  startAt: number;
  endAt?: number;
  targetEntryId?: string;
  estimatedTime: boolean;
  tag?: MyScheduleTag;
}

export const MY_SCHEDULE_PX_PER_MINUTE = 3;
export const MY_SCHEDULE_MIN_CARD_HEIGHT = 132;

/** 参考用户提供的课程表：清透、偏冷的粉彩底色配更明确的同色相强调色。 */
export const MY_SCHEDULE_COLOR_PALETTE = {
  sky: { surface: '#DDEBFA', accent: '#6E9FD8', ink: '#264E78' },
  rose: { surface: '#F9DFE8', accent: '#E3789B', ink: '#713247' },
  lavender: { surface: '#E9E4F7', accent: '#A18FD3', ink: '#4D416F' },
  mint: { surface: '#DDF3ED', accent: '#64C5B0', ink: '#285F55' },
  amber: { surface: '#F8E8CA', accent: '#DBA653', ink: '#6F4D24' },
} as const;

export const MY_SCHEDULE_TAG_META: Record<MyScheduleTag, {
  label: string;
  surface: string;
  accent: string;
  ink: string;
}> = {
  study: { label: '学习', ...MY_SCHEDULE_COLOR_PALETTE.sky },
  entertainment: { label: '娱乐', ...MY_SCHEDULE_COLOR_PALETTE.rose },
  rest: { label: '休息', ...MY_SCHEDULE_COLOR_PALETTE.mint },
  sleep: { label: '睡眠', ...MY_SCHEDULE_COLOR_PALETTE.lavender },
};

export const MY_SCHEDULE_TAG_OPTIONS = (Object.keys(MY_SCHEDULE_TAG_META) as MyScheduleTag[])
  .map(value => ({ value, ...MY_SCHEDULE_TAG_META[value] }));

const normalizeMyScheduleTag = (value: unknown): MyScheduleTag | undefined =>
  value === 'study' || value === 'entertainment' || value === 'rest' || value === 'sleep' ? value : undefined;

const parseTimestamp = (value: unknown): number | undefined => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 1_000_000_000) return numeric;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const parseCommandValue = (value: Record<string, unknown>): MyScheduleCommand => {
  const action = value.action;
  if (!['create_completed', 'create_open', 'finish_open'].includes(String(action))) {
    throw new Error('AI 没有判断清楚这条记录，请换一种说法再试');
  }
  return {
    action: action as MyScheduleCommandAction,
    title: typeof value.title === 'string' ? value.title.trim() : undefined,
    startAt: value.startAt as number | string | undefined,
    endAt: value.endAt as number | string | undefined,
    durationMinutes: Number(value.durationMinutes),
    targetEntryId: typeof value.targetEntryId === 'string' ? value.targetEntryId : undefined,
    estimatedTime: value.estimatedTime === true,
    tag: normalizeMyScheduleTag(value.tag),
  };
};

export function parseMyScheduleCommand(raw: string): MyScheduleCommand {
  return parseCommandValue((extractJson(raw) || {}) as Record<string, unknown>);
}

export function parseMyScheduleCommands(raw: string): MyScheduleCommand[] {
  const value = extractJson(raw) as Record<string, unknown> | unknown[] | null;
  const actions = Array.isArray(value) ? value : Array.isArray(value?.actions) ? value.actions : [value];
  if (!actions.length || actions.some(action => !action || typeof action !== 'object')) {
    throw new Error('AI 没有返回可用的日程记录，请换一种说法再试');
  }
  return actions.map(action => parseCommandValue(action as Record<string, unknown>));
}

export function findPreviousMyScheduleEnd(entries: MyScheduleEntry[], now = Date.now()): number | undefined {
  return entries.reduce<number | undefined>((latest, entry) => {
    if (entry.endAt === undefined || entry.endAt >= now) return latest;
    return latest === undefined || entry.endAt > latest ? entry.endAt : latest;
  }, undefined);
}

export function anchorPreviousMyScheduleSpan(
  commands: MyScheduleCommand[],
  sourceText: string,
  previousEndAt: number | undefined,
  now: number,
): MyScheduleCommand[] {
  if (previousEndAt === undefined || !/从\s*(?:刚才|刚刚)\s*(?:到|至)\s*(?:现在|目前|此刻)/.test(sourceText)) return commands;
  const targetIndex = commands.findIndex(command => command.action !== 'finish_open');
  return commands.map((command, index) => index === targetIndex ? {
    ...command,
    action: 'create_completed',
    startAt: previousEndAt,
    endAt: now,
    durationMinutes: undefined,
    estimatedTime: false,
  } : command);
}

export function resolveMyScheduleCommand(
  command: MyScheduleCommand,
  openEntries: MyScheduleEntry[],
  now = Date.now(),
): ResolvedMyScheduleCommand {
  if (command.action === 'finish_open') {
    const target = openEntries.find(entry => entry.id === command.targetEntryId)
      || [...openEntries].sort((a, b) => b.startAt - a.startAt)[0];
    if (!target) throw new Error('没有正在进行或等待结束的日程');
    return {
      action: 'finish_open', title: target.title, startAt: target.startAt,
      endAt: Math.max(target.startAt + 60_000, now), targetEntryId: target.id,
      estimatedTime: target.estimatedTime === true, tag: target.tag,
    };
  }

  const title = (command.title || '').trim().slice(0, 60);
  if (!title) throw new Error('AI 没有提取出日程标题，请说得更具体一点');
  const oneYear = 365 * 86_400_000;
  const rawStart = parseTimestamp(command.startAt);

  if (command.action === 'create_open') {
    const startAt = rawStart && Math.abs(rawStart - now) <= oneYear ? rawStart : now;
    return { action: command.action, title, startAt, estimatedTime: command.estimatedTime === true, tag: command.tag };
  }

  const rawEnd = parseTimestamp(command.endAt);
  const endAt = rawEnd && rawEnd <= now + 5 * 60_000 && now - rawEnd <= oneYear ? rawEnd : now;
  const hasExplicitDuration = Number.isFinite(command.durationMinutes) && command.durationMinutes! > 0;
  const duration = hasExplicitDuration
    ? Math.min(24 * 60, Math.max(1, Math.round(command.durationMinutes!)))
    : 15;
  const startAt = rawStart && rawStart < endAt && endAt - rawStart <= oneYear
    ? rawStart
    : endAt - duration * 60_000;
  return {
    action: command.action, title, startAt, endAt,
    estimatedTime: command.estimatedTime === true || (!rawStart && !hasExplicitDuration), tag: command.tag,
  };
}

export function myScheduleCardMinHeight(
  entry: Pick<MyScheduleEntry, 'startAt' | 'endAt'>,
  pxPerMinute = MY_SCHEDULE_PX_PER_MINUTE,
): number {
  if (entry.endAt === undefined) return MY_SCHEDULE_MIN_CARD_HEIGHT;
  const minutes = Math.max(1, (entry.endAt - entry.startAt) / 60_000);
  return Math.max(MY_SCHEDULE_MIN_CARD_HEIGHT, Math.round(minutes * pxPerMinute));
}

export function myScheduleGapPx(
  occupiedUntil: number | undefined,
  nextStartAt: number,
  pxPerMinute = MY_SCHEDULE_PX_PER_MINUTE,
): number {
  if (occupiedUntil === undefined) return 0;
  const previous = new Date(occupiedUntil);
  const next = new Date(nextStartAt);
  if (previous.getFullYear() !== next.getFullYear()
    || previous.getMonth() !== next.getMonth()
    || previous.getDate() !== next.getDate()) return 0;
  return Math.max(0, Math.round(((nextStartAt - occupiedUntil) / 60_000) * pxPerMinute));
}

export function editMyScheduleEntry(entry: MyScheduleEntry, patch: {
  title: string;
  note: string;
  startAt: number;
  endAt?: number;
  estimatedTime: boolean;
  tag?: MyScheduleTag;
  now?: number;
}): MyScheduleEntry {
  const title = patch.title.trim().slice(0, 60);
  if (!title) throw new Error('日程标题不能为空');
  if (!Number.isFinite(patch.startAt)) throw new Error('开始时间无效');
  if (patch.endAt !== undefined && (!Number.isFinite(patch.endAt) || patch.endAt <= patch.startAt)) {
    throw new Error('结束时间必须晚于开始时间');
  }
  if (patch.endAt !== undefined && patch.endAt - patch.startAt > 365 * 86_400_000) {
    throw new Error('单条日程不能超过一年');
  }
  return {
    ...entry, title, note: patch.note, startAt: patch.startAt, endAt: patch.endAt,
    estimatedTime: patch.estimatedTime, tag: patch.tag, updatedAt: patch.now ?? Date.now(),
  };
}

export function createMyScheduleEntry(input: {
  command: ResolvedMyScheduleCommand;
  sourceText: string;
  note: string;
  recipientCharIds: string[];
  now?: number;
}): MyScheduleEntry {
  if (input.command.action === 'finish_open') throw new Error('结束指令不能创建新日程');
  const now = input.now ?? Date.now();
  return editMyScheduleEntry({
    id: `my-schedule-${now}-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'entry', sourceText: input.sourceText.trim(), title: input.command.title,
    note: input.note, startAt: input.command.startAt, endAt: input.command.endAt,
    estimatedTime: input.command.estimatedTime, tag: input.command.tag,
    recipientCharIds: [...new Set(input.recipientCharIds)],
    messageIdsByCharId: {}, createdAt: now, updatedAt: now,
  }, {
    title: input.command.title, note: input.note, startAt: input.command.startAt,
    endAt: input.command.endAt, estimatedTime: input.command.estimatedTime, tag: input.command.tag, now,
  });
}

export function myScheduleEntryState(entry: MyScheduleEntry, now = Date.now()): 'planned' | 'active' | 'completed' {
  if (entry.endAt !== undefined) return 'completed';
  return entry.startAt > now ? 'planned' : 'active';
}

export function myScheduleDurationMs(
  entry: Pick<MyScheduleEntry, 'startAt' | 'endAt'>,
  cutoff?: number,
): number {
  if (entry.endAt === undefined && cutoff === undefined) return 0;
  const endAt = cutoff === undefined
    ? entry.endAt!
    : Math.min(entry.endAt ?? cutoff, cutoff);
  return Math.max(0, endAt - entry.startAt);
}

export function formatMyScheduleDuration(minutes: number): string {
  const rounded = Math.max(0, Math.round(minutes));
  const hours = Math.floor(rounded / 60);
  const remainder = rounded % 60;
  if (!hours) return `${remainder}min`;
  return remainder ? `${hours}h ${remainder}min` : `${hours}h`;
}

export function myScheduleTagTotals(entries: MyScheduleEntry[], cutoff: number): Record<MyScheduleTag, number> {
  const milliseconds: Record<MyScheduleTag, number> = { study: 0, entertainment: 0, rest: 0, sleep: 0 };
  entries.forEach(entry => {
    if (entry.tag) milliseconds[entry.tag] += myScheduleDurationMs(entry, cutoff);
  });
  return {
    study: Math.round(milliseconds.study / 60_000),
    entertainment: Math.round(milliseconds.entertainment / 60_000),
    rest: Math.round(milliseconds.rest / 60_000),
    sleep: Math.round(milliseconds.sleep / 60_000),
  };
}

export function createMyScheduleArchive(entries: MyScheduleEntry[], now = Date.now()): MyScheduleArchive {
  if (!entries.length) throw new Error('当前没有可以归档的日程');
  return {
    id: `my-schedule-archive-${now}-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'archive',
    entryIds: [...new Set(entries.map(entry => entry.id))],
    startedAt: Math.min(now, ...entries.map(entry => entry.startAt)),
    endedAt: now,
    archivedAt: now,
  };
}

export function myScheduleCurrentEntries(
  entries: MyScheduleEntry[],
  archives: MyScheduleArchive[],
): MyScheduleEntry[] {
  const archivedIds = new Set(archives.flatMap(archive => archive.entryIds));
  return entries.filter(entry => !archivedIds.has(entry.id));
}

export function formatMyScheduleTimeRange(entry: Pick<MyScheduleEntry, 'startAt' | 'endAt' | 'estimatedTime'>): string {
  const clock = (timestamp: number) => new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
  const date = new Date(entry.startAt).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
  const end = entry.endAt === undefined ? '未填写结束时间' : clock(entry.endAt);
  const duration = entry.endAt === undefined ? '' : ` · ${formatMyScheduleDuration(myScheduleDurationMs(entry) / 60_000)}`;
  return `${date} ${clock(entry.startAt)} — ${end}${duration}${entry.estimatedTime ? ' · 时间为估算' : ''}`;
}

export function myScheduleCardSummary(entry: MyScheduleEntry): string {
  const tag = entry.tag ? `【${MY_SCHEDULE_TAG_META[entry.tag].label}】` : '';
  return `${formatMyScheduleTimeRange(entry)}\n${tag}${entry.title}${entry.note ? `\n随笔：${entry.note}` : ''}`;
}
