import React, { useEffect, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import type { MurderMysteryCommand } from '../utils/murderMystery/rules';
import { requestMysteryChannelReply, requestMysteryGmSuggestion } from '../utils/murderMystery/service';
import { effectiveSpeechMode, type MurderMysteryEvent, type MurderMysterySession } from '../utils/murderMystery/session';

const button = 'rounded-xl bg-stone-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40';
const field = 'w-full rounded-xl border border-stone-300 bg-white p-2 text-sm';

export default function MurderMysteryHostConsole({ session, events, onChange, stopRound }: {
  session: MurderMysterySession; events: MurderMysteryEvent[];
  onChange: () => Promise<void>; stopRound: () => void;
}) {
  const { characters, userProfile, apiConfig, apiPresets } = useOS();
  const appApi = () => {
    if (!session.dialogueApiPresetId) return undefined;
    const preset = apiPresets.find(item => item.id === session.dialogueApiPresetId);
    if (!preset) throw new Error('本局指定的 App API 预设已不存在；不会改用其他付费来源');
    return preset.config;
  };
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [targetPhaseId, setTargetPhaseId] = useState(session.scriptSnapshot.phases.find(item => item.id !== session.phaseId)?.id || '');
  const [candidateReason, setCandidateReason] = useState('');
  const [victoryId, setVictoryId] = useState(session.scriptSnapshot.victoryConditions[0]?.id || '');
  const [accusedSeatId, setAccusedSeatId] = useState(session.scriptSnapshot.seats[0]?.id || '');
  const [accusationText, setAccusationText] = useState('');
  const [accusationMode, setAccusationMode] = useState<'in_character' | 'out_of_character'>('in_character');
  const [holderSeatId, setHolderSeatId] = useState(session.scriptSnapshot.seats[0]?.id || '');
  const [abilityId, setAbilityId] = useState(session.scriptSnapshot.abilities[0]?.id || '');
  const [targetSeatId, setTargetSeatId] = useState(session.scriptSnapshot.seats[0]?.id || '');
  const [firstCharId, setFirstCharId] = useState(Object.values(session.seats)[0] || '');
  const [secondCharId, setSecondCharId] = useState(Object.values(session.seats)[1] || '');
  const [threadId, setThreadId] = useState('');
  const [privateText, setPrivateText] = useState('');
  const [gameCharId, setGameCharId] = useState(Object.values(session.seats)[0] || '');
  const [gameText, setGameText] = useState('');
  const [showLedger, setShowLedger] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => () => abortRef.current?.abort(), []);
  const script = session.scriptSnapshot;
  const nameOf = (id?: string) => id?.startsWith('human:') ? `${script.seats.find(seat => seat.id === id.slice(6))?.name || id}（真人）`
    : characters.find(char => char.id === id)?.name || (id ? '已删除角色' : '主持人');
  const run = async (command: MurderMysteryCommand) => {
    stopRound(); setBusy(true); setError('');
    try {
      const fresh = await DB.getMurderMysterySession(session.id);
      if (!fresh) throw new Error('存档不存在');
      await DB.applyMurderMysteryCommand(fresh.id, fresh.revision, command);
      await onChange(); return true;
    } catch (e) { setError(String(e)); await onChange(); return false; }
    finally { setBusy(false); }
  };
  const openThread = async (a: string, b: string, sourceRequestId?: string) => {
    if (await run({ type: 'open_private', threadId: crypto.randomUUID(), participantCharIds: [a, b], sourceRequestId })) {
      const fresh = await DB.getMurderMysterySession(session.id);
      setThreadId(fresh?.privateThreads.at(-1)?.id || '');
    }
  };
  const sendGame = async () => {
    const text = gameText.trim(); if (!text || busy) return;
    if (!await run({ type: 'host_game_message', charId: gameCharId, content: text })) return;
    setGameText('');
    const abort = new AbortController(); abortRef.current = abort; setBusy(true);
    try {
      const fresh = await DB.getMurderMysterySession(session.id);
      if (!fresh) return;
      const history = await DB.getMurderMysteryEvents(session.id);
      const char = characters.find(item => item.id === gameCharId);
      if (!char) throw new Error('角色已删除');
      const reply = await requestMysteryChannelReply({ session: fresh, events: history, char, user: userProfile, apiConfig, appApi: appApi(),
        channel: 'host_player_game', signal: abort.signal });
      if (!abort.signal.aborted) await DB.appendMurderMysteryEvent(fresh.id, fresh.revision, {
        channel: 'host_player_game', audienceIds: [gameCharId], speakerCharId: gameCharId,
        seatId: Object.entries(fresh.seats).find(([, id]) => id === gameCharId)?.[0], speechMode: 'in_character', content: reply, action: 'host_game_reply',
      });
      await onChange();
    } catch (e) { if (!abort.signal.aborted) setError(String(e)); await onChange(); }
    finally { abortRef.current = null; setBusy(false); }
  };
  const privateTurn = async () => {
    const thread = session.privateThreads.find(item => item.id === threadId && item.active);
    if (!thread || busy) return;
    const abort = new AbortController(); abortRef.current = abort; setBusy(true); setError('');
    try {
      for (const id of thread.participantCharIds) {
        if (abort.signal.aborted) break;
        const fresh = await DB.getMurderMysterySession(session.id);
        if (!fresh?.privateThreads.some(item => item.id === thread.id && item.active)) break;
        const history = await DB.getMurderMysteryEvents(session.id);
        const char = characters.find(item => item.id === id);
        if (!char) throw new Error('角色已删除');
        const reply = await requestMysteryChannelReply({ session: fresh, events: history, char, user: userProfile, apiConfig, appApi: appApi(),
          channel: 'player_private', threadId: thread.id, signal: abort.signal });
        if (abort.signal.aborted) break;
        await DB.applyMurderMysteryCommand(fresh.id, fresh.revision, { type: 'private_message', threadId: thread.id,
          speakerCharId: id, speechMode: 'in_character', content: reply });
        await onChange();
      }
    } catch (e) { if (!abort.signal.aborted) setError(String(e)); await onChange(); }
    finally { abortRef.current = null; setBusy(false); }
  };
  const suggest = async () => {
    if (busy) return;
    const abort = new AbortController(); abortRef.current = abort; setBusy(true); setError(''); stopRound();
    try {
      const fresh = await DB.getMurderMysterySession(session.id);
      if (!fresh) throw new Error('存档不存在');
      const history = await DB.getMurderMysteryEvents(session.id);
      const suggestion = await requestMysteryGmSuggestion({ session: fresh, events: history, apiConfig, signal: abort.signal });
      if (abort.signal.aborted) return;
      if (!suggestion) { setError('现有正式记录不足以生成推进或胜负候选。'); return; }
      await DB.applyMurderMysteryCommand(fresh.id, fresh.revision, { type: 'propose', ...suggestion, source: 'ai' });
      await onChange();
    } catch (e) { if (!abort.signal.aborted) setError(String(e)); await onChange(); }
    finally { abortRef.current = null; setBusy(false); }
  };
  const activeThread = session.privateThreads.find(item => item.id === threadId);
  const pendingRequests = events.filter(event => event.action === 'private_request' && event.speakerCharId && event.targetSeatId)
    .filter(event => !session.privateThreads.some(thread => thread.sourceRequestId === event.id));
  return <div className="space-y-4">
    <section className="rounded-2xl bg-white p-4"><h2 className="font-bold">主持人阶段与候选</h2><p className="mt-1 text-sm">当前：{script.phases.find(item => item.id === session.phaseId)?.title || '无阶段'} · 第 {session.roundNumber || 0} 轮</p>{session.pendingDecision && <p className="mt-2 rounded-xl bg-amber-50 p-2 text-sm">待确认 {session.pendingDecision.kind === 'phase' ? '阶段' : '胜负'}：{session.pendingDecision.reason}</p>}<div className="mt-3 flex flex-wrap gap-2"><select className={field} value={targetPhaseId} onChange={e => setTargetPhaseId(e.target.value)}><option value="">选择阶段</option>{script.phases.filter(item => item.id !== session.phaseId).map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select><button className={button} disabled={busy || !targetPhaseId || session.status === 'ended'} onClick={() => void run({ type: 'confirm_phase', phaseId: targetPhaseId })}>主持人确认推进／纠正</button><button className={button} disabled={busy || session.status === 'ended'} onClick={() => void run({ type: 'advance_round' })}>推进一轮（持续状态 -1）</button></div><p className="mt-2 text-xs text-stone-500">候选不会自动发本；主持人可提前、延迟或手动纠正阶段。纯皮下发言不触发正式指认。</p></section>
    <section className="rounded-2xl bg-white p-4"><h2 className="font-bold">候选判定</h2><p className="mt-1 text-xs text-stone-500">AI 仅给主持人一份私有建议；无配置时可手动提出候选。任何候选都不自动改变事实。</p><button className={`mt-2 ${button}`} disabled={busy || session.status === 'ended'} onClick={() => void suggest()}>请 AI 提出阶段／胜负候选</button>{session.pendingDecision?.kind === 'phase' && <button className="ml-2 text-sm font-bold text-amber-800" disabled={busy} onClick={() => void run({ type: 'confirm_phase', phaseId: session.pendingDecision!.targetId })}>确认当前阶段候选</button>}<textarea className={`mt-3 ${field}`} value={candidateReason} onChange={e => setCandidateReason(e.target.value)} placeholder="主持人手动候选理由" /><div className="mt-2 flex flex-wrap gap-2"><button className={button} disabled={busy || !candidateReason.trim() || !targetPhaseId} onClick={() => void run({ type: 'propose', kind: 'phase', targetId: targetPhaseId, reason: candidateReason, source: 'host' })}>提出阶段候选</button>{script.victoryConditions.length > 0 && <><select className={field} value={victoryId} onChange={e => setVictoryId(e.target.value)}>{script.victoryConditions.map(item => <option key={item.id} value={item.id}>{item.description}</option>)}</select><button className={button} disabled={busy || !candidateReason.trim() || !victoryId} onClick={() => void run({ type: 'propose', kind: 'victory', targetId: victoryId, reason: candidateReason, source: 'host' })}>提出胜负候选</button></>}</div></section>
    <section className="rounded-2xl bg-white p-4"><h2 className="font-bold">公开发言语义更正</h2><p className="mt-1 text-xs text-stone-500">更正会追加一条公开记录，保留原话；皮下发言不会作为正式证词。</p><div className="mt-2 max-h-36 overflow-y-auto">{events.filter(event => event.channel === 'public_table' && event.speechMode !== 'system' && event.action !== 'speech_mode_correction').slice(-15).map(event => <div key={event.id} className="flex items-center justify-between gap-2 border-b py-1 text-xs"><span className="min-w-0 truncate">#{event.revision} {effectiveSpeechMode(event, events) === 'in_character' ? '戏内' : '皮下'} · {event.content}</span><button className="shrink-0 font-bold text-amber-800" disabled={busy || session.status === 'ended'} onClick={() => void run({ type: 'correct_speech_mode', eventId: event.id, speechMode: effectiveSpeechMode(event, events) === 'in_character' ? 'out_of_character' : 'in_character' })}>更正</button></div>)}</div></section>
    <section className="rounded-2xl bg-white p-4"><h2 className="font-bold">正式指认与线索</h2><div className="mt-2 flex gap-2"><select className={field} value={accusedSeatId} onChange={e => setAccusedSeatId(e.target.value)}>{script.seats.map(seat => <option key={seat.id} value={seat.id}>{seat.name}</option>)}</select><select className={field} value={accusationMode} onChange={e => setAccusationMode(e.target.value as typeof accusationMode)}><option value="in_character">戏内正式指认</option><option value="out_of_character">皮下公开讨论</option></select></div><textarea className={`mt-2 ${field}`} value={accusationText} onChange={e => setAccusationText(e.target.value)} placeholder="指认说明与推理" />{session.participation ? <p className="mt-2 text-xs text-stone-500">V2 正式指认由警探提出；GM 可在候选判定中手动裁定。</p> : <button className={`mt-2 ${button}`} disabled={busy || !accusationText.trim() || session.status === 'ended'} onClick={() => { void run({ type: 'accuse', targetSeatId: accusedSeatId, content: accusationText, speechMode: accusationMode }).then(ok => { if (ok) setAccusationText(''); }); }}>提交指认</button>}<div className="mt-3 space-y-1">{[...script.clues.map(item => ({ id: item.id, label: item.text, kind: 'clue' as const })), ...script.deliverables.map(item => ({ id: item.id, label: item.title, kind: 'deliverable' as const }))].filter(item => !(item.kind === 'clue' ? session.grantedClueIds : session.grantedDeliverableIds).includes(item.id)).map(item => <div key={item.id} className="flex justify-between gap-2 text-xs"><span>{item.label}</span><button className="shrink-0 text-amber-800" disabled={busy} onClick={() => void run({ type: 'grant', grantType: item.kind, grantId: item.id })}>主持人私发</button></div>)}</div></section>
    <section className="rounded-2xl bg-white p-4"><h2 className="font-bold">能力与持续状态</h2><div className="mt-2 grid gap-2 sm:grid-cols-3"><select className={field} value={abilityId} onChange={e => setAbilityId(e.target.value)}>{script.abilities.filter(item => session.grantedAbilityIds.includes(item.id)).map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select><select className={field} value={holderSeatId} onChange={e => setHolderSeatId(e.target.value)}>{script.seats.map(seat => <option key={seat.id} value={seat.id}>{seat.name} 使用</option>)}</select><select className={field} value={targetSeatId} onChange={e => setTargetSeatId(e.target.value)}>{script.seats.map(seat => <option key={seat.id} value={seat.id}>{seat.name} 受影响</option>)}</select></div><button className={`mt-2 ${button}`} disabled={busy || !abilityId || !session.grantedAbilityIds.includes(abilityId) || session.status === 'ended'} onClick={() => void run({ type: 'use_ability', abilityId, holderSeatId, targetSeatId })}>主持人确认使用</button><div className="mt-2 text-xs">{session.activeEffects.map(effect => <p key={effect.id}>{script.seats.find(item => item.id === effect.targetSeatId)?.name}：{effect.label} · 剩余 {effect.remainingRounds} 轮{effect.blocksPublicSpeech ? ' · 暂不能公开发言' : ''}</p>)}</div></section>
    {script.communicationRules.hostPlayerGame && <section className="rounded-2xl bg-white p-4"><h2 className="font-bold">主持人正式单独环节</h2><select className={`mt-2 ${field}`} value={gameCharId} onChange={e => setGameCharId(e.target.value)}>{Object.values(session.seats).map(id => <option key={id} value={id}>{nameOf(id)}</option>)}</select><div className="mt-2 max-h-40 overflow-y-auto text-xs">{events.filter(event => event.channel === 'host_player_game' && event.audienceIds.includes(gameCharId) && !event.action?.startsWith('grant_')).map(event => <p key={event.id} className="p-1">{nameOf(event.speakerCharId)}：{event.content}</p>)}</div><textarea className={`mt-2 ${field}`} value={gameText} onChange={e => setGameText(e.target.value)} placeholder="只发给该玩家的正式问询或资料" /><div className="mt-2 flex gap-3"><button className={button} disabled={busy || !gameText.trim() || session.status === 'ended'} onClick={() => void sendGame()}>发送并请玩家回应</button>{busy && <button onClick={() => abortRef.current?.abort()}>停止生成</button>}</div></section>}
    {script.communicationRules.playerPrivate && <section className="rounded-2xl bg-white p-4"><h2 className="font-bold">玩家秘密交流</h2><p className="text-xs text-stone-500">仅参与者可见，主持人能查看与终止。申请先由主持人批准。</p>{pendingRequests.map(request => <div key={request.id} className="mt-2 rounded-xl bg-amber-50 p-2 text-xs">{nameOf(request.speakerCharId)} 申请与 {script.seats.find(seat => seat.id === request.targetSeatId)?.name} 交谈：{request.content}<button className="ml-2 font-bold" disabled={busy} onClick={() => void openThread(request.speakerCharId!, session.seats[request.targetSeatId!], request.id)}>批准</button></div>)}<div className="mt-2 grid gap-2 sm:grid-cols-2"><select className={field} value={firstCharId} onChange={e => setFirstCharId(e.target.value)}>{Object.values(session.seats).map(id => <option key={id} value={id}>{nameOf(id)}</option>)}</select><select className={field} value={secondCharId} onChange={e => setSecondCharId(e.target.value)}>{Object.values(session.seats).map(id => <option key={id} value={id}>{nameOf(id)}</option>)}</select></div><button className={`mt-2 ${button}`} disabled={busy || firstCharId === secondCharId || session.status === 'ended'} onClick={() => void openThread(firstCharId, secondCharId)}>主持人允许秘密交流</button><select className={`mt-3 ${field}`} value={threadId} onChange={e => setThreadId(e.target.value)}><option value="">选择交流记录</option>{session.privateThreads.map(thread => <option key={thread.id} value={thread.id}>{thread.participantCharIds.map(nameOf).join(' ↔ ')} {thread.active ? '进行中' : '已结束'}</option>)}</select>{activeThread && <><div className="mt-2 max-h-48 overflow-y-auto rounded-xl bg-stone-100 p-2 text-xs">{events.filter(event => event.threadId === activeThread.id).map(event => <p key={event.id} className="mt-1"><b>{nameOf(event.speakerCharId)}：</b>{event.content}</p>)}</div>{activeThread.active && <><textarea className={`mt-2 ${field}`} value={privateText} onChange={e => setPrivateText(e.target.value)} placeholder="主持人向两位玩家干预或补充" /><div className="mt-2 flex flex-wrap gap-2"><button className={button} disabled={busy || !privateText.trim()} onClick={() => { void run({ type: 'private_message', threadId: activeThread.id, content: privateText, speechMode: 'out_of_character' }).then(ok => { if (ok) setPrivateText(''); }); }}>主持人干预</button><button className={button} disabled={busy} onClick={() => void privateTurn()}>让两位玩家依次交谈</button><button className="text-sm text-red-700" disabled={busy} onClick={() => void run({ type: 'close_private', threadId: activeThread.id })}>终止交流</button>{busy && <button onClick={() => abortRef.current?.abort()}>暂停生成</button>}</div></>}</>}</section>}
    <section className="rounded-2xl bg-white p-4"><button className="font-bold" onClick={() => setShowLedger(!showLedger)}>主持人全量事件账本 {showLedger ? '▲' : '▼'}</button>{showLedger && <div className="mt-2 max-h-64 overflow-y-auto text-xs">{events.map(event => <p key={event.id} className="border-b border-stone-100 py-1">#{event.revision} {event.channel} · {event.seatId ? script.seats.find(seat => seat.id === event.seatId)?.name || event.seatId : script.investigator && event.speakerActorId === script.investigator.id ? script.investigator.name : nameOf(event.speakerCharId)} · 受众 {event.audienceIds.map(nameOf).join('、') || '仅主持人'}：{event.content}</p>)}</div>}</section>
    {error && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm">{error}</p>}
  </div>;
}
