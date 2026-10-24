import React, { useEffect, useRef, useState } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { buildPlayerView, effectiveSpeechMode, type MurderMysteryEvent, type MurderMysterySession } from '../utils/murderMystery/session';
import { requestMysteryOocReply } from '../utils/murderMystery/service';
import { runMurderMysteryRound } from '../utils/murderMystery/round';
import MurderMysteryHostConsole from './MurderMysteryHostConsole';
import MurderMysteryEnding from './MurderMysteryEnding';

const button = 'rounded-xl bg-stone-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40';
const field = 'w-full rounded-xl border border-stone-300 bg-white p-3 text-sm';

export default function MurderMysterySessionView({ initial, onBack }: { initial: MurderMysterySession; onBack: () => void }) {
  const { characters, userProfile, apiConfig } = useOS();
  const [session, setSession] = useState(initial);
  const [events, setEvents] = useState<MurderMysteryEvent[]>([]);
  const [charId, setCharId] = useState(Object.values(initial.seats)[0] || '');
  const [draft, setDraft] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [roundBusy, setRoundBusy] = useState(false);
  const [publicDraft, setPublicDraft] = useState('');
  const [publicMode, setPublicMode] = useState<'in_character' | 'out_of_character'>('out_of_character');
  const [roundStatus, setRoundStatus] = useState('');
  const [error, setError] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const roundAbortRef = useRef<AbortController | null>(null);
  const roundTaskRef = useRef<Promise<void> | null>(null);
  const sessionRef = useRef(session);
  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { void DB.getMurderMysteryEvents(initial.id).then(setEvents).catch(e => setError(String(e))); return () => { abortRef.current?.abort(); roundAbortRef.current?.abort(); }; }, [initial.id]);
  useEffect(() => { setNote(session.strategyNotes[charId] || ''); }, [session.strategyNotes, charId]);
  const reload = async () => {
    const [latest, history] = await Promise.all([DB.getMurderMysterySession(initial.id), DB.getMurderMysteryEvents(initial.id)]);
    if (latest) { setSession(latest); sessionRef.current = latest; }
    setEvents(history);
    return { latest, history };
  };
  const send = async () => {
    const question = draft.trim();
    const char = characters.find(item => item.id === charId);
    if (!question || !char || busy || session.status === 'ended' || !session.scriptSnapshot.communicationRules.hostPlayerOoc) return;
    setBusy(true); setError(''); setDraft('');
    const abort = new AbortController(); abortRef.current = abort;
    try {
      const first = await DB.appendMurderMysteryEvent(sessionRef.current.id, sessionRef.current.revision, {
        channel: 'host_player_ooc', audienceIds: [charId], speechMode: 'out_of_character', content: question,
        seatId: Object.entries(session.seats).find(([, id]) => id === charId)?.[0], action: 'host_message',
      });
      sessionRef.current = first; setSession(first);
      const history = await DB.getMurderMysteryEvents(first.id); setEvents(history);
      const result = await requestMysteryOocReply({ session: first, events: history, char, user: userProfile, apiConfig, question, signal: abort.signal });
      if (abort.signal.aborted) return;
      const second = await DB.appendMurderMysteryEvent(first.id, first.revision, {
        channel: 'host_player_ooc', audienceIds: [charId], speakerCharId: charId,
        seatId: Object.entries(first.seats).find(([, id]) => id === charId)?.[0],
        speechMode: 'out_of_character', content: result.reply, action: 'player_reply',
      }, { charId, text: result.strategyNote });
      sessionRef.current = second; setSession(second);
      await reload();
    } catch (e) { if (!abort.signal.aborted) setError(String(e)); await reload(); }
    finally { setBusy(false); abortRef.current = null; }
  };
  const saveNote = async () => {
    try {
      const next = await DB.appendMurderMysteryEvent(sessionRef.current.id, sessionRef.current.revision, {
        channel: 'host_system', audienceIds: [], speechMode: 'system', content: `主持人编辑了 ${characters.find(item => item.id === charId)?.name || charId} 的个人策略笔记`, action: 'strategy_note_edit',
      }, { charId, text: note });
      sessionRef.current = next; setSession(next); await reload(); setError('策略笔记已保存。');
    } catch (e) { setError(String(e)); await reload(); }
  };
  const runRound = async () => {
    if (roundAbortRef.current || session.status === 'ended' || !session.scriptSnapshot.communicationRules.publicTable) return;
    const abort = new AbortController(); roundAbortRef.current = abort;
    setRoundBusy(true); setRoundStatus('角色正在按当前公开历史逐人判断是否发言…');
    try {
      const result = await runMurderMysteryRound({ sessionId: session.id, characters, user: userProfile, apiConfig, signal: abort.signal,
        onCommit: (next, history) => { sessionRef.current = next; setSession(next); setEvents(history); },
        onFailure: (char, reason) => setRoundStatus(`${char.name} 请求失败：${String(reason)}；继续其他玩家。`),
      });
      setRoundStatus(`本轮结束：${result.replies} 条公开发言，${result.failures} 位请求失败（${result.stopped === 'cancelled' ? '主持人停止' : result.stopped === 'stale' ? '对局已变化' : result.stopped === 'limit' ? '达到轮次上限' : '无人继续发言'}）。`);
      await reload();
    } catch (e) { setError(String(e)); await reload(); }
    finally { setRoundBusy(false); roundAbortRef.current = null; }
  };
  const startRound = () => {
    const task = runRound();
    roundTaskRef.current = task;
    void task.finally(() => { if (roundTaskRef.current === task) roundTaskRef.current = null; });
    return task;
  };
  const sendPublic = async () => {
    const content = publicDraft.trim();
    if (!content || session.status === 'ended' || !session.scriptSnapshot.communicationRules.publicTable) return;
    roundAbortRef.current?.abort();
    if (roundTaskRef.current) await roundTaskRef.current;
    try {
      const fresh = await DB.getMurderMysterySession(session.id);
      if (!fresh) throw new Error('存档不存在');
      const next = await DB.appendMurderMysteryEvent(fresh.id, fresh.revision, {
        channel: 'public_table', audienceIds: Object.values(fresh.seats), speechMode: publicMode, content, action: 'host_public_speech',
      });
      sessionRef.current = next; setSession(next); setPublicDraft(''); setError('');
      await reload();
      void startRound();
    } catch (e) { setError(String(e)); await reload(); }
  };
  const view = charId ? buildPlayerView(session, events, charId) : null;
  const privateHistory = events.filter(event => event.channel === 'host_player_ooc' && event.audienceIds.includes(charId));
  return <div className="space-y-4">
    <button className="text-sm text-stone-600" onClick={() => { abortRef.current?.abort(); roundAbortRef.current?.abort(); onBack(); }}>← 剧本库与存档</button>
    <header><h1 className="text-xl font-black">{session.scriptSnapshot.title}</h1><p className="text-xs text-stone-500">{session.status === 'ended' ? '已结算' : session.status === 'playing' ? '进行中' : '开局准备'} · 本机存档 · {session.scriptSnapshot.seats.length} 席</p></header>
    <section className="rounded-2xl bg-white p-4"><h2 className="font-bold">主持人选席</h2><div className="mt-2 flex flex-wrap gap-2">{session.scriptSnapshot.seats.map(seat => { const id = session.seats[seat.id]; const char = characters.find(item => item.id === id); return <button key={seat.id} className={`rounded-xl px-3 py-2 text-sm ${charId === id ? 'bg-stone-900 text-white' : 'bg-stone-100'}`} onClick={() => setCharId(id)}>{char?.name || '角色已删除'} 饰 {seat.name}</button>; })}</div></section>
    {view && <section className="rounded-2xl bg-white p-4"><h2 className="font-bold">已发给该玩家的开场资料</h2><p className="mt-2 whitespace-pre-wrap text-sm">{view.seat.personalScript}</p><div className="mt-3 text-xs"><b>本人主观认识</b>{view.seat.beliefs.map(item => <p key={item.id}>• {item.text}</p>)}<b className="mt-2 block">本人秘密</b>{view.seat.privateKnowledge.map(item => <p key={item.id}>• {item.text}</p>)}<b className="mt-2 block">已发资料</b>{[...view.clues, ...view.deliverables].map(item => <p key={item.id}>• {'title' in item ? String(item.title) : item.text}</p>)}</div></section>}
    {session.scriptSnapshot.communicationRules.hostPlayerOoc && <section className="rounded-2xl bg-white p-4"><h2 className="font-bold">主持人与该玩家皮下讨论</h2><p className="mt-1 text-xs text-stone-500">完整原文仅主持人与当前角色可见；下方笔记可修改，角色可以自主改变策略。</p><div className="my-3 max-h-64 space-y-2 overflow-y-auto">{privateHistory.map(event => <p key={event.id} className="rounded-xl bg-stone-100 p-2 text-sm"><b>{event.speakerCharId ? '玩家' : '主持人'}：</b>{event.content}</p>)}</div><textarea className={field} value={draft} onChange={e => setDraft(e.target.value)} placeholder="和该角色商量开局策略" /><button className={`mt-2 ${button}`} disabled={busy || session.status === 'ended' || !draft.trim()} onClick={() => void send()}>{busy ? '等待角色…' : '发送并听取回应'}</button>{busy && <button className="ml-3 text-sm" onClick={() => abortRef.current?.abort()}>停止请求</button>}</section>}
    <section className="rounded-2xl bg-white p-4"><h2 className="font-bold">个人策略笔记</h2><textarea className={`mt-2 min-h-24 ${field}`} value={note} onChange={e => setNote(e.target.value)} /><button className={`mt-2 ${button}`} disabled={session.status === 'ended'} onClick={() => void saveNote()}>保存笔记</button></section>
    {session.scriptSnapshot.communicationRules.publicTable && <section className="rounded-2xl bg-white p-4"><h2 className="font-bold">公共游戏桌</h2><p className="mt-1 text-xs text-stone-500">公开发言当时所有玩家都能听见。皮下吐槽也公开可见，不自动视为正式口供。</p><div className="my-3 max-h-80 space-y-2 overflow-y-auto">{events.filter(event => event.channel === 'public_table').map(event => <p key={event.id} className="rounded-xl bg-stone-100 p-2 text-sm"><b>{event.speakerCharId ? characters.find(char => char.id === event.speakerCharId)?.name || '离场玩家' : '主持人'}：</b>{effectiveSpeechMode(event, events) === 'out_of_character' && <span className="mr-1 text-xs text-amber-700">[皮下公开]</span>}{event.content}</p>)}</div><div className="mb-2 flex gap-2 text-xs"><button className={publicMode === 'in_character' ? 'font-bold text-stone-900' : 'text-stone-500'} onClick={() => setPublicMode('in_character')}>戏内发言</button><button className={publicMode === 'out_of_character' ? 'font-bold text-stone-900' : 'text-stone-500'} onClick={() => setPublicMode('out_of_character')}>皮下公开</button></div><textarea className={field} value={publicDraft} onChange={e => setPublicDraft(e.target.value)} placeholder="主持人说话、插话或代入调查人物" /><div className="mt-2 flex flex-wrap gap-3"><button className={button} disabled={!publicDraft.trim()} onClick={() => void sendPublic()}>发到公共桌并请玩家回应</button><button className={button} disabled={roundBusy || !events.some(event => event.channel === 'public_table')} onClick={() => void startRound()}>继续一轮</button>{roundBusy && <button className="text-sm text-red-700" onClick={() => roundAbortRef.current?.abort()}>暂停／结束本轮</button>}</div>{roundStatus && <p role="status" className="mt-2 text-xs text-stone-600">{roundStatus}</p>}</section>}
    <MurderMysteryHostConsole session={session} events={events} onChange={async () => { await reload(); }} stopRound={() => roundAbortRef.current?.abort()} />
    <MurderMysteryEnding session={session} events={events} onChange={async () => { await reload(); }} stopRound={() => roundAbortRef.current?.abort()} />
    <section className="rounded-2xl bg-amber-50 p-4 text-sm"><b>主持人专属真相</b>{session.scriptSnapshot.objectiveFacts.map(fact => <p key={fact.id} className="mt-1">• {fact.text}</p>)}</section>
    {error && <p role="status" className="rounded-xl bg-amber-50 p-3 text-sm">{error}</p>}
  </div>;
}
