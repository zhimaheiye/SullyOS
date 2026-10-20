import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Archive, ArrowRight, CaretLeft, Check, Clock, FloppyDisk, GearSix, NotePencil,
  PaperPlaneTilt, PencilSimple, Plus, Trash, UsersThree,
} from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import type { MyScheduleArchive, MyScheduleEntry, MyScheduleRecord, MyScheduleSettings, MyScheduleTag } from '../types';
import { DB } from '../utils/db';
import {
  createMyScheduleArchive, formatMyScheduleDuration, formatMyScheduleTimeRange,
  findPreviousMyScheduleEnd, MY_SCHEDULE_TAG_META, MY_SCHEDULE_TAG_OPTIONS, myScheduleCardMinHeight,
  myScheduleCurrentEntries, myScheduleEntryState, myScheduleGapPx, myScheduleTagTotals,
} from '../utils/mySchedule';
import { createAndSyncMyScheduleEntry, editAndSyncMyScheduleEntry, finishAndSyncMyScheduleEntry, requestMyScheduleCommands } from '../utils/myScheduleService';

type View = 'timeline' | 'control' | 'edit' | 'archives' | 'archive';

interface EditDraft {
  entryId?: string;
  title: string;
  note: string;
  startAt: string;
  endAt: string;
  hasEnd: boolean;
  estimatedTime: boolean;
  tag: MyScheduleTag | '';
}

const DEFAULT_SETTINGS: MyScheduleSettings = { id: 'settings', kind: 'settings', selectedCharIds: [] };

