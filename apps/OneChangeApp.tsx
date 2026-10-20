import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CalendarBlank,
  CaretDown,
  CaretLeft,
  CaretRight,
  Check,
  GearSix,
  House,
  ListBullets,
  PencilSimple,
  Plus,
  Target,
  Trash,
} from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { useLocalDateKey } from '../hooks/useLocalDateKey';
import type { OneChangeItem, OneChangeResult } from '../types';
import { getLocalDateKey, parseLocalDateKey } from '../utils/localDate';
import {
  OneChangeRuleError,
  archiveOneChange,
  canStartOneChange,
  createOneChange,
  deleteOneChangeDraft,
  editOneChange,
  getOneChangeFormalParticipantIds,
  getOneChangeStandard,
  listOneChangeMissingDates,
  moveOneChangeDraft,
  resolveOneChangeContraction,
  setOneChangeDefaultDays,
  startOneChange,
  submitOneChangeRecord,
  updateOneChangeFeeling,
  type OneChangeDraftInput,
  type OneChangeSnapshot,
} from '../utils/oneChange/engine';
import { loadOneChangeSnapshot, mutateOneChange } from '../utils/oneChange/repository';

type Tab = 'today' | 'library' | 'calendar' | 'settings';
type Page = 'tabs' | 'checkin' | 'detail' | 'form' | 'stable';

const BG = 'bg-[#f5f5ef]';
const TEXT = 'text-[#2e2b26]';
const MUTED = 'text-[#6e685e]';
const FAINT = 'text-[#a8a096]';
const BORDER = 'border-[#e6e0d9]';
const GREEN = 'text-[#54715c]';
const GREEN_BG = 'bg-[#6e8c73]';
const CARD = `rounded-[16px] border ${BORDER} bg-white`;
const button = `h-[52px] w-full rounded-[14px] ${GREEN_BG} text-[16px] font-semibold text-white active:scale-[0.98] disabled:opacity-40`;

const statusText: Record<OneChangeItem['status'], string> = {
  draft: '草稿', active: '进行中', frozen: '冻结中', archived: '已结束',
};

const formatDate = (key: string, withYear = false) => {
  const date = parseLocalDateKey(key);
  if (!date) return key;
  const weekday = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'][date.getDay()];
  return `${withYear ? `${date.getFullYear()}年` : ''}${date.getMonth() + 1}月${date.getDate()}日 ${weekday}`;
};

const makeForm = (snapshot: OneChangeSnapshot, change?: OneChangeItem, preset?: Partial<OneChangeDraftInput>) => ({
  name: change?.name || preset?.name || '',
  standard: change?.standard || preset?.standard || '',
  description: change?.description || preset?.description || '',
  stabilityTargetDays: change?.stabilityTargetDays || preset?.stabilityTargetDays || snapshot.settings.defaultStabilityDays,
  useDefault: !change && !preset?.stabilityTargetDays,
});

