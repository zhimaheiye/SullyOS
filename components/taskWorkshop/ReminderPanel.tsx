import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOS } from '../../context/OSContext';
import type { LifeReminderRecord, TaskWorkshopUnit } from '../../types';
import { DB } from '../../utils/db';
import {
  executeLifeReminder, LIFE_REMINDERS_UPDATED_EVENT, listLifeReminders,
  nextLifeOccurrence, refreshLifeReminderRemoteStates,
} from '../../utils/lifeReminderRecords';
import type { WorkshopCalendarLaunch } from '../../utils/workshopCalendarLaunch';
import { TASK_WORKSHOP_UPDATED_EVENT } from './TaskWorkshopRuntime';
import ReminderHistory from './ReminderHistory';

const format = (value?: number) => value ? new Date(value).toLocaleString('zh-CN', {
  year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
}) : '—';
const localInput = (value: number) => {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}T${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};
const scheduleText = (record: LifeReminderRecord) => {
  if (record.schedule.type === 'once') return `仅一次 · ${format(record.schedule.at)}`;
  if (record.schedule.type === 'daily') return `每天 ${record.schedule.time || '09:00'}`;
  if (record.schedule.type === 'weekly') return `每周 ${record.schedule.time || '09:00'}`;
  return '旧版提醒（当前公开版不新建这种规则）';
};

interface Props {
  units: TaskWorkshopUnit[];
  calendarLaunch?: WorkshopCalendarLaunch | null;
  initialUnitId?: string;
  onUnitsChanged: () => Promise<void>;
  onSettings: () => void;
}

