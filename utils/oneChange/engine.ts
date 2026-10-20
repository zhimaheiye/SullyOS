import type {
  OneChangeItem,
  OneChangePendingContraction,
  OneChangeRecord,
  OneChangeResult,
  OneChangeSettings,
  OneChangeStandardVersion,
  OneChangeStateEvent,
} from '../../types';
import { addLocalDays, getCalendarDayDifference, getLocalDateKey } from '../localDate';

export interface OneChangeSnapshot {
  changes: OneChangeItem[];
  records: OneChangeRecord[];
  standardVersions: OneChangeStandardVersion[];
  stateEvents: OneChangeStateEvent[];
  settings: OneChangeSettings;
}

export interface OneChangeDraftInput {
  name: string;
  standard: string;
  description?: string;
  stabilityTargetDays: number;
}

export interface OneChangeSubmitResult {
  snapshot: OneChangeSnapshot;
  creditEarned: boolean;
  focusCompleted: boolean;
  stableReached: boolean;
  pendingContraction?: OneChangePendingContraction;
}

export class OneChangeRuleError extends Error {}

const id = (prefix: string, now: number) => `${prefix}-${now}-${crypto.randomUUID?.() || Math.random().toString(36).slice(2)}`;
const positiveDays = (value: number) => Math.max(1, Math.min(3650, Math.round(value || 0)));

export const createEmptyOneChangeSnapshot = (now = Date.now()): OneChangeSnapshot => ({
  changes: [],
  records: [],
  standardVersions: [],
  stateEvents: [],
  settings: { id: 'main', defaultStabilityDays: 30, expansionCredit: 0, updatedAt: now },
});

const copySnapshot = (source: OneChangeSnapshot): OneChangeSnapshot => ({
  changes: source.changes.map(change => ({ ...change })),
  records: source.records.map(record => ({ ...record })),
  standardVersions: source.standardVersions.map(version => ({ ...version })),
  stateEvents: source.stateEvents.map(event => ({ ...event, participantIds: event.participantIds?.slice() })),
  settings: {
    ...source.settings,
    focusObservation: source.settings.focusObservation ? { ...source.settings.focusObservation } : undefined,
    pendingContraction: source.settings.pendingContraction
      ? { ...source.settings.pendingContraction, participantIds: source.settings.pendingContraction.participantIds.slice() }
      : undefined,
  },
});

const event = (
  type: OneChangeStateEvent['type'],
  effectiveDate: string,
  effectiveAt: number,
  extra: Partial<OneChangeStateEvent> = {},
): OneChangeStateEvent => ({ id: id(`one-change-${type}`, effectiveAt), type, effectiveDate, effectiveAt, ...extra });

const validateDraft = (input: OneChangeDraftInput) => {
  if (!input.name.trim()) throw new OneChangeRuleError('请填写改变名称');
  if (!input.standard.trim()) throw new OneChangeRuleError('请填写当前标准');
  if (!Number.isFinite(input.stabilityTargetDays) || input.stabilityTargetDays < 1) {
    throw new OneChangeRuleError('稳定周期至少为 1 天');
  }
};

export function canStartOneChange(snapshot: OneChangeSnapshot): boolean {
  if (snapshot.settings.pendingContraction) return false;
  const hasActiveChange = snapshot.changes.some(change => change.status === 'active');
  return !hasActiveChange || snapshot.settings.expansionCredit === 1;
}

export function getOneChangeStandard(
  snapshot: Pick<OneChangeSnapshot, 'standardVersions'>,
  changeId: string,
  date: string,
): OneChangeStandardVersion | undefined {
  return snapshot.standardVersions
    .filter(version => version.changeId === changeId && version.effectiveDate <= date)
    .sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate) || b.createdAt - a.createdAt)[0]
    || snapshot.standardVersions
      .filter(version => version.changeId === changeId)
      .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.createdAt - b.createdAt)[0];
}

/**
 * Lifecycle end events take effect after their effective calendar day. This preserves the
 * formal set that completed the day before a contraction/archive decision was made.
 */
export function getOneChangeFormalParticipantIds(snapshot: OneChangeSnapshot, date: string): string[] {
  return snapshot.changes.filter(change => {
    let active = false;
    const lifecycle = snapshot.stateEvents
      .filter(item => item.changeId === change.id && ['activated', 'resumed', 'frozen', 'archived'].includes(item.type))
      .sort((a, b) => a.effectiveDate.localeCompare(b.effectiveDate) || a.effectiveAt - b.effectiveAt);
    for (const item of lifecycle) {
      if ((item.type === 'activated' || item.type === 'resumed') && item.effectiveDate <= date) active = true;
      if ((item.type === 'frozen' || item.type === 'archived') && item.effectiveDate < date) active = false;
    }
    return active;
  }).map(change => change.id);
}

