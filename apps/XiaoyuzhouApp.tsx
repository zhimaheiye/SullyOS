import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowLeft, GearSix, Headphones, Plus, SpinnerGap } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { episodeIdFromShare, heardExcerpts, mergePlayedRanges, normalizeTranscript, podcastTime, type Segment } from '../utils/podcast/core';
import {
  flushPodcastProgress, podcastProgress, selectPodcast, stopPodcast, usePodcastPlayer,
  togglePodcast,
} from '../utils/podcast/player';
import { fetchEpisode, podcastBridge, requestPodcastText, requireListeningScope, sharePodcastSummary } from '../utils/podcast/service';
import {
  editListening, podcastLease, podcastModeToken, podcastScope, readPodcastLibrary, saveEpisode, startListening,
  type Episode, type ListeningSession, type PodcastTurn,
} from '../utils/podcast/store';
import { readPodcastMode as readStoryMode, mutatePodcast, type PodcastMode as StoryModeRecord } from '../utils/podcast/platform';
import { updatePlatform, type PlatformLease, type PlatformSnapshot } from '../utils/podcast/platform';
import { cardCreationErrorMessage } from '../utils/cardCreation';
import { withCreationRunLock } from '../utils/creationRunLock';
import { DB } from '../utils/db';
import { button, Cover, field, PlayerPanel, primary, TranscriptPanel } from './podcast/Panels';
import Discussion, { pendingQuestion } from './podcast/Discussion';
import PodcastSettings from './podcast/Settings';
import './XiaoyuzhouApp.css';

type PendingSave = { id: string; lease: PlatformLease; patch: (session: ListeningSession) => ListeningSession; text: string; character: { id: string; fingerprint: string } };
const emptyLibrary: PlatformSnapshot = { rows: [], revision: 0, epoch: 'initial' };

