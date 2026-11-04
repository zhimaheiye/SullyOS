import type { LifeReminderRecord } from '../types';
import { DB } from './db';
import { getLocalDateKey } from './localDate';
import { nowInTimeZone, wallClockToTimestamp } from './timezone';
import { lifeOccurrenceOnDay } from './lifeReminderOccurrences';

export async function readCalendarReminders(): Promise<LifeReminderRecord[]> {
  return (await DB.getMyScheduleRecords()).filter((row): row is LifeReminderRecord => row.kind === 'life_reminder');
}

export const dateInZone = (at: number, zone?: string) => getLocalDateKey(nowInTimeZone(zone, new Date(at)));
export function calendarMonth(month: string) {
  const [year, number] = month.split('-').map(Number);
  return { days: new Date(Date.UTC(year, number, 0)).getUTCDate(), offset: new Date(Date.UTC(year, number - 1, 1)).getUTCDay() };
}
export function shiftCalendarMonth(date: string, delta: number) {
  const [year, month, day] = date.split('-').map(Number);
  const next = new Date(Date.UTC(year, month - 1 + delta, 1));
  const prefix = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
  return `${prefix}-${String(Math.min(day, calendarMonth(prefix).days)).padStart(2, '0')}`;
}

export interface CalendarOccurrence { key: string; record: LifeReminderRecord; at: number; date: string; actual: boolean }
export function projectCalendarMonth(records: LifeReminderRecord[], month: string, displayZone?: string): CalendarOccurrence[] {
  const start = wallClockToTimestamp(`${month}-01T00:00:00`, displayZone);
  const end = wallClockToTimestamp(`${shiftCalendarMonth(`${month}-01`, 1).slice(0, 7)}-01T00:00:00`, displayZone);
  const items = new Map<string, CalendarOccurrence>();
  for (const record of records) {
    if (record.schedule.type === 'conditional') continue;
    const add = (at: number | undefined, actual: boolean) => {
      if (!at || at < start || at >= end) return;
      const key = `life_reminder:${record.id}:${at}`;
      const previous = items.get(key);
      items.set(key, { key, record, at, date: dateInZone(at, displayZone), actual: actual || previous?.actual === true });
    };
    add(record.scheduledFor, true);
    if (record.schedule.type === 'once') { add(record.schedule.at, record.schedule.at === record.scheduledFor); continue; }
    if (record.status === 'cancelled' || record.status === 'completed') continue;
    const first = dateInZone(start, record.timezone).split('-').map(Number);
    for (let step = 0; step < 35; step += 1) add(lifeOccurrenceOnDay(record, new Date(Date.UTC(first[0], first[1] - 1, first[2] + step))) ?? undefined, false);
  }
  return [...items.values()].sort((a, b) => a.at - b.at || a.key.localeCompare(b.key));
}

export function calendarOccurrenceStatus(item: CalendarOccurrence, current = Date.now()) {
  const record = item.record;
  if (record.status === 'cancelled') return '已取消';
  if (record.status === 'completed') return '已完成';
  if (record.status === 'paused') return '已暂停';
  if (record.scheduleError || record.status === 'error') return '异常待修复';
  if (item.actual && record.scheduleState === 'triggered') return '云端已处理';
  if (item.actual && record.scheduleState === 'scheduled') return '已排程';
  return item.at < current ? '历史规则' : '预计时间';
}