const clock = (timestamp: number) => new Date(timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
const dayLabel = (timestamp: number) => new Date(timestamp).toLocaleDateString('zh-CN', { month: 'long', day: 'numeric', weekday: 'short' });
const shortDate = (timestamp: number) => new Date(timestamp).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' });
const archiveLabel = (archive: MyScheduleArchive) => dateKey(archive.startedAt) === dateKey(archive.endedAt)
  ? dayLabel(archive.startedAt)
  : `${shortDate(archive.startedAt)} — ${shortDate(archive.endedAt)}`;
const dateKey = (timestamp: number) => {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
};
const toLocalDateTimeInput = (timestamp: number) => {
  const date = new Date(timestamp);
  return new Date(timestamp - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
};
/** 旧版自动观察仍留在本机库里，时间轴不再把未改写的 Veglia 卡片当成用户日程。 */
const isUneditedVegliaCard = (entry: MyScheduleEntry) => {
  const extra = entry as MyScheduleEntry & {
    activityId?: string;
    manualCorrection?: boolean;
    observationOnly?: boolean;
    source?: string;
    evidence?: string;
  };
  const automatic = extra.sourceText === 'Veglia 自动观察'
    || extra.sourceText === 'Veglia 活动段'
    || extra.source === 'Veglia 聚合观察'
    || (extra.observationOnly === true && !!extra.activityId);
  if (!automatic) return false;
  if (entry.note.trim() || extra.manualCorrection || extra.evidence === 'confirmed' || entry.recipientCharIds.length > 0) return false;
  return true;
};

const MyScheduleApp: React.FC = () => {
  const { closeApp, registerBackHandler, characters, apiConfig, addToast } = useOS();
  const [view, setView] = useState<View>('timeline');
  const [records, setRecords] = useState<MyScheduleRecord[]>([]);
  const [sourceText, setSourceText] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [editDraft, setEditDraft] = useState<EditDraft | null>(null);
  const [selectedArchiveId, setSelectedArchiveId] = useState<string | null>(null);

  const entries = useMemo(() => records.filter((record): record is MyScheduleEntry => record.kind === 'entry').filter(entry => !isUneditedVegliaCard(entry)).sort((a, b) => a.startAt - b.startAt), [records]);
  const archives = useMemo(() => records.filter((record): record is MyScheduleArchive => record.kind === 'archive').sort((a, b) => b.archivedAt - a.archivedAt), [records]);
  const currentEntries = useMemo(() => myScheduleCurrentEntries(entries, archives), [archives, entries]);
  const selectedArchive = useMemo(() => archives.find(archive => archive.id === selectedArchiveId), [archives, selectedArchiveId]);
  const selectedArchiveEntries = useMemo(() => selectedArchive
    ? entries.filter(entry => selectedArchive.entryIds.includes(entry.id))
    : [], [entries, selectedArchive]);
  const settings = useMemo(() => records.find((record): record is MyScheduleSettings => record.kind === 'settings') || DEFAULT_SETTINGS, [records]);
  const selectedCharacters = useMemo(() => characters.filter(char => settings.selectedCharIds.includes(char.id)), [characters, settings.selectedCharIds]);
  const previousDraftEndAt = editDraft ? findPreviousMyScheduleEnd(
    currentEntries.filter(entry => entry.id !== editDraft.entryId),
    editDraft.entryId ? currentEntries.find(entry => entry.id === editDraft.entryId)?.startAt ?? Date.now() : Date.now(),
  ) : undefined;

  const load = useCallback(async () => setRecords(await DB.getMyScheduleRecords()), []);
  useEffect(() => { void load().catch(() => addToast('日程读取失败', 'error')); }, [addToast, load]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 30_000); return () => window.clearInterval(timer); }, []);

  const goBack = useCallback(() => {
    if (view === 'archive') { setView('archives'); setSelectedArchiveId(null); return true; }
    if (view !== 'timeline') { setView('timeline'); setEditDraft(null); setSelectedArchiveId(null); return true; }
    closeApp(); return true;
  }, [closeApp, view]);
  useEffect(() => registerBackHandler(goBack), [goBack, registerBackHandler]);

  const toggleRecipient = async (charId: string) => {
    const selectedCharIds = settings.selectedCharIds.includes(charId)
      ? settings.selectedCharIds.filter(id => id !== charId)
      : [...settings.selectedCharIds, charId];
    await DB.saveMyScheduleRecord({ ...settings, selectedCharIds });
    await load();
  };

  const submit = async () => {
    if (!sourceText.trim() || busy) return;
    setBusy(true);
    try {
      let openEntries = currentEntries.filter(entry => entry.endAt === undefined);
      const commands = await requestMyScheduleCommands({
        apiConfig, sourceText, openEntries, timelineEntries: currentEntries, now: Date.now(),
      });
      const failedCharNames = new Set<string>();
      for (const [index, command] of commands.entries()) {
        const commandNote = index === commands.length - 1 ? note : '';
        if (command.action === 'finish_open') {
          const target = openEntries.find(entry => entry.id === command.targetEntryId);
          if (!target || command.endAt === undefined) throw new Error('没有找到要结束的日程');
          await finishAndSyncMyScheduleEntry(target, command.endAt, commandNote);
          openEntries = openEntries.filter(entry => entry.id !== target.id);
        } else {
          const result = await createAndSyncMyScheduleEntry({
            command, sourceText, note: commandNote, recipients: selectedCharacters,
          });
          result.failedCharNames.forEach(name => failedCharNames.add(name));
        }
      }
      if (failedCharNames.size) addToast(`${commands.length} 条日程已保存，但未能同步给：${[...failedCharNames].join('、')}`, 'error');
      else addToast(selectedCharacters.length ? `已记录 ${commands.length} 条日程并同步给 ${selectedCharacters.length} 位角色` : `已记录 ${commands.length} 条日程`, 'success');
      setSourceText(''); setNote(''); await load(); setNow(Date.now());
    } catch (error) {
      addToast(error instanceof Error ? error.message : '日程解析失败', 'error');
    } finally { setBusy(false); }
  };

  const openEditor = (entry: MyScheduleEntry) => {
    setEditDraft({
      entryId: entry.id, title: entry.title, note: entry.note,
      startAt: toLocalDateTimeInput(entry.startAt),
      endAt: toLocalDateTimeInput(entry.endAt ?? Math.max(entry.startAt + 60_000, Date.now())),
      hasEnd: entry.endAt !== undefined, estimatedTime: entry.estimatedTime === true,
      tag: entry.tag || '',
    });
    setView('edit');
  };

  const openManualEditor = () => {
    const openedAt = Date.now();
    const defaultDateTime = toLocalDateTimeInput(openedAt);
    setEditDraft({
      title: '', note: '', startAt: defaultDateTime, endAt: defaultDateTime,
      hasEnd: true, estimatedTime: false, tag: '',
    });
    setView('edit');
  };

  const usePreviousEndAsStart = () => {
    if (!editDraft) return;
    if (previousDraftEndAt === undefined) {
      addToast('当前时间轴还没有可接续的上一事件', 'info');
      return;
    }
    setEditDraft({ ...editDraft, startAt: toLocalDateTimeInput(previousDraftEndAt), estimatedTime: false });
  };

  const saveEdit = async () => {
    if (!editDraft || busy) return;
    setBusy(true);
    try {
      let failedCharNames: string[] = [];
      const startAt = new Date(editDraft.startAt).getTime();
      const endAt = editDraft.hasEnd ? new Date(editDraft.endAt).getTime() : undefined;
      if (editDraft.entryId) {
        const entry = currentEntries.find(item => item.id === editDraft.entryId);
        if (!entry) throw new Error('这条日程已经不存在');
        await editAndSyncMyScheduleEntry(entry, {
          title: editDraft.title, note: editDraft.note, startAt, endAt,
          estimatedTime: editDraft.estimatedTime, tag: editDraft.tag || undefined,
        });
      } else {
        const result = await createAndSyncMyScheduleEntry({
          command: {
            action: editDraft.hasEnd ? 'create_completed' : 'create_open',
            title: editDraft.title, startAt, endAt, estimatedTime: editDraft.estimatedTime,
            tag: editDraft.tag || undefined,
          },
          sourceText: '手动添加', note: editDraft.note, recipients: selectedCharacters,
        });
        failedCharNames = result.failedCharNames;
      }
      await load(); setNow(Date.now()); setEditDraft(null); setView('timeline');
      if (failedCharNames.length) addToast(`日程已保存，但未能同步给：${failedCharNames.join('、')}`, 'error');
      else addToast(editDraft.entryId ? '日程已更新，时间轴和聊天卡已同步' : selectedCharacters.length ? `日程已添加并同步给 ${selectedCharacters.length} 位角色` : '日程已添加', 'success');
    } catch (error) { addToast(error instanceof Error ? error.message : '日程保存失败', 'error'); }
    finally { setBusy(false); }
  };

  const remove = async (entry: MyScheduleEntry) => {
    const synced = Object.keys(entry.messageIdsByCharId).length > 0;
    const suffix = synced ? ' 已经同步到角色聊天的卡片会继续保留。' : '';
    if (!window.confirm(`删除“${entry.title}”？${suffix}`)) return;
    await DB.deleteMyScheduleEntry(entry.id); await load(); addToast('本地日程已删除', 'success');
  };

  const enterNextDay = async () => {
    if (!currentEntries.length || busy) return;
    const openCount = currentEntries.filter(entry => entry.endAt === undefined).length;
    const openNotice = openCount ? ` 其中 ${openCount} 条尚未结束，归档统计会停在现在。` : '';
    if (!window.confirm(`把当前 ${currentEntries.length} 条日程归档并进入下一天？${openNotice} 已同步到角色聊天的卡片不会改变。`)) return;
    setBusy(true);
    try {
      await DB.saveMyScheduleRecord(createMyScheduleArchive(currentEntries));
      await load();
      setNow(Date.now());
      addToast('上一天已归档，可以开始新的记录了', 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : '日程归档失败', 'error');
    } finally { setBusy(false); }
  };

  const timelineItemsFor = (displayEntries: MyScheduleEntry[], markerTime?: number) => {
    const items: Array<{ type: 'entry'; time: number; entry: MyScheduleEntry } | { type: 'now'; time: number }> = displayEntries.map(entry => ({ type: 'entry', time: entry.startAt, entry }));
    if (markerTime !== undefined) items.push({ type: 'now', time: markerTime });
    let occupiedUntil: number | undefined;
    let previousDay = '';
    return items.sort((a, b) => a.time - b.time).map(item => {
      const day = dateKey(item.time);
      const newDay = day !== previousDay;
      const gapPx = newDay ? 0 : myScheduleGapPx(occupiedUntil, item.time);
      const minHeight = item.type === 'entry' ? myScheduleCardMinHeight(item.entry) : 24;
      const itemEnd = item.type === 'entry' ? (item.entry.endAt ?? item.time) : item.time;
      occupiedUntil = newDay ? itemEnd : Math.max(occupiedUntil ?? item.time, itemEnd);
      previousDay = day;
      return { ...item, newDay, gapPx, minHeight };
    });
  };

  const renderTotals = (displayEntries: MyScheduleEntry[], cutoff: number) => {
    const totals = myScheduleTagTotals(displayEntries, cutoff);
    return <div className="mt-5 grid grid-cols-4 divide-x divide-[#d9dee7] rounded-[14px] bg-white px-1 py-3 shadow-[0_8px_22px_rgba(36,50,72,0.08)]" aria-label="分类累计时长">
      {MY_SCHEDULE_TAG_OPTIONS.map(option => <div key={option.value} className="min-w-0 px-1.5 text-center">
        <div className="flex items-center justify-center gap-1 text-[9px] font-black" style={{ color: option.ink }}><span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: option.accent }} />{option.label}</div>
        <p className="mt-1 truncate text-[12px] font-black tabular-nums text-[#293a54]">{formatMyScheduleDuration(totals[option.value])}</p>
      </div>)}
    </div>;
  };

  const renderTimelineEntries = (
    displayEntries: MyScheduleEntry[],
    options: { markerTime?: number; readOnly?: boolean; emptyText?: string } = {},
  ) => {
    if (!displayEntries.length) return <div className="border-y border-[#d5dae2] py-16 text-center"><Clock size={38} className="mx-auto text-[#8d99aa]" /><p className="mt-4 text-sm font-black text-[#34445c]">{options.emptyText || '时间轴还没有内容'}</p>{!options.readOnly && <p className="mt-2 text-xs text-[#718096]">例如：刚才看了 15 分钟书</p>}</div>;
    return <div className="relative pb-10"><div className="absolute bottom-0 left-[62px] top-0 w-px bg-[#c9d0db]" />{timelineItemsFor(displayEntries, options.markerTime).map(item => {
      if (item.type === 'now') return <React.Fragment key="now">{item.newDay && <div className="relative mb-3 mt-7 pl-[76px] text-[10px] font-black tracking-[0.1em] text-[#778397]">{dayLabel(item.time)}</div>}<div className="relative grid grid-cols-[48px_1fr] gap-7" style={{ marginTop: item.gapPx + 12 }}><div className="pt-0.5 text-right text-[11px] font-black tabular-nums text-[#ed5b51]">{clock(item.time)}</div><div className="relative h-6"><span className="absolute -left-5 top-1 h-3 w-3 rounded-full bg-[#ed5b51] ring-4 ring-[#f4f6f8]" /><div className="absolute left-0 right-0 top-[7px] h-px bg-[#ed5b51]" /><span className="absolute right-0 -top-1 bg-[#f4f6f8] pl-2 text-[10px] font-black text-[#ed5b51]">现在</span></div></div></React.Fragment>;
      const entry = item.entry;
      const state = myScheduleEntryState(entry, now);
      const tagMeta = entry.tag ? MY_SCHEDULE_TAG_META[entry.tag] : undefined;
      const markerColor = tagMeta?.accent || (state === 'active' ? '#2F6FED' : state === 'planned' ? '#8F6ED5' : '#77869C');
      const status = options.readOnly ? '已归档' : state === 'active' ? '进行中' : state === 'planned' ? '待开始' : '已完成';
      const statusClass = options.readOnly || state === 'completed' ? 'bg-[#e7ebf0] text-[#536177]' : state === 'active' ? 'bg-[#dce8ff] text-[#2457ae]' : 'bg-[#ebe4f8] text-[#654b9c]';
      return <React.Fragment key={entry.id}>{item.newDay && <div className="relative mb-3 mt-7 pl-[76px] text-[10px] font-black tracking-[0.1em] text-[#778397]">{dayLabel(entry.startAt)}</div>}<article className="relative grid grid-cols-[48px_1fr] gap-7" style={{ marginTop: item.gapPx + 12 }}><div className="pt-1 text-right text-[11px] font-bold tabular-nums text-[#536177]">{clock(entry.startAt)}</div><div className="relative min-w-0"><span className="absolute -left-5 top-2 h-2.5 w-2.5 rounded-full ring-4 ring-[#f4f6f8]" style={{ backgroundColor: markerColor }} /><div className="flex rounded-[14px] px-4 py-4 shadow-[0_8px_22px_rgba(36,50,72,0.09)]" style={{ minHeight: item.minHeight, backgroundColor: tagMeta?.surface || '#FFFFFF' }}><div className="flex min-w-0 flex-1 flex-col"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="text-sm font-black text-[#1d2d46]">{entry.title}</h3>{tagMeta && <span className="rounded-full px-2 py-0.5 text-[9px] font-black" style={{ backgroundColor: `${tagMeta.accent}33`, color: tagMeta.ink }}>{tagMeta.label}</span>}<span className={`rounded-full px-2 py-0.5 text-[9px] font-black ${statusClass}`}>{status}</span></div><p className="mt-1.5 text-[10px] leading-4 text-[#536177]">{formatMyScheduleTimeRange(entry)}</p></div>{!options.readOnly && <div className="flex shrink-0"><button onClick={() => openEditor(entry)} className="p-1.5 text-[#65758d] focus:outline-none focus:ring-2 focus:ring-[#2f6fed]" aria-label={`编辑${entry.title}`}><PencilSimple size={16} /></button><button onClick={() => void remove(entry)} className="p-1.5 text-[#7a8799] focus:outline-none focus:ring-2 focus:ring-[#2f6fed]" aria-label={`删除${entry.title}`}><Trash size={15} /></button></div>}</div>{entry.note && <p className="mt-3 whitespace-pre-wrap border-t border-[#bfc9d6] pt-3 text-xs leading-5 text-[#3f4d62]">{entry.note}</p>}<div className="mt-auto flex items-center gap-1.5 pt-3 text-[9px] font-bold text-[#66748a]"><UsersThree size={13} />同步给 {entry.recipientCharIds.length} 位角色</div></div></div></div></article></React.Fragment>;
    })}</div>;
  };

  const renderTimeline = () => <>
    <main className="min-h-0 flex-1 overflow-y-auto px-5 pb-[calc(var(--safe-bottom)+310px)]">
      <section className="pb-6 pt-4"><div className="flex items-start justify-between gap-4"><h2 className="text-[28px] font-black tracking-[-0.035em] text-[#15243b]">{dayLabel(now)}</h2><button onClick={openManualEditor} className="flex h-10 shrink-0 items-center gap-1.5 rounded-[12px] bg-white px-3 text-[11px] font-black text-[#2457ae] shadow-[0_6px_16px_rgba(36,50,72,0.08)] focus:outline-none focus:ring-2 focus:ring-[#2f6fed]"><Plus size={16} weight="bold" />手动添加</button></div><p className="mt-2 max-w-[28rem] text-xs leading-5 text-[#5b677a]">当前记录日可以跨过零点。录完睡眠后，由你决定什么时候归档并进入下一天。</p>{renderTotals(currentEntries, now)}<div className="mt-3 flex gap-2"><button onClick={() => setView('archives')} className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[12px] bg-white text-[11px] font-black text-[#536177] shadow-[0_6px_16px_rgba(36,50,72,0.06)] focus:outline-none focus:ring-2 focus:ring-[#2f6fed]"><Archive size={16} />历史归档{archives.length ? ` ${archives.length}` : ''}</button><button disabled={!currentEntries.length || busy} onClick={() => void enterNextDay()} className="flex h-10 flex-1 items-center justify-center gap-1.5 rounded-[12px] bg-[#20395e] text-[11px] font-black text-white shadow-[0_6px_16px_rgba(32,57,94,0.16)] focus:outline-none focus:ring-2 focus:ring-[#2f6fed] disabled:bg-[#aab6c9] disabled:shadow-none">进入下一天<ArrowRight size={16} /></button></div></section>
      {renderTimelineEntries(currentEntries, { markerTime: now })}
    </main>
    <section className="absolute inset-x-0 bottom-0 z-20 border-t border-[#d6dbe3] bg-[#f4f6f8] px-4 pb-[calc(var(--safe-bottom)+12px)] pt-3 shadow-[0_-10px_28px_rgba(31,45,67,0.08)]"><label className="block"><span className="mb-1.5 block text-[11px] font-black text-[#34445c]">日程</span><textarea value={sourceText} onChange={event => setSourceText(event.target.value)} placeholder="刚才看了 15 分钟书……" className="h-14 w-full resize-none rounded-[12px] bg-white px-4 py-3 text-sm leading-5 text-[#26364f] outline-none placeholder:text-[#8b96a6] focus:ring-2 focus:ring-[#2f6fed]" /></label><label className="mt-3 block"><span className="mb-1.5 flex items-center justify-between gap-3 text-[11px] font-black text-[#34445c]"><span className="flex items-center gap-1.5"><NotePencil size={15} className="text-[#2f6fed]" />我的随笔</span><span className="font-medium text-[#758195]">可选 · AI 不会编辑</span></span><textarea value={note} onChange={event => setNote(event.target.value)} placeholder="写下此刻的感受、情绪或想留下的话……" className="h-20 w-full resize-none rounded-[12px] bg-white px-4 py-3 text-sm leading-5 text-[#26364f] outline-none placeholder:text-[#8b96a6] focus:ring-2 focus:ring-[#2f6fed]" /></label><div className="mt-2 flex items-center justify-between px-1 text-[9px] text-[#758195]"><span>{busy ? 'AI 正在理解日程时间……' : '随笔不会发送给解析 AI'}</span><span>将同步给 {selectedCharacters.length} 位角色</span></div><button disabled={busy || !sourceText.trim()} onClick={() => void submit()} className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-[12px] bg-[#2f6fed] text-sm font-black text-white shadow-[0_6px_16px_rgba(47,111,237,0.25)] focus:outline-none focus:ring-2 focus:ring-[#1f54c7] focus:ring-offset-2 disabled:bg-[#aab6c9] disabled:shadow-none" aria-label="记录日程">{busy ? <Clock size={19} className="animate-pulse" /> : <PaperPlaneTilt size={18} weight="fill" />}{busy ? '正在记录……' : '记录日程'}</button></section>
  </>;

  const renderEdit = () => editDraft && <main className="min-h-0 flex-1 overflow-y-auto px-5 pb-[calc(var(--safe-bottom)+28px)] pt-4">
    <button onClick={() => { setView('timeline'); setEditDraft(null); }} className="flex items-center gap-1 text-xs font-bold text-[#59677b]"><CaretLeft size={16} />{editDraft.entryId ? '取消编辑' : '取消添加'}</button>
    <h2 className="mt-7 text-[28px] font-black tracking-[-0.035em] text-[#15243b]">{editDraft.entryId ? '修改这段时间' : '手动添加日程'}</h2><p className="mt-2 text-sm leading-6 text-[#5b677a]">{editDraft.entryId ? '这里的开始和结束时间会直接决定卡片在时间轴上的位置与长度，不会重新交给 AI 理解。' : '直接填写标题、时间和随笔，不经过 AI。保存后会按这些时间生成一张新卡片。'}</p>
    <label className="mt-7 block"><span className="mb-2 block text-[11px] font-black text-[#34445c]">做了什么</span><input value={editDraft.title} onChange={event => setEditDraft({ ...editDraft, title: event.target.value })} maxLength={60} className="h-12 w-full rounded-[12px] bg-white px-4 text-sm text-[#26364f] outline-none focus:ring-2 focus:ring-[#2f6fed]" /></label>
    <div className="mt-5"><span className="mb-2 block text-[11px] font-black text-[#34445c]">时间标签</span><div className="grid grid-cols-3 gap-2"><button onClick={() => setEditDraft({ ...editDraft, tag: '' })} aria-pressed={!editDraft.tag} className={`h-10 rounded-[12px] text-[11px] font-black focus:outline-none focus:ring-2 focus:ring-[#2f6fed] ${editDraft.tag ? 'bg-white text-[#66748a]' : 'bg-[#dce2ea] text-[#34445c]'}`}>未分类</button>{MY_SCHEDULE_TAG_OPTIONS.map(option => <button key={option.value} onClick={() => setEditDraft({ ...editDraft, tag: option.value })} aria-pressed={editDraft.tag === option.value} className="h-10 rounded-[12px] text-[11px] font-black focus:outline-none focus:ring-2 focus:ring-[#2f6fed]" style={{ backgroundColor: editDraft.tag === option.value ? option.accent : option.surface, color: option.ink }}>{option.label}</button>)}</div></div>
    <div className="mt-5 grid grid-cols-1 gap-4">
      <label>
        <span className="mb-2 flex items-center justify-between gap-3 text-[11px] font-black text-[#34445c]">
          <span>开始时间</span>
          <button type="button" onClick={usePreviousEndAsStart} className="flex items-center gap-1 rounded-full bg-[#dce8ff] px-3 py-1 text-[9px] text-[#2457ae] focus:outline-none focus:ring-2 focus:ring-[#2f6fed]">
            <ArrowRight size={11} weight="bold" />接续上一事件
          </button>
        </span>
        <input type="datetime-local" value={editDraft.startAt} onChange={event => setEditDraft({ ...editDraft, startAt: event.target.value, estimatedTime: false })} className="h-12 w-full rounded-[12px] bg-white px-4 text-sm text-[#26364f] outline-none focus:ring-2 focus:ring-[#2f6fed]" />
      </label>
      <label>
        <span className="mb-2 flex items-center justify-between gap-3 text-[11px] font-black text-[#34445c]">
          <span>结束时间</span>
          <span className="flex items-center gap-2">
            <button type="button" onClick={() => setEditDraft({ ...editDraft, endAt: toLocalDateTimeInput(Date.now()), hasEnd: true, estimatedTime: false })} className="flex items-center gap-1 rounded-full bg-[#dce8ff] px-3 py-1 text-[9px] text-[#2457ae] focus:outline-none focus:ring-2 focus:ring-[#2f6fed]">
              <Clock size={11} weight="bold" />设为现在
            </button>
            <button type="button" onClick={() => setEditDraft({ ...editDraft, hasEnd: !editDraft.hasEnd, estimatedTime: false })} className={`rounded-full px-3 py-1 text-[9px] focus:outline-none focus:ring-2 focus:ring-[#2f6fed] ${editDraft.hasEnd ? 'bg-[#dce8ff] text-[#2457ae]' : 'bg-[#e7ebf0] text-[#59677b]'}`}>{editDraft.hasEnd ? '已有结束时间' : '尚未结束'}</button>
          </span>
        </span>
        <input disabled={!editDraft.hasEnd} type="datetime-local" value={editDraft.endAt} onChange={event => setEditDraft({ ...editDraft, endAt: event.target.value, estimatedTime: false })} className="h-12 w-full rounded-[12px] bg-white px-4 text-sm text-[#26364f] outline-none focus:ring-2 focus:ring-[#2f6fed] disabled:text-[#9aa4b2]" />
      </label>
    </div>
    <button onClick={() => setEditDraft({ ...editDraft, estimatedTime: !editDraft.estimatedTime })} className="mt-5 flex w-full items-center justify-between border-y border-[#d6dbe3] py-4 text-left"><span><b className="block text-xs text-[#26364f]">时间仍然是估算值</b><span className="mt-1 block text-[10px] text-[#758195]">手动修改时间时会自动取消；如果你仍不确定，也可以重新打开。</span></span><span className={`relative h-7 w-12 shrink-0 rounded-full ${editDraft.estimatedTime ? 'bg-[#2f6fed]' : 'bg-[#cbd3df]'}`}><span className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white transition-transform ${editDraft.estimatedTime ? 'translate-x-5' : ''}`} /></span></button>
    <label className="mt-5 block"><span className="mb-2 flex items-center justify-between text-[11px] font-black text-[#34445c]"><span>我的随笔</span><span className="font-medium text-[#758195]">完全保留你的原文</span></span><textarea value={editDraft.note} onChange={event => setEditDraft({ ...editDraft, note: event.target.value })} placeholder="可以补充新的感受和内容……" className="h-40 w-full resize-none rounded-[12px] bg-white p-4 text-sm leading-6 text-[#26364f] outline-none placeholder:text-[#8b96a6] focus:ring-2 focus:ring-[#2f6fed]" /></label>
    <button disabled={busy || !editDraft.title.trim() || !editDraft.startAt || (editDraft.hasEnd && !editDraft.endAt)} onClick={() => void saveEdit()} className="mt-7 flex h-12 w-full items-center justify-center gap-2 rounded-[12px] bg-[#2f6fed] text-sm font-black text-white disabled:bg-[#aab6c9]"><FloppyDisk size={19} />{busy ? '正在保存……' : editDraft.entryId ? '保存并更新时间轴' : '保存并加入时间轴'}</button>
  </main>;

  const renderControl = () => <main className="min-h-0 flex-1 overflow-y-auto px-5 pb-[calc(var(--safe-bottom)+28px)] pt-4"><button onClick={() => setView('timeline')} className="flex items-center gap-1 text-xs font-bold text-[#59677b]"><CaretLeft size={16} />返回时间轴</button><h2 className="mt-7 text-[28px] font-black tracking-[-0.035em] text-[#15243b]">角色控制中心</h2><p className="mt-2 text-sm leading-6 text-[#5b677a]">每次新增日程，会自动把标题、时间和随笔卡片发给这里选中的角色。修改选择只影响之后的新记录，不会补发历史。</p>
    {characters.length === 0 ? <div className="py-24 text-center text-sm text-[#718096]">先在神经链接中创建角色。</div> : <div className="mt-8 divide-y divide-[#d6dbe3]">{characters.map(char => { const checked = settings.selectedCharIds.includes(char.id); return <button key={char.id} onClick={() => void toggleRecipient(char.id)} className="flex w-full items-center gap-4 py-4 text-left focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#2f6fed]"><div className="h-12 w-12 shrink-0 overflow-hidden rounded-full bg-[#dde3eb]">{char.avatar ? <img src={char.avatar} alt={char.name} className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center font-black text-[#536177]">{char.name.slice(0, 1)}</div>}</div><div className="min-w-0 flex-1"><p className="truncate text-sm font-black text-[#24354f]">{char.name}</p><p className="mt-1 text-[10px] text-[#788497]">{checked ? '之后会收到我的日程卡片' : '不会收到新的日程卡片'}</p></div><div className={`flex h-7 w-7 items-center justify-center rounded-full ${checked ? 'bg-[#2f6fed] text-white' : 'border border-[#aeb8c6] text-transparent'}`}><Check size={15} weight="bold" /></div></button>; })}</div>}
  </main>;

  const renderArchives = () => <main className="min-h-0 flex-1 overflow-y-auto px-5 pb-[calc(var(--safe-bottom)+28px)] pt-4">
    <button onClick={() => setView('timeline')} className="flex items-center gap-1 text-xs font-bold text-[#59677b]"><CaretLeft size={16} />返回当前日程</button>
    <h2 className="mt-7 text-[28px] font-black tracking-[-0.035em] text-[#15243b]">历史归档</h2>
    <p className="mt-2 text-sm leading-6 text-[#5b677a]">这里按你点击“进入下一天”的顺序保存，不受自然日零点影响。</p>
    {archives.length === 0 ? <div className="mt-10 border-y border-[#d5dae2] py-20 text-center"><Archive size={38} className="mx-auto text-[#8d99aa]" /><p className="mt-4 text-sm font-black text-[#34445c]">还没有归档记录</p><p className="mt-2 text-xs text-[#718096]">当前记录完成后，再手动进入下一天。</p></div>
      : <div className="mt-8 divide-y divide-[#d6dbe3] border-y border-[#d6dbe3]">{archives.map(archive => {
        const archiveEntries = entries.filter(entry => archive.entryIds.includes(entry.id));
        return <button key={archive.id} onClick={() => { setSelectedArchiveId(archive.id); setView('archive'); }} className="flex min-h-20 w-full items-center gap-4 py-4 text-left focus:outline-none focus:ring-2 focus:ring-inset focus:ring-[#2f6fed]"><div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-[12px] bg-[#e3e9f1] text-[#405777]"><Archive size={21} /></div><div className="min-w-0 flex-1"><p className="text-sm font-black text-[#22334d]">{archiveLabel(archive)}</p><p className="mt-1 text-[10px] leading-4 text-[#758195]">{archiveEntries.length} 条日程 · {shortDate(archive.archivedAt)} {clock(archive.archivedAt)} 归档</p></div><ArrowRight size={17} className="shrink-0 text-[#7b889b]" /></button>;
      })}</div>}
  </main>;

  const renderArchive = () => selectedArchive ? <main className="min-h-0 flex-1 overflow-y-auto px-5 pb-[calc(var(--safe-bottom)+28px)] pt-4">
    <button onClick={() => { setView('archives'); setSelectedArchiveId(null); }} className="flex items-center gap-1 text-xs font-bold text-[#59677b]"><CaretLeft size={16} />返回历史归档</button>
    <h2 className="mt-7 text-[28px] font-black tracking-[-0.035em] text-[#15243b]">{archiveLabel(selectedArchive)}</h2>
    <p className="mt-2 text-sm leading-6 text-[#5b677a]">共 {selectedArchiveEntries.length} 条日程，于 {shortDate(selectedArchive.archivedAt)} {clock(selectedArchive.archivedAt)} 进入下一天。</p>
    {renderTotals(selectedArchiveEntries, selectedArchive.archivedAt)}
    <div className="mt-7">{renderTimelineEntries(selectedArchiveEntries, { readOnly: true, emptyText: '这份归档中的日程已经被删除' })}</div>
  </main> : renderArchives();

  const subtitle = view === 'edit' ? editDraft?.entryId ? 'EDIT TIMELINE' : 'NEW TIMELINE'
    : view === 'archives' ? 'ARCHIVES' : view === 'archive' ? 'ARCHIVED DAY'
      : view === 'control' ? 'RECIPIENTS' : 'REAL TIME LOG';

  return <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#f4f6f8]" style={{ paddingTop: 'var(--chrome-top)' }}><header className="flex h-14 shrink-0 items-center justify-between px-4"><button onClick={goBack} className="flex h-10 w-10 items-center justify-center rounded-full text-[#40506a]" aria-label="返回"><CaretLeft size={24} /></button><div className="text-center"><h1 className="text-base font-black text-[#172740]">我的日程</h1><p className="text-[9px] font-bold tracking-[0.14em] text-[#738097]">{subtitle}</p></div><button disabled={view === 'edit' || view === 'archives' || view === 'archive'} onClick={() => setView(view === 'control' ? 'timeline' : 'control')} className={`flex h-10 w-10 items-center justify-center rounded-full disabled:opacity-20 ${view === 'control' ? 'bg-[#dce8ff] text-[#2457ae]' : 'text-[#40506a]'}`} aria-label="角色控制中心"><GearSix size={21} /></button></header>{view === 'timeline' ? renderTimeline() : view === 'edit' ? renderEdit() : view === 'control' ? renderControl() : view === 'archives' ? renderArchives() : renderArchive()}</div>;
};

export default MyScheduleApp;