export function createOneChange(
  source: OneChangeSnapshot,
  input: OneChangeDraftInput,
  options: { start?: boolean; now?: number; date?: string } = {},
): { snapshot: OneChangeSnapshot; changeId: string } {
  validateDraft(input);
  const now = options.now ?? Date.now();
  const date = options.date ?? getLocalDateKey(new Date(now));
  const start = options.start === true;
  if (start && !canStartOneChange(source)) throw new OneChangeRuleError('现在只能先保存为草稿');
  const snapshot = copySnapshot(source);
  const changeId = id('one-change', now);
  const change: OneChangeItem = {
    id: changeId,
    name: input.name.trim(),
    standard: input.standard.trim(),
    description: input.description?.trim() || '',
    stabilityTargetDays: positiveDays(input.stabilityTargetDays),
    status: start ? 'active' : 'draft',
    sortOrder: snapshot.changes.reduce((max, item) => Math.max(max, item.sortOrder), -1) + 1,
    totalSuccessDays: 0,
    currentStreak: 0,
    everStable: false,
    currentStable: false,
    createdAt: now,
    updatedAt: now,
    activatedAt: start ? now : undefined,
  };
  snapshot.changes.push(change);
  snapshot.standardVersions.push({
    id: id('one-change-standard', now),
    changeId,
    standard: change.standard,
    effectiveDate: date,
    createdAt: now,
  });
  if (start) {
    snapshot.stateEvents.push(event('activated', date, now, { changeId }));
    if (source.changes.some(item => item.status === 'active')) {
      snapshot.settings.expansionCredit = 0;
      snapshot.stateEvents.push(event('expansion_credit_used', date, now, { changeId }));
    }
  }
  snapshot.settings.updatedAt = now;
  return { snapshot, changeId };
}

export function startOneChange(
  source: OneChangeSnapshot,
  changeId: string,
  options: { now?: number; date?: string } = {},
): OneChangeSnapshot {
  if (!canStartOneChange(source)) throw new OneChangeRuleError('还没有增加改变的资格');
  const now = options.now ?? Date.now();
  const date = options.date ?? getLocalDateKey(new Date(now));
  const snapshot = copySnapshot(source);
  const change = snapshot.changes.find(item => item.id === changeId);
  if (!change || !['draft', 'frozen'].includes(change.status)) throw new OneChangeRuleError('这个改变现在不能开始');
  const usesCredit = snapshot.changes.some(item => item.status === 'active');
  const resume = change.status === 'frozen';
  const hasTodayRecord = snapshot.records.some(record => record.changeId === changeId && record.date === date);
  const participationDate = resume && hasTodayRecord ? addLocalDays(date, 1) : date;
  change.status = 'active';
  change.activatedAt ||= now;
  change.updatedAt = now;
  snapshot.stateEvents.push(event(resume ? 'resumed' : 'activated', participationDate, now, { changeId }));
  if (usesCredit) {
    snapshot.settings.expansionCredit = 0;
    snapshot.stateEvents.push(event('expansion_credit_used', date, now, { changeId }));
  }
  snapshot.settings.updatedAt = now;
  return snapshot;
}

export function editOneChange(
  source: OneChangeSnapshot,
  changeId: string,
  input: OneChangeDraftInput,
  options: { now?: number; date?: string } = {},
): OneChangeSnapshot {
  validateDraft(input);
  const now = options.now ?? Date.now();
  const date = options.date ?? getLocalDateKey(new Date(now));
  const snapshot = copySnapshot(source);
  const change = snapshot.changes.find(item => item.id === changeId);
  if (!change) throw new OneChangeRuleError('改变不存在');
  change.name = input.name.trim();
  change.description = input.description?.trim() || '';
  change.updatedAt = now;
  if (change.status === 'draft') change.stabilityTargetDays = positiveDays(input.stabilityTargetDays);
  const nextStandard = input.standard.trim();
  if (nextStandard !== change.standard) {
    change.standard = nextStandard;
    if (change.status === 'draft') {
      const initial = snapshot.standardVersions.find(version => version.changeId === changeId);
      if (initial) { initial.standard = nextStandard; initial.createdAt = now; }
    } else {
      snapshot.standardVersions.push({
        id: id('one-change-standard', now),
        changeId,
        standard: nextStandard,
        effectiveDate: addLocalDays(date, 1),
        createdAt: now,
      });
    }
  }
  return snapshot;
}

const earnCredit = (snapshot: OneChangeSnapshot, changeId: string, date: string, now: number) => {
  const earned = snapshot.settings.expansionCredit === 0;
  snapshot.settings.expansionCredit = 1;
  if (earned) snapshot.stateEvents.push(event('expansion_credit_earned', date, now, { changeId }));
  return earned;
};

