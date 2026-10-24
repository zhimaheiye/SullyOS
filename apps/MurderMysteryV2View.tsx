import React, { useEffect, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { buildInvestigatorView, buildPlayerView, effectiveSpeechMode, publicAudience, type MurderMysteryEvent, type MurderMysterySession } from '../utils/murderMystery/session';
import { requestMysteryInvestigatorAction, requestMysteryNpcAnswer, requestMysteryOocReply } from '../utils/murderMystery/service';
import type { MurderMysteryCommand } from '../utils/murderMystery/rules';
import { getMysteryAnswerOptions } from '../utils/murderMystery/script';
import MurderMysteryHostConsole from './MurderMysteryHostConsole';
import MurderMysteryEnding from './MurderMysteryEnding';

const button = 'rounded-xl bg-stone-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40';
const field = 'w-full rounded-xl border border-stone-300 bg-white p-3 text-sm';
const MAX_CALLS = 6;

export default function MurderMysteryV2View({ initial, onBack }: { initial: MurderMysterySession; onBack: () => void }) {
  const { characters, userProfile, apiConfig, apiPresets } = useOS();
  const [session, setSession] = useState(initial);
  const [events, setEvents] = useState<MurderMysteryEvent[]>([]);
  const [hostOpen, setHostOpen] = useState(false);
  const [selectedCharId, setSelectedCharId] = useState(Object.values(initial.seats)[0] || '');
  const [oocDraft, setOocDraft] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [publicDraft, setPublicDraft] = useState('');
  const [humanDraft, setHumanDraft] = useState('');
  const [publicMode, setPublicMode] = useState<'in_character' | 'out_of_character'>('out_of_character');
  const controller = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const alive = useRef(true);
  const investigatorId = session.participation!.investigatorCharId;
  const script = session.scriptSnapshot;
  const phase = script.phases.find(item => item.id === session.phaseId);
  const nextPhase = script.phases[script.phases.findIndex(item => item.id === session.phaseId) + 1];
  const investigator = characters.find(item => item.id === investigatorId);
  const appApi = () => {
    if (!session.dialogueApiPresetId) return undefined;
    const preset = apiPresets.find(item => item.id === session.dialogueApiPresetId);
    if (!preset) throw new Error('本局指定的 App API 预设已不存在；请恢复预设后重试，不会改用其他付费来源');
    return preset.config;
  };
  const nameOfSeat = (seatId?: string) => script.seats.find(item => item.id === seatId)?.name || seatId || '';
  const refresh = async () => {
    const [next, history] = await Promise.all([DB.getMurderMysterySession(initial.id), DB.getMurderMysteryEvents(initial.id)]);
    if (next && alive.current) { setSession(next); setEvents(history); }
    return { next, history };
  };
  useEffect(() => {
    alive.current = true;
    void refresh().catch(e => setError(String(e)));
    return () => { alive.current = false; controller.current?.abort(); };
  }, [initial.id]);
  useEffect(() => { setNote(session.strategyNotes[selectedCharId] || ''); }, [session.strategyNotes, selectedCharId]);
  const stop = () => { controller.current?.abort(); setStatus('调查已暂停；已保存的事件不会撤销。'); };
  const command = async (value: MurderMysteryCommand) => {
    const fresh = await DB.getMurderMysterySession(initial.id);
    if (!fresh) throw new Error('存档不存在');
    const next = await DB.applyMurderMysteryCommand(fresh.id, fresh.revision, value);
    await refresh(); return next;
  };
  const commandFromRevision = async (revision: number, value: MurderMysteryCommand) => {
    const next = await DB.applyMurderMysteryCommand(initial.id, revision, value);
    await refresh(); return next;
  };
  const runInvestigation = async () => {
    if (busyRef.current || !investigator) return;
    const abort = new AbortController(); controller.current = abort; busyRef.current = true; setBusy(true); setError('');
    try {
      let calls = 0;
      let feedback = '';
      while (!abort.signal.aborted && calls < MAX_CALLS) {
        const fresh = await DB.getMurderMysterySession(initial.id);
        if (!fresh || fresh.status !== 'playing') { setStatus('对局状态已变化。'); break; }
        if (fresh.pendingQuestion) {
          if (fresh.participation?.humanSeatIds.includes(fresh.pendingQuestion.targetSeatId)) { setStatus(`轮到你 · ${nameOfSeat(fresh.pendingQuestion.targetSeatId)}，等待你亲自回答。`); break; }
          const npc = characters.find(item => item.id === fresh.seats[fresh.pendingQuestion!.targetSeatId]);
          if (!npc) throw new Error('受询 AI 角色不存在');
          const history = await DB.getMurderMysteryEvents(fresh.id);
          setStatus(`${nameOfSeat(fresh.pendingQuestion.targetSeatId)} 正在回答…`);
          const answer = await requestMysteryNpcAnswer({ session: fresh, events: history, char: npc, user: userProfile, apiConfig, appApi: appApi(), signal: abort.signal });
          calls++;
          if (abort.signal.aborted) break;
          const answered = await commandFromRevision(fresh.revision, { type: 'answer_question', answer, speakerCharId: npc.id });
          await commandFromRevision(answered.revision, { type: 'advance_round' });
          continue;
        }
        if (fresh.pendingAbility) { setStatus('调查者申请了能力，等待 GM 批准。'); break; }
        if (fresh.pendingDecision) { setStatus('正式指认已形成私有候选，等待 GM 裁定。'); break; }
        const history = await DB.getMurderMysteryEvents(fresh.id);
        setStatus(`警探正在调查…本段模型调用 ${calls + 1}/${MAX_CALLS}`);
        const action = await requestMysteryInvestigatorAction({ session: fresh, events: history, char: investigator, user: userProfile, apiConfig, appApi: appApi(), signal: abort.signal, feedback });
        calls++;
        feedback = '';
        if (abort.signal.aborted) break;
        if (action.type === 'stop') { setStatus('警探暂时停止调查。'); break; }
        if (action.type === 'question') {
          try { await commandFromRevision(fresh.revision, { type: 'investigator_question', targetSeatId: action.targetSeatId, content: action.content, note: action.note }); }
          catch (e) { if (String(e).includes('封闭问题')) { feedback = String(e); setStatus('警探的问题需要改成明确的封闭问题，正在要求重问…'); continue; } throw e; }
        } else if (action.type === 'reason') {
          await commandFromRevision(fresh.revision, { type: 'investigator_reason', content: action.content, note: action.note });
        } else if (action.type === 'accuse') {
          const accused = await commandFromRevision(fresh.revision, { type: 'accuse', targetSeatId: action.targetSeatId, content: action.content, speechMode: 'in_character', speakerCharId: investigator.id });
          if (accused.pendingDecision) { setStatus('警探正式指认形成候选，等待 GM 裁定。'); break; }
          setStatus('警探的指认未触发阶段候选，可继续调查。');
        } else if (action.type === 'ability') {
          await commandFromRevision(fresh.revision, { type: 'request_ability', abilityId: action.abilityId, targetSeatId: action.targetSeatId });
          setStatus('警探申请能力，等待 GM 批准。'); break;
        }
      }
      if (abort.signal.aborted) setStatus('调查已暂停；已保存的事件不会撤销。');
      else if (calls >= MAX_CALLS) setStatus(`本段达到 ${MAX_CALLS} 次模型调用上限。点击“继续调查”可再运行一段。`);
    } catch (e) { if (!abort.signal.aborted) { setError(String(e)); setStatus('模型或存档操作失败，已暂停。可检查后继续。'); } }
    finally { controller.current = null; busyRef.current = false; if (alive.current) { setBusy(false); await refresh(); } }
  };
  const answerHuman = async (answer: string) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true);
    let committed = false;
    try {
      const answered = await command({ type: 'answer_question', answer });
      await commandFromRevision(answered.revision, { type: 'advance_round' });
      setHumanDraft(''); setStatus('你的回答已记录，警探继续调查。');
      committed = true;
    } catch (e) { setError(String(e)); await refresh(); }
    finally { busyRef.current = false; setBusy(false); }
    if (committed) void runInvestigation();
  };
  const sendOoc = async () => {
    const char = characters.find(item => item.id === selectedCharId);
    if (!char || !oocDraft.trim() || busyRef.current) return;
    const abort = new AbortController(); controller.current = abort; busyRef.current = true; setBusy(true); setError('');
    try {
      const fresh = await DB.getMurderMysterySession(initial.id); if (!fresh) throw new Error('存档不存在');
      const question = oocDraft.trim();
      const first = await DB.appendMurderMysteryEvent(fresh.id, fresh.revision, { channel: 'host_player_ooc', audienceIds: [char.id], speechMode: 'out_of_character', content: question, action: 'host_message' });
      setOocDraft(''); await refresh();
      const history = await DB.getMurderMysteryEvents(first.id);
      const result = await requestMysteryOocReply({ session: first, events: history, char, user: userProfile, apiConfig, appApi: appApi(), question, signal: abort.signal });
      if (!abort.signal.aborted) await DB.appendMurderMysteryEvent(first.id, first.revision, { channel: 'host_player_ooc', audienceIds: [char.id], speakerCharId: char.id, seatId: Object.entries(first.seats).find(([, id]) => id === char.id)?.[0], speechMode: 'out_of_character', content: result.reply, action: 'player_reply' }, { charId: char.id, text: result.strategyNote });
      await refresh();
    } catch (e) { if (!abort.signal.aborted) setError(String(e)); await refresh(); }
    finally { controller.current = null; busyRef.current = false; setBusy(false); }
  };
  const saveNote = async () => {
    try { const fresh = await DB.getMurderMysterySession(initial.id); if (!fresh) throw new Error('存档不存在');
      await DB.appendMurderMysteryEvent(fresh.id, fresh.revision, { channel: 'host_system', audienceIds: [], speechMode: 'system', content: '主持人编辑了 AI 玩家策略笔记', action: 'strategy_note_edit' }, { charId: selectedCharId, text: note });
      await refresh(); setStatus('策略笔记已保存。');
    } catch (e) { setError(String(e)); }
  };
  const sendPublic = async () => {
    if (!publicDraft.trim()) return;
    stop();
    try { const fresh = await DB.getMurderMysterySession(initial.id); if (!fresh) throw new Error('存档不存在');
      await DB.appendMurderMysteryEvent(fresh.id, fresh.revision, { channel: 'public_table', audienceIds: publicAudience(fresh), speechMode: publicMode, content: publicDraft.trim(), action: 'host_public_speech' });
      setPublicDraft(''); await refresh();
    } catch (e) { setError(String(e)); await refresh(); }
  };
  const seatName = (id: string) => characters.find(char => char.id === id)?.name || '已删除角色';
  const humanPending = session.pendingQuestion && session.participation!.humanSeatIds.includes(session.pendingQuestion.targetSeatId);
  const humanOptions = session.pendingQuestion ? getMysteryAnswerOptions(phase, session.pendingQuestion.targetSeatId) : undefined;
  const investigatorView = investigator ? buildInvestigatorView(session, events, investigator.id) : null;
  return <div className="space-y-4 pb-8">
    <div className="flex justify-between gap-3"><button className="text-sm text-stone-600" onClick={() => { stop(); onBack(); }}>← 剧本库与存档</button>{session.status === 'ended' && <button className="text-sm font-bold text-amber-800" onClick={() => setHostOpen(true)}>主持完整记录</button>}</div>
    {session.status === 'preparation' ? <>
      <header><p className="text-xs font-bold text-amber-700">准备室 · 尚未正式开场</p><h1 className="text-2xl font-black">{script.title}</h1><p className="text-sm text-stone-600">发本与皮下协商只保存在本机。正式开始后进入第一幕游戏桌。</p></header>
      <section className="rounded-2xl bg-white p-4"><h2 className="font-bold">本局参与者</h2><p className="mt-2 text-sm">警探：{seatName(investigatorId)} · 独立调查者</p>{script.seats.map(seat => <p key={seat.id} className="mt-1 text-sm">{seat.name}：{session.participation!.humanSeatIds.includes(seat.id) ? '你亲自扮演' : seatName(session.seats[seat.id]) + ' · AI NPC'}</p>)}</section>
      {script.seats.filter(seat => session.participation!.humanSeatIds.includes(seat.id)).map(seat => <section key={seat.id} className="rounded-2xl bg-white p-4"><h2 className="font-bold">你的人物本 · {seat.name}</h2><p className="mt-2 whitespace-pre-wrap text-sm">{seat.personalScript}</p>{seat.beliefs.map(item => <p key={item.id} className="mt-2 text-xs">主观认知：{item.text}</p>)}{seat.privateKnowledge.map(item => <p key={item.id} className="mt-2 text-xs">本人私知：{item.text}</p>)}<p className="mt-2 text-xs text-amber-800">这些资料仅供你扮演；警探不会看到。正式受询由你亲自回答。</p></section>)}
      <section className="rounded-2xl bg-white p-4"><h2 className="font-bold">公开开场资料</h2><p className="mt-2 text-sm">{script.publicBackground}</p>{investigatorView?.openingStatements.map(item => <p key={item.seatId} className="mt-2 text-sm">{nameOfSeat(item.seatId)}：{item.text}</p>)}{!investigatorView?.openingStatements.length && <p className="mt-2 text-xs text-amber-800">本摘要版缺少原始公开口供，请主持人在剧本 JSON 中补充后再用完整资料开局。</p>}{investigatorView?.clues.map(item => <p key={item.id} className="mt-1 text-xs">线索 · {item.text}</p>)}</section>
      <section className="rounded-2xl bg-white p-4"><h2 className="font-bold">AI 玩家发本与皮下协商</h2><select className={`mt-2 ${field}`} value={selectedCharId} onChange={e => setSelectedCharId(e.target.value)}>{Object.values(session.seats).map(id => <option key={id} value={id}>{seatName(id)}</option>)}</select>{selectedCharId && <><p className="mt-2 whitespace-pre-wrap rounded-xl bg-stone-100 p-3 text-xs">{buildPlayerView(session, events, selectedCharId).seat.personalScript}</p><div className="mt-2 max-h-48 space-y-2 overflow-y-auto">{events.filter(event => event.channel === 'host_player_ooc' && event.audienceIds.includes(selectedCharId)).map(event => <p key={event.id} className="rounded-xl bg-stone-100 p-2 text-sm">{event.speakerCharId ? seatName(event.speakerCharId) : '主持人'}：{event.content}</p>)}</div><textarea className={`mt-2 ${field}`} value={oocDraft} onChange={e => setOocDraft(e.target.value)} placeholder="与该 AI 角色皮下讨论" /><button className={`mt-2 ${button}`} disabled={busy || !oocDraft.trim()} onClick={() => void sendOoc()}>发送皮下消息</button><textarea className={`mt-3 ${field}`} value={note} onChange={e => setNote(e.target.value)} placeholder="可编辑个人策略笔记" /><button className={`mt-2 ${button}`} disabled={busy} onClick={() => void saveNote()}>保存笔记</button></>}</section>
      <button className={button} disabled={busy} onClick={() => void command({ type: 'game_start' }).then(() => setStatus('第一幕已开场。点击“开始调查”后警探才会请求模型。')).catch(e => setError(String(e)))}>正式开始游戏</button>
      <button className="ml-3 text-sm text-amber-800" onClick={() => setHostOpen(true)}>主持控制台</button>
    </> : <>
      <header className="rounded-2xl bg-stone-900 p-5 text-white"><p className="text-xs opacity-70">{session.status === 'ended' ? '结算场景' : '公开游戏桌'} · 第 {script.phases.findIndex(item => item.id === session.phaseId) + 1} 幕</p><h1 className="mt-1 text-2xl font-black">{phase?.title || script.title}</h1><p className="mt-2 text-sm opacity-80">{phase?.completionHint || phase?.publicRules?.join(' ') || '按当前幕目标调查。'}</p></header>
      {session.status === 'playing' && <section className="rounded-2xl bg-white p-4"><div className="flex flex-wrap items-center gap-2"><button className={button} disabled={busy || !!session.pendingQuestion || !!session.pendingAbility || !!session.pendingDecision || !investigator} onClick={() => void runInvestigation()}>{events.some(item => item.action === 'investigator_question') ? '继续调查' : '开始调查'}</button><button className="text-sm font-bold text-red-700 disabled:opacity-40" disabled={!busy} onClick={stop}>暂停调查</button><button className="ml-auto text-sm font-bold text-amber-800" onClick={() => { stop(); setHostOpen(true); }}>主持控制台</button></div><p role="status" className="mt-2 text-xs text-stone-600">{busy ? '模型等待中 · ' : ''}{status || (session.pendingQuestion ? `等待 ${nameOfSeat(session.pendingQuestion.targetSeatId)} 回答` : '调查暂停，刷新后不会自动请求模型。')}</p>{session.pendingDecision && <p className="mt-2 rounded-xl bg-amber-50 p-2 text-xs">GM 私有候选：{session.pendingDecision.reason}</p>}</section>}
      {humanPending && <section className="rounded-2xl border-2 border-amber-500 bg-amber-50 p-4"><h2 className="font-bold">轮到你 · {nameOfSeat(session.pendingQuestion!.targetSeatId)}</h2><p className="mt-2 text-sm">警探问：{session.pendingQuestion!.content}</p><p className="mt-2 text-xs">你按角色主观认知亲自回答；系统不会代答。</p>{humanOptions ? <div className="mt-3 grid grid-cols-2 gap-3">{humanOptions.map(option => <button key={option} className={`${button} min-h-11`} disabled={busy} onClick={() => void answerHuman(option)}>{option}</button>)}</div> : <><textarea className={`mt-2 ${field}`} value={humanDraft} onChange={e => setHumanDraft(e.target.value)} /><button className={`mt-2 ${button}`} disabled={!humanDraft.trim() || busy} onClick={() => void answerHuman(humanDraft)}>提交戏内回答</button></>}</section>}
      {session.pendingAbility && <section className="rounded-2xl bg-amber-50 p-4"><h2 className="font-bold">警探申请能力 · GM 待批准</h2><p className="mt-1 text-sm">{script.abilities.find(item => item.id === session.pendingAbility!.abilityId)?.name} → {nameOfSeat(session.pendingAbility.targetSeatId)}</p><div className="mt-3 flex gap-2"><button className={button} onClick={() => void command({ type: 'use_ability', holderSeatId: script.investigator!.id, abilityId: session.pendingAbility!.abilityId, targetSeatId: session.pendingAbility!.targetSeatId }).then(() => setStatus('能力已执行；可继续调查。')).catch(e => setError(String(e)))}>批准并执行</button><button onClick={() => void command({ type: 'decline_ability' }).catch(e => setError(String(e)))}>拒绝</button></div></section>}
      <section className="rounded-2xl bg-white p-4"><h2 className="font-bold">公开交锋</h2><div className="mt-3 max-h-[45vh] space-y-2 overflow-y-auto">{events.filter(event => event.channel === 'public_table').map(event => <p key={event.id} className="rounded-xl bg-stone-100 p-3 text-sm"><b>{event.speakerCharId === investigatorId ? investigator?.name : event.seatId ? nameOfSeat(event.seatId) : '主持人'}：</b>{effectiveSpeechMode(event, events) === 'out_of_character' && <span className="mr-1 text-xs text-amber-700">[皮下公开]</span>}{event.content}</p>)}</div>{session.status === 'playing' && <><div className="mt-3 flex gap-3 text-xs"><button className={publicMode === 'in_character' ? 'font-bold' : ''} onClick={() => setPublicMode('in_character')}>戏内主持发言</button><button className={publicMode === 'out_of_character' ? 'font-bold' : ''} onClick={() => setPublicMode('out_of_character')}>皮下公开</button></div><textarea className={`mt-2 ${field}`} value={publicDraft} onChange={e => setPublicDraft(e.target.value)} placeholder="主持人公开插话；不会代替抚子回答" /><button className={`mt-2 ${button}`} disabled={!publicDraft.trim()} onClick={() => void sendPublic()}>发送公开发言</button></>}</section>
      <section className="rounded-2xl bg-white p-4"><h2 className="font-bold">已公开线索与状态</h2>{investigatorView?.clues.map(item => <p key={item.id} className="mt-2 text-sm">• {item.text}</p>)}{investigatorView?.deliverables.map(item => <p key={item.id} className="mt-2 text-sm">• {item.title}：{item.text}</p>)}{session.activeEffects.map(effect => <p key={effect.id} className="mt-2 text-xs">{nameOfSeat(effect.targetSeatId)}：{effect.label} · 剩余 {effect.remainingRounds} 轮</p>)}</section>
      {session.status === 'playing' && nextPhase && <section className="rounded-2xl bg-white p-4"><h2 className="font-bold">进入下一幕</h2><p className="mt-1 text-sm">{nextPhase.title} · 只有主持人确认才切换场景并发放该幕资料。</p><button className={`mt-3 ${button}`} onClick={() => { stop(); void command({ type: 'confirm_phase', phaseId: nextPhase.id }).then(() => setStatus(`已进入 ${nextPhase.title}；调查暂停，按需继续。`)).catch(e => setError(String(e))); }}>GM 确认进入下一幕</button></section>}
      {(session.status === 'ended' || !nextPhase) && <MurderMysteryEnding session={session} events={events} onChange={async () => { await refresh(); }} stopRound={stop} />}
    </>}
    {hostOpen && <div className="fixed inset-0 z-50 overflow-y-auto bg-stone-950/60 p-3" role="dialog" aria-modal="true" aria-label="主持控制台"><div className="mx-auto max-w-3xl space-y-3 rounded-2xl bg-stone-100 p-3"><div className="sticky top-0 z-10 flex justify-between rounded-xl bg-stone-900 p-3 text-white"><b>幕后主持控制台 · 仅 GM</b><button onClick={() => setHostOpen(false)}>返回场景 ✕</button></div>{session.status !== 'preparation' && <MurderMysteryHostConsole session={session} events={events} onChange={async () => { await refresh(); }} stopRound={stop} />}<section className="rounded-2xl bg-amber-50 p-4"><b>GM 专属真相</b>{script.objectiveFacts.map(fact => <p key={fact.id} className="mt-1 text-sm">• {fact.text}</p>)}</section>{session.status === 'playing' && nextPhase && <MurderMysteryEnding session={session} events={events} onChange={async () => { await refresh(); }} stopRound={stop} />}</div></div>}
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-800">{error}</p>}
  </div>;
}
