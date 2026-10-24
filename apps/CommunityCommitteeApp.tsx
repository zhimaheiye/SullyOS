import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, CaretLeft, ChatTeardropText, CheckCircle, ChatsCircle, Handshake,
  Leaf, Plus, ShieldCheck, Trash, UsersThree, WarningCircle, X,
} from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { useCommunityCommittee } from '../hooks/useCommunityCommittee';
import type {
  CharacterProfile, CommunityCommitteeOpeningAnalysis, CommunityCommitteeOpeningSegment,
  CommunityCommitteeSession,
} from '../types';
import {
  COMMUNITY_PEELING_LAYERS,
  getCommunityCommitteeRound,
  getPendingCommitteeCharIds,
  splitCommunityCommitteeOpening,
} from '../utils/communityCommittee';

type View = 'home' | 'setup' | 'review' | 'peeling' | 'summary';

const Avatar: React.FC<{ char?: CharacterProfile | null; selected?: boolean; size?: string }> = ({
  char, selected, size = 'h-12 w-12',
}) => (
  <div className={`${size} shrink-0 overflow-hidden rounded-full bg-teal-100 ring-2 ${selected ? 'ring-teal-500' : 'ring-white'}`}>
    {char?.avatar ? <img src={char.avatar} alt={char.name} className="h-full w-full object-cover" /> : (
      <div className="flex h-full w-full items-center justify-center font-black text-teal-800">{char?.name?.slice(0, 1) || '?'}</div>
    )}
  </div>
);

const Header: React.FC<{ title: string; onBack: () => void }> = ({ title, onBack }) => (
  <header className="shrink-0 border-b border-teal-950/10 bg-[#f6faf8]" style={{ paddingTop: 'var(--safe-top)' }}>
    <div className="flex h-16 items-center justify-between px-4">
      <button onClick={onBack} className="-ml-2 flex h-11 w-11 items-center justify-center rounded-full text-teal-950 hover:bg-teal-50" aria-label="返回"><CaretLeft size={27} /></button>
      <h1 className="font-black tracking-[-0.02em] text-slate-900">{title}</h1>
      <div className="min-w-11" />
    </div>
  </header>
);

const OPENING_SIDE_META = {
  a: { label: '第一边', className: 'bg-[#dcefeb] text-teal-950', dot: 'bg-teal-600' },
  b: { label: '另一边', className: 'bg-[#fff0d5] text-amber-950', dot: 'bg-amber-500' },
  both: { label: '两边拉扯', className: 'bg-[#f1eee7] text-slate-800', dot: 'bg-slate-500' },
} as const;

const OpeningParagraphs: React.FC<{
  segments: CommunityCommitteeOpeningSegment[];
  onCycle?: (id: string) => void;
}> = ({ segments, onCycle }) => (
  <div className="space-y-2">{segments.map(segment => {
    const meta = OPENING_SIDE_META[segment.side];
    const content = <><span className="mb-1.5 flex items-center gap-1.5 text-[10px] font-black"><span className={`h-1.5 w-1.5 rounded-full ${meta.dot}`} />{meta.label}{onCycle ? ' · 点按换色' : ''}</span><span className="block whitespace-pre-wrap text-sm leading-6">{segment.content}</span></>;
    return onCycle ? <button key={segment.id} type="button" onClick={() => onCycle(segment.id)} className={`w-full rounded-xl px-3 py-3 text-left outline-none transition-colors focus-visible:ring-2 focus-visible:ring-teal-600 focus-visible:ring-offset-2 ${meta.className}`} aria-label={`${meta.label}：${segment.content}。点按切换归属`}>{content}</button> : <div key={segment.id} className={`rounded-xl px-3 py-3 ${meta.className}`}>{content}</div>;
  })}</div>
);

const getSessionOpeningSegments = (session: CommunityCommitteeSession): CommunityCommitteeOpeningSegment[] => {
  if (session.openingSegments?.length) return session.openingSegments;
  const fallback = session.openingText || session.topic;
  return splitCommunityCommitteeOpening(fallback).map((content, index) => ({
    id: `legacy-opening-segment-${index + 1}`,
    content,
    side: 'both',
  }));
};