const findContraction = (snapshot: OneChangeSnapshot, date: string): OneChangePendingContraction | undefined => {
  if (snapshot.settings.pendingContraction) return snapshot.settings.pendingContraction;
  const participantIds = getOneChangeFormalParticipantIds(snapshot, date);
  if (participantIds.length < 2) return undefined;
  const records = participantIds.map(changeId => snapshot.records.find(record => (
    record.changeId === changeId && record.date === date && record.recordMode === 'formal'
  )));
  if (records.some(record => !record) || !records.some(record => record?.result === 'not_done')) return undefined;
  return { sourceDate: date, participantIds, triggeredAt: 0 };
};

export function submitOneChangeRecord(
  source: OneChangeSnapshot,
  input: { changeId: string; date: string; result: OneChangeResult; feeling?: string },
  options: { now?: number; currentDate?: string } = {},
): OneChangeSubmitResult {
  const now = options.now ?? Date.now();
  const currentDate = options.currentDate ?? getLocalDateKey(new Date(now));
  if (input.date > currentDate) throw new OneChangeRuleError('不能记录未来日期');
  const existing = source.records.find(record => record.changeId === input.changeId && record.date === input.date);
  if (existing) {
    if (existing.result !== input.result) throw new OneChangeRuleError('完成情况保存后不能修改');
    return { snapshot: source, creditEarned: false, focusCompleted: false, stableReached: false };
  }
  const snapshot = copySnapshot(source);
  const change = snapshot.changes.find(item => item.id === input.changeId);
  if (!change || change.status === 'draft') throw new OneChangeRuleError('这个改变还不能记录');
  const participants = getOneChangeFormalParticipantIds(snapshot, input.date);
  const formal = participants.includes(change.id) && !(input.date === currentDate && change.status === 'frozen');
  const standard = getOneChangeStandard(snapshot, change.id, input.date);
  if (!standard) throw new OneChangeRuleError('找不到当天适用的标准');
  snapshot.records.push({
    id: `${change.id}:${input.date}`,
    changeId: change.id,
    date: input.date,
    result: input.result,
    feeling: input.feeling?.trim() || '',
    standardVersionId: standard.id,
    recordMode: formal ? 'formal' : 'frozen',
    submittedAt: now,
    feelingUpdatedAt: now,
  });

  let stableReached = false;
  let creditEarned = false;
  let focusCompleted = false;
  if (formal) {
    const wasEverStable = change.everStable;
    if (input.result === 'done') {
      change.totalSuccessDays += 1;
      change.currentStreak += 1;
      if (change.currentStreak >= change.stabilityTargetDays) {
        change.currentStreak = change.stabilityTargetDays;
        change.currentStable = true;
        change.everStable = true;
        stableReached = !wasEverStable;
        if (!wasEverStable) creditEarned = earnCredit(snapshot, change.id, currentDate, now) || creditEarned;
      }
    } else {
      change.currentStreak = 0;
      change.currentStable = false;
    }
    change.updatedAt = now;

    const focus = snapshot.settings.focusObservation;
    if (focus?.changeId === change.id) {
      focus.streak = input.result === 'done' ? focus.streak + 1 : 0;
      if (focus.streak >= focus.targetDays) {
        focusCompleted = true;
        snapshot.stateEvents.push(event('focus_completed', currentDate, now, { changeId: change.id }));
        snapshot.settings.focusObservation = undefined;
        creditEarned = earnCredit(snapshot, change.id, currentDate, now) || creditEarned;
      }
    }
  }

  const pending = findContraction(snapshot, input.date);
  if (pending && !snapshot.settings.pendingContraction) {
    pending.triggeredAt = now;
    snapshot.settings.pendingContraction = pending;
    snapshot.stateEvents.push(event('contraction_pending', currentDate, now, {
      sourceDate: input.date,
      participantIds: pending.participantIds,
    }));
  }
  snapshot.settings.updatedAt = now;
  return { snapshot, creditEarned, focusCompleted, stableReached, pendingContraction: snapshot.settings.pendingContraction };
}

export function updateOneChangeFeeling(
  source: OneChangeSnapshot,
  changeId: string,
  date: string,
  feeling: string,
  now = Date.now(),
): OneChangeSnapshot {
  const snapshot = copySnapshot(source);
  const record = snapshot.records.find(item => item.changeId === changeId && item.date === date);
  if (!record) throw new OneChangeRuleError('记录不存在');
  record.feeling = feeling.trim();
  record.feelingUpdatedAt = now;
  return snapshot;
}

