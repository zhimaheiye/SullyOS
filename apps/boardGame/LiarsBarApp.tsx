import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowRight, CardsThree, CaretLeft, Check, ClockCounterClockwise, Crosshair, Info,
  Play, ShieldCheck, Trash, UsersThree, X,
} from '@phosphor-icons/react';
import { useOS } from '../../context/OSContext';
import TokenImg from '../../components/os/TokenImg';
import { CharacterGroupFilterBar, filterCharactersByGroup, GROUP_FILTER_ALL } from '../../components/character/CharacterGroupFilter';
import type { CharacterProfile, LiarsBarEvent, LiarsBarGenerationMode, LiarsBarPlayerState, LiarsBarRank, LiarsBarSession } from '../../types';
import { DB } from '../../utils/db';
import { createLiarsBarSession, getLegalActions } from '../../utils/boardGame/liarsBar/engine';
import { buildLiarsBarPlayerView } from '../../utils/boardGame/liarsBar/visibility';
import { requestLiarsBarAction } from '../../utils/boardGame/liarsBar/aiService';
import { requestLiarsBarBatch } from '../../utils/boardGame/liarsBar/batchAiService';
import { buildLiarsBarBatchView, executeLiarsBarPlan } from '../../utils/boardGame/liarsBar/batch';
import { getLocalLiarsBarAction } from '../../utils/boardGame/liarsBar/parser';
import { calculateLiarsBarStats } from '../../utils/boardGame/liarsBar/stats';
import { persistLiarsBarShare } from '../../utils/boardGame/liarsBar/writeback';
import { BOARD_GAMES } from '../../utils/boardGame/catalog';