export default function XiaoyuzhouApp() {
  const { closeApp, registerBackHandler, characters, userProfile, apiConfig, addToast } = useOS();
  const player = usePodcastPlayer();
  const [library, setLibrary] = useState(emptyLibrary);
  const [mode, setMode] = useState<StoryModeRecord | null>();
  const [eid, setEid] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [charId, setCharId] = useState('');
  const [settings, setSettings] = useState(false);
  const [view, setView] = useState<'discussion' | 'transcript'>('discussion');
  const [link, setLink] = useState('');
  const [search, setSearch] = useState('');
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [summaryDrafts, setSummaryDrafts] = useState<Record<string, string>>({});
  const [quote, setQuote] = useState<Segment>();
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [pendingSave, setPendingSave] = useState<PendingSave>();
  const operation = useRef<AbortController>();
  const audioInput = useRef<HTMLInputElement>(null);
  const readSequence = useRef(0);
  const modeRef = useRef<StoryModeRecord | null>();
  const epochRef = useRef('');
  const draftTimer = useRef<ReturnType<typeof setTimeout>>();
  const draftWrite = useRef<(() => Promise<void>)>();
  const episodes = library.rows.filter(row => row.kind === 'podcast_episode') as Episode[];
  const sessions = (library.rows.filter(row => row.kind === 'podcast_session' && row.scope === podcastScope(mode ?? null)) as ListeningSession[])
    .sort((a, b) => b.progress.updatedAt - a.progress.updatedAt);
  const episode = episodes.find(row => row.eid === eid);
  const session = sessions.find(row => row.id === sessionId && row.eid === eid);
  const char = session && characters.find(row => row.id === session.charId);
  const solo = sessions.find(row => row.eid === eid && !row.charId);
  const selectedCharacter = charId;
  const atMs = player.id === session?.id ? player.atMs : session?.progress.atMs || 0;
  const draft = session ? drafts[session.id] ?? session.draft ?? '' : '';
  const summary = session ? summaryDrafts[session.id] ?? session.summary ?? '' : '';
  const saveCandidate = pendingSave?.id === sessionId ? pendingSave : undefined;

  const reload = useCallback(async () => {
    const request = ++readSequence.current;
    const [rows, nextMode] = await Promise.all([readPodcastLibrary(), readStoryMode()]);
    if (request !== readSequence.current) return;
    if ((modeRef.current !== undefined && podcastModeToken(modeRef.current) !== podcastModeToken(nextMode))
        || (epochRef.current && epochRef.current !== rows.epoch && epochRef.current !== 'initial')) {
      operation.current?.abort();
      clearTimeout(draftTimer.current); draftWrite.current = undefined;
      setSessionId(''); setQuote(undefined); setPendingSave(undefined);
    }
    modeRef.current = nextMode; epochRef.current = rows.epoch;
    setMode(nextMode); setLibrary(rows);
  }, []);

  useEffect(() => {
    const refresh = () => { void reload().catch(cause => setError(cardCreationErrorMessage(cause))); };
    refresh();
    window.addEventListener('podcast-updated', refresh);
    window.addEventListener('personal-memory-reset', refresh);
    return () => {
      ++readSequence.current; operation.current?.abort();
      clearTimeout(draftTimer.current);
      void draftWrite.current?.().catch(() => {});
      window.removeEventListener('podcast-updated', refresh);
      window.removeEventListener('personal-memory-reset', refresh);
    };
  }, [reload]);

  function editDraft(value: string) {
    if (!session) return;
    setDrafts(values => ({ ...values, [session.id]: value }));
    clearTimeout(draftTimer.current);
    const token = podcastModeToken(modeRef.current ?? null);
    const epoch = epochRef.current;
    const id = session.id;
    const save = async () => {
      await mutatePodcast(id, rows => {
        const old = rows.find(row => row.id === id);
        return { put: old ? [{ ...old, draft: value }] : [], value: undefined };
      }, token, { name: 'podcast', epoch });
      if (draftWrite.current === save) draftWrite.current = undefined;
    };
    draftWrite.current = save;
    draftTimer.current = setTimeout(() => {
      void save().catch(() => setError('讨论草稿暂未保存，请保持页面打开后重试。'));
    }, 600);
  }

  function back() {
    if (settings) { setSettings(false); return true; }
    if (!eid) return false;
    operation.current?.abort(); setEid(''); setSessionId(''); setQuote(undefined); setError('');
    return true;
  }
  useEffect(() => registerBackHandler(back), [settings, eid, registerBackHandler]);

  async function run(label: string, work: (signal: AbortSignal, lease: PlatformLease) => Promise<void>) {
    if (operation.current || modeRef.current === undefined) return;
    const controller = new AbortController();
    operation.current = controller; setBusy(label); setError('');
    try {
      clearTimeout(draftTimer.current);
      await draftWrite.current?.();
      const lease = await podcastLease();
      if (lease.canonToken !== podcastModeToken(modeRef.current) || lease.epoch !== epochRef.current) throw new Error('存档已更新，请重试。');
      controller.signal.throwIfAborted();
      if ((label === '角色回复' || label === '整理小结') && session?.charId) {
        await withCreationRunLock('role:' + session.charId, controller.signal, () => work(controller.signal, lease));
      } else await work(controller.signal, lease);
    } catch (cause) {
      if (!controller.signal.aborted) setError(cardCreationErrorMessage(cause));
    } finally {
      if (operation.current === controller) { operation.current = undefined; setBusy(''); }
      void reload().catch(cause => setError(cardCreationErrorMessage(cause)));
    }
  }

  function chooseEpisode(value: Episode) {
    setEid(value.eid); setSessionId(''); setCharId(''); setQuote(undefined); setView('discussion');
  }

  function openSession(value: Episode, next: ListeningSession, lease: PlatformLease) {
    setEid(value.eid); setSessionId(next.id); setCharId(next.charId); setQuote(undefined); setView('discussion');
    selectPodcast(next, value, lease);
  }

  function addEpisode() {
    void run('读取节目', async (signal, lease) => {
      const id = episodeIdFromShare(link);
      const next = await fetchEpisode(id, signal);
      await saveEpisode(id, old => ({ ...next, transcript: old?.transcript }), lease, signal);
      signal.throwIfAborted(); setLink(''); chooseEpisode(next);
    });
  }

  function openPlayback(targetChar = '', newSession = false) {
    if (!episode) return;
    void run('打开收听', async (signal, lease) => {
      const wasPlaying = player.playing;
      await flushPodcastProgress();
      const mode = modeRef.current ?? null;
      if (targetChar && (!characters.some(item => item.id === targetChar))) throw new Error('请选择当前玩法允许的角色。');
      const progress = player.id === session?.id ? podcastProgress() : session?.progress ?? solo?.progress;
      const next = await startListening({ eid: episode.eid, charId: targetChar, scope: podcastScope(mode),
        atMs: progress?.atMs ?? 0, rate: progress?.rate ?? 1, newSession }, lease);
      signal.throwIfAborted(); openSession(episode, next, lease);
      if (wasPlaying && player.id !== next.id) togglePodcast();
      if (targetChar && !episode.transcript) {
        const nextLease = await podcastLease();
        if (nextLease.epoch !== lease.epoch || nextLease.canonToken !== lease.canonToken) throw new Error('存档已更新。');
        try {
          const input = await podcastBridge<{ segments: unknown; source: 'online' | 'local' }>('transcript/' + episode.eid, signal);
          const segments = normalizeTranscript(input.segments);
          await saveEpisode(episode.eid, old => {
            if (!old) throw new Error('节目已移除。');
            return { ...old, transcript: { segments, source: input.source, updatedAt: Date.now() } };
          }, nextLease, signal);
        } catch (cause) {
          if (!signal.aborted) setError('已打开一起听，文稿尚未取得。' + cardCreationErrorMessage(cause));
        }
      }
    });
  }

  function resume(next: ListeningSession) {
    const value = episodes.find(row => row.eid === next.eid);
    if (!value) return;
    void run('恢复收听', async (signal, lease) => {
      if (next.charId) await requireListeningScope(next, lease);
      signal.throwIfAborted(); openSession(value, next, lease);
    });
  }

  function transcript(file?: File) {
    if (!episode) return;
    void run('读取文稿', async (signal, lease) => {
      if (file && file.size > 5_000_000) throw new Error('文稿文件需小于 5 MB。');
      const input = file ? { segments: JSON.parse(await file.text()), source: 'import' as const }
        : await podcastBridge<{ segments: unknown; source: 'online' | 'local' }>('transcript/' + episode.eid, signal);
      const segments = normalizeTranscript(input.segments);
      await saveEpisode(episode.eid, old => {
        if (!old) throw new Error('节目已移除。');
        return { ...old, transcript: { segments, source: input.source, updatedAt: Date.now() } };
      }, lease, signal);
    });
  }

  function refreshAudio() {
    if (!episode || !session) return;
    void run('刷新音源', async (signal, lease) => {
      const value = await fetchEpisode(episode.eid, signal);
      await saveEpisode(episode.eid, old => ({ ...value, transcript: old?.transcript }), lease, signal);
      signal.throwIfAborted();
      selectPodcast(session, value, lease, value.audioUrl ? 'online' : 'local');
    });
  }

  function importAudio(file: File) {
    if (!episode) return;
    void run('导入本机音频', async (signal, lease) => {
      const format = file.name.split('.').pop()?.toLowerCase() || '';
      if (!['mp3', 'm4a', 'mp4', 'aac', 'ogg', 'wav', 'flac'].includes(format)) throw new Error('请选择支持的音频文件。');
      if (!file.size || file.size > 1024 * 1024 * 1024) throw new Error('音频文件应大于 0 字节且不超过 1 GB。');
      const response = await fetch('/api/xiaoyuzhou/importAudio/' + episode.eid + '?format=' + format, {
        method: 'POST', headers: { 'X-Sully-Podcast': '1', 'Content-Type': 'application/octet-stream' }, body: file, signal,
      });
      const result = response.headers.get('Content-Type')?.includes('application/json') ? await response.json() : null;
      if (!response.ok || !result?.localAudio) throw new Error(result?.error || '本机音频导入失败，请重试。');
      const updated = await saveEpisode(episode.eid, old => {
        if (!old) throw new Error('节目已移除。');
        return { ...old, localAudio: true };
      }, lease, signal);
      if (session) selectPodcast(session, updated, lease, 'local');
    });
  }

  function source(next: 'online' | 'local') {
    if (episode && session) void run('切换音源', async (signal, lease) => {
      signal.throwIfAborted(); selectPodcast(session, episode, lease, next);
    });
  }

  async function saveGenerated(id: string, lease: PlatformLease, signal: AbortSignal, text: string, patch: PendingSave['patch'], character: PendingSave['character']) {
    try { await editListening(id, patch, lease, signal, character); }
    catch (cause) {
      if (!signal.aborted) setPendingSave({ id, lease, patch, text, character });
      throw cause;
    }
  }

  function respond(retry?: PodcastTurn, fallback?: string) {
    if (!episode || !session || !char || saveCandidate) return;
    const text = draft.trim() || fallback || (quote ? '想和你聊聊引用的这段。' : '');
    if (!retry && !text) return;
    const actual = (player.id === session.id ? podcastProgress() : undefined) ?? session.progress;
    const progress = { ...actual, ranges: mergePlayedRanges([...session.progress.ranges, ...actual.ranges]) };
    const question: PodcastTurn = retry ?? { id: crypto.randomUUID(), role: 'user', text, atMs: progress.atMs,
      quote: quote ? { ...quote, text: quote.text.slice(0, 4000) } : undefined,
      evidence: heardExcerpts(episode.transcript?.segments || [], progress.ranges, progress.atMs, progress.finalMs, text) };
    const id = session.id;
    void run('角色回复', async (signal, initialLease) => {
      const work = async () => {
        const { char: owner } = await requireListeningScope(session, initialLease);
        let lease = initialLease;
        let current = session;
        if (!retry) {
          current = await editListening(id, old => {
            if (pendingQuestion(old)) throw new Error('请先重试或跳过上一条回复。');
            return { ...old, stoppedAt: undefined, turns: [...old.turns, question], draft: '' };
          }, lease, signal);
          signal.throwIfAborted();
          setDrafts(values => ({ ...values, [id]: '' })); setQuote(undefined);
          lease = await podcastLease();
          if (lease.epoch !== initialLease.epoch || lease.canonToken !== initialLease.canonToken || lease.revision !== initialLease.revision + 1) throw new Error('存档已变化，请重试回复。');
        } else if (pendingQuestion(current)?.id !== question.id) throw new Error('这条回复已处理。');
        const answer = await requestPodcastText({ episode, session: current, question, lease, api: apiConfig, user: userProfile, signal });
        const live = await requireListeningScope(current, lease);
        if (JSON.stringify(live.char) !== JSON.stringify(owner)) throw new Error('角色已变更，旧回复未保存。');
        await saveGenerated(id, lease, signal, answer, old => {
          if (pendingQuestion(old)?.id !== question.id) throw new Error('该问题已经处理。');
          return { ...old, turns: [...old.turns, { id: crypto.randomUUID(), role: 'assistant', text: answer, atMs: question.atMs, replyTo: question.id }] };
        }, { id: owner.id, fingerprint: JSON.stringify(owner) });
      };
      if (navigator.locks) {
        await navigator.locks.request('sully-podcast-reply:' + id, { ifAvailable: true }, async lock => {
          if (!lock) throw new Error('另一个窗口正在处理这场讨论。');
          await work();
        });
      } else await work();
    });
  }

  function updateSession(label: string, patch: (old: ListeningSession) => ListeningSession) {
    if (!session) return;
    void run(label, async (signal, lease) => { await editListening(session.id, patch, lease, signal); });
  }

  function summarize() {
    if (!episode || !session || !char || saveCandidate) return;
    void run('整理小结', async (signal, lease) => {
      const { char: owner } = await requireListeningScope(session, lease);
      const text = await requestPodcastText({ episode, session, lease, api: apiConfig, user: userProfile, signal });
      const summaryId = crypto.randomUUID();
      await saveGenerated(session.id, lease, signal, text, old => {
        if (old.summary !== session.summary || old.summaryId !== session.summaryId || old.sharedId !== session.sharedId) throw new Error('这场小结已更新，请保留候选后重新操作。');
        const summaries = [...(old.summaries || [])];
        if (old.summary) summaries.push({ id: old.summaryId || 'legacy', text: old.summary, atMs: old.progress.atMs, sharedId: old.sharedId });
        return { ...old, summary: text, summaryId, sharedId: undefined, summaries };
      }, { id: owner.id, fingerprint: JSON.stringify(owner) });
      setSummaryDrafts(values => ({ ...values, [session.id]: text }));
    });
  }

  function share() {
    if (!episode || !session || session.sharedId) return;
    void run('带回聊天', async (signal, lease) => {
      await flushPodcastProgress();
      const progress = player.id === session.id ? podcastProgress() : undefined;
      await sharePodcastSummary(episode, progress ? { ...session, progress } : session, lease, signal);
      addToast('讨论小结已带回聊天', 'success');
    });
  }

  function stopForToday() {
    if (!session) return;
    void run('保存收听', async (signal, lease) => {
      await flushPodcastProgress();
      await editListening(session.id, old => ({ ...old, stoppedAt: Date.now() }), lease, signal);
      stopPodcast(session.id); setEid(''); setSessionId(''); setQuote(undefined);
    });
  }

  function supplement() {
    if (!session || !solo) return;
    const previous = solo.progress.ranges.flatMap(([from, to]) => from < session.joinedAtMs
      ? [[from, Math.min(to, session.joinedAtMs)] as [number, number]] : []);
    updateSession('补充内容', old => ({ ...old, progress: { ...old.progress, ranges: mergePlayedRanges([...old.progress.ranges, ...previous]) } }));
    // Future request snapshots merge the stored supplement with the active playback ranges.
    void flushPodcastProgress();
  }

  const title = settings ? '设置' : episode ? '节目' : '小宇宙';
  const continued = sessions.find(row => row.id === player.id) || sessions.find(row => !row.charId || characters.some(item => item.id === row.charId));
  const continuedEpisode = episodes.find(row => row.eid === continued?.eid);
  const availableEpisodes = episodes.filter(row => (row.title + ' ' + row.podcast).toLowerCase().includes(search.trim().toLowerCase()));
  const history = sessions.filter(row => row.eid === eid && row.charId);
  const modelBusy = busy === '角色回复' || busy === '整理小结';

  return <div className="xyz-app h-full bg-sky-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
    <header className="flex shrink-0 items-center justify-between gap-2 border-b border-sky-100 bg-white/80 px-3 pb-2 dark:border-slate-700 dark:bg-slate-900/90">
      <button className={button} aria-label="返回" onClick={() => { if (!back()) closeApp(); }}><ArrowLeft size={18} /></button>
      <h1 className="text-base font-semibold">{title}</h1>
      <button className={button} aria-label="小宇宙设置" disabled={!!busy} onClick={() => setSettings(!settings)}><GearSix size={18} /></button>
    </header>
    {error && <div role="alert" className="mx-3 mt-2 flex items-start gap-2 rounded-xl bg-rose-50 p-2.5 text-xs text-rose-800 dark:bg-rose-950 dark:text-rose-200">
      <span className="min-w-0 flex-1 break-words">{error}</span><button aria-label="关闭提示" onClick={() => setError('')} className="px-2">×</button>
    </div>}
    {busy && !modelBusy && <div role="status" className="mx-3 mt-2 inline-flex items-center gap-2 text-xs text-sky-800 dark:text-sky-200"><SpinnerGap className="animate-spin" size={14} />{busy}…</div>}
    {settings ? <div className="xyz-scroll p-3"><PodcastSettings onClear={async () => {
      const lease = await podcastLease();
      await updatePlatform('podcast', rows => ({ put: rows.filter(row => row.kind === 'podcast_episode').map(row => ({ ...row, transcript: undefined })), value: undefined }), lease);
    }} /></div> : !episode ? <main className="xyz-scroll mx-auto w-full max-w-3xl space-y-4 p-3 sm:p-5">
      <section className="rounded-3xl bg-gradient-to-br from-sky-900 to-indigo-900 p-5 text-white">
        <Headphones size={30} weight="duotone" />
        <h2 className="mb-3 mt-2 text-xl font-semibold">播客，一起听</h2>
        <form className="flex flex-wrap gap-2" onSubmit={event => { event.preventDefault(); addEpisode(); }}>
          <input className={field + ' min-w-32 flex-1'} aria-label="小宇宙单集链接" placeholder="粘贴单集链接或分享文字" value={link} onChange={event => setLink(event.target.value)} maxLength={3000} />
          <button className={button} disabled={!!busy || !link.trim() || mode === undefined}><Plus size={16} />添加节目</button>
        </form>
      </section>
      {continued && continuedEpisode && <section className="space-y-2">
        <h2 className="text-sm font-semibold">继续收听</h2>
        <button className="xyz-row" disabled={!!busy} onClick={() => resume(continued)}>
          <Cover episode={continuedEpisode} className="h-12 w-12" />
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{continuedEpisode.title}</span><span className="text-xs text-slate-500 dark:text-slate-300">{podcastTime(player.id === continued.id ? player.atMs : continued.progress.atMs)}{continued.charId ? ' · ' + (characters.find(item => item.id === continued.charId)?.name || '角色已移除') : ''}</span></span>
        </button>
      </section>}
      <section className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-sm font-semibold">已添加节目</h2>
          {!!episodes.length && <input aria-label="搜索已添加节目" placeholder="搜索节目" className={field + ' w-36'} value={search} onChange={event => setSearch(event.target.value)} />}</div>
        {availableEpisodes.map(row => <button key={row.id} className="xyz-row" onClick={() => chooseEpisode(row)} disabled={!!busy}>
          <Cover episode={row} className="h-12 w-12" />
          <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{row.title}</span><span className="text-xs text-slate-500 dark:text-slate-300">{row.podcast || '小宇宙'} · {podcastTime(row.durationMs)} · {row.transcript ? '有文稿' : '未缓存文稿'}</span></span>
        </button>)}
        {!availableEpisodes.length && <p className="py-3 text-sm text-slate-500 dark:text-slate-300">{mode === undefined ? '正在读取节目…' : search ? '没有找到匹配的节目。' : '添加一集播客，就可以开始收听。'}</p>}
      </section>
    </main> : <main className="xyz-detail">
      <div className="xyz-episode px-3 pt-3">
        <div className="flex items-center gap-3">
          <Cover episode={episode} className="h-14 w-14" />
          <div className="min-w-0"><p className="truncate text-xs text-sky-800 dark:text-sky-200">{episode.podcast || '小宇宙'}</p><h2 className="line-clamp-2 break-words text-base font-semibold leading-snug">{episode.title}</h2></div>
        </div>
        {session && <PlayerPanel episode={episode} sessionId={session.id} onSource={source} onRefresh={refreshAudio} />}
        <div className="flex flex-wrap items-center gap-2">
          {!session && <button className={primary} disabled={!!busy} onClick={() => openPlayback()}>{solo ? '继续独自收听' : '打开播放器'}</button>}
          <select aria-label="一起听的角色" className={button + ' max-w-40'} value={selectedCharacter} disabled={!!busy} onChange={event => setCharId(event.target.value)}>
            <option value="">选择角色</option>
            {characters.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
          <button className={button} disabled={!!busy || !selectedCharacter} onClick={() => openPlayback(selectedCharacter)}>{session?.charId === selectedCharacter ? '继续一起听' : '邀请一起听'}</button>
          {history.some(item => item.charId === selectedCharacter) && <button className={button} disabled={!!busy} onClick={() => openPlayback(selectedCharacter, true)}>开始新一场</button>}
          <button className={button} disabled={!!busy} onClick={() => audioInput.current?.click()}>关联本机音频</button>
          <input ref={audioInput} hidden type="file" accept=".mp3,.m4a,.mp4,.aac,.ogg,.wav,.flac,audio/*" onChange={event => {
            const file = event.target.files?.[0]; event.target.value = ''; if (file) importAudio(file);
          }} />
        </div>
      </div>
      {char && session && <div className="xyz-tabs gap-2 px-3 pt-3" role="group" aria-label="播客页面">
        <button className={view === 'discussion' ? primary : button} aria-pressed={view === 'discussion'} onClick={() => setView('discussion')}>讨论</button>
        <button className={view === 'transcript' ? primary : button} aria-pressed={view === 'transcript'} onClick={() => setView('transcript')}>文稿</button>
      </div>}
      <div className={'xyz-workspace ' + (char && session ? 'xyz-together' : '')} data-view={view}>
        <div className="xyz-transcript">
          {!session && episode.description && <details className="mb-3 rounded-xl bg-white/70 p-3 dark:bg-slate-800"><summary className="cursor-pointer text-sm font-medium">节目简介</summary>
            <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700 dark:text-slate-300">{episode.description.replace(/<[^>]+>/g, ' ')}</p></details>}
          <TranscriptPanel key={episode.eid} episode={episode} atMs={atMs} busy={!!busy} onFetch={() => transcript()} onImport={transcript}
            onQuote={char ? segment => { setQuote(segment); setView('discussion'); } : undefined} />
          {!!history.length && <details className="mt-3 rounded-xl bg-white/70 p-3 dark:bg-slate-800">
            <summary className="cursor-pointer text-sm font-medium">收听历史</summary>
            <div className="mt-2 space-y-2">
              {history.map(item => <button key={item.id} className="xyz-row" disabled={!!busy || !characters.some(owner => owner.id === item.charId)} onClick={() => resume(item)}>
                <span className="min-w-0 flex-1 truncate text-xs">{characters.find(owner => owner.id === item.charId)?.name || '角色已移除'} · {podcastTime(item.progress.atMs)} · {new Date(item.progress.updatedAt).toLocaleDateString()}</span>
                <span className="text-xs text-slate-500 dark:text-slate-300">{item.turns.length} 条讨论</span>
              </button>)}
            </div>
          </details>}
        </div>
        {char && session && <div className="xyz-discussion">
          {saveCandidate && <details className="mb-2 rounded-lg bg-amber-50 p-2 text-xs text-amber-950" open><summary>尚未保存的生成内容，刷新可能丢失</summary><p className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap break-words">{saveCandidate.text}</p></details>}
          <Discussion session={session} name={char.name} draft={draft} quote={quote} summary={summary} busy={!!busy} modelBusy={modelBusy}
            canSupplement={!!solo?.progress.ranges.some(([from]) => from < session.joinedAtMs)} canSave={!!saveCandidate}
            onDiscardPending={() => setPendingSave(undefined)}
            onSavePending={() => {
              if (!saveCandidate) return;
              void run('保存生成内容', async (signal, lease) => {
                if (lease.epoch !== saveCandidate.lease.epoch || lease.canonToken !== saveCandidate.lease.canonToken) throw new Error('原存档已变化。');
                await requireListeningScope(session, lease);
                const saved = await editListening(session.id, saveCandidate.patch, lease, signal, saveCandidate.character);
                if (saved.summary) setSummaryDrafts(values => ({ ...values, [session.id]: saved.summary! }));
                setPendingSave(undefined);
              });
            }}
            onDraft={editDraft} onQuoteClear={() => setQuote(undefined)}
            onSend={fallback => respond(undefined, fallback)} onRetry={question => respond(question)}
            onAbandon={() => updateSession('跳过回复', old => ({ ...old, turns: old.turns.map(turn => turn.id === pendingQuestion(old)?.id ? { ...turn, abandoned: true } : turn) }))}
            onSummary={summarize} onSummaryChange={value => setSummaryDrafts(drafts => ({ ...drafts, [session.id]: value }))}
            onSummarySave={() => updateSession('保存小结', old => old.sharedId ? old : { ...old, summary: summary.trim() })}
            onShare={share} onStop={stopForToday} onCancel={() => operation.current?.abort()} onSupplement={supplement} />
        </div>}
      </div>
    </main>}
  </div>;
}
