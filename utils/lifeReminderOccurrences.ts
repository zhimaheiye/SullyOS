import type { LifeReminderRecord } from '../types';
import { nowInTimeZone, wallClockToTimestamp } from './timezone';

export function lifeOccurrenceOnDay(record: LifeReminderRecord, day: Date): number | null {
  const type = record.schedule.type;
  if (type === 'conditional' || type === 'once') return null;
  const endDay = new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth() + 1, 0)).getUTCDate();
  if (type === 'monthly_last_days' && !(record.schedule.lastDays || [-1]).some(n => endDay + n + 1 === day.getUTCDate())) return null;
  if (type === 'weekly' && day.getUTCDay() !== nowInTimeZone(record.timezone, new Date(record.startAt || record.createdAt)).getDay()) return null;
  const [hour, minute] = (record.schedule.time || '09:00').split(':').map(Number);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  const key = `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, '0')}-${String(day.getUTCDate()).padStart(2, '0')}`;
  const at = wallClockToTimestamp(`${key}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`, record.timezone);
  return Number.isFinite(at) && at >= (record.suppressUntil || 0) && at >= (record.startAt || 0) && at <= (record.endAt || Infinity) ? at : null;
}