const OneChangeApp: React.FC = () => {
  const { closeApp, registerBackHandler, addToast } = useOS();
  const today = useLocalDateKey();
  const [snapshot, setSnapshot] = useState<OneChangeSnapshot>();
  const [tab, setTab] = useState<Tab>('today');
  const [page, setPage] = useState<Page>('tabs');
  const [selectedId, setSelectedId] = useState<string>();
  const [recordDate, setRecordDate] = useState(today);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<ReturnType<typeof makeForm>>();
  const [formEditingId, setFormEditingId] = useState<string>();
  const [result, setResult] = useState<OneChangeResult>();
  const [feeling, setFeeling] = useState('');
  const [descriptionOpen, setDescriptionOpen] = useState(false);
  const [frozenOpen, setFrozenOpen] = useState(false);
  const [archiveTarget, setArchiveTarget] = useState<string>();
  const [contractionChoice, setContractionChoice] = useState<string>();
  const [showContraction, setShowContraction] = useState(true);
  const [stableNotice, setStableNotice] = useState<{ changeId: string; focus: boolean }>();
  const [monthKey, setMonthKey] = useState(today.slice(0, 7));
  const [calendarDate, setCalendarDate] = useState(today);
  const [settingsDays, setSettingsDays] = useState(30);

  const reload = useCallback(async () => {
    const next = await loadOneChangeSnapshot();
    setSnapshot(next);
    setSettingsDays(next.settings.defaultStabilityDays);
  }, []);

  useEffect(() => { void reload().catch(() => addToast('改变资料读取失败', 'error')); }, [reload]);

  const selected = snapshot?.changes.find(change => change.id === selectedId);
  const goBack = useCallback(() => {
    if (archiveTarget) { setArchiveTarget(undefined); return true; }
    if (page !== 'tabs') { setPage('tabs'); setStableNotice(undefined); return true; }
    closeApp();
    return true;
  }, [archiveTarget, closeApp, page]);
  useEffect(() => registerBackHandler(goBack), [goBack, registerBackHandler]);

  const mutate = useCallback(async <T,>(run: (current: OneChangeSnapshot) => { snapshot: OneChangeSnapshot; result: T }) => {
    setBusy(true);
    try {
      const next = await mutateOneChange(run);
      setSnapshot(next.snapshot);
      setSettingsDays(next.snapshot.settings.defaultStabilityDays);
      return next.result;
    } catch (error) {
      addToast(error instanceof OneChangeRuleError ? error.message : '保存失败，请重试', 'error');
      return undefined;
    } finally {
      setBusy(false);
    }
  }, [addToast]);

  const openForm = (change?: OneChangeItem, preset?: Partial<OneChangeDraftInput>) => {
    if (!snapshot) return;
    setForm(makeForm(snapshot, change, preset));
    setFormEditingId(change?.id);
    setPage('form');
  };

  const openCheckin = (changeId: string, date = today) => {
    if (!snapshot) return;
    const existing = snapshot.records.find(record => record.changeId === changeId && record.date === date);
    setSelectedId(changeId);
    setRecordDate(date);
    setResult(existing?.result);
    setFeeling(existing?.feeling || '');
    setDescriptionOpen(false);
    setPage('checkin');
  };

  const openDetail = (changeId: string) => {
    setSelectedId(changeId);
    setDescriptionOpen(false);
    setPage('detail');
  };

  if (!snapshot) return <div className={`h-full w-full ${BG} ${TEXT} flex items-center justify-center`}>正在整理改变…</div>;

  const active = snapshot.changes.filter(change => change.status === 'active').sort((a, b) => a.sortOrder - b.sortOrder);
  const frozen = snapshot.changes.filter(change => change.status === 'frozen').sort((a, b) => a.sortOrder - b.sortOrder);
  const missing = listOneChangeMissingDates(snapshot, today).filter(item => item.date < today);
  const hasEverStarted = snapshot.changes.some(change => change.status !== 'draft');

  const saveForm = async (start: boolean) => {
    if (!form) return;
    const input: OneChangeDraftInput = {
      name: form.name,
      standard: form.standard,
      description: form.description,
      stabilityTargetDays: form.useDefault ? snapshot.settings.defaultStabilityDays : form.stabilityTargetDays,
    };
    if (formEditingId) {
      const ok = await mutate(current => ({ snapshot: editOneChange(current, formEditingId, input, { date: today }), result: true }));
      if (ok) setPage('detail');
      return;
    }
    const created = await mutate(current => {
      const next = createOneChange(current, input, { start, date: today });
      return { snapshot: next.snapshot, result: next.changeId };
    });
    if (created) { setSelectedId(created); setPage('tabs'); setTab('today'); }
  };

  const saveRecord = async () => {
    if (!selected || !result) { addToast('请选择“做了”或“没做”', 'error'); return; }
    const existing = snapshot.records.find(record => record.changeId === selected.id && record.date === recordDate);
    if (existing) {
      const ok = await mutate(current => ({
        snapshot: updateOneChangeFeeling(current, selected.id, recordDate, feeling), result: true,
      }));
      if (ok) {
        addToast('感受已保存', 'success');
        setPage('tabs');
        setTab(recordDate === today ? 'today' : 'calendar');
      }
      return;
    }
    const outcome = await mutate(current => {
      const next = submitOneChangeRecord(current, { changeId: selected.id, date: recordDate, result, feeling }, { currentDate: today });
      return { snapshot: next.snapshot, result: next };
    });
    if (!outcome) return;
    if (outcome.stableReached || outcome.focusCompleted) {
      setStableNotice({ changeId: selected.id, focus: outcome.focusCompleted });
      setPage('stable');
    } else {
      setPage('tabs');
      setTab('today');
    }
    if (outcome.pendingContraction) setShowContraction(true);
  };

  const root = `relative flex h-full w-full flex-col overflow-hidden ${BG} ${TEXT} pt-[var(--chrome-top)]`;
  const header = (title: string, action?: React.ReactNode) => (
    <div className="flex h-14 shrink-0 items-center justify-between px-4">
      <button type="button" onClick={goBack} className="grid h-10 w-10 place-items-center rounded-full active:bg-black/5"><ArrowLeft size={22} /></button>
      <div className="text-[17px] font-semibold">{title}</div>
      <div className="flex h-10 min-w-10 items-center justify-end">{action}</div>
    </div>
  );

  const cardStats = (change: OneChangeItem) => (
    <>
      <div className="flex items-end justify-between gap-3">
        <div><span className="text-[24px] font-bold">{change.totalSuccessDays}</span><span className={`ml-1 text-[12px] ${MUTED}`}>累计完成</span></div>
        <div className={`text-[13px] ${GREEN}`}>{change.currentStable ? '当前稳定' : `${change.everStable ? '重新稳定' : '当前稳定'} ${change.currentStreak}/${change.stabilityTargetDays}`}</div>
      </div>
      <progress className="h-1 w-full overflow-hidden rounded-full accent-[#6e8c73]" max={change.stabilityTargetDays} value={change.currentStreak} />
    </>
  );

  const ChangeCard = ({ change, frozenMode = false }: { change: OneChangeItem; frozenMode?: boolean }) => {
    const todayRecord = snapshot.records.find(record => record.changeId === change.id && record.date === today);
    const standard = getOneChangeStandard(snapshot, change.id, today)?.standard || change.standard;
    return (
      <div className={`${CARD} space-y-3 p-4`}>
        <button type="button" onClick={() => openDetail(change.id)} className="flex w-full items-center justify-between text-left">
          <span className="text-[18px] font-semibold">{change.name}</span>
          <span className={`rounded-[10px] px-2.5 py-1 text-[11px] ${frozenMode ? 'bg-[#eef0f2] text-[#68727f]' : 'bg-[#ebf0eb] text-[#54715c]'}`}>{statusText[change.status]}</span>
        </button>
        <div className={`text-[13px] ${MUTED}`}>当前标准 · {standard}</div>
        {cardStats(change)}
        <button type="button" onClick={() => openCheckin(change.id)} className={`h-9 rounded-[10px] px-4 text-[13px] font-medium ${todayRecord ? 'bg-transparent text-[#54715c]' : 'border border-[#6e8c73] text-[#54715c]'}`}>
          {todayRecord ? `今天 · ${todayRecord.result === 'done' ? '做了' : '没做'}` : frozenMode ? '记录今天的观察' : '记录今天'}
        </button>
      </div>
    );
  };

  const BottomTabs = () => {
    const items: Array<{ id: Tab; label: string; icon: typeof House }> = [
      { id: 'today', label: '今日', icon: House }, { id: 'library', label: '改变库', icon: ListBullets },
      { id: 'calendar', label: '日历', icon: CalendarBlank }, { id: 'settings', label: '设置', icon: GearSix },
    ];
    return (
      <div className="shrink-0 px-[21px] pb-[calc(var(--safe-bottom)+12px)] pt-3">
        <div className={`flex h-[62px] rounded-full border ${BORDER} bg-white p-1`}>
          {items.map(item => {
            const Icon = item.icon;
            return <button key={item.id} type="button" onClick={() => setTab(item.id)} className={`flex flex-1 flex-col items-center justify-center gap-0.5 rounded-[26px] text-[10px] ${tab === item.id ? 'bg-[#ebf0eb] text-[#54715c]' : FAINT}`}><Icon size={21} weight={tab === item.id ? 'fill' : 'regular'} />{item.label}</button>;
          })}
        </div>
      </div>
    );
  };

  const Onboarding = () => (
    <div className="flex flex-1 flex-col overflow-y-auto px-7 pb-[calc(var(--safe-bottom)+28px)] pt-10 text-center">
      <div className="mx-auto grid h-24 w-24 place-items-center rounded-full bg-[#ebf0eb]"><Target size={38} className={GREEN} /></div>
      <h1 className="mt-6 text-[28px] font-bold">只做一个改变</h1>
      <p className={`mt-3 text-[15px] leading-6 ${MUTED}`}>一次只新增一个改变。做了就记做了，没做就记没做。</p>
      <div className={`${CARD} mt-8 p-4`}><div className="font-semibold">现在只选一个改变。</div><div className={`mt-1 text-[13px] ${FAINT}`}>准备好了，就从一个开始。</div></div>
      <button type="button" onClick={() => openForm()} className={`${button} mt-6`}>创建我的第一个改变</button>
      <button type="button" onClick={() => openForm(undefined, { name: '锻炼', standard: '每天运动 30 分钟' })} className={`${CARD} mt-6 flex items-center justify-between p-4 text-left`}><span><b>锻炼</b><span className={`mt-1 block text-[13px] ${FAINT}`}>标准示例 · 每天运动 30 分钟</span></span><CaretRight /></button>
      <button type="button" onClick={() => openForm(undefined, { name: '每日随机行善', standard: '' })} className={`${CARD} mt-3 flex items-center justify-between p-4 text-left`}><span><b>每日随机行善</b><span className={`mt-1 block text-[13px] ${FAINT}`}>标准由你填写</span></span><CaretRight /></button>
      <div className={`mt-4 text-[12px] ${FAINT}`}>预制只是帮你快速开始，不是固定规则。</div>
    </div>
  );

  const TodayView = () => (
    <div className="flex-1 overflow-y-auto px-5 pb-5 pt-5">
      <div className="mb-6"><h1 className="text-[24px] font-bold">只做一个改变</h1><div className={`mt-1 text-[13px] ${FAINT}`}>{formatDate(today)}</div></div>
      <div className={`mb-3 text-center text-[13px] font-semibold ${MUTED}`}>今日</div>
      <div className="space-y-3">{active.length ? active.map(change => <ChangeCard key={change.id} change={change} />) : <div className={`${CARD} p-5 text-center ${MUTED}`}>现在没有正在进行的改变。<button type="button" onClick={() => { setTab('library'); }} className={`mt-3 block w-full ${GREEN}`}>去改变库看看</button></div>}</div>
      {!!frozen.length && <div className="mt-4"><button type="button" onClick={() => setFrozenOpen(value => !value)} className={`${CARD} flex w-full items-center justify-between px-4 py-3.5 text-[15px]`}><span>冻结中的改变 · {frozen.length}</span><CaretDown className={frozenOpen ? 'rotate-180' : ''} /></button>{frozenOpen && <div className="mt-3 space-y-3">{frozen.map(change => <ChangeCard key={change.id} change={change} frozenMode />)}</div>}</div>}
      {!!missing.length && <button type="button" onClick={() => { setCalendarDate(missing[0].date); setMonthKey(missing[0].date.slice(0, 7)); setTab('calendar'); }} className="mt-4 flex w-full items-center justify-between rounded-[10px] bg-[#f3efe5] px-4 py-3 text-[14px]"><span>有 {missing.length} 项历史记录尚未填写</span><CaretRight /></button>}
    </div>
  );

  const LibraryView = () => {
    const groups: Array<{ status: OneChangeItem['status']; title: string }> = [
      { status: 'active', title: '正在进行' }, { status: 'frozen', title: '冻结' }, { status: 'draft', title: '草稿' }, { status: 'archived', title: '已结束' },
    ];
    return <div className="flex-1 overflow-y-auto px-5 pb-5 pt-5"><div className="mb-5 flex items-center justify-between"><h1 className="text-[22px] font-bold">改变库</h1><button type="button" onClick={() => openForm()} className="grid h-10 w-10 place-items-center rounded-full bg-[#ebf0eb] text-[#54715c]"><Plus /></button></div>{snapshot.settings.expansionCredit === 1 && <div className="mb-5 rounded-[14px] bg-[#ebf0eb] p-4 text-[14px] text-[#54715c]">可以增加一个改变</div>}{groups.map(group => { const list = snapshot.changes.filter(change => change.status === group.status).sort((a, b) => a.sortOrder - b.sortOrder); return <section key={group.status} className="mb-6"><div className={`mb-2 text-[13px] font-semibold ${MUTED}`}>{group.title} · {list.length}</div><div className="space-y-2">{list.map(change => <div key={change.id} className={`${CARD} p-4`}><button type="button" onClick={() => openDetail(change.id)} className="w-full text-left"><div className="font-semibold">{change.name}</div><div className={`mt-1 line-clamp-2 text-[13px] ${FAINT}`}>{getOneChangeStandard(snapshot, change.id, today)?.standard || change.standard}</div></button><div className="mt-3 flex flex-wrap items-center gap-2">{change.status === 'draft' && <><button type="button" disabled={!canStartOneChange(snapshot)} onClick={() => void mutate(current => ({ snapshot: startOneChange(current, change.id, { date: today }), result: true }))} className="rounded-[10px] bg-[#ebf0eb] px-3 py-2 text-[12px] text-[#54715c] disabled:opacity-35">开始</button><button type="button" onClick={() => openForm(change)} className="rounded-[10px] bg-[#efede8] px-3 py-2 text-[12px]">编辑</button><button type="button" onClick={() => { if (window.confirm('删除这个草稿？')) void mutate(current => ({ snapshot: deleteOneChangeDraft(current, change.id), result: true })); }} className="rounded-[10px] bg-[#efede8] px-3 py-2 text-[12px]"><Trash size={14} /></button><button type="button" onClick={() => void mutate(current => ({ snapshot: moveOneChangeDraft(current, change.id, -1), result: true }))} className="rounded-[10px] bg-[#efede8] p-2"><ArrowUp size={14} /></button><button type="button" onClick={() => void mutate(current => ({ snapshot: moveOneChangeDraft(current, change.id, 1), result: true }))} className="rounded-[10px] bg-[#efede8] p-2"><ArrowDown size={14} /></button></>}{change.status === 'frozen' && canStartOneChange(snapshot) && <button type="button" onClick={() => void mutate(current => ({ snapshot: startOneChange(current, change.id, { date: today }), result: true }))} className="rounded-[10px] bg-[#ebf0eb] px-3 py-2 text-[12px] text-[#54715c]">恢复</button>}</div></div>)}</div></section>; })}</div>;
  };

  const CalendarView = () => {
    const [year, month] = monthKey.split('-').map(Number);
    const first = new Date(year, month - 1, 1);
    const days = new Date(year, month, 0).getDate();
    const cells = Array.from({ length: first.getDay() + days }, (_, index) => index < first.getDay() ? null : `${monthKey}-${String(index - first.getDay() + 1).padStart(2, '0')}`);
    const relevantIds = new Set([
      ...snapshot.records.filter(record => record.date === calendarDate).map(record => record.changeId),
      ...getOneChangeFormalParticipantIds(snapshot, calendarDate),
    ]);
    const rows = [...relevantIds].map(changeId => ({ change: snapshot.changes.find(item => item.id === changeId), record: snapshot.records.find(item => item.changeId === changeId && item.date === calendarDate) })).filter(row => row.change);
    const moveMonth = (amount: number) => { const next = new Date(year, month - 1 + amount, 1); setMonthKey(getLocalDateKey(next).slice(0, 7)); };
    return <div className="flex-1 overflow-y-auto px-5 pb-5 pt-5"><h1 className="mb-5 text-[22px] font-bold">日历</h1><div className={`${CARD} p-4`}><div className="mb-4 flex items-center justify-between"><button type="button" onClick={() => moveMonth(-1)}><CaretLeft /></button><b>{year} 年 {month} 月</b><button type="button" onClick={() => moveMonth(1)}><CaretRight /></button></div><div className={`grid grid-cols-7 gap-1 text-center text-[11px] ${FAINT}`}>{['日','一','二','三','四','五','六'].map(day => <div key={day}>{day}</div>)}{cells.map((date, index) => { const count = date ? snapshot.records.filter(record => record.date === date).length : 0; return <button key={`${date}-${index}`} type="button" disabled={!date || date > today} onClick={() => date && setCalendarDate(date)} className={`relative aspect-square rounded-full text-[13px] ${date === calendarDate ? 'bg-[#6e8c73] text-white' : date === today ? 'bg-[#ebf0eb] text-[#54715c]' : ''}`}>{date ? Number(date.slice(-2)) : ''}{count > 0 && <span className={`absolute bottom-1 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full ${date === calendarDate ? 'bg-white' : 'bg-[#6e8c73]'}`} />}</button>; })}</div></div><div className={`mb-2 mt-5 text-[13px] font-semibold ${MUTED}`}>{formatDate(calendarDate, true)}</div><div className="space-y-2">{rows.length ? rows.map(({ change, record }) => <button key={change!.id} type="button" onClick={() => openCheckin(change!.id, calendarDate)} className={`${CARD} flex w-full items-center justify-between p-4 text-left`}><span><b>{change!.name}</b>{record?.recordMode === 'frozen' && <span className={`ml-2 text-[11px] ${FAINT}`}>冻结中</span>}<span className={`mt-1 block text-[12px] ${FAINT}`}>{record ? (record.result === 'done' ? '做了' : '没做') : '未记录'}</span></span><CaretRight /></button>) : <div className={`${CARD} p-5 text-center text-[13px] ${FAINT}`}>这一天没有相关改变</div>}</div></div>;
  };

  const SettingsView = () => <div className="flex-1 overflow-y-auto px-5 pb-5 pt-5"><h1 className="mb-6 text-[22px] font-bold">设置</h1><div className={`mb-3 text-center text-[13px] font-semibold ${MUTED}`}>全局默认值</div><div className={`${CARD} p-4`}><label className="flex items-center justify-between gap-4"><span>默认稳定周期</span><span className="flex items-center gap-2"><input type="number" min={1} max={3650} value={settingsDays} onChange={event => setSettingsDays(Number(event.target.value))} className="w-20 rounded-[10px] bg-[#f5f5ef] px-3 py-2 text-right outline-none focus:ring-2 focus:ring-[#6e8c73]" />天</span></label></div><div className={`mt-3 text-[13px] ${FAINT}`}>修改后，仅影响此后新创建的改变。</div><button type="button" disabled={busy || settingsDays === snapshot.settings.defaultStabilityDays} onClick={() => void mutate(current => ({ snapshot: setOneChangeDefaultDays(current, settingsDays), result: true }))} className={`${button} mt-6`}>保存设置</button></div>;

  const TabsPage = () => <div className={root}><div className="flex h-12 shrink-0 items-center px-3"><button type="button" aria-label="返回桌面" onClick={goBack} className="grid h-10 w-10 place-items-center rounded-full active:bg-black/5"><ArrowLeft size={22} /></button></div>{!hasEverStarted && snapshot.changes.length === 0 ? Onboarding() : <>{tab === 'today' && TodayView()}{tab === 'library' && LibraryView()}{tab === 'calendar' && CalendarView()}{tab === 'settings' && SettingsView()}{BottomTabs()}</>}</div>;

  const CheckinPage = () => {
    if (!selected) return TabsPage();
    const existing = snapshot.records.find(record => record.changeId === selected.id && record.date === recordDate);
    const standardVersion = existing ? snapshot.standardVersions.find(version => version.id === existing.standardVersionId) : getOneChangeStandard(snapshot, selected.id, recordDate);
    const frozenMode = existing?.recordMode === 'frozen' || (!existing && selected.status === 'frozen');
    return <div className={root}>{header(selected.name, <button type="button" onClick={() => openForm(selected)} className={`text-[14px] ${MUTED}`}>编辑</button>)}<div className="flex-1 overflow-y-auto px-5 pb-[calc(var(--safe-bottom)+24px)] pt-5"><div className="flex items-center justify-between"><h1 className="text-[26px] font-bold">{selected.name}</h1><span className={`rounded-[10px] px-2.5 py-1.5 text-[12px] ${frozenMode ? 'bg-[#eef0f2] text-[#68727f]' : 'bg-[#ebf0eb] text-[#54715c]'}`}>{frozenMode ? '冻结中' : recordDate === today ? '正式推进' : formatDate(recordDate)}</span></div><div className={`mt-5 text-[15px] ${MUTED}`}>当天标准 · {standardVersion?.standard}</div>{selected.description && <><button type="button" onClick={() => setDescriptionOpen(value => !value)} className={`mt-4 flex items-center gap-1 text-[14px] ${GREEN}`}>{descriptionOpen ? '收起简介' : '查看简介'}<CaretDown className={descriptionOpen ? 'rotate-180' : ''} /></button>{descriptionOpen && <div className={`${CARD} mt-2 whitespace-pre-wrap p-4 text-[14px] leading-6 ${MUTED}`}>{selected.description}</div>}</>}{frozenMode && <div className="mt-5 rounded-[12px] bg-[#eef0f2] p-4 text-[13px] leading-5 text-[#68727f]">冻结中。今天的记录只作为观察，不会改变正式进度。</div>}<div className={`my-5 h-px bg-[#e6e0d9]`} /><div className={`mb-3 text-[13px] font-semibold ${MUTED}`}>{recordDate === today ? '今天' : formatDate(recordDate, true)}</div><div className="grid grid-cols-2 gap-3"><button type="button" disabled={!!existing} onClick={() => setResult('done')} className={`h-[120px] rounded-[16px] text-[18px] font-semibold ${result === 'done' ? 'bg-[#dfe9e0] text-[#54715c] ring-2 ring-[#6e8c73]' : 'bg-[#ebf0eb] text-[#54715c]'} disabled:opacity-80`}><Check size={28} className="mx-auto mb-2" />做了</button><button type="button" disabled={!!existing} onClick={() => setResult('not_done')} className={`h-[120px] rounded-[16px] text-[18px] font-semibold ${result === 'not_done' ? 'bg-[#e7e3db] text-[#6e685e] ring-2 ring-[#928a7d]' : 'bg-[#efede8] text-[#6e685e]'} disabled:opacity-80`}>没做<div className="mt-2 text-[11px] font-normal">只是事实记录</div></button></div><label className={`mt-6 block text-[13px] font-semibold ${MUTED}`}>感受<textarea value={feeling} onChange={event => setFeeling(event.target.value)} placeholder="今天有什么感觉？可以不写。" className={`${CARD} mt-2 h-[140px] w-full resize-none p-4 text-[15px] font-normal outline-none focus:ring-2 focus:ring-[#6e8c73]`} /></label>{!existing && <div className={`mt-3 text-[12px] ${FAINT}`}>完成情况保存后不能修改。感受以后仍可补充或编辑。</div>}<button type="button" disabled={busy || (!existing && !result)} onClick={() => void saveRecord()} className={`${button} mt-5`}>{existing ? '保存感受' : recordDate === today ? '保存今天' : '保存补记'}</button></div></div>;
  };

  const DetailPage = () => {
    if (!selected) return TabsPage();
    const standard = getOneChangeStandard(snapshot, selected.id, today)?.standard || selected.standard;
    const versions = snapshot.standardVersions.filter(item => item.changeId === selected.id).sort((a, b) => b.effectiveDate.localeCompare(a.effectiveDate));
    const recent = snapshot.records.filter(item => item.changeId === selected.id).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 8);
    const focus = snapshot.settings.focusObservation?.changeId === selected.id ? snapshot.settings.focusObservation : undefined;
    const resolving = snapshot.settings.pendingContraction?.participantIds.includes(selected.id);
    return <div className={root}>{header('改变详情')}<div className="flex-1 overflow-y-auto px-5 pb-[calc(var(--safe-bottom)+24px)]"><div className="flex items-center justify-between"><h1 className="text-[26px] font-bold">{selected.name}</h1><span className="rounded-[10px] bg-[#ebf0eb] px-2.5 py-1.5 text-[12px] text-[#54715c]">{statusText[selected.status]}</span></div><div className={`mt-4 text-[14px] ${MUTED}`}>当前标准 · {standard}</div><div className={`${CARD} mt-5 space-y-3 p-4`}>{cardStats(selected)}{focus && <div className="rounded-[10px] bg-[#f3efe5] px-3 py-2 text-[13px]">本轮单任务观察 {focus.streak}/{focus.targetDays}</div>}<div className={`text-[13px] ${FAINT}`}>稳定周期 · {selected.stabilityTargetDays} 天</div></div>{selected.description && <div className={`${CARD} mt-4 p-4`}><button type="button" onClick={() => setDescriptionOpen(value => !value)} className="flex w-full items-center justify-between font-semibold"><span>简介</span><CaretDown className={descriptionOpen ? 'rotate-180' : ''} /></button>{descriptionOpen && <div className={`mt-3 whitespace-pre-wrap text-[14px] leading-6 ${MUTED}`}>{selected.description}</div>}</div>}<section className="mt-6"><div className={`mb-2 text-[13px] font-semibold ${MUTED}`}>标准历史</div><div className={`${CARD} divide-y divide-[#e6e0d9]`}>{versions.map(version => <div key={version.id} className="p-4"><div className="text-[14px]">{version.standard}</div><div className={`mt-1 text-[11px] ${FAINT}`}>{version.effectiveDate} 起生效</div></div>)}</div></section><section className="mt-6"><div className={`mb-2 text-[13px] font-semibold ${MUTED}`}>最近记录</div><div className={`${CARD} divide-y divide-[#e6e0d9]`}>{recent.length ? recent.map(record => <button key={record.id} type="button" onClick={() => openCheckin(selected.id, record.date)} className="flex w-full items-center justify-between p-4 text-left"><span>{record.date}<span className={`ml-2 text-[12px] ${FAINT}`}>{record.recordMode === 'frozen' ? '冻结观察' : ''}</span></span><span className={GREEN}>{record.result === 'done' ? '做了' : '没做'}</span></button>) : <div className={`p-4 text-[13px] ${FAINT}`}>还没有记录</div>}</div></section><div className="mt-6 grid gap-3">{selected.status === 'frozen' && canStartOneChange(snapshot) && <button type="button" onClick={() => void mutate(current => ({ snapshot: startOneChange(current, selected.id, { date: today }), result: true }))} className={button}>恢复这个改变</button>}<button type="button" onClick={() => openForm(selected)} className="h-[48px] rounded-[14px] bg-[#efede8] font-medium"><PencilSimple className="mr-2 inline" />编辑改变</button>{selected.status !== 'draft' && selected.status !== 'archived' && !resolving && <button type="button" onClick={() => setArchiveTarget(selected.id)} className={`h-[48px] rounded-[14px] border ${BORDER} ${MUTED}`}><Archive className="mr-2 inline" />结束这个改变</button>}</div></div></div>;
  };

  const FormPage = () => {
    if (!form) return TabsPage();
    const editing = snapshot.changes.find(change => change.id === formEditingId);
    const official = editing && editing.status !== 'draft';
    return <div className={root}>{header(editing ? '编辑改变' : '新建改变')}<div className="flex-1 overflow-y-auto px-5 pb-[calc(var(--safe-bottom)+24px)]"><label className={`block text-[13px] font-semibold ${MUTED}`}>名称<input value={form.name} onChange={event => setForm({ ...form, name: event.target.value })} placeholder="例如：锻炼" className={`${CARD} mt-2 h-12 w-full px-4 text-[15px] font-normal outline-none focus:ring-2 focus:ring-[#6e8c73]`} /></label><label className={`mt-5 block text-[13px] font-semibold ${MUTED}`}>当前标准<textarea value={form.standard} onChange={event => setForm({ ...form, standard: event.target.value })} placeholder="例如：每天至少运动 30 分钟" className={`${CARD} mt-2 h-24 w-full resize-none p-4 text-[15px] font-normal outline-none focus:ring-2 focus:ring-[#6e8c73]`} /></label>{official && <div className={`mt-2 text-[12px] ${FAINT}`}>新标准将从明天开始生效。</div>}<label className={`mt-5 block text-[13px] font-semibold ${MUTED}`}>简介<textarea value={form.description} onChange={event => setForm({ ...form, description: event.target.value })} placeholder="为什么想做、有什么好处、怎样降低难度……" className={`${CARD} mt-2 h-32 w-full resize-none p-4 text-[15px] font-normal outline-none focus:ring-2 focus:ring-[#6e8c73]`} /></label><div className={`mt-5 text-[13px] font-semibold ${MUTED}`}>稳定周期</div>{official ? <div className={`${CARD} mt-2 p-4`}>{editing.stabilityTargetDays} 天<span className={`ml-2 text-[12px] ${FAINT}`}>正式开始后保持原实验周期</span></div> : <div className={`${CARD} mt-2 space-y-3 p-4`}><label className="flex items-center gap-3"><input type="radio" checked={form.useDefault} onChange={() => setForm({ ...form, useDefault: true, stabilityTargetDays: snapshot.settings.defaultStabilityDays })} />使用当前全局默认 {snapshot.settings.defaultStabilityDays} 天</label><label className="flex items-center gap-3"><input type="radio" checked={!form.useDefault} onChange={() => setForm({ ...form, useDefault: false })} />自定义<input type="number" min={1} max={3650} disabled={form.useDefault} value={form.stabilityTargetDays} onChange={event => setForm({ ...form, stabilityTargetDays: Number(event.target.value) })} className="w-20 rounded-lg bg-[#f5f5ef] px-2 py-1.5 text-right outline-none" />天</label></div>}<div className="mt-7 grid gap-3">{editing ? <button type="button" disabled={busy} onClick={() => void saveForm(false)} className={button}>保存改变</button> : <>{canStartOneChange(snapshot) && <button type="button" disabled={busy} onClick={() => void saveForm(true)} className={button}>现在开始这个改变</button>}<button type="button" disabled={busy} onClick={() => void saveForm(false)} className="h-[50px] rounded-[14px] bg-[#efede8] font-medium">保存为草稿</button></>}</div></div></div>;
  };

  const StablePage = () => {
    const noticeChange = snapshot.changes.find(change => change.id === stableNotice?.changeId);
    if (!noticeChange) return TabsPage();
    return <div className={root}>{header(noticeChange.name)}<div className="flex flex-1 flex-col items-center px-7 pb-[calc(var(--safe-bottom)+24px)] pt-16 text-center"><div className="grid h-24 w-24 place-items-center rounded-full bg-[#ebf0eb]"><Check size={38} className={GREEN} /></div><h1 className={`mt-6 text-[24px] font-bold ${GREEN}`}>{stableNotice?.focus ? '这一轮观察已经完成。' : '已稳定'}</h1><p className={`mt-5 whitespace-pre-line text-[15px] leading-6 ${MUTED}`}>{stableNotice?.focus ? `你已经连续完成 ${noticeChange.stabilityTargetDays} 天单任务观察。\n现在可以增加一个新改变。` : `你已经连续 ${noticeChange.stabilityTargetDays} 天完成这个改变。\n现在可以增加一个新改变。`}</p><button type="button" onClick={() => { setPage('tabs'); setTab('library'); setStableNotice(undefined); }} className={`${button} mt-8`}>去看看</button><button type="button" onClick={() => { setPage('tabs'); setTab('today'); setStableNotice(undefined); }} className={`mt-5 text-[15px] ${FAINT}`}>以后再说</button></div></div>;
  };

  const contraction = snapshot.settings.pendingContraction;
  const ContractionSheet = () => contraction && showContraction ? <div className="absolute inset-0 z-50 flex items-end bg-[#2e2b26]/25"><div className="w-full rounded-t-[22px] bg-white px-6 pb-[calc(var(--safe-bottom)+24px)] pt-6"><h2 className="text-[18px] font-bold">接下来只保留一个改变</h2><p className={`mt-2 text-[14px] ${MUTED}`}>其他改变会暂时冻结。已经走过的进度都会保留。</p><div className="mt-5 space-y-2">{contraction.participantIds.map(changeId => { const change = snapshot.changes.find(item => item.id === changeId); if (!change) return null; return <button key={changeId} type="button" onClick={() => setContractionChoice(changeId)} className={`flex w-full items-center gap-3 rounded-[14px] border p-4 text-left ${contractionChoice === changeId ? 'border-[#6e8c73] bg-[#ebf0eb]' : BORDER}`}><span className={`h-5 w-5 rounded-full border-2 ${contractionChoice === changeId ? 'border-[#6e8c73] bg-[#6e8c73] ring-4 ring-white' : BORDER}`} /><span><b>{change.name}</b><span className={`mt-1 block text-[12px] ${FAINT}`}>累计完成 {change.totalSuccessDays} 天</span></span></button>; })}</div><button type="button" disabled={!contractionChoice || busy} onClick={async () => { if (!contractionChoice) return; const ok = await mutate(current => ({ snapshot: resolveOneChangeContraction(current, contractionChoice, { date: today }), result: true })); if (ok) { setContractionChoice(undefined); setShowContraction(false); setPage('tabs'); setTab('today'); } }} className={`${button} mt-5`}>确认保留这个改变</button><button type="button" onClick={() => setShowContraction(false)} className={`mt-4 w-full text-[15px] ${FAINT}`}>以后再选择</button></div></div> : null;

  const ArchiveModal = () => archiveTarget ? <div className="absolute inset-0 z-[60] grid place-items-center bg-[#2e2b26]/25 px-9"><div className="w-full rounded-[20px] bg-white p-6"><h2 className="text-[18px] font-bold">结束这个改变？</h2><p className={`mt-3 text-[14px] leading-[22px] ${MUTED}`}>历史记录会完整保留。<br />结束后它将不再参与每日打卡和进度规则。</p><div className="mt-5 grid grid-cols-2 gap-2"><button type="button" onClick={() => setArchiveTarget(undefined)} className="h-12 rounded-[12px] bg-[#efede8]">取消</button><button type="button" disabled={busy} onClick={async () => { const ok = await mutate(current => ({ snapshot: archiveOneChange(current, archiveTarget, { date: today }), result: true })); if (ok) { setArchiveTarget(undefined); setPage('tabs'); setTab('library'); } }} className="h-12 rounded-[12px] bg-[#6e8c73] font-semibold text-white">结束并归档</button></div></div></div> : null;

  let content: React.ReactNode;
  if (page === 'checkin') content = CheckinPage();
  else if (page === 'detail') content = DetailPage();
  else if (page === 'form') content = FormPage();
  else if (page === 'stable') content = StablePage();
  else content = TabsPage();
  return <>{content}{ContractionSheet()}{ArchiveModal()}</>;
};

export default OneChangeApp;
