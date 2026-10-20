import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, Broadcast, CaretDown, CaretLeft, Check, ClockCounterClockwise, Gavel, MicrophoneStage,
  Plus, Scales, ShieldCheck, Trash, UsersThree, X,
} from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import TokenImg from '../components/os/TokenImg';
import type { CharacterProfile, DebateMode, DebateSession, DebateSide, DebateSpeech } from '../types';
import { DB } from '../utils/db';
import {
  calculateDebateReport, canStartTeamDebate, createDebateSession,
  getDebateParticipantIds,
  teamDebateLineup, teamDebateShareText,
  DEBATE_ROLE_LABELS, DEBATE_SIDE_LABELS, getCurrentDebateTurn, getDebateTurns,
  parseDebateJudgement, parseDebateRecall,
} from '../utils/debate';
import {
  persistDebateShare, requestDebateCharacter, requestDebateJudgement, requestDebateSummary,
} from '../utils/debateService';

type View = 'home' | 'setup' | 'recall' | 'lineup' | 'debate' | 'report' | 'history';
const newestFirst = (items: DebateSession[]) => [...items].sort((a, b) => b.updatedAt - a.updatedAt);
const speechId = () => globalThis.crypto?.randomUUID?.() || `speech-${Date.now()}-${Math.random().toString(36).slice(2)}`;

const Avatar: React.FC<{ char?: CharacterProfile | null; size?: string }> = ({ char, size = 'h-12 w-12' }) => (
  <div className={`${size} shrink-0 overflow-hidden rounded-full bg-amber-100 ring-2 ring-white`}>
    {char?.avatar ? <TokenImg value={char.avatar} alt={char.name} className="h-full w-full object-cover" /> : (
      <div className="flex h-full w-full items-center justify-center font-bold text-amber-800">{char?.name?.slice(0, 1) || '?'}</div>
    )}
  </div>
);

const Header: React.FC<{ title: string; onBack: () => void; right?: React.ReactNode }> = ({ title, onBack, right }) => (
  <header className="shrink-0 border-b border-amber-950/10 bg-[#fffaf1]" style={{ paddingTop: 'var(--safe-top)' }}>
    <div className="flex h-16 items-center justify-between px-4">
      <button onClick={onBack} className="-ml-2 flex h-11 w-11 items-center justify-center rounded-full text-stone-700 hover:bg-amber-100" aria-label="返回"><CaretLeft size={26} /></button>
      <h1 className="font-bold tracking-[-0.02em] text-stone-900">{title}</h1>
      <div className="flex min-w-11 justify-end">{right}</div>
    </div>
  </header>
);

