import { describe, expect, it } from 'vitest';
import { addLocalDays } from '../localDate';
import {
  OneChangeRuleError,
  archiveOneChange,
  canStartOneChange,
  createEmptyOneChangeSnapshot,
  createOneChange,
  editOneChange,
  getOneChangeFormalParticipantIds,
  getOneChangeStandard,
  resolveOneChangeContraction,
  setOneChangeDefaultDays,
  startOneChange,
  submitOneChangeRecord,
  updateOneChangeFeeling,
  type OneChangeSnapshot,
} from './engine';

const DAY = '2026-01-01';
const draft = (name: string, days = 30) => ({ name, standard: `每天完成${name}`, description: '', stabilityTargetDays: days });

function create(snapshot: OneChangeSnapshot, name: string, start = false, date = DAY, days = 30) {
  return createOneChange(snapshot, draft(name, days), { start, date, now: Date.parse(`${date}T08:00:00`) });
}

function record(snapshot: OneChangeSnapshot, changeId: string, date: string, result: 'done' | 'not_done') {
  return submitOneChangeRecord(snapshot, { changeId, date, result }, {
    currentDate: date,
    now: Date.parse(`${date}T20:00:00`),
  });
}

function doneDays(snapshot: OneChangeSnapshot, changeId: string, from: string, count: number) {
  let next = snapshot;
  for (let i = 0; i < count; i += 1) next = record(next, changeId, addLocalDays(from, i), 'done').snapshot;
  return next;
}

function twoActive(days = 30) {
  let snapshot = createEmptyOneChangeSnapshot();
  const first = create(snapshot, 'A', true, DAY, days); snapshot = first.snapshot;
  snapshot = doneDays(snapshot, first.changeId, DAY, days);
  const secondDate = addLocalDays(DAY, days);
  const second = create(snapshot, 'B', true, secondDate, days); snapshot = second.snapshot;
  return { snapshot, a: first.changeId, b: second.changeId, date: secondDate };
}

