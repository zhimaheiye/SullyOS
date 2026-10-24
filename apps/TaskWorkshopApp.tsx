import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown, ArrowRight, ArrowUp, Briefcase, CaretDown, CaretLeft, Check, ClipboardText, Clock,
  NotePencil, PaperPlaneTilt, Plus, Robot, Toolbox, Trash, UserCirclePlus, UsersThree, Wrench, X,
} from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { TASK_WORKSHOP_UPDATED_EVENT } from '../components/taskWorkshop/TaskWorkshopRuntime';
import type {
  CharacterProfile, TaskWorkshopEntryKind, TaskWorkshopRecord, TaskWorkshopSettings,
  TaskWorkshopTool, TaskWorkshopUnit, TaskWorkshopUnitStatus, TaskWorkshopVisit,
} from '../types';
import { DB } from '../utils/db';
import {
  createTaskWorkshopId, createTaskWorkshopTool, createTaskWorkshopUnit, DEFAULT_TASK_WORKSHOP_SETTINGS,
  normalizeTaskWorkshopTags, refreshTaskWorkshopToolStatuses,
} from '../utils/taskWorkshop';
import { persistTaskWorkshopShare, persistTaskWorkshopVisit, requestTaskWorkshopVisit } from '../utils/taskWorkshopService';
import { AppID } from '../types';

type View = 'tasks' | 'tools' | 'visitors' | 'unit' | 'tool';
type EditorKind = 'unit' | 'tool' | null;

const STATUS_META: Record<TaskWorkshopUnitStatus, { label: string; color: string }> = {
  inbox: { label: '收件箱', color: 'bg-slate-100 text-slate-600' },
  active: { label: '进行中', color: 'bg-emerald-100 text-emerald-800' },
  blocked: { label: '有阻塞', color: 'bg-amber-100 text-amber-800' },
  done: { label: '已完成', color: 'bg-sky-100 text-sky-700' },
  archived: { label: '已归档', color: 'bg-stone-100 text-stone-500' },
};