const CommunityCommitteeApp: React.FC = () => {
  const { closeApp, registerBackHandler, addToast } = useOS();
  const {
    characters, userProfile, sessions, busy, busyLabel, error, setError,
    analyzeOpening, startSession, submitLayer, retryPending, completeSession, retryShare, remove,
  } = useCommunityCommittee();
  const [view, setView] = useState<View>('home');
  const [activeSessionId, setActiveSessionId] = useState('');
  const [openingText, setOpeningText] = useState('');
  const [openingAnalysis, setOpeningAnalysis] = useState<CommunityCommitteeOpeningAnalysis | null>(null);
  const [selectedCharIds, setSelectedCharIds] = useState<string[]>([]);
  const [draft, setDraft] = useState('');

  const activeSession = sessions.find(session => session.id === activeSessionId) || null;
  const charById = useMemo(() => new Map(characters.map(char => [char.id, char])), [characters]);
  const pendingCharIds = activeSession ? getPendingCommitteeCharIds(activeSession).filter(charId => charById.has(charId)) : [];
  const participantChars = activeSession?.charIds.map(charId => charById.get(charId)).filter((char): char is CharacterProfile => Boolean(char)) || [];
  const allShared = Boolean(activeSession?.report && activeSession.charIds.every(charId => activeSession.sharedMessageIds?.[charId] || !charById.has(charId)));

  const goHome = useCallback(() => {
    setView('home');
    setActiveSessionId('');
    setDraft('');
    setOpeningAnalysis(null);
    setError('');
  }, [setError]);

  const goBack = useCallback(() => {
    if (busy) return true;
    if (view === 'home') { closeApp(); return true; }
    if (view === 'review') { setView('setup'); setError(''); return true; }
    goHome();
    return true;
  }, [busy, closeApp, goHome, view]);

  useEffect(() => registerBackHandler(goBack), [goBack, registerBackHandler]);

  const beginNew = () => {
    setOpeningText(''); setOpeningAnalysis(null); setSelectedCharIds([]); setError('');
    setView('setup');
  };

  const toggleChar = (charId: string) => {
    setSelectedCharIds(current => current.includes(charId)
      ? current.filter(id => id !== charId)
      : current.length < 3 ? [...current, charId] : current);
  };

  const reviewOpening = async () => {
    if (!openingText.trim()) { setError('先把这件事一口气写下来。'); return; }
    try {
      const analysis = await analyzeOpening(openingText);
      setOpeningAnalysis(analysis);
      setView('review');
    } catch { /* hook 保留错误 */ }
  };

  const cycleOpeningSegment = (segmentId: string) => {
    setOpeningAnalysis(current => current ? {
      ...current,
      segments: current.segments.map(segment => segment.id === segmentId ? {
        ...segment,
        side: segment.side === 'a' ? 'b' : segment.side === 'b' ? 'both' : 'a',
      } : segment),
    } : current);
  };

  const createSession = async () => {
    if (!openingAnalysis) { setError('请先让 AI 梳理这段话。'); return; }
    if (!selectedCharIds.length) { setError('请选择至少一位愿意听你说的角色。'); return; }
    try {
      const session = await startSession({ analysis: openingAnalysis, charIds: selectedCharIds });
      setActiveSessionId(session.id);
      setView('peeling');
    } catch { /* hook 保留错误 */ }
  };

  const openSession = (session: CommunityCommitteeSession) => {
    setActiveSessionId(session.id);
    setDraft('');
    setError('');
    setView(session.stage === 'summary' ? 'summary' : 'peeling');
  };

  const sendLayer = async () => {
    if (!activeSession || !draft.trim()) return;
    try {
      await submitLayer(activeSession, draft);
      setDraft('');
    } catch { /* 保存前失败时保留草稿 */ }
  };

  const finishSession = async () => {
    if (!activeSession) return;
    try {
      const completed = await completeSession(activeSession);
      setActiveSessionId(completed.id);
      setView('summary');
    } catch { /* hook 保留错误 */ }
  };

  const deleteSession = async (session: CommunityCommitteeSession) => {
    const suffix = session.stage === 'summary' ? '已写入聊天和记忆的内容不会被撤回。' : '这段未完成的倾诉将无法恢复。';
    if (!window.confirm(`删除“${session.topic}”的本地记录？${suffix}`)) return;
    try {
      await remove(session.id);
      if (activeSessionId === session.id) goHome();
      addToast('居委会记录已删除', 'success');
    } catch { addToast('删除失败，请重试', 'error'); }
  };

  const renderHome = () => (
    <main className="min-h-0 flex-1 overflow-y-auto bg-[#f6faf8] px-5" style={{ paddingTop: 'calc(var(--safe-top) + 18px)', paddingBottom: 'calc(var(--safe-bottom) + 30px)' }}>
      <div className="mx-auto max-w-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-[30px] font-black tracking-[-0.035em] text-slate-950">居委会</h1>
            <p className="mt-2 max-w-lg text-sm leading-6 text-slate-600">有些事不是谁没道理，而是你理解了所有人之后，痛苦还是落在了自己身上。</p>
          </div>
          <button onClick={closeApp} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-teal-100 text-teal-950" aria-label="关闭"><X size={21} /></button>
        </div>

        <section className="relative mt-7 overflow-hidden rounded-2xl bg-[#123e3a] px-5 py-6 text-white shadow-[0_18px_44px_rgba(18,62,58,0.24)]">
          <div className="absolute inset-y-0 right-0 w-28 bg-[#d7a458] opacity-20 [clip-path:polygon(38%_0,100%_0,100%_100%,0_100%)]" />
          <Handshake size={34} weight="duotone" className="relative text-[#f0c985]" />
          <h2 className="relative mt-5 max-w-md text-2xl font-black tracking-[-0.03em]">不判输赢，先陪你把这件事一层层说清楚。</h2>
          <p className="relative mt-3 max-w-lg text-sm leading-6 text-teal-50/80">选择 1—3 位熟悉你的角色。ta 们会带着共同记忆来听，不替任何一边辩护，也不催你立刻做决定。</p>
          <button onClick={beginNew} className="relative mt-6 flex h-12 w-full items-center justify-between rounded-xl bg-[#f0c985] px-4 font-black text-[#123e3a] hover:bg-[#f6d89f]">
            <span className="flex items-center gap-2"><Plus size={20} weight="bold" />倾诉一个新困境</span><ArrowRight size={20} />
          </button>
        </section>

        <div className="mt-5 flex items-start gap-3 rounded-2xl bg-white px-4 py-3 text-xs leading-5 text-slate-600 shadow-[0_7px_24px_rgba(15,63,58,0.06)]">
          <ShieldCheck size={19} className="mt-0.5 shrink-0 text-teal-700" />
          <span>这里讨论现实生活。你点击结束倾诉后，克制的总结会默认同步到参与角色的主聊天与记忆；逐字倾诉仍只保留在本机记录里。</span>
        </div>

        <section className="mt-9">
          <div className="flex items-end justify-between">
            <div><h2 className="text-lg font-black text-slate-900">议事记录</h2><p className="mt-1 text-xs text-slate-500">未结束的可以继续，已经结束的可以回看落点。</p></div>
            <span className="text-xs font-bold text-slate-400">{sessions.length} 件</span>
          </div>
          {sessions.length === 0 ? (
            <div className="mt-4 border-t border-dashed border-teal-200 py-12 text-center text-sm text-slate-500"><ChatsCircle size={32} className="mx-auto mb-3 text-teal-300" />还没有把任何一件事放到桌上。</div>
          ) : <div className="mt-3 divide-y divide-teal-950/10">{sessions.map(session => {
            const names = session.charIds.map(id => charById.get(id)?.name).filter(Boolean).join('、');
            return <div key={session.id} className="flex items-center gap-3 py-4">
              <button onClick={() => openSession(session)} className="min-w-0 flex-1 text-left">
                <div className="flex items-center gap-2"><b className="truncate text-sm text-teal-950">{session.topic}</b><span className={`shrink-0 rounded-full px-2 py-0.5 text-[9px] font-black ${session.stage === 'summary' ? 'bg-teal-100 text-teal-800' : 'bg-amber-100 text-amber-800'}`}>{session.stage === 'summary' ? '已落点' : '继续倾诉'}</span></div>
                <span className="mt-1 block truncate text-xs text-slate-500">{names || '原参与角色已不存在'} · {getCommunityCommitteeRound(session.turns)} 层 · {new Date(session.updatedAt).toLocaleDateString('zh-CN')}</span>
              </button>
              <button onClick={() => void deleteSession(session)} className="flex h-10 w-10 items-center justify-center rounded-xl text-rose-300 hover:bg-rose-50 hover:text-rose-700" aria-label="删除记录"><Trash size={18} /></button>
            </div>;
          })}</div>}
        </section>
      </div>
    </main>
  );

  const renderSetup = () => (
    <><Header title="先一口气说完" onBack={goBack} />
    <main className="min-h-0 flex-1 overflow-y-auto bg-[#f6faf8] px-5 py-6" style={{ paddingBottom: 'calc(var(--safe-bottom) + 28px)' }}>
      <div className="mx-auto max-w-2xl">
        <h2 className="text-2xl font-black tracking-[-0.03em] text-slate-950">不用先替它分类。</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">想到哪边就写哪边，前后推翻也没关系。AI 会先替你听出两股互相拉扯的力量，你再用荧光色调整每一段的归属。</p>
        <label className="mt-7 block"><span className="text-xs font-black text-slate-700">我想说的是</span><textarea autoFocus value={openingText} onChange={event => setOpeningText(event.target.value)} rows={14} placeholder={'把想到的全部写在这里……\n\n想换一个角度时，可以另起一段。'} className="mt-2 w-full resize-y rounded-2xl bg-white px-4 py-4 text-sm leading-7 text-slate-900 shadow-[0_9px_28px_rgba(15,63,58,0.08)] outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-teal-500" /></label>
        <p className="mt-2 text-xs leading-5 text-slate-500">原文不会被 AI 改写。换行分出的段落会在下一步逐段标色。</p>
        {error && <div className="mt-5 rounded-2xl bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-800">{error}</div>}
        <button onClick={() => void reviewOpening()} disabled={busy || !openingText.trim()} className="mt-6 flex h-12 w-full items-center justify-between rounded-2xl bg-[#123e3a] px-5 text-sm font-black text-white shadow-[0_10px_28px_rgba(18,62,58,0.2)] disabled:bg-slate-300 disabled:shadow-none"><span className="flex items-center gap-2"><Leaf size={20} weight="fill" />帮我听出这份拉扯</span><ArrowRight size={19} /></button>
      </div>
    </main></>
  );

  const renderReview = () => openingAnalysis && (
    <><Header title="看看这份拉扯" onBack={goBack} />
    <main className="min-h-0 flex-1 overflow-y-auto bg-[#f6faf8] px-5 py-6" style={{ paddingBottom: 'calc(var(--safe-bottom) + 28px)' }}>
      <div className="mx-auto max-w-2xl">
        <h2 className="text-2xl font-black tracking-[-0.03em] text-slate-950">{openingAnalysis.topic}</h2>
        <p className="mt-3 text-sm leading-6 text-slate-600">下面仍是你的原话。点按任意一段，可以在“第一边 → 另一边 → 两边拉扯”之间换色。</p>
        <div className="mt-6"><OpeningParagraphs segments={openingAnalysis.segments} onCycle={cycleOpeningSegment} /></div>

        <div className="mt-6 grid grid-cols-2 gap-3">
          <section className="rounded-2xl bg-[#dcefeb] px-4 py-4"><b className="text-xs font-black text-teal-800">第一股力量</b><p className="mt-2 text-sm leading-6 text-teal-950">{openingAnalysis.sideA}</p></section>
          <section className="rounded-2xl bg-[#fff0d5] px-4 py-4"><b className="text-xs font-black text-amber-800">另一股力量</b><p className="mt-2 text-sm leading-6 text-amber-950">{openingAnalysis.sideB}</p></section>
        </div>

        <div className="mt-9 flex items-end justify-between"><div><h3 className="text-base font-black text-slate-900">请谁来听</h3><p className="mt-1 text-xs text-slate-500">确认后会把上面的原话直接说给 ta 们听。</p></div><span className="text-xs font-black text-teal-700">{selectedCharIds.length}/3</span></div>
        {characters.length === 0 ? <div className="mt-4 rounded-2xl bg-rose-50 p-4 text-sm text-rose-800">还没有角色，请先在“神经链接”中创建。</div> : (
          <div className="mt-4 grid grid-cols-3 gap-3">{characters.map(char => {
            const selectedIndex = selectedCharIds.indexOf(char.id);
            return <button key={char.id} type="button" onClick={() => toggleChar(char.id)} aria-pressed={selectedIndex >= 0} className={`relative flex min-h-28 flex-col items-center justify-center rounded-2xl px-2 py-3 text-center shadow-[0_6px_20px_rgba(15,63,58,0.07)] ${selectedIndex >= 0 ? 'bg-[#123e3a] text-white' : 'bg-white text-slate-800'}`}>
              {selectedIndex >= 0 && <span className="absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full bg-[#f0c985] text-[10px] font-black text-[#123e3a]">{selectedIndex + 1}</span>}
              <Avatar char={char} selected={selectedIndex >= 0} />
              <span className="mt-2 max-w-full truncate text-xs font-black">{char.name}</span>
            </button>;
          })}</div>
        )}
        <div className="mt-5 flex items-start gap-3 text-xs leading-5 text-slate-500"><WarningCircle size={19} className="mt-0.5 shrink-0 text-amber-700" /><span>这不是诊断或裁决。遇到当前紧迫的人身危险时，应优先联系现实中的可信任者、当地紧急服务或专业支持。</span></div>
        {error && <div className="mt-5 rounded-2xl bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-800">{error}</div>}
        <button onClick={() => void createSession()} disabled={busy || !selectedCharIds.length} className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#123e3a] px-5 text-sm font-black text-white shadow-[0_10px_28px_rgba(18,62,58,0.2)] disabled:bg-slate-300 disabled:shadow-none"><UsersThree size={20} weight="bold" />就这样说给 ta 们听</button>
      </div>
    </main></>
  );

  const renderPeeling = () => {
    if (!activeSession) return null;
    const openingSegments = getSessionOpeningSegments(activeSession);
    const openingTurnOffset = activeSession.openingText
      && activeSession.turns[0]?.speakerType === 'user'
      && activeSession.turns[0].content === activeSession.openingText ? 1 : 0;
    const visibleTurns = activeSession.turns.slice(openingTurnOffset);
    return <><Header title="正在议事" onBack={goBack} />
      <main className="min-h-0 flex-1 overflow-y-auto bg-[#f6faf8] px-4 py-5" style={{ paddingBottom: 'calc(var(--safe-bottom) + 28px)' }}>
        <div className="mx-auto max-w-2xl">
          <section className="rounded-2xl bg-[#123e3a] px-5 py-5 text-white shadow-[0_12px_32px_rgba(18,62,58,0.18)]">
            <div className="flex items-start justify-between gap-4"><div className="min-w-0"><h2 className="text-lg font-black leading-6">{activeSession.topic}</h2><p className="mt-2 text-xs leading-5 text-teal-50/75">原话在上，两股互相压过彼此的力量在下。</p></div><div className="flex -space-x-2">{participantChars.map(char => <Avatar key={char.id} char={char} size="h-9 w-9" />)}</div></div>
            <div className="mt-4"><OpeningParagraphs segments={openingSegments} /></div>
            <div className="mt-4 grid grid-cols-2 divide-x divide-white/15 border-t border-white/15 pt-4 text-xs leading-5">
              <div className="pr-3"><b className="block text-[#b6e2d5]">第一股力量</b><span className="mt-1 block text-teal-50/85">{activeSession.sideA}</span></div>
              <div className="pl-3"><b className="block text-[#f0c985]">另一股力量</b><span className="mt-1 block text-amber-50/90">{activeSession.sideB}</span></div>
            </div>
          </section>

          <div className="mt-6 flex items-center gap-3"><div className="flex h-9 w-9 items-center justify-center rounded-full bg-[#f0c985] text-[#123e3a]"><Leaf size={19} weight="fill" /></div><div><div className="text-xs font-black text-teal-800">第 {Math.max(1, getCommunityCommitteeRound(activeSession.turns))} 层</div><div className="text-sm font-black text-slate-900">{(getCommunityCommitteeRound(activeSession.turns) ? COMMUNITY_PEELING_LAYERS[Math.min(getCommunityCommitteeRound(activeSession.turns) - 1, COMMUNITY_PEELING_LAYERS.length - 1)] : COMMUNITY_PEELING_LAYERS[0]).label}</div></div></div>

          {visibleTurns.length === 0 ? (
            <div className="mt-5 border-l border-teal-300 py-9 pl-5 text-sm leading-7 text-slate-600">{activeSession.openingText ? '你的原话已经在上面，正在等大家回应。' : '这份旧记录还没有第一段倾诉，你可以从此刻最真实的感受继续。'}</div>
          ) : <div className="relative mt-5 border-l border-teal-300 pb-2 pl-5">{visibleTurns.map((turn, index) => {
            const absoluteIndex = index + openingTurnOffset;
            const depth = activeSession.turns.slice(0, absoluteIndex + 1).filter(item => item.speakerType === 'user').length;
            const char = turn.charId ? charById.get(turn.charId) : null;
            return <article key={turn.id} className={`relative mb-4 rounded-2xl px-4 py-3 ${turn.speakerType === 'user' ? 'bg-[#fff3df] text-slate-900' : 'bg-white text-slate-800 shadow-[0_6px_20px_rgba(15,63,58,0.07)]'}`} style={{ marginLeft: `${Math.min(Math.max(depth - 1, 0), 3) * 6}px` }}>
              <span className={`absolute -left-[25px] top-5 h-2.5 w-2.5 rounded-full ring-4 ring-[#f6faf8] ${turn.speakerType === 'user' ? 'bg-amber-500' : 'bg-teal-600'}`} />
              <div className="flex items-center gap-2">{turn.speakerType === 'character' && <Avatar char={char} size="h-7 w-7" />}<b className={`text-xs ${turn.speakerType === 'user' ? 'text-amber-900' : 'text-teal-800'}`}>{turn.speakerName}</b></div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-7">{turn.content}</p>
            </article>;
          })}</div>}

          {error && <div className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-800">{error}</div>}

          {pendingCharIds.length > 0 ? (
            <button onClick={() => void retryPending(activeSession)} disabled={busy} className="mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-teal-700 px-5 text-sm font-black text-white disabled:bg-slate-300"><ChatTeardropText size={20} />请 {pendingCharIds.map(id => charById.get(id)?.name).filter(Boolean).join('、')} 继续</button>
          ) : (
            <section className="mt-6 rounded-2xl bg-[#e6f3ef] p-4">
              <div className="flex items-start gap-3"><Leaf size={20} className="mt-0.5 shrink-0 text-teal-700" /><div><b className="text-sm text-teal-950">{COMMUNITY_PEELING_LAYERS[Math.min(getCommunityCommitteeRound(activeSession.turns), COMMUNITY_PEELING_LAYERS.length - 1)].label}</b><p className="mt-1 text-xs leading-5 text-teal-900/70">不必回答所有问题，只继续说这一刻最想补上的部分。</p></div></div>
              <textarea value={draft} onChange={event => setDraft(event.target.value)} rows={5} placeholder="听完这些，我还想补充……" className="mt-4 w-full resize-y rounded-xl bg-white px-4 py-3 text-sm leading-6 text-slate-900 outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-teal-500" />
              <button onClick={() => void sendLayer()} disabled={busy || !draft.trim()} className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#123e3a] text-sm font-black text-white disabled:bg-slate-300"><ChatsCircle size={19} />说给大家听</button>
            </section>
          )}

          <button onClick={() => void finishSession()} disabled={busy || !activeSession.turns.some(turn => turn.speakerType === 'user') || pendingCharIds.length > 0} className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-black text-teal-800 hover:bg-teal-50 disabled:text-teal-300"><CheckCircle size={19} />我想先停在这里，整理并写回</button>
        </div>
      </main></>;
  };

  const renderSummary = () => activeSession?.report && (
    <><Header title="这次议事的落点" onBack={goBack} />
    <main className="min-h-0 flex-1 overflow-y-auto bg-[#f6faf8] px-5 py-6" style={{ paddingBottom: 'calc(var(--safe-bottom) + 28px)' }}>
      <div className="mx-auto max-w-2xl">
        <div className="flex items-center gap-3"><div className="flex h-12 w-12 items-center justify-center rounded-full bg-[#f0c985] text-[#123e3a]"><Handshake size={25} weight="duotone" /></div><div className="min-w-0"><h2 className="truncate text-xl font-black text-slate-950">{activeSession.topic}</h2><p className="mt-1 text-xs text-slate-500">共说到 {getCommunityCommitteeRound(activeSession.turns)} 层 · {participantChars.map(char => char.name).join('、')}</p></div></div>
        <article className="mt-6 whitespace-pre-wrap rounded-2xl bg-white px-5 py-5 text-sm leading-7 text-slate-700 shadow-[0_10px_30px_rgba(15,63,58,0.08)]">{activeSession.report}</article>
        <section className="mt-9">
          <h3 className="text-base font-black text-slate-950">逐字倾诉</h3>
          <p className="mt-1 text-xs leading-5 text-slate-500">从最初原文到每一轮回应，完整保留在这份本机记录中。</p>
          <div className="relative mt-4 border-l border-teal-300 pb-1 pl-5">{activeSession.turns.map(turn => {
            const char = turn.charId ? charById.get(turn.charId) : null;
            return <article key={turn.id} className={`relative mb-4 rounded-2xl px-4 py-3 ${turn.speakerType === 'user' ? 'bg-[#fff3df] text-slate-900' : 'bg-white text-slate-800 shadow-[0_6px_20px_rgba(15,63,58,0.07)]'}`}>
              <span className={`absolute -left-[25px] top-5 h-2.5 w-2.5 rounded-full ring-4 ring-[#f6faf8] ${turn.speakerType === 'user' ? 'bg-amber-500' : 'bg-teal-600'}`} />
              <div className="flex items-center gap-2">{turn.speakerType === 'character' && <Avatar char={char} size="h-7 w-7" />}<b className={`text-xs ${turn.speakerType === 'user' ? 'text-amber-900' : 'text-teal-800'}`}>{turn.speakerName}</b></div>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-7">{turn.content}</p>
            </article>;
          })}</div>
        </section>
        {allShared ? (
          <div className="mt-5 flex items-start gap-3 rounded-2xl bg-[#e6f3ef] px-4 py-3 text-sm leading-6 text-teal-900"><CheckCircle size={21} weight="fill" className="mt-0.5 shrink-0 text-teal-700" /><span>总结已写入所有参与角色的主聊天与普通记忆。完整逐字倾诉仍只在这份本机记录中。</span></div>
        ) : (
          <div className="mt-5 rounded-2xl bg-amber-50 px-4 py-3 text-sm leading-6 text-amber-900"><div className="flex items-start gap-3"><WarningCircle size={21} className="mt-0.5 shrink-0" /><span>总结已保存在本机，但还有角色尚未收到。</span></div><button onClick={() => void retryShare(activeSession)} disabled={busy} className="mt-3 h-10 w-full rounded-xl bg-amber-700 text-xs font-black text-white disabled:bg-slate-300">继续写回聊天与记忆</button></div>
        )}
        {error && <div className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-800">{error}</div>}
        <button onClick={goHome} className="mt-6 flex h-12 w-full items-center justify-center rounded-2xl bg-[#123e3a] text-sm font-black text-white">回到议事记录</button>
      </div>
    </main></>
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden bg-[#f6faf8] text-slate-900">
      {view === 'home' && renderHome()}
      {view === 'setup' && renderSetup()}
      {view === 'review' && renderReview()}
      {view === 'peeling' && renderPeeling()}
      {view === 'summary' && renderSummary()}
      {busy && <div className="pointer-events-none absolute inset-x-4 bottom-[calc(var(--safe-bottom)+18px)] z-30 mx-auto max-w-md rounded-2xl bg-[#123e3a] px-4 py-3 text-center text-sm font-black text-white shadow-[0_14px_35px_rgba(18,62,58,0.3)]"><span className="mr-2 inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-[#f0c985]" />{busyLabel}</div>}
    </div>
  );
};

export default CommunityCommitteeApp;
