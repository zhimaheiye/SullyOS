import React, { useEffect, useState } from 'react';
import { DB } from '../utils/db';
import { shareOrDownloadBlob } from '../utils/shareExport';
import { validateMurderMysteryScript, type MurderMysteryScript, type ScriptDiagnostic } from '../utils/murderMystery/script';
import { createMurderMysterySession, initialGrantEvents, type MurderMysterySession } from '../utils/murderMystery/session';
import { useOS } from '../context/OSContext';
import MurderMysterySessionView from './MurderMysterySessionView';
import MurderMysteryV2View from './MurderMysteryV2View';

const inputClass = 'w-full rounded-xl border border-stone-300 bg-white px-3 py-2 text-sm text-stone-900';
const buttonClass = 'rounded-xl bg-stone-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40';

export default function MurderMysteryApp() {
  const { characters, apiPresets } = useOS();
  const [library, setLibrary] = useState<MurderMysteryScript[]>([]);
  const [sessions, setSessions] = useState<MurderMysterySession[]>([]);
  const [active, setActive] = useState<MurderMysterySession | null>(null);
  const [setupScript, setSetupScript] = useState<MurderMysteryScript | null>(null);
  const [seatMapping, setSeatMapping] = useState<Record<string, string>>({});
  const [investigatorCharId, setInvestigatorCharId] = useState('');
  const [dialogueApiPresetId, setDialogueApiPresetId] = useState('');
  const [draft, setDraft] = useState<MurderMysteryScript | null>(null);
  const [raw, setRaw] = useState('');
  const [diagnostics, setDiagnostics] = useState<ScriptDiagnostic[]>([]);
  const [error, setError] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const refresh = async () => { setLibrary(await DB.getMurderMysteryScripts()); setSessions(await DB.getMurderMysterySessions()); };
  useEffect(() => { void refresh().catch(e => setError(String(e))); }, []);
  const open = (script: MurderMysteryScript) => { setDraft(structuredClone(script)); setRaw(JSON.stringify(script, null, 2)); setDiagnostics([]); setError(''); setAdvanced(false); };
  const update = (change: Partial<MurderMysteryScript>) => setDraft(current => current ? { ...current, ...change } : current);
  const parseRaw = (text: string) => {
    try {
      const result = validateMurderMysteryScript(JSON.parse(text));
      setDiagnostics(result.diagnostics);
      if (result.script) { setDraft(result.script); setRaw(JSON.stringify(result.script, null, 2)); setAdvanced(false); setError(''); }
      else setError('剧本结构未通过校验；请按下方路径修正。');
    } catch (e) { setError(`JSON 解析失败：${String(e)}`); }
  };
  const importFile = async (file?: File) => { if (file) { setDraft(null); parseRaw(await file.text()); } };
  const save = async () => {
    if (!draft) return;
    const result = validateMurderMysteryScript(draft);
    setDiagnostics(result.diagnostics);
    if (!result.script) { setError('剧本结构未通过校验，未保存。'); return; }
    try { await DB.saveMurderMysteryScript(result.script); await refresh(); setError('已保存到本机剧本库。'); }
    catch (e) { setError(`保存失败：${String(e)}`); }
  };
  const exportScript = async () => {
    if (!draft) return;
    const result = validateMurderMysteryScript(draft);
    setDiagnostics(result.diagnostics);
    if (!result.script) { setError('请先修复结构错误再导出。'); return; }
    await shareOrDownloadBlob({ blob: new Blob([JSON.stringify(result.script, null, 2)], { type: 'application/json' }), fileName: `${result.script.id}.murder-mystery.json`, preferDownloadOnWeb: true });
  };
  const remove = async (script: MurderMysteryScript) => {
    if (!window.confirm(`删除剧本「${script.title}」？`)) return;
    try { await DB.deleteMurderMysteryScript(script.id); if (draft?.id === script.id) setDraft(null); await refresh(); }
    catch (e) { setError(`删除失败：${String(e)}`); }
  };
  const start = async () => {
    if (!setupScript) return;
    try {
      const session = createMurderMysterySession(setupScript, seatMapping, setupScript.investigator ? investigatorCharId : undefined, dialogueApiPresetId || undefined);
      const saved = await DB.createMurderMysterySession(session, initialGrantEvents(session));
      setActive(saved); setSetupScript(null); await refresh(); setError('');
    } catch (e) { setError(String(e)); }
  };
  if (active) return <main className="h-full overflow-y-auto bg-stone-100 px-4 text-stone-900" style={{ paddingTop: 'max(1rem, var(--chrome-top, 0px))', paddingBottom: 'max(2rem, var(--safe-bottom, 0px))' }}><div className="mx-auto max-w-3xl">{active.participation ? <MurderMysteryV2View initial={active} onBack={() => { setActive(null); void refresh(); }} /> : <MurderMysterySessionView initial={active} onBack={() => { setActive(null); void refresh(); }} />}</div></main>;
  return <main className="h-full overflow-y-auto bg-stone-100 px-4 text-stone-900" style={{ paddingTop: 'max(1rem, var(--chrome-top, 0px))', paddingBottom: 'max(2rem, var(--safe-bottom, 0px))' }}>
    <div className="mx-auto max-w-3xl space-y-5">
      <header><h1 className="text-2xl font-black">剧本杀 · 剧本库</h1><p className="mt-1 text-xs text-stone-600">导入、校稿与复用剧本；选择神经链接角色开局。</p></header>
      <section className="rounded-2xl bg-white p-4 shadow-sm"><h2 className="font-bold">本机对局</h2><div className="mt-3 space-y-2">{sessions.length ? [...sessions].sort((a,b) => b.updatedAt - a.updatedAt).map(item => <button key={item.id} className="block w-full rounded-xl border border-stone-200 p-3 text-left" onClick={() => setActive(item)}><b>{item.scriptSnapshot.title}</b><span className="ml-2 text-xs text-stone-500">{item.status === 'preparation' ? '开局准备' : item.status === 'playing' ? '进行中' : '已结束'}</span></button>) : <p className="text-sm text-stone-500">还没有对局。</p>}</div></section>
      <section className="rounded-2xl bg-white p-4 shadow-sm"><label className={buttonClass}>导入标准 JSON<input type="file" accept=".json,.murder-mystery.json" className="hidden" onChange={event => { void importFile(event.target.files?.[0]); event.target.value = ''; }} /></label><p className="mt-3 text-xs text-stone-500">原文 txt/md 请先交给外部 Agent 按仓库 Skill 预处理；导入时不调用模型。结构通过不代表剧情没有矛盾，请同时核对预处理的独立诊断报告。</p></section>
      <section className="rounded-2xl bg-white p-4 shadow-sm"><h2 className="font-bold">本机剧本</h2><div className="mt-3 space-y-2">{library.length ? library.map(script => <div key={script.id} className="flex items-center justify-between gap-2 rounded-xl border border-stone-200 p-3"><button className="min-w-0 flex-1 text-left" onClick={() => open(script)}><b className="block truncate">{script.title}</b><span className="text-xs text-stone-500">{script.seats.length} 席 · {script.phases.length} 阶段</span></button><button className="text-xs font-semibold disabled:opacity-40" onClick={() => { setSetupScript(script); setSeatMapping({}); setInvestigatorCharId(''); setDialogueApiPresetId(''); }}>开新局</button><button className="text-xs text-red-700" onClick={() => void remove(script)}>删除</button></div>) : <p className="text-sm text-stone-500">尚无剧本。先导入外部 Agent 整理的 JSON。</p>}</div></section>
      {setupScript && <section className="space-y-3 rounded-2xl bg-white p-4 shadow-sm"><h2 className="font-bold">为「{setupScript.title}」选角</h2><p className="text-xs text-stone-500">冻结本局剧本与身份；发本后进入准备室，正式开场另由主持人确认。</p>{setupScript.investigator && <label className="block text-sm font-semibold">{setupScript.investigator.name} · AI 调查者<select className={`mt-1 ${inputClass}`} value={investigatorCharId} onChange={e => setInvestigatorCharId(e.target.value)}><option value="">选择已有神经链接角色</option>{characters.map(char => <option key={char.id} value={char.id} disabled={Object.values(seatMapping).includes(char.id)}>{char.name}</option>)}</select></label>}{setupScript.seats.map(seat => setupScript.investigator && setupScript.humanSeatIds?.includes(seat.id) ? <p key={seat.id} className="rounded-xl bg-amber-50 p-3 text-sm">{seat.name} · 由你亲自扮演，不绑定 AI 角色</p> : <label key={seat.id} className="block text-sm font-semibold">{seat.name} · AI NPC<select className={`mt-1 ${inputClass}`} value={seatMapping[seat.id] || ''} onChange={e => setSeatMapping(current => ({ ...current, [seat.id]: e.target.value }))}><option value="">选择角色</option>{characters.map(char => <option key={char.id} value={char.id} disabled={char.id === investigatorCharId || Object.entries(seatMapping).some(([id, selected]) => id !== seat.id && selected === char.id)}>{char.name}</option>)}</select></label>)}{setupScript.investigator && <label className="block text-sm font-semibold">本 App 角色文字来源<select className={`mt-1 ${inputClass}`} value={dialogueApiPresetId} onChange={e => setDialogueApiPresetId(e.target.value)}><option value="">按各角色默认 API，再按全局 API</option>{apiPresets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}</select></label>}<div className="flex gap-2"><button className={buttonClass} onClick={() => void start()}>发初始资料，进入准备室</button><button onClick={() => setSetupScript(null)}>取消</button></div></section>}
      {draft && <section className="space-y-4 rounded-2xl bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-2"><h2 className="font-bold">主持人校稿</h2><span className="text-xs text-amber-700">含 GM 专属真相，请勿给玩家看</span></div>
        <label className="block text-xs font-semibold">标题<input className={`mt-1 ${inputClass}`} value={draft.title} onChange={e => update({ title: e.target.value })} /></label>
        <label className="block text-xs font-semibold">公开背景<textarea className={`mt-1 min-h-24 ${inputClass}`} value={draft.publicBackground} onChange={e => update({ publicBackground: e.target.value })} /></label>
        <div><h3 className="mb-2 text-sm font-bold">人物本与主观认知</h3>{draft.seats.map((seat, index) => <div key={seat.id} className="mb-3 space-y-2 rounded-xl border border-stone-200 p-3"><p className="font-semibold">{seat.name} <span className="text-xs text-stone-400">{seat.id}</span></p><textarea className={inputClass} aria-label={`${seat.name}个人本`} value={seat.personalScript} onChange={e => update({ seats: draft.seats.map((item, i) => i === index ? { ...item, personalScript: e.target.value } : item) })} /><p className="text-xs text-stone-500">主观认识可与客观真相不同；高级 JSON 可编辑信念和秘密条目。</p></div>)}</div>
        <div className="rounded-xl bg-amber-50 p-3"><h3 className="text-sm font-bold">主持人专属客观真相</h3>{draft.objectiveFacts.map(fact => <p key={fact.id} className="mt-2 text-xs">• {fact.text}</p>)}</div>
        <p className="text-xs text-stone-500">{draft.clues.length} 条线索 · {draft.deliverables.length} 份资料 · {draft.abilities.length} 项能力。可在高级 JSON 中编辑完整发放和权限字段。</p>
        <button className="text-sm font-semibold text-amber-800" onClick={() => { if (!advanced) setRaw(JSON.stringify(draft, null, 2)); setAdvanced(!advanced); }}>高级 JSON 编辑 {advanced ? '▲' : '▼'}</button>
        {advanced && <div className="space-y-2"><textarea className={`${inputClass} h-80 font-mono text-xs`} aria-label="剧本 JSON" value={raw} onChange={e => setRaw(e.target.value)} /><button className={buttonClass} onClick={() => parseRaw(raw)}>校验并应用 JSON</button><p className="text-xs text-stone-500">高级编辑内容须先点击“校验并应用 JSON”才进入当前草稿。</p></div>}
        <div className="flex flex-wrap gap-2"><button className={buttonClass} onClick={() => void save()}>保存剧本</button><button className={buttonClass} onClick={() => void exportScript()}>导出 JSON</button></div>
      </section>}
      {error && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
      {!!diagnostics.length && <section className="rounded-2xl bg-white p-4"><h2 className="font-bold">结构与引用诊断</h2>{diagnostics.map((item, index) => <p key={index} className="mt-2 text-xs"><b>{item.severity === 'error' ? '错误' : '待确认'}</b> {item.path}：{item.message}</p>)}</section>}
    </div>
  </main>;
}