export const ReminderPanel: React.FC<Props> = ({ units, calendarLaunch, initialUnitId, onUnitsChanged, onSettings }) => {
  const { characters, userProfile, groups, realtimeConfig, apiConfig, updateCharacter, addToast } = useOS();
  const [records, setRecords] = useState<LifeReminderRecord[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [dateTime, setDateTime] = useState(() => localInput(Date.now() + 15 * 60_000));
  const [recurrence, setRecurrence] = useState<'none' | 'daily' | 'weekly'>('none');
  const [linkedUnitId, setLinkedUnitId] = useState(initialUnitId || '');
  const [primaryId, setPrimaryId] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const targetRef = useRef<HTMLElement | null>(null);
  const appliedLaunchRef = useRef('');

  const deps = useMemo(() => ({ characters, userProfile, groups, realtimeConfig, apiConfig, updateCharacter }), [characters, userProfile, groups, realtimeConfig, apiConfig, updateCharacter]);
  const load = useCallback(async () => {
    const [items, settings] = await Promise.all([listLifeReminders(), DB.getMyScheduleSettings()]);
    setRecords(items);
    setPrimaryId(settings.lifeReminderCharId || '');
    setEnabled(settings.lifeRemindersEnabled === true);
  }, []);
  useEffect(() => {
    void load().catch(() => setError('提醒读取失败'));
    const refresh = () => { void load(); };
    window.addEventListener(LIFE_REMINDERS_UPDATED_EVENT, refresh);
    return () => window.removeEventListener(LIFE_REMINDERS_UPDATED_EVENT, refresh);
  }, [load]);
  useEffect(() => { void refreshLifeReminderRemoteStates().then(load).catch(() => undefined); }, [load]);

  const begin = useCallback((record?: LifeReminderRecord) => {
    setEditingId(record?.id || 'new'); setError('');
    setTitle(record?.title || ''); setMessage(record?.message || '');
    setRecurrence(record?.schedule.type === 'daily' || record?.schedule.type === 'weekly' ? record.schedule.type : 'none');
    const next = record ? record.schedule.at || record.scheduledFor || nextLifeOccurrence(record) || record.startAt : undefined;
    setDateTime(localInput(next || Date.now() + 15 * 60_000));
    setLinkedUnitId(record ? units.find(unit => unit.linkedReminderIds?.includes(record.id))?.id || '' : initialUnitId || '');
  }, [initialUnitId, units]);

  useEffect(() => {
    if (!calendarLaunch || appliedLaunchRef.current === calendarLaunch.token) return;
    if (calendarLaunch.kind === 'new') {
      appliedLaunchRef.current = calendarLaunch.token;
      begin(); setDateTime(`${calendarLaunch.date}T09:00`); return;
    }
    if (records.some(item => item.id === calendarLaunch.recordId)) {
      appliedLaunchRef.current = calendarLaunch.token;
      window.setTimeout(() => targetRef.current?.scrollIntoView({ block: 'center' }), 0);
    }
  }, [begin, calendarLaunch, records]);

  const link = async (reminderId: string, unitId: string) => {
    for (const unit of units) {
      const fresh = await DB.getTaskWorkshopRecord(unit.id);
      if (fresh?.kind !== 'unit') continue;
      const previous = fresh.linkedReminderIds || [];
      const next = fresh.id === unitId ? Array.from(new Set([...previous, reminderId])) : previous.filter(id => id !== reminderId);
      if (next.join('\0') !== previous.join('\0')) await DB.saveTaskWorkshopRecord({ ...fresh, linkedReminderIds: next, updatedAt: Date.now() });
    }
    await onUnitsChanged();
    window.dispatchEvent(new Event(TASK_WORKSHOP_UPDATED_EVENT));
  };

  const run = async (action: Parameters<typeof executeLifeReminder>[0]['action'], record?: LifeReminderRecord) => {
    if (busy) return;
    if (action === 'cancel' && !window.confirm(`停止“${record?.title}”？`)) return;
    setBusy(true); setError('');
    try {
      const at = dateTime ? new Date(dateTime).toISOString() : undefined;
      const result = await executeLifeReminder(action === 'create'
        ? { action, title: title.trim(), message: message.trim(), at, recurrence }
        : action === 'edit'
          ? { action, id: record?.id, title: title.trim(), message: message.trim(), at, recurrence }
          : { action, id: record?.id }, deps);
      if (!result.startsWith('已')) throw new Error(result);
      const createdId = action === 'create' ? result.match(/\[(life:[^\]]+)\]/)?.[1] : undefined;
      if (createdId) await link(createdId, linkedUnitId);
      await load(); setEditingId(null); addToast(result.replace(/\s*\[life:[^\]]+\]$/, ''), 'success');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  };

  const renderEditor = (record?: LifeReminderRecord) => <div className="mt-4 space-y-3 rounded-2xl bg-emerald-50 p-4">
    <label className="block text-xs font-bold text-slate-700">标题<input value={title} onChange={event => setTitle(event.target.value)} className="mt-1 h-11 w-full rounded-xl bg-white px-3 text-sm font-normal" /></label>
    <label className="block text-xs font-bold text-slate-700">提醒文案<textarea value={message} onChange={event => setMessage(event.target.value)} rows={2} className="mt-1 w-full rounded-xl bg-white px-3 py-2 text-sm font-normal" /></label>
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-slate-700">日期与时间<input type="datetime-local" value={dateTime} onChange={event => setDateTime(event.target.value)} className="mt-1 h-11 w-full rounded-xl bg-white px-2 text-sm font-normal" /></label><label className="text-xs font-bold text-slate-700">重复<select value={recurrence} onChange={event => setRecurrence(event.target.value as typeof recurrence)} className="mt-1 h-11 w-full rounded-xl bg-white px-2 text-sm font-normal"><option value="none">仅一次</option><option value="daily">每天</option><option value="weekly">每周</option></select></label></div>
    {!record && <label className="block text-xs font-bold text-slate-700">关联任务（可选）<select value={linkedUnitId} onChange={event => setLinkedUnitId(event.target.value)} className="mt-1 h-11 w-full rounded-xl bg-white px-2 text-sm font-normal"><option value="">独立提醒</option>{units.map(unit => <option key={unit.id} value={unit.id}>{unit.title}</option>)}</select></label>}
    {error && <p className="whitespace-pre-wrap text-xs text-rose-700">{error}</p>}
    <div className="flex gap-2"><button disabled={busy || !title.trim() || !message.trim()} onClick={() => void run(record ? 'edit' : 'create', record)} className="min-h-10 rounded-xl bg-emerald-700 px-4 text-xs font-black text-white disabled:opacity-40">{busy ? '正在核对…' : '保存并排程'}</button><button onClick={() => setEditingId(null)} className="min-h-10 rounded-xl px-4 text-xs text-slate-600">取消</button></div>
  </div>;

  return <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-[calc(var(--safe-bottom)+28px)] pt-5">
    <section className="rounded-[24px] bg-emerald-950 p-5 text-white"><h2 className="text-2xl font-black">提醒控制台</h2><p className="mt-2 text-xs leading-5 text-emerald-100">手动创建的提醒会通过你选择的角色排程；提醒清单保存在本机。</p><div className="mt-4 flex gap-2"><button onClick={() => begin()} className="min-h-10 rounded-xl bg-white px-4 text-xs font-black text-emerald-900">＋ 新建提醒</button><button onClick={onSettings} className="min-h-10 rounded-xl border border-white/30 px-4 text-xs font-bold">角色与开关</button></div></section>
    <p className="mt-4 text-xs leading-5 text-slate-600">提醒角色：{characters.find(char => char.id === primaryId)?.name || '未选择'} · {enabled ? '已开启' : '未开启'}</p>
    {error && <p className="mt-3 rounded-xl bg-rose-50 p-3 text-xs text-rose-700">{error}</p>}
    {editingId === 'new' && renderEditor()}
    <div className="mt-6 space-y-3">{records.map(record => {
      const linked = units.find(unit => unit.linkedReminderIds?.includes(record.id));
      const target = calendarLaunch?.kind === 'record' && calendarLaunch.recordId === record.id;
      return <article key={record.id} ref={target ? targetRef : undefined} className={`rounded-2xl bg-white p-4 ring-1 ${target ? 'ring-2 ring-emerald-600' : 'ring-emerald-100'}`}><div className="flex items-start justify-between gap-2"><b className="break-words text-sm text-slate-900">{record.title}</b><span className="rounded-full bg-slate-100 px-2 py-1 text-[10px] text-slate-600">{record.status === 'active' ? '进行中' : record.status === 'paused' ? '已暂停' : record.status === 'cancelled' ? '已取消' : record.status === 'completed' ? '已完成' : '待修复'}</span></div><p className="mt-2 whitespace-pre-wrap text-xs leading-5 text-slate-700">{record.message}</p><div className="mt-3 text-[11px] leading-5 text-slate-500"><p>{scheduleText(record)}</p><p>下次：{format(record.scheduledFor || nextLifeOccurrence(record) || undefined)}</p>{linked && <p>关联任务：{linked.title}</p>}</div><ReminderHistory operationLog={record.operationLog} scheduleError={record.scheduleError} scheduleState={record.scheduleState} /><label className="mt-3 block text-[11px] font-bold text-slate-600">关联任务<select value={linked?.id || ''} onChange={event => void link(record.id, event.target.value)} className="mt-1 h-10 w-full rounded-xl border border-emerald-100 bg-white px-2 text-xs font-normal"><option value="">独立提醒</option>{units.map(unit => <option key={unit.id} value={unit.id}>{unit.title}</option>)}</select></label><div className="mt-3 flex flex-wrap gap-2 text-xs">{record.status !== 'cancelled' && <button disabled={busy} onClick={() => begin(record)} className="rounded-lg bg-emerald-50 px-3 py-2 font-bold text-emerald-800">编辑</button>}{record.status === 'active' && <button disabled={busy} onClick={() => void run('pause', record)} className="rounded-lg bg-slate-100 px-3 py-2">暂停</button>}{(record.status === 'paused' || record.status === 'error') && <button disabled={busy} onClick={() => void run('resume', record)} className="rounded-lg bg-emerald-50 px-3 py-2">恢复</button>}{record.status === 'active' && <button disabled={busy} onClick={() => void run('complete', record)} className="rounded-lg bg-sky-50 px-3 py-2">完成</button>}{record.status !== 'cancelled' && <button disabled={busy} onClick={() => void run('cancel', record)} className="rounded-lg bg-rose-50 px-3 py-2 text-rose-700">停止</button>}</div>{editingId === record.id && renderEditor(record)}</article>;
    })}</div>
    {!records.length && <p className="py-14 text-center text-sm text-slate-500">还没有提醒。</p>}
  </div>;
};