const Avatar: React.FC<{ char: CharacterProfile; size?: string }> = ({ char, size = 'h-11 w-11' }) => (
  <div className={`${size} shrink-0 overflow-hidden rounded-full bg-emerald-100 ring-2 ring-white`}>
    {char.avatar ? <img src={char.avatar} alt={char.name} className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center font-black text-emerald-800">{char.name.slice(0, 1)}</div>}
  </div>
);

const Header: React.FC<{ title: string; onBack: () => void; right?: React.ReactNode }> = ({ title, onBack, right }) => (
  <header className="shrink-0 border-b border-emerald-100 bg-[#f8fbf8]" style={{ paddingTop: 'var(--safe-top)' }}>
    <div className="flex h-16 items-center justify-between px-4">
      <button onClick={onBack} className="-ml-2 flex h-11 w-11 items-center justify-center rounded-full text-slate-700 hover:bg-white" aria-label="返回"><CaretLeft size={27} /></button>
      <h1 className="truncate px-3 font-black tracking-[-0.02em] text-slate-900">{title}</h1>
      <div className="flex min-w-11 justify-end">{right}</div>
    </div>
  </header>
);

const Sheet: React.FC<{ title: string; onClose: () => void; children: React.ReactNode }> = ({ title, onClose, children }) => (
  <div className="absolute inset-0 z-50 flex items-end bg-slate-950/30 p-4">
    <div className="max-h-[85%] w-full overflow-y-auto rounded-[26px] bg-white p-5 shadow-2xl">
      <div className="flex items-center justify-between"><h2 className="text-lg font-black text-slate-900">{title}</h2><button onClick={onClose} className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-slate-600"><X size={19} /></button></div>
      {children}
    </div>
  </div>
);

const formatTime = (time?: number) => time ? new Date(time).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '还没有';

const TaskWorkshopApp: React.FC = () => {
  const {
    closeApp, registerBackHandler, characters, userProfile, groups, apiConfig, realtimeConfig,
    addToast, openApp, setActiveCharacterId,
  } = useOS();
  const [view, setView] = useState<View>('tasks');
  const [records, setRecords] = useState<TaskWorkshopRecord[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [editor, setEditor] = useState<EditorKind>(null);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftDescription, setDraftDescription] = useState('');
  const [draftTags, setDraftTags] = useState('');
  const [entryKind, setEntryKind] = useState<TaskWorkshopEntryKind>('note');
  const [entryDraft, setEntryDraft] = useState('');
  const [stepDraft, setStepDraft] = useState('');
  const [visitorCharId, setVisitorCharId] = useState('');
  const [busy, setBusy] = useState(false);
  const [editingVisitId, setEditingVisitId] = useState('');
  const [visitDraft, setVisitDraft] = useState('');
  const [archivedExpanded, setArchivedExpanded] = useState(false);

  const units = useMemo(() => records.filter((item): item is TaskWorkshopUnit => item.kind === 'unit').sort((a, b) => b.updatedAt - a.updatedAt), [records]);
  const activeUnits = useMemo(() => units.filter(unit => unit.status !== 'archived'), [units]);
  const archivedUnits = useMemo(() => units.filter(unit => unit.status === 'archived'), [units]);
  const tools = useMemo(() => records.filter((item): item is TaskWorkshopTool => item.kind === 'tool').sort((a, b) => b.updatedAt - a.updatedAt), [records]);
  const settings = useMemo(() => records.find((item): item is TaskWorkshopSettings => item.kind === 'settings') || DEFAULT_TASK_WORKSHOP_SETTINGS, [records]);
  const selectedUnit = units.find(item => item.id === selectedId) || null;
  const selectedTool = tools.find(item => item.id === selectedId) || null;

  const load = useCallback(async () => {
    const next = await DB.getTaskWorkshopRecords();
    const storedTools = next.filter((item): item is TaskWorkshopTool => item.kind === 'tool');
    const refreshedTools = refreshTaskWorkshopToolStatuses(storedTools);
    const refreshedById = new Map(refreshedTools.map(tool => [tool.id, tool]));
    await Promise.all(refreshedTools.filter((tool, index) => tool !== storedTools[index]).map(tool => DB.saveTaskWorkshopRecord(tool)));
    setRecords(next.map(item => item.kind === 'tool' ? refreshedById.get(item.id) || item : item));
  }, []);

  useEffect(() => {
    void load().catch(() => addToast('任务工坊读取失败', 'error'));
    const onUpdate = () => void load();
    window.addEventListener(TASK_WORKSHOP_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(TASK_WORKSHOP_UPDATED_EVENT, onUpdate);
  }, [addToast, load]);

  useEffect(() => {
    if (!visitorCharId) setVisitorCharId(settings.visitorCharIds[0] || characters[0]?.id || '');
  }, [characters, settings.visitorCharIds, visitorCharId]);

  const goBack = useCallback(() => {
    if (editor) { setEditor(null); return true; }
    if (view === 'unit' || view === 'tool') { setView(view === 'unit' ? 'tasks' : 'tools'); setSelectedId(''); return true; }
    if (view === 'visitors') { setView('tasks'); return true; }
    closeApp(); return true;
  }, [closeApp, editor, view]);
  useEffect(() => registerBackHandler(goBack), [goBack, registerBackHandler]);

  const save = async (record: TaskWorkshopRecord) => { await DB.saveTaskWorkshopRecord(record); await load(); };
  const patchUnit = async (patch: Partial<TaskWorkshopUnit>) => {
    if (!selectedUnit) return;
    const current = await DB.getTaskWorkshopRecord(selectedUnit.id);
    if (!current || current.kind !== 'unit') return;
    await save({ ...current, ...patch, updatedAt: Date.now() });
  };
  const patchTool = async (patch: Partial<TaskWorkshopTool>) => {
    if (!selectedTool) return;
    const current = await DB.getTaskWorkshopRecord(selectedTool.id);
    if (!current || current.kind !== 'tool') return;
    await save({ ...current, ...patch, updatedAt: Date.now() });
  };

  const openCreate = (kind: Exclude<EditorKind, null>) => {
    setDraftTitle(''); setDraftDescription(''); setDraftTags(''); setEditor(kind);
  };
  const createRecord = async () => {
    if (!draftTitle.trim()) { addToast('请先填写名称', 'error'); return; }
    const record = editor === 'unit'
      ? createTaskWorkshopUnit({ title: draftTitle, description: draftDescription, tags: normalizeTaskWorkshopTags(draftTags) })
      : createTaskWorkshopTool({ name: draftTitle, description: draftDescription, tags: normalizeTaskWorkshopTags(draftTags) });
    await save(record); setEditor(null); setSelectedId(record.id); setView(record.kind === 'unit' ? 'unit' : 'tool');
  };

  const removeRecord = async (id: string, label: string, returnView: View) => {
    if (!window.confirm(`删除“${label}”？本机中的这条记录将无法恢复。`)) return;
    await DB.deleteTaskWorkshopRecord(id); setSelectedId(''); setView(returnView); await load(); addToast('已删除', 'success');
  };

  const addEntry = async () => {
    if (!selectedUnit || !entryDraft.trim()) return;
    const now = Date.now();
    await patchUnit({ entries: [...selectedUnit.entries, { id: createTaskWorkshopId('entry'), kind: entryKind, content: entryDraft.trim(), createdAt: now, updatedAt: now }] });
    setEntryDraft('');
  };
  const addStep = async (content = stepDraft, source: 'manual' | 'character' = 'manual', charId?: string) => {
    if (!selectedUnit || !content.trim()) return;
    await patchUnit({ steps: [...selectedUnit.steps, { id: createTaskWorkshopId('step'), content: content.trim(), done: false, source, charId, createdAt: Date.now() }] });
    if (content === stepDraft) setStepDraft('');
  };

  const runVisit = async () => {
    if (!selectedUnit || !visitorCharId) { addToast('请先选择一位角色', 'error'); return; }
    const char = characters.find(item => item.id === visitorCharId);
    if (!char) return;
    setBusy(true);
    try {
      const result = await requestTaskWorkshopVisit({ char, userProfile, groups, apiConfig, realtimeConfig, units, tools, focusUnit: selectedUnit });
      const saved = await persistTaskWorkshopVisit(selectedUnit.id, result.visit);
      if (!saved) throw new Error('任务已被删除');
      await load(); addToast(`${char.name}留下了新的便签`, 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : '来访失败，请重试', 'error');
    } finally { setBusy(false); }
  };

  const shareVisit = async (visit: TaskWorkshopVisit) => {
    if (!selectedUnit) return;
    const char = characters.find(item => item.id === visit.charId);
    if (!char) { addToast('这位角色已经不存在', 'error'); return; }
    try {
      const messageId = await persistTaskWorkshopShare({ char, unit: selectedUnit, visit });
      const visits = selectedUnit.visits.map(item => item.charId === visit.charId ? { ...item, sharedMessageId: messageId } : item);
      await patchUnit({ visits });
      setActiveCharacterId(char.id); openApp(AppID.Chat); addToast('便签已带到主聊天', 'success');
    } catch { addToast('写入聊天失败，请重试', 'error'); }
  };

  const shareTask = async () => {
    if (!selectedUnit || !visitorCharId) { addToast('请先选择要带给哪位角色', 'error'); return; }
    const char = characters.find(item => item.id === visitorCharId);
    if (!char) return;
    const pending = selectedUnit.steps.filter(step => !step.done).slice(0, 3).map(step => step.content);
    const latest = selectedUnit.entries.slice(-3).map(entry => entry.content).join('；');
    const now = Date.now();
    const snapshot: TaskWorkshopVisit = {
      charId: char.id,
      summary: [selectedUnit.description, latest && `最近记录：${latest}`, `当前状态：${STATUS_META[selectedUnit.status].label}`].filter(Boolean).join('\n') || '想和你一起看看这项任务。',
      suggestedSteps: pending,
      nextAction: pending[0] || '',
      createdAt: now, updatedAt: now,
    };
    try {
      await persistTaskWorkshopShare({ char, unit: selectedUnit, visit: snapshot, origin: 'task' });
      setActiveCharacterId(char.id); openApp(AppID.Chat); addToast('任务快照已带到主聊天', 'success');
    } catch { addToast('写入聊天失败，请重试', 'error'); }
  };

  const saveVisitEdit = async () => {
    if (!selectedUnit || !editingVisitId || !visitDraft.trim()) return;
    const now = Date.now();
    await patchUnit({ visits: selectedUnit.visits.map(item => item.charId === editingVisitId ? { ...item, summary: visitDraft.trim(), updatedAt: now, editedAt: now } : item) });
    setEditingVisitId(''); setVisitDraft('');
  };

  const saveSettings = async (patch: Partial<TaskWorkshopSettings>) => {
    const next = { ...settings, ...patch };
    if (next.visitorCharIds.length === 0) next.enabled = false;
    next.nextVisitorIndex = next.visitorCharIds.length ? next.nextVisitorIndex % next.visitorCharIds.length : 0;
    await save(next);
    window.dispatchEvent(new Event(TASK_WORKSHOP_UPDATED_EVENT));
  };

  const toggleVisitor = async (charId: string) => {
    const ids = settings.visitorCharIds.includes(charId) ? settings.visitorCharIds.filter(id => id !== charId) : [...settings.visitorCharIds, charId];
    await saveSettings({ visitorCharIds: ids, nextVisitorIndex: 0 });
  };
  const moveVisitor = async (index: number, delta: number) => {
    const nextIndex = index + delta;
    if (nextIndex < 0 || nextIndex >= settings.visitorCharIds.length) return;
    const ids = [...settings.visitorCharIds];
    [ids[index], ids[nextIndex]] = [ids[nextIndex], ids[index]];
    await saveSettings({ visitorCharIds: ids, nextVisitorIndex: 0 });
  };

  const renderNav = () => (
    <nav className="grid grid-cols-3 border-b border-emerald-100 bg-white px-3">
      {([
        ['tasks', '任务盒', ClipboardText], ['tools', '工具箱', Toolbox], ['visitors', '来访', UsersThree],
      ] as const).map(([id, label, Icon]) => <button key={id} onClick={() => { setView(id); setSelectedId(''); }} className={`flex h-14 items-center justify-center gap-2 border-b-2 text-xs font-black ${view === id ? 'border-emerald-700 text-emerald-800' : 'border-transparent text-slate-400'}`}><Icon size={18} weight={view === id ? 'fill' : 'regular'} />{label}</button>)}
    </nav>
  );

  const renderTaskRow = (unit: TaskWorkshopUnit) => {
    const latestVisit = [...unit.visits].sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const char = characters.find(item => item.id === latestVisit?.charId);
    return <button key={unit.id} onClick={() => { setSelectedId(unit.id); setView('unit'); }} className="flex w-full items-center gap-3 py-4 text-left"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-700"><ClipboardText size={22} weight="duotone" /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><b className="truncate text-sm text-slate-900">{unit.title}</b><span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-bold ${STATUS_META[unit.status].color}`}>{STATUS_META[unit.status].label}</span></div><span className="mt-1 block truncate text-xs text-slate-500">{char ? `${char.name} · ${latestVisit?.summary}` : unit.description || '还没有过程记录'}</span></div><ArrowRight size={18} className="text-slate-300" /></button>;
  };

  const renderTasks = () => (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[calc(var(--safe-bottom)+28px)] pt-6">
      <section className="rounded-[24px] bg-emerald-950 px-5 py-5 text-white shadow-[0_18px_45px_rgba(6,78,59,0.22)]">
        <div className="flex items-start justify-between gap-4"><div><h2 className="text-2xl font-black tracking-[-0.04em]">共享工作台</h2><p className="mt-2 max-w-sm text-xs leading-5 text-emerald-100">任务留在这里，角色按顺序偶尔来看看。建议默认只保存在本机。</p></div><Briefcase size={34} weight="duotone" className="shrink-0 text-emerald-300" /></div>
        <button onClick={() => setView('visitors')} className="mt-4 flex w-full items-center gap-3 border-t border-white/15 pt-4 text-left"><div className={`h-2.5 w-2.5 rounded-full ${settings.enabled ? 'bg-emerald-300' : 'bg-slate-400'}`} /><span className="min-w-0 flex-1 text-xs font-bold">{settings.enabled ? `${settings.visitorCharIds.length} 位角色轮流来访 · 每 ${settings.intervalMinutes} 分钟` : '自动来访未开启'}</span><ArrowRight size={17} /></button>
      </section>

      <div className="mt-8 flex items-end justify-between"><div><h2 className="text-lg font-black text-slate-900">任务盒</h2><p className="mt-1 text-xs text-slate-500">记录过程，不必一次整理完整。</p></div><button onClick={() => openCreate('unit')} className="flex h-10 items-center gap-1.5 rounded-xl bg-emerald-700 px-3 text-xs font-black text-white"><Plus size={16} weight="bold" />新任务</button></div>
      {units.length === 0 ? <div className="py-16 text-center"><ClipboardText size={42} className="mx-auto text-emerald-200" /><p className="mt-3 text-sm text-slate-500">先放进来一件正在想的事。</p></div> : <>
        {activeUnits.length > 0 ? <div className="mt-3 divide-y divide-emerald-100">{activeUnits.map(renderTaskRow)}</div> : <p className="py-10 text-center text-sm text-slate-400">当前没有未归档任务。</p>}
        {archivedUnits.length > 0 && <section className="mt-6 border-t border-emerald-100 pt-2">
          <button type="button" onClick={() => setArchivedExpanded(value => !value)} aria-expanded={archivedExpanded} aria-controls="task-workshop-archived-list" className="flex min-h-12 w-full items-center justify-between gap-3 rounded-xl px-1 text-left text-slate-600 outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2">
            <span className="flex min-w-0 items-center gap-2"><b className="text-sm text-slate-800">已归档</b><span className="rounded-full bg-stone-100 px-2 py-0.5 text-[10px] font-bold text-stone-500">{archivedUnits.length} 件</span></span>
            <CaretDown size={18} className={`shrink-0 text-slate-400 transition-transform ${archivedExpanded ? 'rotate-180' : ''}`} />
          </button>
          <div id="task-workshop-archived-list" hidden={!archivedExpanded} className="divide-y divide-emerald-100">{archivedUnits.map(renderTaskRow)}</div>
        </section>}
      </>}
    </div>
  );

  const renderTools = () => (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[calc(var(--safe-bottom)+28px)] pt-6">
      <div className="flex items-end justify-between"><div><h2 className="text-2xl font-black tracking-[-0.03em] text-slate-900">工具箱</h2><p className="mt-2 text-xs leading-5 text-slate-500">记录能调用的人、方法和资源；这里只描述，不自动执行。</p></div><button onClick={() => openCreate('tool')} className="flex h-10 items-center gap-1.5 rounded-xl bg-emerald-700 px-3 text-xs font-black text-white"><Plus size={16} />新工具</button></div>
      {tools.length === 0 ? <div className="py-16 text-center"><Toolbox size={44} className="mx-auto text-emerald-200" /><p className="mt-3 text-sm text-slate-500">把你已经拥有的能力放进来。</p></div> : <div className="mt-6 divide-y divide-emerald-100">{tools.map(tool => <button key={tool.id} onClick={() => { setSelectedId(tool.id); setView('tool'); }} className="flex w-full items-center gap-3 py-4 text-left"><div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-amber-50 text-amber-700"><Wrench size={22} weight="duotone" /></div><div className="min-w-0 flex-1"><b className="block truncate text-sm text-slate-900">{tool.name}</b><span className="mt-1 block truncate text-xs text-slate-500">{tool.description || tool.notes || '还没有说明'}</span></div><span className={`rounded-full px-2 py-1 text-[9px] font-bold ${tool.status === 'available' ? 'bg-emerald-100 text-emerald-700' : tool.status === 'limited' ? 'bg-amber-100 text-amber-700' : 'bg-slate-100 text-slate-500'}`}>{tool.status === 'available' ? '可用' : tool.status === 'limited' ? '受限' : '不可用'}</span></button>)}</div>}
    </div>
  );

  const renderVisitors = () => (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[calc(var(--safe-bottom)+28px)] pt-6">
      <h2 className="text-2xl font-black tracking-[-0.03em] text-slate-900">谁会来工作台</h2>
      <p className="mt-3 text-sm leading-6 text-slate-600">每个周期只来一位，按下方顺序轮换。第一版仅在 SullyOS 打开时运行；自动建议不写聊天、不写记忆、不执行工具。</p>
      <div className="mt-6 flex items-center justify-between border-y border-emerald-100 py-4"><div><b className="text-sm text-slate-900">自动来访</b><p className="mt-1 text-xs text-slate-500">上次检查：{formatTime(settings.lastVisitAt)}</p></div><button disabled={settings.visitorCharIds.length === 0} onClick={() => void saveSettings({ enabled: !settings.enabled, lastVisitAt: settings.enabled ? settings.lastVisitAt : Date.now() })} className={`relative h-7 w-12 rounded-full transition-colors disabled:opacity-40 ${settings.enabled ? 'bg-emerald-600' : 'bg-slate-200'}`}><span className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${settings.enabled ? 'translate-x-5' : 'translate-x-0'}`} /></button></div>
      <label className="mt-5 block"><span className="mb-2 block text-xs font-black text-slate-700">来访间隔</span><select value={settings.intervalMinutes} onChange={event => void saveSettings({ intervalMinutes: Number(event.target.value) })} className="h-12 w-full rounded-xl border border-emerald-100 bg-white px-3 text-sm text-slate-800 outline-none focus:ring-2 focus:ring-emerald-400"><option value={15}>15 分钟</option><option value={30}>30 分钟</option><option value={60}>1 小时</option><option value={180}>3 小时</option><option value={360}>6 小时</option><option value={720}>12 小时</option><option value={1440}>24 小时</option></select></label>

      <h3 className="mt-8 text-sm font-black text-slate-900">轮换顺序</h3>
      {settings.visitorCharIds.length === 0 ? <p className="mt-3 text-sm text-slate-500">还没有选择来访角色。</p> : <div className="mt-2 divide-y divide-emerald-100">{settings.visitorCharIds.map((id, index) => { const char = characters.find(item => item.id === id); if (!char) return null; return <div key={id} className="flex items-center gap-3 py-3"><span className="w-5 text-center text-xs font-black text-emerald-700">{index + 1}</span><Avatar char={char} /><b className="min-w-0 flex-1 truncate text-sm text-slate-900">{char.name}</b><button onClick={() => void moveVisitor(index, -1)} disabled={index === 0} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 disabled:opacity-20"><ArrowUp size={17} /></button><button onClick={() => void moveVisitor(index, 1)} disabled={index === settings.visitorCharIds.length - 1} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-500 disabled:opacity-20"><ArrowDown size={17} /></button></div>; })}</div>}

      <h3 className="mt-8 text-sm font-black text-slate-900">选择角色</h3>
      <div className="mt-3 grid grid-cols-3 gap-3">{characters.map(char => { const selected = settings.visitorCharIds.includes(char.id); return <button key={char.id} onClick={() => void toggleVisitor(char.id)} className={`flex min-w-0 flex-col items-center rounded-2xl border px-2 py-4 ${selected ? 'border-emerald-500 bg-emerald-50' : 'border-slate-100 bg-white'}`}><div className="relative"><Avatar char={char} size="h-14 w-14" />{selected && <span className="absolute -bottom-1 -right-1 flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-white ring-2 ring-white"><Check size={12} weight="bold" /></span>}</div><b className="mt-2 w-full truncate text-center text-xs text-slate-800">{char.name}</b></button>; })}</div>
    </div>
  );

  const renderUnit = () => {
    if (!selectedUnit) return null;
    return <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[calc(var(--safe-bottom)+32px)] pt-5">
      <div className="flex items-start gap-3"><div className="min-w-0 flex-1"><input key={`${selectedUnit.id}-title-${selectedUnit.updatedAt}`} defaultValue={selectedUnit.title} onBlur={event => { if (event.target.value.trim() && event.target.value !== selectedUnit.title) void patchUnit({ title: event.target.value.trim() }); }} className="w-full bg-transparent text-2xl font-black tracking-[-0.03em] text-slate-900 outline-none" /><textarea key={`${selectedUnit.id}-description-${selectedUnit.updatedAt}`} defaultValue={selectedUnit.description} onBlur={event => { if (event.target.value !== selectedUnit.description) void patchUnit({ description: event.target.value }); }} rows={3} placeholder="这件事要解决什么？" className="mt-3 w-full resize-none bg-transparent text-sm leading-6 text-slate-600 outline-none placeholder:text-slate-300" /></div><button onClick={() => void removeRecord(selectedUnit.id, selectedUnit.title, 'tasks')} className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 hover:bg-rose-50 hover:text-rose-600"><Trash size={18} /></button></div>
      <div className="mt-4 flex flex-wrap gap-2"><select value={selectedUnit.status} onChange={event => void patchUnit({ status: event.target.value as TaskWorkshopUnitStatus })} className={`h-9 rounded-full border-0 px-3 text-xs font-black outline-none ${STATUS_META[selectedUnit.status].color}`}>{Object.entries(STATUS_META).map(([id, meta]) => <option key={id} value={id}>{meta.label}</option>)}</select><input key={`${selectedUnit.id}-tags-${selectedUnit.updatedAt}`} defaultValue={selectedUnit.tags.join('，')} onBlur={event => void patchUnit({ tags: normalizeTaskWorkshopTags(event.target.value) })} placeholder="标签，用逗号分隔" className="h-9 min-w-0 flex-1 rounded-full bg-white px-3 text-xs text-slate-600 outline-none ring-1 ring-emerald-100" /></div>
      <div className="mt-4 flex gap-2"><select value={visitorCharId} onChange={event => setVisitorCharId(event.target.value)} className="h-10 min-w-0 flex-1 rounded-xl bg-white px-3 text-xs outline-none ring-1 ring-emerald-100">{characters.map(char => <option key={char.id} value={char.id}>{char.name}</option>)}</select><button onClick={() => void shareTask()} className="flex h-10 items-center gap-2 rounded-xl bg-slate-900 px-3 text-xs font-black text-white"><PaperPlaneTilt size={15} />带任务进聊天</button></div>

      <section className="mt-8"><h3 className="text-sm font-black text-slate-900">过程记录</h3><div className="mt-3 flex gap-2"><select value={entryKind} onChange={event => setEntryKind(event.target.value as TaskWorkshopEntryKind)} className="h-11 rounded-xl bg-white px-2 text-xs outline-none ring-1 ring-emerald-100"><option value="note">笔记</option><option value="progress">进展</option><option value="blocker">阻塞</option></select><input value={entryDraft} onChange={event => setEntryDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void addEntry(); }} placeholder="刚刚发生了什么……" className="h-11 min-w-0 flex-1 rounded-xl bg-white px-3 text-sm outline-none ring-1 ring-emerald-100" /><button onClick={() => void addEntry()} className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-700 text-white"><Plus size={18} /></button></div>{selectedUnit.entries.length > 0 && <div className="mt-3 divide-y divide-emerald-100">{[...selectedUnit.entries].reverse().map(entry => <div key={entry.id} className="py-3"><div className="flex items-center gap-2 text-[9px] font-bold text-slate-400"><span>{entry.kind === 'note' ? '笔记' : entry.kind === 'progress' ? '进展' : '阻塞'}</span><span>{formatTime(entry.createdAt)}</span></div><p className="mt-1 whitespace-pre-wrap text-xs leading-5 text-slate-700">{entry.content}</p></div>)}</div>}</section>

      <section className="mt-8"><h3 className="text-sm font-black text-slate-900">下一步</h3><div className="mt-3 flex gap-2"><input value={stepDraft} onChange={event => setStepDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') void addStep(); }} placeholder="拆成一个可以勾掉的动作" className="h-11 min-w-0 flex-1 rounded-xl bg-white px-3 text-sm outline-none ring-1 ring-emerald-100" /><button onClick={() => void addStep()} className="flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-700 text-white"><Plus size={18} /></button></div><div className="mt-2 divide-y divide-emerald-100">{selectedUnit.steps.map(step => <div key={step.id} className="flex items-start gap-3 py-3"><button onClick={() => void patchUnit({ steps: selectedUnit.steps.map(item => item.id === step.id ? { ...item, done: !item.done } : item) })} className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border ${step.done ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-slate-300 text-transparent'}`}><Check size={12} /></button><span className={`min-w-0 flex-1 text-xs leading-5 ${step.done ? 'text-slate-400 line-through' : 'text-slate-700'}`}>{step.content}</span><button onClick={() => void patchUnit({ steps: selectedUnit.steps.filter(item => item.id !== step.id) })} className="text-slate-300"><X size={15} /></button></div>)}</div></section>

      <section className="mt-8"><div className="flex items-end justify-between"><div><h3 className="text-sm font-black text-slate-900">关联工具</h3><p className="mt-1 text-[11px] text-slate-500">让来访角色知道可用资源，但不会自动调用。</p></div></div>{tools.length === 0 ? <p className="mt-3 text-xs text-slate-400">工具箱还是空的。</p> : <div className="mt-3 flex flex-wrap gap-2">{tools.map(tool => { const linked = selectedUnit.linkedToolIds.includes(tool.id); return <button key={tool.id} onClick={() => void patchUnit({ linkedToolIds: linked ? selectedUnit.linkedToolIds.filter(id => id !== tool.id) : [...selectedUnit.linkedToolIds, tool.id] })} className={`rounded-full px-3 py-2 text-xs font-bold ${linked ? 'bg-amber-100 text-amber-800 ring-1 ring-amber-300' : 'bg-white text-slate-500 ring-1 ring-slate-100'}`}>{tool.name}</button>; })}</div>}</section>

      <section className="mt-9 border-t border-emerald-100 pt-6"><div className="flex items-end justify-between"><div><h3 className="text-sm font-black text-slate-900">角色来访便签</h3><p className="mt-1 text-[11px] text-slate-500">同一角色的新便签会替换旧便签。</p></div><Clock size={20} className="text-emerald-600" /></div><div className="mt-4 flex gap-2"><select value={visitorCharId} onChange={event => setVisitorCharId(event.target.value)} className="h-11 min-w-0 flex-1 rounded-xl bg-white px-3 text-sm outline-none ring-1 ring-emerald-100">{characters.map(char => <option key={char.id} value={char.id}>{char.name}</option>)}</select><button disabled={busy || !visitorCharId} onClick={() => void runVisit()} className="flex h-11 items-center gap-2 rounded-xl bg-emerald-950 px-4 text-xs font-black text-white disabled:opacity-40"><Robot size={17} weight="duotone" />{busy ? '正在查看…' : '现在邀请'}</button></div>
      <div className="mt-4 divide-y divide-emerald-100">{[...selectedUnit.visits].sort((a, b) => b.updatedAt - a.updatedAt).map(visit => { const char = characters.find(item => item.id === visit.charId); return <article key={visit.charId} className="py-5 first:pt-0"><div className="flex items-center gap-3">{char ? <Avatar char={char} /> : <UserCirclePlus size={38} className="text-slate-300" />}<div className="min-w-0 flex-1"><b className="block truncate text-sm text-slate-900">{char?.name || '已删除角色'}</b><span className="text-[10px] text-slate-400">{formatTime(visit.updatedAt)}{visit.editedAt ? ' · 你编辑过' : ''}</span></div><button onClick={() => { setEditingVisitId(visit.charId); setVisitDraft(visit.summary); }} className="text-slate-400"><NotePencil size={17} /></button><button onClick={() => void patchUnit({ visits: selectedUnit.visits.filter(item => item.charId !== visit.charId) })} className="text-slate-300"><Trash size={17} /></button></div>{editingVisitId === visit.charId ? <div className="mt-3"><textarea value={visitDraft} onChange={event => setVisitDraft(event.target.value)} rows={5} className="w-full rounded-xl bg-white px-3 py-2 text-xs leading-5 outline-none ring-1 ring-emerald-200" /><div className="mt-2 flex justify-end gap-2"><button onClick={() => setEditingVisitId('')} className="h-9 rounded-lg px-3 text-xs font-bold text-slate-500">取消</button><button onClick={() => void saveVisitEdit()} className="h-9 rounded-lg bg-emerald-700 px-3 text-xs font-bold text-white">保存</button></div></div> : <><p className="mt-3 whitespace-pre-wrap text-xs leading-6 text-slate-700">{visit.summary}</p>{visit.suggestedSteps.length > 0 && <div className="mt-3 space-y-2">{visit.suggestedSteps.map((step, index) => <div key={`${index}-${step}`} className="flex items-start gap-2 text-xs leading-5 text-slate-600"><span className="font-black text-emerald-700">{index + 1}</span><span className="min-w-0 flex-1">{step}</span><button onClick={() => void addStep(step, 'character', visit.charId)} className="shrink-0 rounded-lg bg-emerald-50 px-2 py-1 text-[9px] font-bold text-emerald-700">采纳</button></div>)}</div>}{visit.nextAction && <div className="mt-3 bg-emerald-50 px-3 py-2 text-[11px] leading-5 text-emerald-950"><b>最小下一步：</b>{visit.nextAction}</div>}<button disabled={!!visit.sharedMessageId} onClick={() => void shareVisit(visit)} className="mt-3 flex h-10 items-center gap-2 rounded-xl bg-slate-900 px-4 text-xs font-black text-white disabled:bg-slate-200 disabled:text-slate-500"><PaperPlaneTilt size={16} />{visit.sharedMessageId ? '已带到聊天' : '带到聊天处理'}</button></>}</article>; })}</div></section>
    </div>;
  };

  const renderTool = () => {
    if (!selectedTool) return null;
    return <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[calc(var(--safe-bottom)+32px)] pt-6"><div className="flex items-start gap-3"><div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-800"><Toolbox size={28} weight="duotone" /></div><div className="min-w-0 flex-1"><input key={`${selectedTool.id}-name-${selectedTool.updatedAt}`} defaultValue={selectedTool.name} onBlur={event => { if (event.target.value.trim() && event.target.value !== selectedTool.name) void patchTool({ name: event.target.value.trim() }); }} className="w-full bg-transparent text-2xl font-black text-slate-900 outline-none" /><p className="mt-1 text-xs text-slate-500">工具说明只提供给角色判断，不会在任务工坊内执行。</p></div><button onClick={() => void removeRecord(selectedTool.id, selectedTool.name, 'tools')} className="flex h-10 w-10 items-center justify-center text-slate-400"><Trash size={18} /></button></div><label className="mt-7 block"><span className="mb-2 block text-xs font-black text-slate-700">它能做什么</span><textarea key={`${selectedTool.id}-description-${selectedTool.updatedAt}`} defaultValue={selectedTool.description} onBlur={event => { if (event.target.value !== selectedTool.description) void patchTool({ description: event.target.value }); }} rows={5} className="w-full rounded-2xl bg-white px-4 py-3 text-sm leading-6 outline-none ring-1 ring-emerald-100" /></label><label className="mt-5 block"><span className="mb-2 block text-xs font-black text-slate-700">使用限制与备注</span><textarea key={`${selectedTool.id}-notes-${selectedTool.updatedAt}`} defaultValue={selectedTool.notes} onBlur={event => { if (event.target.value !== selectedTool.notes) void patchTool({ notes: event.target.value }); }} rows={5} placeholder="例如：只能工作日使用、需要先确认权限……" className="w-full rounded-2xl bg-white px-4 py-3 text-sm leading-6 outline-none ring-1 ring-emerald-100" /></label><label className="mt-5 block"><span className="mb-2 block text-xs font-black text-slate-700">状态</span><select value={selectedTool.status} onChange={event => void patchTool({ status: event.target.value as TaskWorkshopTool['status'] })} className="h-12 w-full rounded-xl bg-white px-3 text-sm outline-none ring-1 ring-emerald-100"><option value="available">可用</option><option value="limited">受限</option><option value="unavailable">暂不可用</option></select></label><div className="mt-5 grid grid-cols-2 gap-3"><label><span className="mb-2 block text-xs font-black text-slate-700">到日恢复可用</span><input type="date" value={selectedTool.availableFrom || ''} onChange={event => void patchTool({ availableFrom: event.target.value || undefined })} className="h-12 w-full rounded-xl bg-white px-3 text-xs outline-none ring-1 ring-emerald-100" /></label><label><span className="mb-2 block text-xs font-black text-slate-700">到日变为不可用</span><input type="date" value={selectedTool.unavailableFrom || ''} onChange={event => void patchTool({ unavailableFrom: event.target.value || undefined })} className="h-12 w-full rounded-xl bg-white px-3 text-xs outline-none ring-1 ring-emerald-100" /></label></div><p className="mt-2 text-[10px] leading-4 text-slate-400">到达日期后自动改状态，条目不会被删除；若两项都设置，以已到达的较晚日期为准。</p><label className="mt-5 block"><span className="mb-2 block text-xs font-black text-slate-700">标签</span><input key={`${selectedTool.id}-tags-${selectedTool.updatedAt}`} defaultValue={selectedTool.tags.join('，')} onBlur={event => void patchTool({ tags: normalizeTaskWorkshopTags(event.target.value) })} className="h-12 w-full rounded-xl bg-white px-3 text-sm outline-none ring-1 ring-emerald-100" /></label></div>;
  };

  const title = view === 'unit' ? selectedUnit?.title || '任务详情' : view === 'tool' ? selectedTool?.name || '工具详情' : '任务工坊';
  return <div className="relative flex h-full flex-col overflow-hidden bg-[#f8fbf8] text-slate-900">
    <Header title={title} onBack={goBack} right={view === 'tasks' ? <button onClick={() => openCreate('unit')} className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-800"><Plus size={20} /></button> : undefined} />
    {(view === 'tasks' || view === 'tools' || view === 'visitors') && renderNav()}
    {view === 'tasks' && renderTasks()}{view === 'tools' && renderTools()}{view === 'visitors' && renderVisitors()}{view === 'unit' && renderUnit()}{view === 'tool' && renderTool()}
    {editor && <Sheet title={editor === 'unit' ? '新建任务' : '新建工具'} onClose={() => setEditor(null)}><label className="mt-5 block"><span className="mb-2 block text-xs font-black text-slate-700">名称</span><input autoFocus value={draftTitle} onChange={event => setDraftTitle(event.target.value)} className="h-12 w-full rounded-xl bg-slate-50 px-3 text-sm outline-none focus:ring-2 focus:ring-emerald-400" /></label><label className="mt-4 block"><span className="mb-2 block text-xs font-black text-slate-700">说明</span><textarea value={draftDescription} onChange={event => setDraftDescription(event.target.value)} rows={5} className="w-full rounded-xl bg-slate-50 px-3 py-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-emerald-400" /></label><label className="mt-4 block"><span className="mb-2 block text-xs font-black text-slate-700">标签</span><input value={draftTags} onChange={event => setDraftTags(event.target.value)} placeholder="用逗号分隔" className="h-12 w-full rounded-xl bg-slate-50 px-3 text-sm outline-none focus:ring-2 focus:ring-emerald-400" /></label><button onClick={() => void createRecord()} className="mt-5 h-12 w-full rounded-xl bg-emerald-700 text-sm font-black text-white">保存</button></Sheet>}
  </div>;
};

export default TaskWorkshopApp;
