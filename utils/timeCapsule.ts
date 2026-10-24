import type { CharacterProfile, TimeCapsuleEntry, TimeCapsuleSettings, TimeCapsuleSource } from '../types';

export const DEFAULT_TIME_CAPSULE_SETTINGS: TimeCapsuleSettings = {
  id: 'settings', kind: 'settings', enabled: false, visitorCharIds: [], intervalMinutes: 1440, nextVisitorIndex: 0,
};

export const createTimeCapsuleId = (): string =>
  `capsule_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

export function maxTimeCapsuleUnlockAt(now = Date.now()): number {
  const date = new Date(now);
  date.setFullYear(date.getFullYear() + 1);
  return date.getTime();
}

export function validateTimeCapsuleUnlockAt(unlockAt: number, now = Date.now()): string | null {
  if (!Number.isFinite(unlockAt)) return '请选择开启时间';
  if (unlockAt <= now) return '开启时间需要晚于现在';
  if (unlockAt > maxTimeCapsuleUnlockAt(now)) return '开启时间不能超过一年';
  return null;
}

export function toLocalDateTimeInput(time: number): string {
  const date = new Date(time);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(time - offset).toISOString().slice(0, 16);
}

export function createUserTimeCapsule(input: { title: string; content: string; unlockAt: number; now?: number }): TimeCapsuleEntry {
  const now = input.now ?? Date.now();
  const error = validateTimeCapsuleUnlockAt(input.unlockAt, now);
  if (error) throw new Error(error);
  const title = input.title.trim();
  const content = input.content.trim();
  if (!title) throw new Error('请给胶囊写一个封面标题');
  if (!content) throw new Error('胶囊里还没有内容');
  return {
    id: createTimeCapsuleId(), kind: 'capsule', title: title.slice(0, 80), content: content.slice(0, 12_000),
    source: 'user', createdAt: now, unlockAt: input.unlockAt,
  };
}

const stripFence = (raw: string): string => raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

export function parseCharacterTimeCapsule(
  raw: string,
  char: Pick<CharacterProfile, 'id' | 'name' | 'avatar'>,
  source: Exclude<TimeCapsuleSource, 'user'>,
  now = Date.now(),
): TimeCapsuleEntry {
  const cleaned = stripFence(raw);
  let parsed: any = null;
  try { parsed = JSON.parse(cleaned); } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) try { parsed = JSON.parse(match[0]); } catch { /* use raw fallback */ }
  }
  const daysValue = Number(parsed?.unlockInDays ?? parsed?.days ?? 30);
  const unlockInDays = Math.min(365, Math.max(1, Number.isFinite(daysValue) ? Math.round(daysValue) : 30));
  const unlockAt = Math.min(now + unlockInDays * 24 * 60 * 60_000, maxTimeCapsuleUnlockAt(now));
  const content = String(parsed?.content || parsed?.message || cleaned || '等时间到了，再来看看我想说什么。').trim().slice(0, 12_000);
  const title = String(parsed?.title || `${char.name}留给未来的一封话`).trim().slice(0, 80);
  return {
    id: createTimeCapsuleId(), kind: 'capsule', title, content, source,
    charId: char.id, charName: char.name, charAvatar: char.avatar,
    createdAt: now, unlockAt,
  };
}

export function isTimeCapsuleVisitDue(settings: TimeCapsuleSettings, now = Date.now()): boolean {
  if (!settings.enabled || settings.visitorCharIds.length === 0) return false;
  const intervalMs = Math.max(5, settings.intervalMinutes || 1440) * 60_000;
  return !settings.lastVisitAt || now - settings.lastVisitAt >= intervalMs;
}

export function nextTimeCapsuleVisitor(settings: TimeCapsuleSettings, blockedCharIds: string[] = []): { charId: string | null; nextIndex: number } {
  const ids = settings.visitorCharIds;
  if (!ids.length) return { charId: null, nextIndex: 0 };
  const start = Math.max(0, settings.nextVisitorIndex) % ids.length;
  for (let step = 0; step < ids.length; step += 1) {
    const index = (start + step) % ids.length;
    if (!blockedCharIds.includes(ids[index])) return { charId: ids[index], nextIndex: (index + 1) % ids.length };
  }
  return { charId: null, nextIndex: (start + 1) % ids.length };
}

export function hasPendingAutoTimeCapsule(capsules: TimeCapsuleEntry[], charId: string): boolean {
  return capsules.some(item => item.source === 'auto' && item.charId === charId && !item.openedAt);
}

export function formatTimeCapsuleDistance(unlockAt: number, now = Date.now()): string {
  const diff = unlockAt - now;
  if (diff <= 0) return '可以开启了';
  const days = Math.floor(diff / 86_400_000);
  if (days > 0) return `还有 ${days} 天`;
  const hours = Math.floor(diff / 3_600_000);
  if (hours > 0) return `还有 ${hours} 小时`;
  return `还有 ${Math.max(1, Math.ceil(diff / 60_000))} 分钟`;
}