export function resolveOneChangeContraction(
  source: OneChangeSnapshot,
  keptChangeId: string,
  options: { now?: number; date?: string } = {},
): OneChangeSnapshot {
  const pending = source.settings.pendingContraction;
  if (!pending || !pending.participantIds.includes(keptChangeId)) throw new OneChangeRuleError('请选择本轮中的一个改变');
  const now = options.now ?? Date.now();
  const date = options.date ?? getLocalDateKey(new Date(now));
  const snapshot = copySnapshot(source);
  for (const changeId of pending.participantIds) {
    const change = snapshot.changes.find(item => item.id === changeId);
    if (!change || change.status === 'archived') continue;
    if (changeId === keptChangeId) {
      change.status = 'active';
    } else {
      change.status = 'frozen';
      snapshot.stateEvents.push(event('frozen', date, now, { changeId, sourceDate: pending.sourceDate }));
    }
    change.updatedAt = now;
  }
  const kept = snapshot.changes.find(item => item.id === keptChangeId)!;
  snapshot.settings.expansionCredit = 0;
  snapshot.settings.pendingContraction = undefined;
  snapshot.settings.focusObservation = {
    changeId: keptChangeId,
    targetDays: kept.stabilityTargetDays,
    streak: 0,
    startedAt: now,
    startedDate: date,
  };
  snapshot.settings.updatedAt = now;
  snapshot.stateEvents.push(
    event('contraction_resolved', date, now, {
      changeId: keptChangeId,
      sourceDate: pending.sourceDate,
      participantIds: pending.participantIds,
    }),
    event('focus_started', date, now, { changeId: keptChangeId, sourceDate: pending.sourceDate }),
  );
  return snapshot;
}

export function archiveOneChange(
  source: OneChangeSnapshot,
  changeId: string,
  options: { now?: number; date?: string } = {},
): OneChangeSnapshot {
  if (source.settings.pendingContraction?.participantIds.includes(changeId)) {
    throw new OneChangeRuleError('请先完成收缩选择');
  }
  const now = options.now ?? Date.now();
  const date = options.date ?? getLocalDateKey(new Date(now));
  const snapshot = copySnapshot(source);
  const change = snapshot.changes.find(item => item.id === changeId);
  if (!change || change.status === 'draft') throw new OneChangeRuleError('草稿可以直接删除');
  change.status = 'archived';
  change.archivedAt = now;
  change.updatedAt = now;
  snapshot.stateEvents.push(event('archived', date, now, { changeId }));
  if (snapshot.settings.focusObservation?.changeId === changeId) snapshot.settings.focusObservation = undefined;
  snapshot.settings.updatedAt = now;
  return snapshot;
}

export function deleteOneChangeDraft(source: OneChangeSnapshot, changeId: string): OneChangeSnapshot {
  const change = source.changes.find(item => item.id === changeId);
  if (!change || change.status !== 'draft') throw new OneChangeRuleError('只有草稿可以删除');
  const snapshot = copySnapshot(source);
  snapshot.changes = snapshot.changes.filter(item => item.id !== changeId);
  snapshot.standardVersions = snapshot.standardVersions.filter(version => version.changeId !== changeId);
  return snapshot;
}

export function setOneChangeDefaultDays(source: OneChangeSnapshot, days: number, now = Date.now()): OneChangeSnapshot {
  const snapshot = copySnapshot(source);
  snapshot.settings.defaultStabilityDays = positiveDays(days);
  snapshot.settings.updatedAt = now;
  return snapshot;
}

export function moveOneChangeDraft(source: OneChangeSnapshot, changeId: string, direction: -1 | 1): OneChangeSnapshot {
  const snapshot = copySnapshot(source);
  const drafts = snapshot.changes.filter(change => change.status === 'draft').sort((a, b) => a.sortOrder - b.sortOrder);
  const index = drafts.findIndex(change => change.id === changeId);
  const other = drafts[index + direction];
  if (index < 0 || !other) return snapshot;
  const current = drafts[index];
  [current.sortOrder, other.sortOrder] = [other.sortOrder, current.sortOrder];
  return snapshot;
}

export function listOneChangeMissingDates(snapshot: OneChangeSnapshot, throughDate: string): Array<{ date: string; changeId: string }> {
  const activationDates = snapshot.stateEvents
    .filter(item => item.type === 'activated' || item.type === 'resumed')
    .map(item => item.effectiveDate)
    .sort();
  if (!activationDates.length) return [];
  const total = getCalendarDayDifference(activationDates[0], throughDate);
  if (total === null || total < 0) return [];
  const missing: Array<{ date: string; changeId: string }> = [];
  for (let offset = 0; offset <= total; offset += 1) {
    const date = addLocalDays(activationDates[0], offset);
    for (const changeId of getOneChangeFormalParticipantIds(snapshot, date)) {
      if (!snapshot.records.some(record => record.changeId === changeId && record.date === date)) missing.push({ date, changeId });
    }
  }
  return missing;
}
