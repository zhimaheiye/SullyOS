import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CharacterProfile, Emoji, Message, VisionApiConfig } from '../../types';
import { DB } from '../../utils/db';
import { selectCharacterContextMessages } from '../../utils/chatContextRange';
import { collectVisionItems, emojiVisionItems, describePreflightItem, commitPreflightItem, seedVisionDescriptions, editPreflightVision, markPreflightFailure, isPreflightRefUsable, visionPreflightError, type VisionPreflightItem } from '../../utils/visionPreflight';
import { findStableVisionAsset, visionAssetVersion, visionCacheEpoch, VISION_DESCRIPTION_LIMIT } from '../../utils/visionAssetCache';
import { ArrowClockwise, PencilSimple, X } from '@phosphor-icons/react';
import TokenImg from '../os/TokenImg';

interface Row { item: VisionPreflightItem; selected: boolean; state: 'missing' | 'known' | 'ready' | 'running' | 'success' | 'failed'; error?: string; cached?: string; cachedBlank?: boolean }
interface Props { char?: CharacterProfile; emojis?: Emoji[]; targetMessage?: Message; operationId?: string; config?: VisionApiConfig; onClose: () => void; onUpdated?: () => void | Promise<void>; onSettings?: () => void }
const startedDirectOperations = new Set<string>();
const shownDescription = (row: Row) => row.item.manualBlank ? '' : row.item.description || row.cached || '';
const intentionallyBlank = (row: Row) => row.item.manualBlank || !row.item.description && row.cachedBlank;
const selectable = (row: Row) => !row.item.description && !row.item.manualBlank && !row.cachedBlank && isPreflightRefUsable(row.item.ref);
/** Standalone explicit Vision work. Closing aborts; reopening rescans persisted successes. */
export default function VisionPreflightModal({ char, emojis, targetMessage, operationId, config, onClose, onUpdated, onSettings }: Props) {
  const [allHistory, setAllHistory] = useState(false), [rows, setRows] = useState<Row[]>([]), [loading, setLoading] = useState(true), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const [filter, setFilter] = useState('all'), [editor, setEditor] = useState<{ item: VisionPreflightItem; text: string; initial: string; error?: string } | null>(null), [directAttempted, setDirectAttempted] = useState(false);
  const controller = useRef<AbortController | null>(null), loadVersion = useRef(0), mounted = useRef(true), lock = useRef(false);
  const dialogRef = useRef<HTMLElement | null>(null);
  const initialEmojis = useRef(emojis), charRef = useRef(char); charRef.current = char;
  const direct = !!targetMessage;
  const scope = operationId || char?.id || emojis?.map(item => item.name).join('\u0000');
  const load = async () => {
    const version = ++loadVersion.current; setLoading(true); setError('');
    try {
      let items: VisionPreflightItem[];
      if (targetMessage) {
        const latest = await DB.getMessageById(targetMessage.id);
        if (!latest || latest.charId !== targetMessage.charId || latest.charId !== charRef.current?.id || latest.groupId || latest.role !== targetMessage.role || latest.type !== 'image' || latest.content !== targetMessage.content)
          throw Error('消息原图或归属已变化，请重新打开消息菜单');
        items = collectVisionItems([latest]).filter(item => item.path === 'image');
        if (items.length !== 1) throw Error('这条消息已不再是可补全的图片');
      } else {
        items = initialEmojis.current
          ? emojiVisionItems((await DB.getEmojis()).filter(item => initialEmojis.current!.some(original => original.name === item.name)))
          : collectVisionItems((await DB.peekMessagesByCharId(charRef.current!.id)).filter(m => !m.groupId));
      }
      let inRange = items;
      if (!targetMessage && !initialEmojis.current && !allHistory) {
        const history = await DB.peekMessagesByCharId(charRef.current!.id);
        const ids = new Set(selectCharacterContextMessages(history, charRef.current!).map(m => m.id));
        inRange = items.filter(item => item.message && ids.has(item.message.id));
      }
      const next: Row[] = [];
      for (const item of inRange) {
        const cached = await findStableVisionAsset(item.ref, item.semantics).catch(() => null);
        next.push({ item: { ...item, assetSnapshot: { key: cached?.key || item.emoji?.vision?.key || null, version: visionAssetVersion(cached) } }, cached: cached?.description, cachedBlank: cached?.origin === 'manual' && !cached.description, selected: !item.description && !item.manualBlank && isPreflightRefUsable(item.ref) && item.eligible && cached?.origin !== 'manual',
          state: item.description || item.manualBlank || cached?.origin === 'manual' && !cached.description ? 'known' : cached?.description ? 'ready' : item.emoji?.visionError || item.message?.metadata?.visionPreflightErrors?.[item.path] ? 'failed' : 'missing', error: item.emoji?.visionError || item.message?.metadata?.visionPreflightErrors?.[item.path] });
      }
      if (mounted.current && version === loadVersion.current) setRows(next);
    } catch (cause) { if (mounted.current && version === loadVersion.current) setError(visionPreflightError(cause)); }
    finally { if (mounted.current && version === loadVersion.current) setLoading(false); }
  };
  useEffect(() => { mounted.current = true; initialEmojis.current = emojis; controller.current?.abort(); controller.current = null; lock.current = false; setDirectAttempted(false); setBusy(false); setEditor(null); void load(); return () => { mounted.current = false; loadVersion.current++; controller.current?.abort(); }; }, [allHistory, scope]);
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; dialogRef.current?.focus(); return () => { if (previous?.isConnected) previous.focus(); }; }, []);
  useEffect(() => {
    const reset = () => { controller.current?.abort(); setError('存档已切换，请关闭后重新打开补图工具'); setRows([]); };
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Tab') {
        const elements = [...(dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),summary') || [])].filter(el => el.getClientRects().length > 0);
        const first = elements[0], last = elements.at(-1);
        if (first && (!dialogRef.current?.contains(document.activeElement) || document.activeElement === dialogRef.current || event.shiftKey && document.activeElement === first || !event.shiftKey && document.activeElement === last)) { event.preventDefault(); (event.shiftKey ? last : first)?.focus(); }
      }
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); controller.current?.abort(); onClose(); } };
    window.addEventListener('personal-memory-reset', reset); window.addEventListener('keydown', escape, true);
    return () => { window.removeEventListener('personal-memory-reset', reset); window.removeEventListener('keydown', escape, true); };
  }, [onClose]);
  const patch = (id: string, value: Partial<Row>) => { if (mounted.current) setRows(previous => previous.map(row => row.item.id === id ? { ...row, ...value } : row)); };
  const refreshLibrary = async () => {
    if (!initialEmojis.current) return;
    const fresh = new Map(emojiVisionItems(await DB.getEmojis()).map(item => [item.id, item]));
    if (mounted.current) setRows(previous => previous.map(row => {
      const value = fresh.get(row.item.id), vision = value?.emoji?.vision;
      const item = value ? { ...value, assetSnapshot: {key:vision?.key || null,version:visionAssetVersion(vision?.key ? vision : null)} } : null;
      return item ? { ...row, item, cached: item.description, cachedBlank: item.manualBlank, selected: item.description || item.manualBlank ? false : row.selected } : row;
    }));
  };
  const run = async (onlyFailed = false) => {
    if (lock.current || loading || editor) return;
    const chosen = rows.filter(row => row.selected && selectable(row) && (!onlyFailed || row.state === 'failed'));
    if (!chosen.length) return;
    lock.current = true; const ac = new AbortController(); controller.current = ac; setBusy(true); setError('');
    try {
      const epoch = await visionCacheEpoch(), failedAssets = new Set<string>();
      await seedVisionDescriptions(rows.map(row => row.item), ac.signal, epoch);
      for (const row of chosen) {
        ac.signal.throwIfAborted(); patch(row.item.id, { state: 'running', error: '' });
        try {
          const asset = await describePreflightItem(row.item, config, ac.signal, epoch, failedAssets);
          if (!asset.description) { patch(row.item.id, { state: 'known', selected: false, error: '素材已被手动留空；批处理未覆盖' }); continue; }
          const committed = await commitPreflightItem(row.item, asset, epoch, ac.signal);
          patch(row.item.id, { state: 'success', selected: false, item: committed.item, cached: committed.description });
        } catch (cause) { if (ac.signal.aborted) { patch(row.item.id, { state: 'missing' }); throw cause; } const safeError = visionPreflightError(cause); await markPreflightFailure(row.item, epoch, safeError).catch(() => undefined); patch(row.item.id, { state: 'failed', error: safeError }); }
      }
    } catch (cause) { if (mounted.current && controller.current === ac) setError(visionPreflightError(cause)); }
    finally { if (controller.current === ac) { lock.current = false; if (mounted.current) setBusy(false); if (mounted.current) await onUpdated?.(); } }
  };
  useEffect(() => {
    if (!direct || loading || directAttempted || rows.length !== 1 || !selectable(rows[0])) return;
    if (operationId && startedDirectOperations.has(operationId)) { setDirectAttempted(true); return; }
    if (operationId) { startedDirectOperations.add(operationId); if (startedDirectOperations.size > 128) startedDirectOperations.delete(startedDirectOperations.values().next().value!); }
    setDirectAttempted(true);
    void run();
  }, [direct, directAttempted, loading, rows.length, scope]);
  const regenerate = async (row: Row) => {
    if (lock.current) return;
    lock.current = true; const ac = new AbortController(); controller.current = ac; setBusy(true); setError(''); patch(row.item.id, { state: 'running', error: '' });
    let epoch = '';
    try {
      epoch = await visionCacheEpoch();
      const asset = await describePreflightItem(row.item, config, ac.signal, epoch, undefined, { regenerate: true });
      const saved = await commitPreflightItem(row.item, asset, epoch, ac.signal);
      if (mounted.current && controller.current === ac) { patch(row.item.id, { item: saved.item, state: 'success', selected: false, cached: saved.description, cachedBlank: false }); await refreshLibrary(); await onUpdated?.(); }
    } catch (cause) {
      if (mounted.current && controller.current === ac) {
        const message = visionPreflightError(cause);
        if (!ac.signal.aborted && epoch) await markPreflightFailure(row.item, epoch, message).catch(() => undefined);
        patch(row.item.id, { state: ac.signal.aborted ? row.state : 'failed', error: message }); await onUpdated?.();
      }
    } finally { if (controller.current === ac) { lock.current = false; if (mounted.current) setBusy(false); } }
  };
  const saveEdit = async () => {
    if (!editor || lock.current || editor.text === editor.initial) return;
    lock.current = true; const ac = new AbortController(); controller.current = ac; setBusy(true);
    try {
      const saved = await editPreflightVision(editor.item, editor.text, ac.signal);
      if (mounted.current && controller.current === ac) {
        if (saved) patch(editor.item.id, { item: saved.item, state: 'success', selected: false, error: '', cached: saved.description, cachedBlank: saved.item.manualBlank });
        setEditor(null); await refreshLibrary(); await onUpdated?.();
      }
    } catch (cause) { if (mounted.current && controller.current === ac) setEditor(value => value ? { ...value, error: visionPreflightError(cause) } : value); }
    finally { if (controller.current === ac) { lock.current = false; if (mounted.current) setBusy(false); } }
  };
  const selected = rows.filter(row => row.selected && selectable(row)), maximumCalls = new Set(selected.filter(row => !row.cached).map(row => `${row.item.semantics}:${row.item.ref}`)).size;
  const visible = rows.filter(row => filter === 'all' || filter === 'failed' ? filter === 'all' || row.state === 'failed' : filter === 'known' ? !!(shownDescription(row) || intentionallyBlank(row)) : !shownDescription(row) && !intentionallyBlank(row));
  const eligibleVisible = visible.filter(selectable), visibleSelected = eligibleVisible.filter(row => row.selected).length;
  const allSelected = eligibleVisible.length > 0 && visibleSelected === eligibleVisible.length;
  const partiallySelected = visibleSelected > 0 && !allSelected;
  const selectionDisabled = busy || loading || !!editor;
  const hiddenSelected = selected.length - visibleSelected;
  const toggleVisible = () => {
    if (lock.current || selectionDisabled) return;
    const ids = new Set(eligibleVisible.map(row => row.item.id));
    setRows(previous => previous.map(row => ids.has(row.item.id) && selectable(row) ? { ...row, selected: !allSelected } : row));
  };
  const statuses = { missing: '未识别', known: '已有描述', ready: '可复用', running: '识图中', success: '已保存', failed: '失败' };
  const button = 'min-h-11 rounded-xl px-3 py-2 text-sm font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:opacity-40';
  return createPortal(<div className="fixed inset-0 z-[120] bg-black/40 flex items-center justify-center p-3" style={{ paddingTop: 'calc(var(--safe-top,0px) + 12px)', paddingBottom: 'calc(var(--safe-bottom,0px) + 12px)' }}>
    <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={emojis ? '表情图片描述' : '补全图片描述'} className="flex min-h-0 max-h-full w-full max-w-lg flex-col rounded-3xl bg-[#f7f7f2] text-slate-800 shadow-xl" style={{ maxHeight: 'min(90dvh,850px)' }}>
      <header className="flex items-center justify-between gap-2 p-4 border-b border-black/5"><h2 className="font-bold">{emojis ? '表情图片描述' : '补全图片描述'}</h2><button aria-label="关闭" className={button} onClick={() => { controller.current?.abort(); onClose(); }}><X size={20} weight="bold"/></button></header>
      <div className="overflow-y-auto min-h-0 flex-1 p-4 space-y-3">
        <p className="text-xs leading-5">{direct ? '只处理这条图片消息。' : ''}独立识图：{config?.model || '未配置'}。只保存图片描述，不生成聊天回复。</p>
        {!direct && !emojis && <label className="block text-xs">扫描范围<select aria-label="图片扫描范围" disabled={busy || !!editor} value={allHistory ? 'all' : 'context'} onChange={event => setAllHistory(event.target.value === 'all')} className="ml-2 rounded-lg bg-white p-2"><option value="context">当前有效上下文</option><option value="all">当前会话全部历史</option></select></label>}
        {!direct && <><div className="flex flex-wrap items-center gap-2"><select aria-label="描述筛选" disabled={!!editor} value={filter} onChange={event => setFilter(event.target.value)} className="rounded-xl bg-white p-2 text-xs"><option value="all">全部 · {rows.length}</option><option value="missing">未识别</option><option value="known">已有描述 / 可复用</option><option value="failed">失败</option></select><button disabled={busy || loading || !!editor} className={`${button} text-xs`} onClick={() => void load()}>重新扫描</button><label className={`inline-flex min-h-11 items-center gap-2 rounded-xl px-2 text-xs font-bold ${selectionDisabled || !eligibleVisible.length ? 'opacity-40' : 'cursor-pointer'}`}><input type="checkbox" aria-label="全选当前筛选" aria-checked={partiallySelected ? 'mixed' : allSelected} ref={input => { if (input) input.indeterminate = partiallySelected; }} checked={allSelected} disabled={selectionDisabled || !eligibleVisible.length} onChange={toggleVisible} className="h-5 w-5 shrink-0 accent-emerald-800"/>{allSelected ? '取消全选' : '全选'}</label></div>
        {hiddenSelected > 0 && <p className="text-xs text-slate-600">另有{hiddenSelected}项已选内容在其它筛选中</p>}
        <p className="text-xs text-slate-600">已选{selected.length}项 · 已有{rows.filter(row => !!row.item.description).length}项 · 可复用{rows.filter(row => !row.item.description && !!row.cached).length}项 · 批量补缺最多{maximumCalls}种素材需识图，同内容合并。重新生成会单独调用一次；GIF最多5张代表帧合为一次请求，图片输入会增加用量。</p></>}
        {loading ? <p role="status">正在读取本机会话…</p> : !visible.length ? <p className="py-8 text-center text-sm text-slate-500">{rows.length ? '当前筛选没有图片或表情' : '没有需要整理的图片或表情'}</p> : visible.map(row => <article key={row.item.id} className="rounded-2xl bg-white p-3 space-y-2 border border-black/5">
          <div className="flex gap-3 items-start">{!direct && <input type="checkbox" aria-label={`选择${row.item.label}`} className="mt-3 h-5 w-5 shrink-0 accent-emerald-800" checked={row.selected && selectable(row)} disabled={selectionDisabled || !selectable(row)} onChange={event => { if (!lock.current && !selectionDisabled && selectable(row)) patch(row.item.id, { selected: event.target.checked }); }} />}
            <TokenImg value={row.item.ref} alt="待整理原图" className="h-14 w-14 rounded-lg object-contain shrink-0" />
            <div className="min-w-0 flex-1"><b className="text-xs break-words">{row.item.label}</b><span className="block text-xs text-slate-500 mt-1">{intentionallyBlank(row) ? '已手动留空' : !isPreflightRefUsable(row.item.ref) ? '原图不可用' : statuses[row.state]}{!row.item.eligible && !row.item.description ? ' · 旧表情仅在明确勾选后补齐' : ''}</span></div>
          </div>
          {shownDescription(row) && <details open={direct || undefined}><summary className="cursor-pointer text-xs min-h-8">查看描述</summary><p className="text-sm leading-6 whitespace-pre-wrap break-words">{shownDescription(row)}</p></details>}
          {row.error && <p role="status" className="text-xs text-rose-700">{row.error}</p>}
          {editor?.item.id === row.item.id ? <div className="space-y-2 border-t border-slate-100 pt-3">
            <label className="block text-xs font-bold">图片描述<textarea autoFocus aria-label="素材图片描述" rows={6} value={editor.text} disabled={busy} onChange={event => setEditor({ ...editor, text: event.target.value, error: '' })} className="mt-2 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm font-normal focus:border-emerald-700 focus:outline-none" /></label>
            <p role={editor.text.length > VISION_DESCRIPTION_LIMIT ? 'alert' : undefined} className={`text-xs ${editor.text.length > VISION_DESCRIPTION_LIMIT ? 'text-rose-700' : 'text-slate-500'}`}>{editor.text.length} / {VISION_DESCRIPTION_LIMIT}字{editor.text.length > VISION_DESCRIPTION_LIMIT ? '，请缩短后保存；原描述未改动' : ''}</p>
            {editor.error && <p role="alert" className="text-xs text-rose-700">{editor.error}</p>}
            <div className="flex flex-wrap gap-2"><button disabled={busy || editor.text === editor.initial || editor.text.length > VISION_DESCRIPTION_LIMIT} className={`${button} bg-emerald-800 text-white`} onClick={() => void saveEdit()}>保存描述</button><button disabled={busy} className={`${button} bg-slate-100`} onClick={() => setEditor(null)}>取消编辑</button></div>
          </div> : <div className="flex flex-wrap gap-2"><button disabled={busy || !!editor || !isPreflightRefUsable(row.item.ref)} className={`${button} inline-flex items-center gap-1.5 text-xs bg-slate-50`} onClick={() => void regenerate(row)}><ArrowClockwise size={15} weight="bold"/>重新生成</button><button disabled={busy || !!editor} className={`${button} inline-flex items-center gap-1.5 text-xs bg-slate-50`} onClick={() => { const text = shownDescription(row); setEditor({ item: row.item, text, initial: text }); }}><PencilSimple size={15} weight="bold"/>编辑描述</button></div>}
          {!isPreflightRefUsable(row.item.ref) && <p className="text-xs text-slate-500">原图不可用，不能重新生成；已有描述仍可编辑。</p>}
        </article>)}
        {rows.some(row => row.state === 'success' || row.state === 'failed') && <p role="status" className="text-sm">本轮已保存{rows.filter(row => row.state === 'success').length}项 · 失败{rows.filter(row => row.state === 'failed').length}项</p>}
        {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
        {(!config?.model || !config.baseUrl || !config.apiKey) && <button className={button} onClick={onSettings}>配置独立识图API</button>}
      </div>
      <footer className="flex flex-wrap gap-2 border-t border-black/5 p-4">{busy ? <button className={`${button} bg-rose-100 text-rose-900`} onClick={() => controller.current?.abort()}>停止补全</button> : direct ? <>{directAttempted && rows.some(row => row.selected && (row.state === 'failed' || row.state === 'missing')) && <button disabled={loading || !!editor} className={`${button} bg-emerald-800 text-white`} onClick={() => void run()}>重试补全</button>}<button className={`${button} bg-white`} onClick={onClose}>完成</button></> : <><button className={`${button} bg-emerald-800 text-white`} disabled={loading || !!editor || !selected.length} onClick={() => void run()}>补全所选（{selected.length}）</button>{rows.some(row => row.state === 'failed' && row.selected) && <button disabled={!!editor} className={`${button} bg-white`} onClick={() => void run(true)}>仅重试所选失败项</button>}</>}</footer>
    </section>
  </div>, document.body);
}