const DebateSpeechCard: React.FC<{ speech: DebateSpeech }> = ({ speech }) => (
  <article className="rounded-2xl bg-white p-4 shadow-[0_6px_20px_rgba(69,49,24,0.08)]">
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${speech.side === 'pro' ? 'bg-red-500' : 'bg-blue-600'}`} />
        <b className="truncate text-stone-900">{speech.speakerName}</b>
        <span className="shrink-0 text-xs text-stone-500">{speech.role ? DEBATE_ROLE_LABELS[speech.role] : `第${speech.round}轮`}</span>
      </div>
      <span className="shrink-0 text-lg font-black text-stone-900">{speech.score}<small className="ml-0.5 text-xs font-semibold text-stone-500">分</small></span>
    </div>
    <p className="mt-3 whitespace-pre-wrap text-[15px] leading-7 text-stone-700">{speech.content}</p>
    <div className="mt-4 rounded-xl bg-stone-100 px-3 py-3 text-sm leading-6 text-stone-600"><b className="text-stone-800">裁判：</b>{speech.judgeComment}</div>
  </article>
);

const DebateApp: React.FC = () => {
  const {
    closeApp, characters, groups, userProfile, apiConfig, realtimeConfig, memoryPalaceConfig,
    updateCharacter, addToast, registerBackHandler,
  } = useOS();
  const [view, setView] = useState<View>('home');
  const [sessions, setSessions] = useState<DebateSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState('');
  const [setupMode, setSetupMode] = useState<DebateMode>('solo');
  const [topic, setTopic] = useState('');
  const [proPosition, setProPosition] = useState('');
  const [conPosition, setConPosition] = useState('');
  const [soloCharId, setSoloCharId] = useState('');
  const [userSide, setUserSide] = useState<DebateSide>('pro');
  const [recallSelection, setRecallSelection] = useState<string[]>([]);
  const [speechDraft, setSpeechDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('');
  const [error, setError] = useState('');
  const [shareConfirm, setShareConfirm] = useState(false);
  const busyRef = useRef(false);
  const operationController = useRef<AbortController | null>(null);
  useEffect(() => () => operationController.current?.abort(), []);

  const activeSession = sessions.find(item => item.id === activeSessionId) || null;
  const charById = useMemo(() => new Map(characters.map(char => [char.id, char])), [characters]);
  const currentTurn = activeSession ? getCurrentDebateTurn(activeSession) : null;

  useEffect(() => {
    void DB.getDebateSessions()
      .then(items => setSessions(newestFirst(items)))
      .catch(() => addToast('辩论赛记录读取失败', 'error'));
  }, [addToast]);

  const goBack = useCallback(() => {
    if (busyRef.current) return true;
    if (shareConfirm) { setShareConfirm(false); return true; }
    if (view === 'home') { closeApp(); return true; }
    if (view === 'lineup') { setView('recall'); return true; }
    if (view === 'recall' || view === 'debate' || view === 'report') { setView('home'); setActiveSessionId(''); return true; }
    setView('home');
    return true;
  }, [closeApp, shareConfirm, view]);

  useEffect(() => registerBackHandler(goBack), [goBack, registerBackHandler]);

  const saveSession = async (session: DebateSession) => {
    operationController.current?.signal.throwIfAborted();
    const next = { ...session, updatedAt: Date.now() };
    await DB.saveDebateSession(next);
    setSessions(prev => newestFirst([next, ...prev.filter(item => item.id !== next.id)]));
    operationController.current?.signal.throwIfAborted();
    return next;
  };

  const runAction = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    operationController.current = new AbortController();
    setBusy(true); setError('');
    try { await action(); }
    catch (cause) { if (!operationController.current?.signal.aborted) setError(cause instanceof Error ? cause.message : '操作失败，请重试。'); }
    finally { busyRef.current = false; operationController.current = null; setBusy(false); setBusyLabel(''); }
  };

  const openSession = (session: DebateSession) => {
    if (busyRef.current) return;
    setActiveSessionId(session.id);
    setSpeechDraft(''); setRecallSelection([]);
    setError('');
    if (session.stage === 'recall') setView('recall');
    else if (session.stage === 'lineup') setView('lineup');
    else if (session.stage === 'complete') setView('report');
    else setView('debate');
  };

  const startSetup = (mode: DebateMode) => {
    setSetupMode(mode);
    setTopic(''); setProPosition(''); setConPosition(''); setSoloCharId(''); setUserSide('pro'); setError('');
    setSpeechDraft(''); setRecallSelection([]);
    setView('setup');
  };

  const createSession = async () => {
    if (!topic.trim() || !proPosition.trim() || !conPosition.trim()) { setError('请完整填写辩题和正反方观点。'); return; }
    if (setupMode === 'solo' && !soloCharId) { setError('请选择一位对辩角色。'); return; }
    const session = createDebateSession({
      mode: setupMode, topic, proPosition, conPosition,
      charId: soloCharId || undefined, userSide: setupMode === 'solo' ? userSide : undefined,
    });
    await runAction(async () => {
      await saveSession(session);
      setActiveSessionId(session.id);
      setView(session.stage === 'recall' ? 'recall' : 'debate');
    });
  };

  const runRecall = async () => {
    if (!activeSession?.team || !recallSelection.length) return;
    let next = activeSession;
    await runAction(async () => {
      for (const charId of recallSelection) {
        const char = charById.get(charId);
        if (!char || next.team!.recalls.some(item => item.charId === charId)) continue;
        setBusyLabel(`正在召回 ${char.name} 的观点`);
        const raw = await requestDebateCharacter({ char, userProfile, groups, apiConfig, realtimeConfig, session: next, purpose: 'recall', signal: operationController.current?.signal });
        const parsed = parseDebateRecall(raw);
        next = {
          ...next,
          team: { ...next.team!, recalls: [...next.team!.recalls, { charId, ...parsed, createdAt: Date.now() }] },
        };
        next = await saveSession(next);
      }
      setRecallSelection([]);
    });
  };

  const toggleLineup = async (charId: string, side: DebateSide) => {
    if (!activeSession?.team) return;
    const key = side === 'pro' ? 'proCharIds' : 'conCharIds';
    const current = activeSession.team[key];
    const nextIds = current.includes(charId) ? current.filter(id => id !== charId) : current.length < 4 ? [...current, charId] : current;
    await runAction(async () => { await saveSession({ ...activeSession, stage: 'lineup', team: { ...activeSession.team!, [key]: nextIds } }); });
  };

  const beginTeamDebate = async () => {
    if (!activeSession || !canStartTeamDebate(activeSession)) return;
    await runAction(async () => {
      await saveSession({ ...activeSession, stage: 'debate' });
      setView('debate');
    });
  };

  const finalizeDebate = async (session: DebateSession) => {
    setBusyLabel('主持人正在整理赛后报告');
    const summary = await requestDebateSummary({ apiConfig, session, signal: operationController.current?.signal });
    const completed: DebateSession = {
      ...session,
      status: 'completed', stage: 'complete',
      report: calculateDebateReport(session.speeches, summary),
    };
    await saveSession(completed);
    setView('report');
  };

  const finishSpeech = async (session: DebateSession, draft: DebateSpeech) => {
    const turn = getCurrentDebateTurn(session);
    if (!turn) return;
    setBusyLabel('主持人正在评分');
    const rawJudgement = await requestDebateJudgement({ apiConfig, session, speech: draft, signal: operationController.current?.signal });
    const judgement = parseDebateJudgement(rawJudgement);
    const speech = { ...draft, ...judgement, judgeComment: judgement.comment };
    const withSpeech: DebateSession = { ...session, speeches: [...session.speeches, speech] };
    const isLast = turn.index >= getDebateTurns(withSpeech).length - 1;
    if (!isLast) {
      const next = withSpeech.mode === 'solo'
        ? { ...withSpeech, solo: { ...withSpeech.solo!, turnIndex: turn.index + 1 } }
        : { ...withSpeech, team: { ...withSpeech.team!, turnIndex: turn.index + 1 } };
      await saveSession(next);
      return;
    }
    await saveSession({ ...withSpeech, stage: 'summary' });
  };

  const submitUserSpeech = async () => {
    if (!activeSession || !currentTurn || currentTurn.speakerType !== 'user' || !speechDraft.trim()) return;
    await runAction(async () => {
      await finishSpeech(activeSession, {
        id: speechId(), speakerType: 'user', speakerName: userProfile.name || '你', side: currentTurn.side,
        round: currentTurn.round, phase: currentTurn.phase, content: speechDraft.trim(), createdAt: Date.now(),
      });
      setSpeechDraft('');
    });
  };

  const generateCharacterSpeech = async () => {
    if (!activeSession || !currentTurn?.charId || currentTurn.speakerType !== 'character') return;
    const char = charById.get(currentTurn.charId);
    if (!char) { setError('找不到当前发言角色。'); return; }
    await runAction(async () => {
      setBusyLabel(`${char.name} 正在准备发言`);
      const draft: DebateSpeech = {
        id: speechId(), speakerType: 'character', charId: char.id, speakerName: char.name,
        side: currentTurn.side, round: currentTurn.round, phase: currentTurn.phase, role: currentTurn.role,
        content: '', createdAt: Date.now(),
      };
      draft.content = await requestDebateCharacter({
        char, userProfile, groups, apiConfig, realtimeConfig, session: activeSession,
        purpose: 'speech', side: currentTurn.side, speech: draft,
        signal: operationController.current?.signal,
      });
      await finishSpeech(activeSession, draft);
    });
  };

  const retrySummary = async () => {
    if (!activeSession || activeSession.stage !== 'summary') return;
    await runAction(async () => { await finalizeDebate(activeSession); });
  };

  const shareResult = async (repair = false) => {
    if (!activeSession?.report) return;
    const report = activeSession.report;
    const participantIds = getDebateParticipantIds(activeSession);
    await runAction(async () => {
      let shareSession = activeSession;
      let sharedMessageIds = { ...(shareSession.sharedMessageIds || {}) };
      const winner = report.winner === 'draw' ? '平局' : `${DEBATE_SIDE_LABELS[report.winner]}获胜`;
      const baseSummary = `我们完成了「${activeSession.topic}」辩论。${winner}，正方 ${report.proScore} 分，反方 ${report.conScore} 分。${report.summary}`;
      const lineup = teamDebateLineup(activeSession, characters);
      for (const charId of participantIds) {
        if (sharedMessageIds[charId] && !repair) continue;
        const char = charById.get(charId);
        if (!char) continue;
        const charSpeeches = activeSession.speeches.filter(speech => speech.charId === charId);
        const participantSide: DebateSide = charSpeeches[0]?.side
          || (activeSession.mode === 'solo' && activeSession.solo?.userSide === 'pro' ? 'con' : 'pro');
        const participantRole = activeSession.mode === 'team'
          ? ((participantSide === 'pro' ? activeSession.team!.proCharIds : activeSession.team!.conCharIds).indexOf(charId) + 1)
          : undefined;
        const participantScore = charSpeeches.reduce((sum, speech) => sum + (speech.score || 0), 0);
        const participantJudgeSummary = charSpeeches.map(speech => speech.judgeComment).filter(Boolean).join('；');
        const participantLabel = `${DEBATE_SIDE_LABELS[participantSide]}${participantRole ? ` ${DEBATE_ROLE_LABELS[participantRole as 1 | 2 | 3 | 4]}` : '辩手'}`;
        const summary = `${lineup ? teamDebateShareText(activeSession, lineup, charId) : baseSummary} ${char.name}担任${participantLabel}，个人发言累计 ${participantScore} 分。${participantJudgeSummary ? `裁判记录：${participantJudgeSummary}` : ''}`;
        const { messageId, memories } = await persistDebateShare({
          char, session: activeSession, summary,
          scoreCard: {
            type: 'debate_card', mode: activeSession.mode, topic: activeSession.topic,
            proPosition: activeSession.proPosition, conPosition: activeSession.conPosition,
            proScore: report.proScore, conScore: report.conScore,
            winner: report.winner, summary: lineup ? `本场共有 ${activeSession.speeches.length} 次公开发言。${winner}，正方 ${report.proScore} 分，反方 ${report.conScore} 分。` : report.summary,
            ...(lineup ? { proTeam: lineup.pro, conTeam: lineup.con, userRole: '观众和组织者（未发言、不属任何一方）' } : {}),
            participantSide, participantRole, participantScore, participantJudgeSummary,
          },
          userProfile, groups, realtimeConfig, apiConfig, memoryPalaceConfig,
        });
        sharedMessageIds = { ...sharedMessageIds, [charId]: messageId };
        await updateCharacter(charId, { memories });
        shareSession = await saveSession({ ...shareSession, sharedMessageIds });
      }
      setShareConfirm(false);
      addToast(repair ? '历史结果已原地修复' : activeSession.mode === 'solo' ? '结果已写入聊天与记忆' : '结果已写入八位辩手的聊天与记忆', 'success');
    });
  };

  const deleteSession = async (session: DebateSession) => {
    if (!window.confirm(`删除「${session.topic}」的本地记录？已写回聊天的卡片不会被删除。`)) return;
    await runAction(async () => {
      await DB.deleteDebateSession(session.id);
      setSessions(prev => prev.filter(item => item.id !== session.id));
    });
  };

  const renderHome = () => (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto bg-[#fffaf1] px-5 pb-8" style={{ paddingTop: 'calc(var(--safe-top) + 18px)', paddingBottom: 'calc(var(--safe-bottom) + 28px)' }}>
      <div className="mb-7 flex items-start justify-between">
        <div>
          <h1 className="text-[30px] font-black tracking-[-0.03em] text-stone-900">辩论赛</h1>
          <p className="mt-1 max-w-[26rem] text-sm leading-6 text-stone-600">让分歧真正交锋。角色带着与你的共同经历入场，主持人只按公开发言裁判。</p>
        </div>
        <button onClick={closeApp} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-950" aria-label="关闭"><X size={21} /></button>
      </div>

      <section className="overflow-hidden rounded-2xl bg-stone-900 p-5 text-amber-50 shadow-[0_14px_34px_rgba(69,49,24,0.18)]">
        <div className="flex items-center gap-3"><MicrophoneStage size={29} weight="duotone" /><h2 className="text-xl font-bold">一对一 · 针锋相对</h2></div>
        <p className="mt-3 text-sm leading-6 text-amber-50/75">你选择立场，与一位角色完成三轮对辩。每次发言都由独立主持人评分，最终按总分决胜。</p>
        <button onClick={() => startSetup('solo')} className="mt-5 flex h-12 w-full items-center justify-between rounded-xl bg-amber-400 px-4 font-bold text-amber-950 hover:bg-amber-300">
          <span className="text-amber-950">邀请一位角色</span> <ArrowRight size={20} className="text-amber-950" />
        </button>
      </section>

      <section className="mt-5 overflow-hidden rounded-2xl bg-[#ef7b45] p-5 text-white shadow-[0_14px_34px_rgba(157,69,29,0.18)]">
        <div className="flex items-center gap-3"><UsersThree size={30} weight="duotone" /><h2 className="text-xl font-bold">八人赛 · 正式赛场</h2></div>
        <p className="mt-3 text-sm leading-6 text-white/85">先召回候选人的真实观点，再由你从正反双方各排出四位辩手。人数不够时，可以继续召回新角色。</p>
        <button onClick={() => startSetup('team')} className="mt-5 flex h-12 w-full items-center justify-between rounded-xl bg-white px-4 font-bold text-[#7f3418] hover:bg-orange-50">
          组建八人阵容 <ArrowRight size={20} />
        </button>
      </section>

      <div className="mt-8 flex items-center justify-between">
        <h2 className="font-bold text-stone-900">最近赛场</h2>
        <button onClick={() => setView('history')} className="flex h-10 items-center gap-1 px-2 text-sm font-semibold text-stone-600">全部记录 <ArrowRight size={16} /></button>
      </div>
      {sessions.length ? newestFirst(sessions).slice(0, 3).map(session => (
        <button key={session.id} onClick={() => openSession(session)} className="mt-3 flex min-h-16 items-center gap-3 rounded-2xl bg-white px-4 py-3 text-left shadow-[0_7px_22px_rgba(69,49,24,0.08)]">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-800"><Gavel size={20} /></div>
          <div className="min-w-0 flex-1"><div className="truncate font-semibold text-stone-900">{session.topic}</div><div className="mt-1 text-xs text-stone-500">{session.mode === 'solo' ? '一对一' : '八人赛'} · {session.status === 'completed' ? '已结束' : '进行中'}</div></div>
          <ArrowRight size={18} className="text-stone-400" />
        </button>
      )) : <div className="mt-3 rounded-2xl border border-dashed border-amber-300 px-4 py-7 text-center text-sm text-stone-500">第一场辩论还在等你开题。</div>}
    </div>
  );

  const renderSetup = () => (
    <><Header title={setupMode === 'solo' ? '一对一辩论' : '八人正式辩论'} onBack={goBack} />
    <main className="min-h-0 min-w-0 flex-1 overflow-x-hidden overflow-y-auto bg-[#fffaf1] px-5 py-6" style={{ paddingBottom: 'calc(var(--safe-bottom) + 28px)' }}>
      <h2 className="text-2xl font-black tracking-[-0.03em] text-stone-900">先把争议说清楚</h2>
      <p className="mt-2 text-sm leading-6 text-stone-600">观点应当明确相反，但不需要写成长篇论证。</p>
      <label className="mt-6 block text-sm font-bold text-stone-800">讨论的事情</label>
      <input value={topic} onChange={e => setTopic(e.target.value)} placeholder="例如：亲密关系中是否应该共享手机密码" className="mt-2 h-12 w-full rounded-xl bg-white px-4 text-stone-900 shadow-[0_5px_18px_rgba(69,49,24,0.07)] outline-none focus:ring-2 focus:ring-amber-400" />
      <label className="mt-5 block text-sm font-bold text-stone-800">正方观点</label>
      <textarea value={proPosition} onChange={e => setProPosition(e.target.value)} placeholder="应该共享，透明有助于建立信任" className="mt-2 min-h-24 w-full resize-none rounded-xl bg-white p-4 text-stone-900 shadow-[0_5px_18px_rgba(69,49,24,0.07)] outline-none focus:ring-2 focus:ring-amber-400" />
      <label className="mt-5 block text-sm font-bold text-stone-800">反方观点</label>
      <textarea value={conPosition} onChange={e => setConPosition(e.target.value)} placeholder="不应该共享，亲密关系仍需保有隐私" className="mt-2 min-h-24 w-full resize-none rounded-xl bg-white p-4 text-stone-900 shadow-[0_5px_18px_rgba(69,49,24,0.07)] outline-none focus:ring-2 focus:ring-amber-400" />

      {setupMode === 'solo' && <>
        <h3 className="mt-7 font-bold text-stone-900">选择对手</h3>
        <div className="mt-3 grid grid-cols-3 gap-3">
          {characters.map(char => <button key={char.id} onClick={() => setSoloCharId(char.id)} className={`flex min-h-28 flex-col items-center justify-center rounded-2xl p-3 ${soloCharId === char.id ? 'bg-stone-900 text-white ring-2 ring-amber-400' : 'bg-white text-stone-700 shadow-[0_5px_18px_rgba(69,49,24,0.07)]'}`}><Avatar char={char} /><span className="mt-2 max-w-full truncate text-sm font-semibold">{char.name}</span></button>)}
        </div>
        <h3 className="mt-7 font-bold text-stone-900">你的立场</h3>
        <div className="mt-3 grid grid-cols-2 gap-3">
          {(['pro', 'con'] as DebateSide[]).map(side => <button key={side} onClick={() => setUserSide(side)} className={`min-h-14 rounded-xl px-3 text-sm font-bold ${userSide === side ? side === 'pro' ? 'bg-red-500 text-white' : 'bg-blue-600 text-white' : 'bg-white text-stone-600'}`}>{DEBATE_SIDE_LABELS[side]}</button>)}
        </div>
      </>}
      {error && <p className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      <button onClick={() => void createSession()} className="mt-7 flex h-[52px] min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-stone-900 font-bold text-white disabled:opacity-40" disabled={busy}>下一步 <ArrowRight size={19} /></button>
    </main></>
  );

  const renderRecall = () => {
    if (!activeSession?.team) return null;
    const recalled = new Set(activeSession.team.recalls.map(item => item.charId));
    const available = characters.filter(char => !recalled.has(char.id));
    const proCount = activeSession.team.recalls.filter(item => item.side === 'pro').length;
    const conCount = activeSession.team.recalls.filter(item => item.side === 'con').length;
    return <><Header title="观点召回" onBack={goBack} right={<span className="text-xs font-bold text-stone-500">正 {proCount} · 反 {conCount}</span>} />
      <main className="min-h-0 flex-1 overflow-y-auto bg-[#fffaf1] px-5 py-5" style={{ paddingBottom: 'calc(var(--safe-bottom) + 28px)' }}>
        <h2 className="text-xl font-black text-stone-900">你决定先问谁</h2>
        <p className="mt-2 text-sm leading-6 text-stone-600">候选人会独立选择愿意捍卫的立场。结果一边倒时，再回来召回更多人即可。</p>
        {!!activeSession.team.recalls.length && <div className="mt-5 space-y-3">
          {activeSession.team.recalls.map(item => {
            const char = charById.get(item.charId);
            return <div key={item.charId} className="flex gap-3 rounded-2xl bg-white p-4 shadow-[0_5px_18px_rgba(69,49,24,0.07)]"><Avatar char={char} /><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><b className="truncate text-stone-900">{char?.name || '未知角色'}</b><span className={`shrink-0 rounded-full px-3 py-1 text-xs font-bold ${item.side === 'pro' ? 'bg-red-50 text-red-600' : 'bg-blue-50 text-blue-700'}`}>{DEBATE_SIDE_LABELS[item.side]}</span></div><p className="mt-2 text-sm leading-6 text-stone-600">{item.reason}</p></div></div>;
          })}
        </div>}
        <h3 className="mt-7 font-bold text-stone-900">继续选择候选人</h3>
        {available.length ? <div className="mt-3 grid grid-cols-3 gap-3">{available.map(char => {
          const selected = recallSelection.includes(char.id);
          return <button key={char.id} disabled={busy} onClick={() => setRecallSelection(prev => selected ? prev.filter(id => id !== char.id) : [...prev, char.id])} className={`relative flex min-h-28 flex-col items-center justify-center rounded-2xl p-3 ${selected ? 'bg-amber-300 text-amber-950 ring-2 ring-stone-900' : 'bg-white text-stone-700'}`}><Avatar char={char} /><span className="mt-2 max-w-full truncate text-sm font-semibold">{char.name}</span>{selected && <Check className="absolute right-2 top-2" size={18} weight="bold" />}</button>;
        })}</div> : <p className="mt-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-950/75">所有角色都已经完成观点召回。</p>}
        {busy && <div className="mt-5 flex items-center gap-3 rounded-xl bg-stone-900 px-4 py-4 text-sm font-semibold text-white"><Broadcast size={20} className="animate-pulse" />{busyLabel}<button onClick={() => operationController.current?.abort()} className="ml-auto min-h-11 shrink-0 px-2 text-xs text-amber-300">停止生成</button></div>}
        {error && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        <button onClick={() => void runRecall()} disabled={busy || !recallSelection.length} className="mt-5 h-[52px] min-h-[52px] w-full rounded-xl bg-stone-900 font-bold text-white disabled:opacity-35">召回所选角色的观点</button>
        <button onClick={() => setView('lineup')} disabled={proCount < 4 || conCount < 4 || busy} className="mt-3 flex h-[52px] min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-amber-400 font-bold text-amber-950 disabled:opacity-35">进入排阵 <ArrowRight size={19} /></button>
        {(proCount < 4 || conCount < 4) && <p className="mt-2 text-center text-xs text-amber-950/65">至少需要 4 位正方候选人与 4 位反方候选人</p>}
      </main></>;
  };

  const renderLineup = () => {
    if (!activeSession?.team) return null;
    const sidePanel = (side: DebateSide) => {
      const selected = side === 'pro' ? activeSession.team!.proCharIds : activeSession.team!.conCharIds;
      const candidates = activeSession.team!.recalls.filter(item => item.side === side);
      return <section className="mt-5"><div className="flex items-center justify-between"><h3 className={`font-bold ${side === 'pro' ? 'text-red-600' : 'text-blue-700'}`}>{DEBATE_SIDE_LABELS[side]}阵容</h3><span className="text-xs font-semibold text-stone-500">按选择顺序担任 1—4 辩</span></div>
        <div className="mt-3 space-y-2">{candidates.map(item => { const char = charById.get(item.charId); const index = selected.indexOf(item.charId); return <button key={item.charId} onClick={() => void toggleLineup(item.charId, side)} className={`flex min-h-16 w-full items-center gap-3 rounded-xl px-4 py-3 text-left ${index >= 0 ? side === 'pro' ? 'bg-red-500 text-white' : 'bg-blue-600 text-white' : 'bg-white text-stone-700'}`}><Avatar char={char} size="h-10 w-10" /><div className="min-w-0 flex-1"><b className="block truncate">{char?.name}</b><span className={`text-xs ${index >= 0 ? 'text-white/75' : 'text-stone-500'}`}>{index >= 0 ? DEBATE_ROLE_LABELS[(index + 1) as 1 | 2 | 3 | 4] : '点按加入阵容'}</span></div>{index >= 0 && <span className="text-xl font-black">{index + 1}</span>}</button>; })}</div>
      </section>;
    };
    return <><Header title="安排辩位" onBack={goBack} right={<button onClick={() => setView('recall')} className="text-xs font-bold text-stone-600">继续召回</button>} />
      <main className="min-h-0 flex-1 overflow-y-auto bg-[#fffaf1] px-5 py-5" style={{ paddingBottom: 'calc(var(--safe-bottom) + 28px)' }}>
        <h2 className="text-xl font-black text-stone-900">顺序就是辩位</h2><p className="mt-2 text-sm leading-6 text-stone-600">先点中的角色是一辩，随后依次为二、三、四辩；再次点按可移出重排。</p>
        {sidePanel('pro')}{sidePanel('con')}
        <button onClick={() => void beginTeamDebate()} disabled={!canStartTeamDebate(activeSession)} className="mt-7 flex h-[52px] min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-stone-900 font-bold text-white disabled:opacity-35"><MicrophoneStage size={20} /> 正式开赛</button>
      </main></>;
  };

  const renderDebate = () => {
    if (!activeSession) return null;
    const proScore = activeSession.speeches.filter(s => s.side === 'pro').reduce((sum, s) => sum + (s.score || 0), 0);
    const conScore = activeSession.speeches.filter(s => s.side === 'con').reduce((sum, s) => sum + (s.score || 0), 0);
    const waitingForReport = activeSession.stage === 'summary';
    if (!waitingForReport && !currentTurn) return null;
    const currentChar = currentTurn?.charId ? charById.get(currentTurn.charId) : null;
    return <><Header title={waitingForReport ? '对局结束' : '直播赛场'} onBack={goBack} right={<span className="text-xs font-bold text-stone-500">{waitingForReport ? '发言完毕' : `${currentTurn!.index + 1}/${getDebateTurns(activeSession).length}`}</span>} />
      <main className="min-h-0 flex-1 overflow-y-auto bg-[#f7efe2]" style={{ paddingBottom: 'calc(var(--safe-bottom) + 24px)' }}>
        <div className="sticky top-0 z-10 grid grid-cols-[1fr_auto_1fr] items-center bg-stone-900 px-5 py-3 text-white shadow-[0_8px_20px_rgba(28,25,23,0.22)]">
          <div><div className="text-xs font-bold text-red-300">正方</div><div className="text-2xl font-black tabular-nums">{proScore}</div></div>
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-400 text-amber-950"><Scales size={22} weight="bold" /></div>
          <div className="text-right"><div className="text-xs font-bold text-blue-300">反方</div><div className="text-2xl font-black tabular-nums">{conScore}</div></div>
        </div>
        <div className="px-5 py-5">
          {waitingForReport ? <section className="rounded-2xl bg-amber-300 p-4 text-amber-950 shadow-[0_8px_22px_rgba(115,77,20,0.14)]">
            <div className="flex items-center gap-2 text-sm font-bold"><Gavel size={19} /> 本场发言结束</div>
            <p className="mt-3 text-sm leading-6 text-amber-950/75">最后一位辩手的发言与评分已保存。你可以留在这里慢慢读完全部对局，再手动进入赛后报告。</p>
          </section> : <section className="rounded-2xl bg-amber-300 p-4 text-amber-950 shadow-[0_8px_22px_rgba(115,77,20,0.14)]">
            <div className="flex items-center gap-2 text-sm font-bold"><Gavel size={19} /> 主持人播报</div>
            <div className="mt-3 flex items-center gap-3"><Avatar char={currentChar} /><div><div className="text-xs font-semibold text-amber-950/70">现在请</div><div className="text-lg font-black">{currentTurn!.speakerType === 'user' ? (userProfile.name || '你') : currentChar?.name} · {DEBATE_SIDE_LABELS[currentTurn!.side]}{currentTurn!.role ? ` ${DEBATE_ROLE_LABELS[currentTurn!.role]}` : ` 第${currentTurn!.round}轮`}</div></div></div>
          </section>}

          <div className="mt-5 space-y-4">{activeSession.speeches.map(speech => <DebateSpeechCard key={speech.id} speech={speech} />)}</div>

          {busy ? <div className="mt-5 flex min-h-24 items-center justify-center gap-3 rounded-2xl bg-stone-900 px-5 text-sm font-semibold text-white"><Broadcast size={22} className="animate-pulse" />{busyLabel}<button onClick={() => operationController.current?.abort()} className="ml-auto min-h-11 shrink-0 px-2 text-xs text-amber-300">停止生成</button></div> : waitingForReport ? <button onClick={() => void retrySummary()} className="mt-5 flex h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-amber-400 font-bold text-amber-950"><Gavel size={20} /> 查看总结 / 进入赛后报告</button> : currentTurn!.speakerType === 'user' ? <section className="mt-5 rounded-2xl bg-white p-4 shadow-[0_6px_20px_rgba(69,49,24,0.08)]"><label className="font-bold text-stone-900">说出你的发言</label><textarea value={speechDraft} onChange={e => setSpeechDraft(e.target.value)} placeholder="提出论点、回应对方，并说明为什么你的判断标准更有说服力……" className="mt-3 min-h-36 w-full resize-none rounded-xl bg-stone-100 p-4 text-stone-900 outline-none focus:ring-2 focus:ring-amber-400" /><button onClick={() => void submitUserSpeech()} disabled={!speechDraft.trim()} className="mt-3 h-12 w-full rounded-xl bg-stone-900 font-bold text-white disabled:opacity-35">提交发言并请主持人评分</button></section> : <button onClick={() => void generateCharacterSpeech()} className="mt-5 flex h-14 w-full items-center justify-center gap-2 rounded-xl bg-stone-900 font-bold text-white"><MicrophoneStage size={21} /> 请 {currentChar?.name} 发言</button>}
          {error && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
        </div>
      </main></>;
  };

  const renderReport = () => {
    if (!activeSession?.report) return null;
    const { report } = activeSession;
    const winner = report.winner === 'draw' ? '本场平局' : `${DEBATE_SIDE_LABELS[report.winner]}获胜`;
    const participantIds = getDebateParticipantIds(activeSession);
    const allShared = participantIds.every(id => activeSession.sharedMessageIds?.[id]);
    return <><Header title="赛后报告" onBack={goBack} />
      <main className="min-h-0 flex-1 overflow-y-auto bg-[#fffaf1] px-5 py-6" style={{ paddingBottom: 'calc(var(--safe-bottom) + 28px)' }}>
        <div className="rounded-2xl bg-stone-900 p-5 text-white shadow-[0_14px_34px_rgba(69,49,24,0.2)]"><div className="flex items-center gap-2 text-amber-300"><Gavel size={22} /><span className="text-sm font-bold">主持人宣布</span></div><h2 className="mt-4 text-3xl font-black tracking-[-0.03em]">{winner}</h2><p className="mt-3 text-sm leading-6 text-stone-300">{activeSession.topic}</p><div className="mt-6 grid grid-cols-2 gap-3"><div className="rounded-xl bg-red-500 p-4"><div className="text-xs font-bold text-red-100">正方总分</div><div className="mt-1 text-3xl font-black tabular-nums">{report.proScore}</div></div><div className="rounded-xl bg-blue-600 p-4"><div className="text-xs font-bold text-blue-100">反方总分</div><div className="mt-1 text-3xl font-black tabular-nums">{report.conScore}</div></div></div></div>
        <section className="mt-5 rounded-2xl bg-white p-5 shadow-[0_7px_22px_rgba(69,49,24,0.08)]"><h3 className="font-bold text-stone-900">关键交锋</h3><p className="mt-3 whitespace-pre-wrap text-[15px] leading-7 text-stone-700">{report.summary}</p></section>
        {busy && <p role="status" className="mt-4 text-sm text-amber-800">{busyLabel || '正在处理…'}{busyLabel && <button onClick={() => operationController.current?.abort()} className="ml-3 min-h-11 px-2 font-semibold">停止生成</button>}</p>}
        <details className="group mt-5 overflow-hidden rounded-2xl bg-white shadow-[0_7px_22px_rgba(69,49,24,0.08)]">
          <summary className="flex min-h-16 cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-left">
            <span><b className="block text-stone-900">查看完整辩论对局记录</b><span className="mt-1 block text-xs text-stone-500">逐轮复盘 · {activeSession.speeches.length} 次原始发言</span></span>
            <CaretDown size={20} className="shrink-0 text-stone-500 transition-transform group-open:rotate-180" />
          </summary>
          <div className="space-y-4 border-t border-stone-100 bg-[#f7efe2] p-4">{activeSession.speeches.map(speech => <DebateSpeechCard key={speech.id} speech={speech} />)}</div>
        </details>
        <section className="mt-5"><h3 className="font-bold text-stone-900">本场辩手</h3><div className="mt-3 flex flex-wrap gap-2">{participantIds.map(id => { const char = charById.get(id); return <div key={id} className="flex items-center gap-2 rounded-full bg-white py-1.5 pl-1.5 pr-3 text-sm font-semibold text-stone-700"><Avatar char={char} size="h-8 w-8" />{char?.name}</div>; })}</div></section>
        <div className="mt-6 rounded-xl bg-amber-50 px-4 py-4 text-sm leading-6 text-amber-950/75"><div className="flex items-start gap-2"><ShieldCheck size={20} className="mt-0.5 shrink-0 text-amber-700" /><span>报告默认只保存在本机。只有你确认后，结果卡片与记忆总结才会写入参赛角色的聊天。</span></div></div>
        <button disabled={allShared || busy} onClick={() => setShareConfirm(true)} className="mt-5 h-[52px] min-h-[52px] w-full rounded-xl bg-amber-400 font-bold text-amber-950 disabled:opacity-45">{allShared ? '已写回聊天与记忆' : '写回聊天与记忆'}</button>
        {activeSession.mode === 'team' && Object.keys(activeSession.sharedMessageIds || {}).length > 0 && <button disabled={busy} onClick={() => void shareResult(true)} className="mt-3 h-12 w-full rounded-xl bg-white font-semibold text-amber-900 disabled:opacity-40">修复历史结果（原地更新卡片与记忆）</button>}
        <button disabled={busy} onClick={() => setView('home')} className="mt-3 h-12 w-full rounded-xl bg-stone-100 font-semibold text-stone-700 disabled:opacity-40">返回首页</button>
        {error && <p className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      </main>
      {shareConfirm && <div className="absolute inset-0 z-50 flex items-end bg-stone-950/40 p-4"><div className="w-full rounded-2xl bg-white p-5 shadow-[0_18px_45px_rgba(28,25,23,0.28)]" style={{ marginBottom: 'var(--safe-bottom)' }}><div className="flex items-center justify-between"><h2 className="text-lg font-bold text-stone-900">写回本次辩论？</h2><button onClick={() => setShareConfirm(false)} className="flex h-10 w-10 items-center justify-center rounded-full bg-stone-100" aria-label="关闭"><X size={18} /></button></div><p className="mt-3 text-sm leading-6 text-stone-600">{activeSession.mode === 'solo' ? '结果卡片会出现在对手角色的聊天框，并成为你们共同经历的一部分。' : '同一张结果卡片会分别写入八位辩手的聊天框与长期记忆。'}写回后不会公开给其他人。</p><div className="mt-5 grid grid-cols-2 gap-3"><button disabled={busy} onClick={() => setShareConfirm(false)} className="h-12 rounded-xl bg-stone-100 font-semibold text-stone-700">继续私密保存</button><button disabled={busy} onClick={() => void shareResult()} className="h-12 rounded-xl bg-amber-400 font-bold text-amber-950 disabled:opacity-40">{busy ? '正在写回…' : '确认写回'}</button></div></div></div>}
    </>;
  };

  const renderHistory = () => <><Header title="全部赛场" onBack={goBack} />
    <main className="min-h-0 flex-1 overflow-y-auto bg-[#fffaf1] px-5 py-5" style={{ paddingBottom: 'calc(var(--safe-bottom) + 28px)' }}>{sessions.length ? newestFirst(sessions).map(session => <div key={session.id} className="mb-3 flex items-center gap-3 rounded-2xl bg-white p-4 shadow-[0_6px_20px_rgba(69,49,24,0.07)]"><button onClick={() => openSession(session)} className="min-w-0 flex-1 text-left"><div className="truncate font-bold text-stone-900">{session.topic}</div><div className="mt-1 text-xs text-stone-500">{session.mode === 'solo' ? '一对一' : '八人赛'} · {session.status === 'completed' ? '已结束' : '进行中'} · {new Date(session.updatedAt).toLocaleDateString()}</div></button><button onClick={() => void deleteSession(session)} className="flex h-11 w-11 items-center justify-center rounded-full text-stone-400 hover:bg-red-50 hover:text-red-600" aria-label="删除记录"><Trash size={19} /></button></div>) : <div className="py-20 text-center text-stone-500"><ClockCounterClockwise size={34} className="mx-auto mb-3" />暂无辩论记录</div>}</main>
  </>;

  return <div className="absolute inset-0 flex flex-col overflow-hidden bg-[#fffaf1] text-stone-900">
    {view === 'home' && renderHome()}
    {view === 'setup' && renderSetup()}
    {view === 'recall' && renderRecall()}
    {view === 'lineup' && renderLineup()}
    {view === 'debate' && renderDebate()}
    {view === 'report' && renderReport()}
    {view === 'history' && renderHistory()}
  </div>;
};

export default DebateApp;