describe('只做一个改变状态机', () => {
  it('Case 1/2：30 天稳定后只获得一个资格，继续完成也不累积', () => {
    let snapshot = createEmptyOneChangeSnapshot();
    const created = create(snapshot, '锻炼', true); snapshot = created.snapshot;
    snapshot = doneDays(snapshot, created.changeId, DAY, 30);
    const change = snapshot.changes[0];
    expect(change.totalSuccessDays).toBe(30);
    expect(change.currentStable).toBe(true);
    expect(change.everStable).toBe(true);
    expect(snapshot.settings.expansionCredit).toBe(1);
    snapshot = record(snapshot, created.changeId, addLocalDays(DAY, 30), 'done').snapshot;
    expect(snapshot.settings.expansionCredit).toBe(1);
    expect(snapshot.stateEvents.filter(item => item.type === 'expansion_credit_earned')).toHaveLength(1);
  });

  it('Case 3/4：没做不清累计、清稳定进度，下一次完成进入重新稳定 1/N', () => {
    let snapshot = createEmptyOneChangeSnapshot();
    const created = create(snapshot, '锻炼', true); snapshot = created.snapshot;
    snapshot = doneDays(snapshot, created.changeId, DAY, 45);
    snapshot = record(snapshot, created.changeId, addLocalDays(DAY, 45), 'not_done').snapshot;
    expect(snapshot.changes[0]).toMatchObject({ totalSuccessDays: 45, currentStreak: 0, everStable: true, currentStable: false });
    snapshot = record(snapshot, created.changeId, addLocalDays(DAY, 46), 'done').snapshot;
    expect(snapshot.changes[0]).toMatchObject({ totalSuccessDays: 46, currentStreak: 1, everStable: true });
  });

  it('Case 5：未记录不产生记录、不改变进度也不触发收缩', () => {
    const { snapshot, a, b, date } = twoActive(3);
    const afterA = record(snapshot, a, date, 'not_done').snapshot;
    expect(afterA.records.some(item => item.changeId === b && item.date === date)).toBe(false);
    expect(afterA.settings.pendingContraction).toBeUndefined();
  });

  it('Case 6/7：并行集合全部有结果后才进入待收缩', () => {
    let { snapshot, a, b, date } = twoActive(2);
    snapshot = doneDays(snapshot, b, date, 2);
    const thirdDate = addLocalDays(date, 2);
    const third = create(snapshot, 'C', true, thirdDate, 2); snapshot = third.snapshot;
    snapshot = record(snapshot, a, thirdDate, 'done').snapshot;
    snapshot = record(snapshot, b, thirdDate, 'not_done').snapshot;
    expect(snapshot.settings.pendingContraction).toBeUndefined();
    snapshot = record(snapshot, third.changeId, thirdDate, 'done').snapshot;
    expect(snapshot.settings.pendingContraction?.participantIds.sort()).toEqual([a, b, third.changeId].sort());
  });

  it('Case 8：收缩只保留一个，冻结其它并开始独立观察期', () => {
    let { snapshot, a, b, date } = twoActive(2);
    snapshot = record(snapshot, a, date, 'done').snapshot;
    snapshot = record(snapshot, b, date, 'not_done').snapshot;
    const before = snapshot.changes.find(item => item.id === b)!.totalSuccessDays;
    snapshot = resolveOneChangeContraction(snapshot, a, { date, now: Date.parse(`${date}T21:00:00`) });
    expect(snapshot.changes.find(item => item.id === a)?.status).toBe('active');
    expect(snapshot.changes.find(item => item.id === b)).toMatchObject({ status: 'frozen', totalSuccessDays: before });
    expect(snapshot.settings).toMatchObject({ expansionCredit: 0, focusObservation: { changeId: a, streak: 0, targetDays: 2 } });
  });

  it('待收缩参与者不能用归档绕过只保留一个的决策', () => {
    let { snapshot, a, b, date } = twoActive(2);
    snapshot = record(snapshot, a, date, 'done').snapshot;
    snapshot = record(snapshot, b, date, 'not_done').snapshot;
    expect(() => archiveOneChange(snapshot, b, { date })).toThrow('请先完成收缩选择');
    expect(snapshot.settings.pendingContraction?.participantIds).toEqual([a, b]);
  });

  it('Case 9：单任务观察连续 N 天后只获得一个资格', () => {
    let { snapshot, a, b, date } = twoActive(2);
    snapshot = record(snapshot, a, date, 'done').snapshot;
    snapshot = record(snapshot, b, date, 'not_done').snapshot;
    snapshot = resolveOneChangeContraction(snapshot, a, { date });
    snapshot = record(snapshot, a, addLocalDays(date, 1), 'done').snapshot;
    expect(snapshot.settings.focusObservation?.streak).toBe(1);
    snapshot = record(snapshot, a, addLocalDays(date, 2), 'done').snapshot;
    expect(snapshot.settings.focusObservation).toBeUndefined();
    expect(snapshot.settings.expansionCredit).toBe(1);
  });

  it('Case 10/11：冻结记录不推进；恢复后正式完成从旧累计继续', () => {
    let { snapshot, a, b, date } = twoActive(2);
    snapshot = record(snapshot, a, date, 'done').snapshot;
    snapshot = record(snapshot, b, date, 'not_done').snapshot;
    snapshot = resolveOneChangeContraction(snapshot, a, { date });
    const frozenBefore = snapshot.changes.find(item => item.id === b)!;
    const observedDate = addLocalDays(date, 1);
    snapshot = record(snapshot, b, observedDate, 'done').snapshot;
    snapshot = record(snapshot, b, addLocalDays(date, 2), 'not_done').snapshot;
    expect(snapshot.changes.find(item => item.id === b)).toMatchObject({
      totalSuccessDays: frozenBefore.totalSuccessDays,
      currentStreak: frozenBefore.currentStreak,
    });
    expect(snapshot.settings.pendingContraction).toBeUndefined();
    snapshot.settings.expansionCredit = 1;
    snapshot = startOneChange(snapshot, b, { date: addLocalDays(date, 3) });
    const total = snapshot.changes.find(item => item.id === b)!.totalSuccessDays;
    snapshot = record(snapshot, b, addLocalDays(date, 3), 'done').snapshot;
    expect(snapshot.changes.find(item => item.id === b)?.totalSuccessDays).toBe(total + 1);
  });

  it('Case 12：正式改变的新标准明天生效，今天记录仍引用旧版本', () => {
    let snapshot = createEmptyOneChangeSnapshot();
    const created = create(snapshot, '锻炼', true); snapshot = created.snapshot;
    snapshot = editOneChange(snapshot, created.changeId, { ...draft('锻炼'), standard: '每天运动 15 分钟' }, { date: DAY, now: 2 });
    expect(getOneChangeStandard(snapshot, created.changeId, DAY)?.standard).toBe('每天完成锻炼');
    expect(getOneChangeStandard(snapshot, created.changeId, addLocalDays(DAY, 1))?.standard).toBe('每天运动 15 分钟');
    const submitted = record(snapshot, created.changeId, DAY, 'done').snapshot.records[0];
    expect(snapshot.standardVersions.find(item => item.id === submitted.standardVersionId)?.standard).toBe('每天完成锻炼');
  });

  it('Case 13：修改全局默认不改变旧改变，只影响以后创建时的快照', () => {
    let snapshot = createEmptyOneChangeSnapshot();
    const old = create(snapshot, '旧改变', false, DAY, snapshot.settings.defaultStabilityDays); snapshot = old.snapshot;
    snapshot = setOneChangeDefaultDays(snapshot, 45);
    const next = create(snapshot, '新改变', false, DAY, snapshot.settings.defaultStabilityDays); snapshot = next.snapshot;
    expect(snapshot.changes.find(item => item.id === old.changeId)?.stabilityTargetDays).toBe(30);
    expect(snapshot.changes.find(item => item.id === next.changeId)?.stabilityTargetDays).toBe(45);
  });

  it('Case 14：正式结果锁定，感受仍可修改且不影响进度', () => {
    let snapshot = createEmptyOneChangeSnapshot();
    const created = create(snapshot, '阅读', true); snapshot = created.snapshot;
    snapshot = record(snapshot, created.changeId, DAY, 'done').snapshot;
    expect(() => record(snapshot, created.changeId, DAY, 'not_done')).toThrow(OneChangeRuleError);
    const before = snapshot.changes[0];
    snapshot = updateOneChangeFeeling(snapshot, created.changeId, DAY, '后来补上的感受', 10);
    expect(snapshot.records[0].feeling).toBe('后来补上的感受');
    expect(snapshot.changes[0]).toEqual(before);
  });

  it('Case 15：晚到历史补记现在触发收缩，不改写后续记录或生命周期', () => {
    let { snapshot, a, b, date } = twoActive(2);
    snapshot = record(snapshot, a, date, 'done').snapshot;
    const later = addLocalDays(date, 16);
    snapshot = submitOneChangeRecord(snapshot, { changeId: a, date: later, result: 'done' }, { currentDate: later, now: 100 }).snapshot;
    snapshot = submitOneChangeRecord(snapshot, { changeId: b, date: later, result: 'done' }, { currentDate: later, now: 101 }).snapshot;
    const eventCount = snapshot.stateEvents.length;
    const laterRecords = snapshot.records.filter(item => item.date === later).map(item => ({ ...item }));
    snapshot = submitOneChangeRecord(snapshot, { changeId: b, date, result: 'not_done' }, { currentDate: later, now: 102 }).snapshot;
    expect(snapshot.settings.pendingContraction?.sourceDate).toBe(date);
    expect(snapshot.records.filter(item => item.date === later)).toEqual(laterRecords);
    expect(snapshot.stateEvents.slice(0, eventCount).every((item, index) => item.id === snapshot.stateEvents[index].id)).toBe(true);
  });

  it('Case 16：归档保留记录和历史参与集合，但不参加未来日期', () => {
    let snapshot = createEmptyOneChangeSnapshot();
    const created = create(snapshot, '阅读', true); snapshot = created.snapshot;
    snapshot = record(snapshot, created.changeId, DAY, 'done').snapshot;
    snapshot = archiveOneChange(snapshot, created.changeId, { date: DAY, now: Date.parse(`${DAY}T21:00:00`) });
    expect(snapshot.records).toHaveLength(1);
    expect(getOneChangeFormalParticipantIds(snapshot, DAY)).toContain(created.changeId);
    expect(getOneChangeFormalParticipantIds(snapshot, addLocalDays(DAY, 1))).not.toContain(created.changeId);
    expect(snapshot.changes[0].status).toBe('archived');
  });

  it('本地日期跨月和闰日仍保持自然日语义', () => {
    expect(addLocalDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addLocalDays('2028-02-29', 1)).toBe('2028-03-01');
  });

  it('完整流程：首个稳定→开启第二个→并行收缩→冻结观察→单任务观察→恢复一个', () => {
    let snapshot = createEmptyOneChangeSnapshot();
    const first = create(snapshot, 'A', true, DAY, 2); snapshot = first.snapshot;
    snapshot = doneDays(snapshot, first.changeId, DAY, 2);
    expect(snapshot.settings.expansionCredit).toBe(1);
    const secondDate = addLocalDays(DAY, 2);
    const second = create(snapshot, 'B', true, secondDate, 2); snapshot = second.snapshot;
    for (let offset = 0; offset < 2; offset += 1) {
      const date = addLocalDays(secondDate, offset);
      snapshot = record(snapshot, first.changeId, date, 'done').snapshot;
      snapshot = record(snapshot, second.changeId, date, 'done').snapshot;
    }
    const failDate = addLocalDays(secondDate, 2);
    snapshot = record(snapshot, first.changeId, failDate, 'done').snapshot;
    snapshot = record(snapshot, second.changeId, failDate, 'not_done').snapshot;
    expect(snapshot.settings.pendingContraction).toBeDefined();
    snapshot = resolveOneChangeContraction(snapshot, first.changeId, { date: failDate });
    const frozenTotal = snapshot.changes.find(item => item.id === second.changeId)!.totalSuccessDays;
    snapshot = record(snapshot, second.changeId, addLocalDays(failDate, 1), 'done').snapshot;
    expect(snapshot.changes.find(item => item.id === second.changeId)?.totalSuccessDays).toBe(frozenTotal);
    snapshot = record(snapshot, first.changeId, addLocalDays(failDate, 1), 'done').snapshot;
    snapshot = record(snapshot, first.changeId, addLocalDays(failDate, 2), 'done').snapshot;
    expect(snapshot.settings.expansionCredit).toBe(1);
    snapshot = startOneChange(snapshot, second.changeId, { date: addLocalDays(failDate, 3) });
    snapshot = record(snapshot, second.changeId, addLocalDays(failDate, 3), 'done').snapshot;
    expect(snapshot.changes.find(item => item.id === second.changeId)).toMatchObject({ status: 'active', totalSuccessDays: frozenTotal + 1 });
    expect(snapshot.settings.expansionCredit).toBe(0);
  });

  it('结束唯一正式改变后释放基础名额，新任务不消耗不存在的资格', () => {
    let snapshot = createEmptyOneChangeSnapshot();
    expect(canStartOneChange(snapshot)).toBe(true);
    snapshot = create(snapshot, 'A', true).snapshot;
    expect(canStartOneChange(snapshot)).toBe(false);
    snapshot = archiveOneChange(snapshot, snapshot.changes[0].id, { date: DAY, now: Date.parse(`${DAY}T21:00:00`) });
    expect(canStartOneChange(snapshot)).toBe(true);
    const replacement = create(snapshot, 'B'); snapshot = replacement.snapshot;
    snapshot = startOneChange(snapshot, replacement.changeId, { date: addLocalDays(DAY, 1) });
    expect(snapshot.changes.find(item => item.id === replacement.changeId)?.status).toBe('active');
    expect(snapshot.settings.expansionCredit).toBe(0);
    expect(snapshot.stateEvents.filter(item => item.type === 'expansion_credit_used')).toHaveLength(0);
    expect(canStartOneChange(snapshot)).toBe(false);
    snapshot = archiveOneChange(snapshot, replacement.changeId, { date: addLocalDays(DAY, 1) });
    snapshot = create(snapshot, 'C', true, addLocalDays(DAY, 2)).snapshot;
    expect(snapshot.changes.find(item => item.name === 'C')?.status).toBe('active');
    expect(snapshot.stateEvents.filter(item => item.type === 'expansion_credit_used')).toHaveLength(0);
  });

  it('收缩后结束保留项时，也可直接恢复剩余冻结项', () => {
    let { snapshot, a, b, date } = twoActive(2);
    snapshot = record(snapshot, a, date, 'done').snapshot;
    snapshot = record(snapshot, b, date, 'not_done').snapshot;
    snapshot = resolveOneChangeContraction(snapshot, a, { date });
    snapshot = archiveOneChange(snapshot, a, { date: addLocalDays(date, 1) });
    const usedCredits = snapshot.stateEvents.filter(item => item.type === 'expansion_credit_used').length;
    expect(canStartOneChange(snapshot)).toBe(true);
    snapshot = startOneChange(snapshot, b, { date: addLocalDays(date, 1) });
    expect(snapshot.changes.find(item => item.id === b)?.status).toBe('active');
    expect(snapshot.stateEvents.filter(item => item.type === 'expansion_credit_used')).toHaveLength(usedCredits);
  });
});