type View = 'catalog' | 'game' | 'setup' | 'table' | 'result' | 'history' | 'rules';
const newest = (sessions: LiarsBarSession[]) => [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
const rankLabel: Record<LiarsBarRank, string> = { Q: 'Q', K: 'K', A: 'A', JOKER: '鬼牌' };
const liarsBarCatalog = BOARD_GAMES.find(game => game.id === 'liars_bar')!;

const Header: React.FC<{ title: string; onBack: () => void; right?: React.ReactNode }> = ({ title, onBack, right }) => (
  <header className="shrink-0 border-b border-white/10 bg-[#251517] text-white" style={{ paddingTop: 'var(--chrome-top)' }}>
    <div className="flex h-15 min-h-[60px] items-center justify-between px-4">
      <button onClick={onBack} className="-ml-2 flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10" aria-label="返回"><CaretLeft size={25} /></button>
      <h1 className="font-black tracking-[-0.02em]">{title}</h1>
      <div className="flex min-w-11 justify-end">{right}</div>
    </div>
  </header>
);

const Avatar: React.FC<{ char?: Pick<CharacterProfile, 'avatar'>; player: LiarsBarPlayerState; active?: boolean }> = ({ char, player, active }) => (
  <div className={`relative mx-auto h-11 w-11 rounded-full ${active ? 'ring-2 ring-amber-300 ring-offset-2 ring-offset-[#4b1d25]' : 'ring-1 ring-white/20'} ${player.alive ? '' : 'grayscale opacity-45'}`}>
    {char?.avatar ? <TokenImg value={char.avatar} alt={player.name} className="h-full w-full rounded-full object-cover" /> : <div className="flex h-full w-full items-center justify-center rounded-full bg-rose-200 font-black text-rose-900">{player.name.slice(0, 1)}</div>}
    {!player.alive && <span className="absolute -right-1 -top-1 rounded-full bg-stone-900 px-1 text-[8px]">OUT</span>}
  </div>
);

const LiarsBarApp: React.FC = () => {
  const {
    closeApp, characters, characterGroups, groups, userProfile, apiConfig, realtimeConfig,
    memoryPalaceConfig, updateCharacter, addToast, registerBackHandler,
  } = useOS();
  const [view, setView] = useState<View>('catalog');
  const [sessions, setSessions] = useState<LiarsBarSession[]>([]);
  const [activeId, setActiveId] = useState('');
  const [selectedChars, setSelectedChars] = useState<string[]>([]);
  const [groupFilter, setGroupFilter] = useState(GROUP_FILTER_ALL);
  const [selectedCards, setSelectedCards] = useState<string[]>([]);
  const [utterance, setUtterance] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [blockedAiKey, setBlockedAiKey] = useState('');
  const [shareConfirm, setShareConfirm] = useState(false);
  const [generationMode, setGenerationMode] = useState<LiarsBarGenerationMode>('batch');
  const [presentation, setPresentation] = useState<LiarsBarEvent[]>([]);
  const requestRef = useRef<AbortController | null>(null);
  const tableRef = useRef({ view, activeId });
  tableRef.current = { view, activeId };
  const active = sessions.find(session => session.id === activeId) || null;
  const charById = useMemo(() => new Map(characters.map(char => [char.id, char])), [characters]);

  useEffect(() => {
    void DB.getBoardGameSessions().then(rows => setSessions(newest(rows.filter((row): row is LiarsBarSession => row.gameId === 'liars_bar'))))
      .catch(() => addToast('桌游记录读取失败', 'error'));
  }, [addToast]);

  const saveSession = useCallback(async (session: LiarsBarSession) => {
    const next = { ...session, updatedAt: session.updatedAt || Date.now() };
    await DB.saveBoardGameSession(next);
    setSessions(previous => newest([next, ...previous.filter(item => item.id !== next.id)]));
    return next;
  }, []);

  const cancelTurn = useCallback(() => {
    requestRef.current?.abort();
    requestRef.current = null;
    setBusy(false);
    setPresentation([]);
  }, []);
  useEffect(() => () => { requestRef.current?.abort(); }, []);

  const goBack = useCallback(() => {
    if (shareConfirm) { setShareConfirm(false); return true; }
    cancelTurn();
    if (view === 'catalog') { closeApp(); return true; }
    if (view === 'game') { setView('catalog'); return true; }
    if (view === 'table' || view === 'result') { setActiveId(''); setView('game'); return true; }
    setView('game');
    return true;
  }, [cancelTurn, closeApp, shareConfirm, view]);
  useEffect(() => registerBackHandler(goBack), [goBack, registerBackHandler]);

  const openSession = (session: LiarsBarSession) => {
    cancelTurn();
    setActiveId(session.id); setSelectedCards([]); setUtterance(''); setError(''); setBlockedAiKey('');
    setView(session.status === 'completed' ? 'result' : 'table');
  };

  const createGame = async () => {
    if (requestRef.current) return;
    if (selectedChars.length !== 3) { setError('请选择 3 位角色。'); return; }
    const controller = new AbortController();
    requestRef.current = controller;
    setBusy(true);
    try {
      const selected = selectedChars.map(id => charById.get(id)).filter(Boolean) as CharacterProfile[];
      const session = createLiarsBarSession({ generationMode, players: [
        { actor: { type: 'user' }, name: userProfile.name || '你' },
        ...selected.map(char => ({ actor: { type: 'character' as const, charId: char.id }, name: char.name })),
      ] });
      await saveSession(session);
      if (!controller.signal.aborted && tableRef.current.view === 'setup') openSession(session);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : '创建存档失败，请重试。');
    } finally {
      if (requestRef.current === controller) { requestRef.current = null; setBusy(false); }
    }
  };

  // One local runner for individual, batch, user and explicitly approved fallback actions.
  const runTurn = useCallback(async (
    snapshot: LiarsBarSession,
    generate: (signal: AbortSignal) => Promise<{ actorSequence: string[]; actions: unknown[] }>,
  ) => {
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    const isActive = () => !controller.signal.aborted && requestRef.current === controller
      && tableRef.current.view === 'table' && tableRef.current.activeId === snapshot.id;
    let latestSaved = snapshot;
    setBusy(true); setError('');
    try {
      const plan = await generate(controller.signal);
      await executeLiarsBarPlan({
        snapshot, ...plan, isActive,
        load: DB.getBoardGameSession,
        save: DB.saveBoardGameSessionIfCurrent,
        onSaved: async (next, previous) => {
          latestSaved = next;
          setSessions(rows => newest([next, ...rows.filter(row => row.id !== next.id)]));
          setSelectedCards([]); setUtterance(''); setBlockedAiKey('');
          const events = next.events.slice(previous.events.length);
          if (events.some(event => event.type === 'reveal')) {
            // Outcomes and the next deal are already persisted; this screen never rolls RNG.
            setPresentation(events.filter(event => event.type !== 'round_start'));
          } else {
            // Let each saved public utterance render before consuming the next planned action.
            await new Promise<void>(resolve => {
              const finish = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', finish); resolve(); };
              const timer = setTimeout(finish, 650);
              controller.signal.addEventListener('abort', finish, { once: true });
              if (controller.signal.aborted) finish();
            });
          }
        },
      });
      if (isActive()) {
        const latest = await DB.getBoardGameSession(snapshot.id);
        if (isActive() && latest) setSessions(rows => newest([latest, ...rows.filter(row => row.id !== latest.id)]));
      }
    } catch (cause) {
      if (isActive()) {
        setError(cause instanceof Error ? cause.message : '角色暂时没有做出有效行动');
        setBlockedAiKey(`${latestSaved.id}:${latestSaved.revision}:${latestSaved.round.currentActorId}`);
      }
    } finally {
      if (requestRef.current === controller) { requestRef.current = null; setBusy(false); }
    }
  }, []);

  const submitAction = async (kind: 'play' | 'challenge') => {
    if (!active || busy || presentation.length || active.round.currentActorId !== 'user') return;
    await runTurn(active, async () => ({ actorSequence: ['user'], actions: [{ actorId: 'user', action: kind, cardIds: selectedCards, utterance }] }));
  };

  const runLocalTurn = async () => {
    if (!active || busy || presentation.length) return;
    const actorId = active.round.currentActorId;
    const viewForActor = buildLiarsBarPlayerView(active, actorId);
    await runTurn(active, async () => ({ actorSequence: [actorId], actions: [{ actorId, ...getLocalLiarsBarAction(viewForActor) }] }));
  };

  useEffect(() => {
    if (view !== 'table' || !active || active.status !== 'in_progress' || presentation.length) return;
    const actorId = active.round.currentActorId;
    if (!actorId.startsWith('character:')) return;
    const key = `${active.id}:${active.revision}:${actorId}`;
    if (busy || requestRef.current || blockedAiKey === key) return;
    const char = charById.get(actorId.slice('character:'.length));
    if (!char) { setError('本局角色已不存在，可使用本地托管继续。'); setBlockedAiKey(key); return; }
    void runTurn(active, async signal => {
      const common = { userProfile, groups, apiConfig, realtimeConfig, signal };
      if (active.settings?.generationMode === 'batch') {
        const batchView = buildLiarsBarBatchView(active);
        return {
          actorSequence: batchView.actorSequence,
          actions: await requestLiarsBarBatch({ ...common, characters, view: batchView }),
        };
      }
      const action = await requestLiarsBarAction({ ...common, char, view: buildLiarsBarPlayerView(active, actorId) });
      return { actorSequence: [actorId], actions: [{ actorId, ...action }] };
    });
  }, [active, apiConfig, blockedAiKey, busy, charById, characters, groups, presentation.length, realtimeConfig, runTurn, userProfile, view]);

  const shareResult = async () => {
    if (!active || active.status !== 'completed') return;
    setBusy(true); setError('');
    try {
      let session = active;
      let shared = { ...(session.sharedMessageIds || {}) };
      for (const player of session.players) {
        if (player.actor.type !== 'character' || shared[player.actor.charId]) continue;
        const char = charById.get(player.actor.charId);
        if (!char) continue;
        const { messageId, memories } = await persistLiarsBarShare({
          char, session: active, userProfile, groups, realtimeConfig, apiConfig, memoryPalaceConfig,
        });
        shared = { ...shared, [char.id]: messageId };
        await updateCharacter(char.id, { memories });
        session = await saveSession({ ...session, sharedMessageIds: shared });
      }
      setShareConfirm(false);
      addToast('这局已写入参与角色的聊天与记忆', 'success');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '写回失败，已完成的部分不会重复。');
    } finally { setBusy(false); }
  };

  const removeSession = async (session: LiarsBarSession) => {
    if (!window.confirm('删除这局本地记录？已写回聊天的卡片不会被删除。')) return;
    await DB.deleteBoardGameSession(session.id);
    setSessions(previous => previous.filter(item => item.id !== session.id));
  };

  const renderCatalog = () => <main className="min-h-0 flex-1 overflow-y-auto bg-[#f6efe8] px-5" style={{ paddingTop: 'calc(var(--chrome-top) + 22px)', paddingBottom: 'calc(var(--safe-bottom) + 28px)' }}>
    <div className="flex items-start justify-between"><div><h1 className="text-3xl font-black text-[#2c1d1d]">桌游</h1><p className="mt-2 text-sm text-stone-600">和他们坐到同一张桌子上</p></div><button onClick={closeApp} className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-stone-700 shadow-sm" aria-label="关闭"><X size={21} /></button></div>
    <button onClick={() => setView('game')} className="mt-9 w-full overflow-hidden rounded-[24px] bg-[#8f2335] text-left text-white shadow-[0_18px_40px_rgba(88,25,38,0.22)]"><div className="flex min-h-48 flex-col justify-between p-6"><CardsThree size={42} weight="duotone" /><div><h2 className="text-2xl font-black">{liarsBarCatalog.name}</h2><p className="mt-2 text-sm text-rose-100/80">{liarsBarCatalog.tagline}</p></div><div className="mt-6 flex items-center justify-between text-sm font-bold"><span>4 人规则对局</span><ArrowRight size={21} /></div></div></button>
    <p className="mt-10 text-center text-xs text-stone-400">更多游戏以后加入</p>
  </main>;

  const renderGameHome = () => <><Header title="骗子酒馆" onBack={goBack} />
    <main className="min-h-0 flex-1 overflow-y-auto bg-[#f6efe8] px-5 py-6" style={{ paddingBottom: 'calc(var(--safe-bottom) + 28px)' }}>
      <section className="rounded-[24px] bg-[#4b1d25] p-6 text-white shadow-xl"><div className="flex items-center gap-3 text-amber-200"><CardsThree size={31} /><span className="text-xs font-black tracking-[0.18em]">LIAR'S BAR</span></div><h2 className="mt-7 text-3xl font-black">谁在说谎？</h2><p className="mt-3 text-sm leading-6 text-white/65">你与三位现有角色共享公开牌桌，却各自保有隐藏手牌。规则程序翻牌，角色只负责判断、欺骗和说话。</p><button onClick={() => { setSelectedChars([]); setError(''); setView('setup'); }} className="mt-6 flex h-13 min-h-[52px] w-full items-center justify-center gap-2 rounded-xl bg-amber-300 font-black text-[#35171d]"><Play weight="fill" /> 开始新对局</button></section>
      {sessions.some(session => session.status === 'in_progress') && <section className="mt-5"><h3 className="text-sm font-black text-stone-800">继续牌局</h3>{newest(sessions.filter(session => session.status === 'in_progress')).slice(0, 2).map(session => <button key={session.id} onClick={() => openSession(session)} className="mt-3 flex w-full items-center justify-between rounded-2xl bg-white p-4 text-left shadow-sm"><span><b className="block text-stone-900">第 {session.round.number} 轮 · 目标 {session.round.targetRank}</b><small className="mt-1 block text-stone-500">{session.players.map(player => player.name).join('、')}</small></span><ArrowRight /></button>)}</section>}
      <div className="mt-5 grid grid-cols-2 gap-3"><button onClick={() => setView('history')} className="flex min-h-24 flex-col items-start justify-between rounded-2xl bg-white p-4 text-left text-stone-800 shadow-sm"><ClockCounterClockwise size={24} /><b>历史对局</b></button><button onClick={() => setView('rules')} className="flex min-h-24 flex-col items-start justify-between rounded-2xl bg-white p-4 text-left text-stone-800 shadow-sm"><Info size={24} /><b>游戏规则</b></button></div>
    </main>
  </>;

  const renderSetup = () => {
    const filtered = filterCharactersByGroup(characters, characterGroups, groupFilter);
    return <><Header title="确认牌桌" onBack={goBack} />
      <main className="min-h-0 flex-1 overflow-y-auto bg-[#f6efe8] px-5 py-5" style={{ paddingBottom: 'calc(var(--safe-bottom) + 28px)' }}>
        <div className="rounded-2xl bg-white p-4"><div className="flex items-center justify-between"><div><h2 className="font-black text-stone-900">选择 3 位角色</h2><p className="mt-1 text-xs text-stone-500">他们分别继承自己的聊天、人格与记忆</p></div><span className="rounded-full bg-rose-100 px-3 py-1 text-xs font-black text-rose-700">{selectedChars.length}/3</span></div>
          <CharacterGroupFilterBar characters={characters} groups={characterGroups} value={groupFilter} onChange={setGroupFilter} className="mt-4" />
          <div className="mt-4 grid grid-cols-3 gap-3">{filtered.map(char => { const picked = selectedChars.includes(char.id); return <button key={char.id} onClick={() => setSelectedChars(previous => picked ? previous.filter(id => id !== char.id) : previous.length < 3 ? [...previous, char.id] : previous)} className={`relative rounded-2xl border p-2.5 ${picked ? 'border-rose-500 bg-rose-50' : 'border-stone-200 bg-white'}`}>{char.avatar ? <TokenImg value={char.avatar} alt={char.name} className="mx-auto h-14 w-14 rounded-full object-cover" /> : <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-stone-200 font-black">{char.name.slice(0, 1)}</div>}<span className="mt-2 block truncate text-xs font-bold text-stone-800">{char.name}</span>{picked && <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-rose-600 text-white"><Check size={12} weight="bold" /></span>}</button>; })}</div>
          {!characters.length && <p className="py-10 text-center text-sm text-stone-500">请先在神经链接中创建角色。</p>}
        </div>
        <fieldset className="mt-4 space-y-3 rounded-2xl bg-white p-4 text-stone-800">
          <legend className="px-1 font-black">AI 生成方式</legend>
          <label className="flex cursor-pointer items-start gap-3"><input type="radio" name="generationMode" value="batch" checked={generationMode === 'batch'} onChange={() => setGenerationMode('batch')} className="mt-1" /><span><b>批量生成（推荐）</b><small className="mt-1 block leading-5 text-stone-500">一次请求生成连续多名 AI 行动，请求更少。但多个角色共享一次模型上下文，可能串号或利用不该知道的信息；这不是严格信息隔离。</small></span></label>
          <label className="flex cursor-pointer items-start gap-3"><input type="radio" name="generationMode" value="individual" checked={generationMode === 'individual'} onChange={() => setGenerationMode('individual')} className="mt-1" /><span><b>逐人生成</b><small className="mt-1 block leading-5 text-stone-500">每位角色独立请求，只收到本人的私有信息。隔离最严格，但请求更多、更慢，更容易触发 RPM 限制。</small></span></label>
        </fieldset>
        <div className="mt-4 rounded-xl bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900"><ShieldCheck className="mr-2 inline" size={17} />两种模式都不发送用户手牌、子弹位置或完整 session；所有行动都由本地引擎校验。</div>
        <button disabled={selectedChars.length !== 3} onClick={() => void createGame()} className="mt-5 h-13 min-h-[52px] w-full rounded-xl bg-[#8f2335] font-black text-white disabled:opacity-35">四人入座</button>
        {error && <p className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      </main>
    </>;
  };

  const playerChar = (player: LiarsBarPlayerState) => player.actor.type === 'character' ? charById.get(player.actor.charId) : userProfile;
  const publicEventText = (event: LiarsBarEvent, session: LiarsBarSession) => {
    const name = (id?: string) => session.players.find(player => player.actorId === id)?.name || '未知玩家';
    if (event.type === 'round_start') return `第 ${event.round} 轮，目标牌 ${event.targetRank}`;
    if (event.type === 'play') return `${name(event.actorId)} 声称出了 ${event.declaredCount} 张 ${event.targetRank || session.round.targetRank}${event.utterance ? `：“${event.utterance}”` : ''}`;
    if (event.type === 'challenge') return `${name(event.actorId)} 抓 ${name(event.targetActorId)} 的骗子${event.utterance ? `：“${event.utterance}”` : ''}`;
    if (event.type === 'reveal') return `翻牌 ${event.cardRanks?.map(rank => rankLabel[rank]).join('、')}，质疑${event.challengeSucceeded ? '成功' : '失败'}`;
    if (event.type === 'roulette') return `${name(event.actorId)} 扣动扳机——${event.rouletteResult === 'bang' ? '砰！' : '咔哒。'}`;
    if (event.type === 'elimination') return `${name(event.actorId)} 被淘汰`;
    return `${name(event.actorId)} 获胜`;
  };

  const renderSeat = (player: LiarsBarPlayerState, session: LiarsBarSession) => <div key={player.actorId} className={`rounded-2xl border p-2 text-center text-white ${session.round.currentActorId === player.actorId ? 'border-amber-300 bg-white/15' : 'border-white/10 bg-black/15'}`}><Avatar char={playerChar(player)} player={player} active={session.round.currentActorId === player.actorId} /><b className="mt-1.5 block truncate text-xs">{player.name}</b><span className="text-[10px] text-white/55">{player.alive ? `${player.hand.length} 张 · 🔫 ${player.roulette.shotsFired}` : '已淘汰'}</span>{session.events.slice().reverse().find(event => event.actorId === player.actorId && event.utterance)?.utterance && <p className="mt-1 line-clamp-2 rounded-lg bg-white/10 px-1.5 py-1 text-[9px] leading-3 text-white/75">“{session.events.slice().reverse().find(event => event.actorId === player.actorId && event.utterance)?.utterance}”</p>}</div>;

  const renderTable = () => {
    if (!active) return null;
    const user = active.players.find(player => player.actorId === 'user')!;
    const opponents = active.players.filter(player => player.actorId !== 'user')
      .sort((a, b) => ((a.seat - user.seat + 4) % 4) - ((b.seat - user.seat + 4) % 4));
    const legal = getLegalActions(active, 'user');
    const userTurn = active.round.currentActorId === 'user' && !busy && !presentation.length;
    const publicView = buildLiarsBarPlayerView(active, 'user');
    const lastPlay = active.round.plays[active.round.plays.length - 1];
    const currentName = active.players.find(player => player.actorId === active.round.currentActorId)?.name;
    return <><Header title={`骗子酒馆 · 第 ${active.round.number} 轮`} onBack={goBack} right={<span className="rounded-full bg-white/10 px-2 py-1 text-[10px]">{busy ? '思考中…' : `${currentName} 的回合`}</span>} />
      <main className="min-h-0 flex-1 overflow-y-auto bg-[#4b1d25] px-3 py-3 text-white" style={{ paddingBottom: 'calc(var(--safe-bottom) + 18px)' }}>
        <p className="mb-3 text-center text-[10px] text-white/60">{active.settings?.generationMode === 'batch' ? '批量生成 · 共享模型上下文，非严格隔离' : '逐人生成 · 独立玩家上下文'}</p>
        <div className="grid grid-cols-2 gap-2"><div className="col-span-2 mx-auto w-[46%]">{renderSeat(opponents[1], active)}</div>{[opponents[2], opponents[0]].map(player => renderSeat(player, active))}</div>
        <section className="my-4 rounded-[26px] border border-amber-200/20 bg-[#2f5b46] p-4 text-center shadow-inner"><div className="text-[10px] font-bold tracking-[0.2em] text-emerald-100/55">本轮目标牌</div><div className="mt-1 font-serif text-6xl font-black text-amber-100">{active.round.targetRank}</div><div className="mt-3 text-xs text-white/65">{lastPlay ? `上一手：${active.players.find(player => player.actorId === lastPlay.actorId)?.name} 声称出了 ${lastPlay.declaredCount} 张 ${active.round.targetRank}` : '等待本轮第一手'}</div></section>
        <div className="rounded-2xl bg-black/15 p-3">{renderSeat(user, active)}</div>
        <section className="mt-3 rounded-2xl bg-[#f6efe8] p-3 text-stone-900"><div className="flex gap-2 overflow-x-auto pb-1">{user.hand.map(card => { const picked = selectedCards.includes(card.id); return <button key={card.id} disabled={!userTurn} onClick={() => setSelectedCards(previous => picked ? previous.filter(id => id !== card.id) : previous.length < 3 ? [...previous, card.id] : previous)} className={`flex h-20 min-w-14 flex-col items-center justify-center rounded-xl border-2 bg-white font-serif font-black shadow-sm ${picked ? '-translate-y-1 border-rose-600 text-rose-700' : 'border-stone-200 text-stone-800'} disabled:opacity-55`}><span className="text-xl">{card.rank === 'JOKER' ? '★' : card.rank}</span><small className="mt-1 text-[8px] font-sans">{card.rank === 'JOKER' ? 'JOKER' : 'CARD'}</small></button>; })}</div>
          <input value={utterance} onChange={event => setUtterance(event.target.value.slice(0, 120))} disabled={!userTurn} placeholder="桌上说一句（可选）" className="mt-3 h-11 w-full rounded-xl bg-white px-3 text-sm outline-none ring-1 ring-stone-200 focus:ring-2 focus:ring-rose-500 disabled:opacity-55" />
          <div className="mt-3 grid grid-cols-2 gap-2"><button disabled={!userTurn || selectedCards.length < 1 || selectedCards.length > 3 || !legal.playableCardIds.length} onClick={() => void submitAction('play')} className="h-12 rounded-xl bg-[#251517] font-black text-white disabled:opacity-30">出牌 {selectedCards.length ? `(${selectedCards.length})` : ''}</button><button disabled={!userTurn || !legal.canChallenge} onClick={() => void submitAction('challenge')} className="h-12 rounded-xl bg-[#8f2335] font-black text-white disabled:opacity-30">抓骗子</button></div>
          {userTurn && !user.hand.length && <p className="mt-2 text-center text-xs font-bold text-rose-700">你已无牌，只能质疑上一手。</p>}
        </section>
        {(busy || blockedAiKey) && <section className="mt-3 rounded-2xl bg-white/10 p-3 text-sm"><p>{busy ? `${currentName} 正在观察牌桌……` : `${currentName} 暂时没有做出有效行动。`}</p>{blockedAiKey && <div className="mt-3 grid grid-cols-2 gap-2"><button onClick={() => { setError(''); setBlockedAiKey(''); }} className="h-10 rounded-xl bg-white/10 font-bold">重试</button><button onClick={() => void runLocalTurn()} className="h-10 rounded-xl bg-amber-300 font-bold text-[#35171d]">本地托管这一手</button></div>}</section>}
        {error && <p className="mt-3 rounded-xl bg-red-950/45 px-3 py-2 text-sm text-red-100">{error}</p>}
        <details className="mt-3 rounded-2xl bg-black/15 p-3" open><summary className="cursor-pointer text-xs font-black text-white/70">公开牌桌记录</summary><div className="mt-2 max-h-48 space-y-1.5 overflow-y-auto">{publicView.publicEvents.slice(-24).map(event => <p key={event.id} className="rounded-lg bg-white/5 px-2.5 py-2 text-[11px] leading-4 text-white/65">{publicEventText(event, active)}</p>)}</div></details>
      </main>
    </>;
  };

  const renderResult = () => {
    if (!active) return null;
    const winner = active.players.find(player => player.actorId === active.winnerActorId);
    const stats = calculateLiarsBarStats(active);
    const participantIds = active.players.filter(player => player.actor.type === 'character').map(player => (player.actor as { type: 'character'; charId: string }).charId);
    const allShared = participantIds.every(id => active.sharedMessageIds?.[id]);
    return <><Header title="对局结算" onBack={goBack} />
      <main className="min-h-0 flex-1 overflow-y-auto bg-[#f6efe8] px-5 py-6" style={{ paddingBottom: 'calc(var(--safe-bottom) + 28px)' }}><section className="rounded-[24px] bg-[#251517] p-6 text-white"><Crosshair size={30} className="text-amber-300" /><p className="mt-5 text-xs font-black tracking-[0.16em] text-white/45">本局获胜</p><h2 className="mt-1 text-3xl font-black">{winner?.name}</h2><p className="mt-2 text-sm text-white/55">共进行 {active.round.number} 轮</p></section>
        <div className="mt-5 space-y-3">{stats.map(item => <article key={item.actorId} className="rounded-2xl bg-white p-4 shadow-sm"><div className="flex items-center justify-between"><b>{item.name}</b><span className="text-xs text-stone-400">{item.actorId === active.winnerActorId ? '获胜' : item.eliminatedRound ? `第 ${item.eliminatedRound} 轮淘汰` : '存活'}</span></div><div className="mt-3 grid grid-cols-3 text-center text-xs text-stone-500"><span><b className="block text-lg text-stone-900">{item.plays}</b>出牌</span><span><b className="block text-lg text-stone-900">{item.successfulChallenges}/{item.challenges}</b>抓谎</span><span><b className="block text-lg text-stone-900">{item.shots}</b>扳机</span></div></article>)}</div>
        <div className="mt-5 rounded-xl bg-amber-50 px-4 py-3 text-xs leading-5 text-amber-900"><ShieldCheck className="mr-1 inline" />对局默认私密。写回时，每个角色只获得公开翻牌、自己的行动与最终结果。</div>
        <details className="mt-4 rounded-2xl bg-white p-4"><summary className="cursor-pointer font-bold">查看完整公开对局记录</summary><div className="mt-3 space-y-2">{buildLiarsBarPlayerView(active, 'user').publicEvents.map(event => <p key={event.id} className="text-xs leading-5 text-stone-600">{publicEventText(event, active)}</p>)}</div></details>
        <button disabled={allShared || busy} onClick={() => setShareConfirm(true)} className="mt-5 h-13 min-h-[52px] w-full rounded-xl bg-[#8f2335] font-black text-white disabled:opacity-40">{allShared ? '大家已经记住这局' : '让参与角色记住这局'}</button><button onClick={() => setView('game')} className="mt-3 h-12 w-full rounded-xl bg-white font-bold text-stone-700">仅保存对局</button>
        {error && <p className="mt-3 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p>}
      </main>{shareConfirm && <div className="absolute inset-0 z-50 flex items-end bg-black/45 p-4"><div className="w-full rounded-2xl bg-white p-5" style={{ marginBottom: 'var(--safe-bottom)' }}><div className="flex items-center justify-between"><b className="text-lg">让大家记住这局？</b><button onClick={() => setShareConfirm(false)} className="h-10 w-10 rounded-full bg-stone-100"><X className="mx-auto" /></button></div><p className="mt-3 text-sm leading-6 text-stone-600">会分别向三位角色写入一张压缩结果卡和一条长期记忆。任何未公开的对手暗牌与子弹位置都不会写入。</p><div className="mt-5 grid grid-cols-2 gap-3"><button onClick={() => setShareConfirm(false)} className="h-12 rounded-xl bg-stone-100 font-bold">继续私密</button><button disabled={busy} onClick={() => void shareResult()} className="h-12 rounded-xl bg-[#8f2335] font-black text-white">确认写回</button></div></div></div>}
    </>;
  };

  const renderHistory = () => <><Header title="历史对局" onBack={goBack} /><main className="min-h-0 flex-1 overflow-y-auto bg-[#f6efe8] px-5 py-5" style={{ paddingBottom: 'calc(var(--safe-bottom) + 28px)' }}>{sessions.length ? sessions.map(session => <div key={session.id} className="mb-3 flex items-center gap-3 rounded-2xl bg-white p-4 shadow-sm"><button onClick={() => openSession(session)} className="min-w-0 flex-1 text-left"><b className="block truncate">{session.players.map(player => player.name).join('、')}</b><span className="mt-1 block text-xs text-stone-500">{session.status === 'completed' ? `已结束 · ${session.players.find(player => player.actorId === session.winnerActorId)?.name} 获胜` : `进行中 · 第 ${session.round.number} 轮`} · {new Date(session.updatedAt).toLocaleDateString()}</span></button><button onClick={() => void removeSession(session)} className="flex h-10 w-10 items-center justify-center rounded-full text-stone-400 hover:bg-red-50 hover:text-red-600"><Trash /></button></div>) : <div className="py-20 text-center text-stone-400"><ClockCounterClockwise size={36} className="mx-auto mb-3" />暂无对局</div>}</main></>;

  const renderRules = () => <><Header title="游戏规则" onBack={goBack} /><main className="min-h-0 flex-1 overflow-y-auto bg-[#f6efe8] px-5 py-6 text-sm leading-7 text-stone-700" style={{ paddingBottom: 'calc(var(--safe-bottom) + 28px)' }}><section className="rounded-2xl bg-white p-5"><h2 className="text-lg font-black text-stone-900">骗子酒馆 · 4 人规则</h2><p className="mt-3">20 张牌：Q、K、A 各 6 张，鬼牌 2 张。每轮为所有存活玩家发 5 张，并随机指定 Q / K / A 为目标牌。</p><p className="mt-3">轮到你时暗出 1～3 张，并声称它们全是目标牌；下一家可以继续出牌或抓骗子。鬼牌永远算目标牌。</p><p className="mt-3">翻牌包含非目标牌时，出牌者受罚；全部是目标牌或鬼牌时，质疑者受罚。受罚者扣动自己的六膛轮盘，枪响即淘汰。轮盘不会随轮次重置，最后存活者获胜。</p></section><section className="mt-4 rounded-2xl bg-[#251517] p-5 text-white/70"><h3 className="font-black text-white">信息边界</h3><p className="mt-2">每个人只知道自己的手牌、所有公开行动和挑战后翻开的牌。未被翻开的暗牌与所有人的真实子弹位置永远不会进入其他玩家视图。</p></section></main></>;

  return <div className="absolute inset-0 flex flex-col overflow-hidden bg-[#f6efe8]">
    {view === 'catalog' && renderCatalog()}{view === 'game' && renderGameHome()}{view === 'setup' && renderSetup()}{view === 'table' && renderTable()}{view === 'result' && renderResult()}{view === 'history' && renderHistory()}{view === 'rules' && renderRules()}
    {!!presentation.length && active && view === 'table' && <div role="dialog" aria-modal="true" aria-label="翻牌与轮盘结果" className="absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-5">
      <section className="max-h-[80%] w-full overflow-y-auto rounded-3xl bg-[#251517] p-6 text-white shadow-2xl">
        <h2 className="text-xl font-black text-amber-200">翻牌 · 轮盘</h2>
        <p className="mt-2 text-xs text-white/50">结果已保存，刷新不会重新判定。</p>
        <div className="mt-5 space-y-3">{presentation.map((event, index) => <p key={event.id} className={`rounded-xl p-3 text-sm ${event.type === 'roulette' ? 'bg-rose-900 font-black' : 'bg-white/10'}`} style={{ animation: `liars-bar-reveal 350ms ease-out ${index * 200}ms both` }}>{publicEventText(event, active)}</p>)}</div>
        <button disabled={busy} onClick={() => { setPresentation([]); if (active.status === 'completed') setView('result'); }} className="mt-5 h-12 w-full rounded-xl bg-amber-300 font-black text-[#251517] disabled:opacity-40">{active.status === 'completed' ? '查看结算' : '继续下一轮'}</button>
      </section>
    </div>}
    <style>{`@keyframes liars-bar-reveal { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } } @media (prefers-reduced-motion: reduce) { [aria-label="翻牌与轮盘结果"] p { animation: none !important; } }`}</style>
  </div>;
};

export default LiarsBarApp;
