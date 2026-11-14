import React, { useRef, useState } from 'react';
import { ArrowClockwise, Headphones, Pause, Play, Rewind, FastForward, SpeakerHigh } from '@phosphor-icons/react';
import { podcastTime, type Segment } from '../../utils/podcast/core';
import { seekPodcast, setPodcastRate, setPodcastVolume, togglePodcast, usePodcastPlayer } from '../../utils/podcast/player';
import type { Episode } from '../../utils/podcast/store';

export const button = 'inline-flex min-h-10 items-center justify-center gap-1.5 rounded-xl border border-sky-200/80 bg-white px-3 py-1.5 text-xs font-medium text-sky-900 hover:bg-sky-50 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-sky-100 dark:hover:bg-slate-700';
export const primary = button + ' !border-sky-700 !bg-sky-700 !text-white hover:!bg-sky-800';
export const field = 'min-w-0 rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-500 focus:border-sky-600 focus:outline-none dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100';

export function Cover({ episode, className = '' }: { episode: Episode; className?: string }) {
  return <div className={'relative grid shrink-0 place-items-center overflow-hidden rounded-2xl bg-gradient-to-br from-sky-200 to-indigo-200 text-sky-800 ' + className}>
    <Headphones size={27} weight="duotone" />
    {episode.cover && <img src={episode.cover} referrerPolicy="no-referrer" loading="lazy" alt="" className="absolute inset-0 h-full w-full object-cover" onError={event => { event.currentTarget.hidden = true; }} />}
  </div>;
}

export function PlayerPanel({ episode, sessionId, onSource, onRefresh }: {
  episode: Episode; sessionId: string; onSource: (source: 'online' | 'local') => void; onRefresh: () => void;
}) {
  const player = usePodcastPlayer();
  const current = player.id === sessionId;
  const duration = current ? player.durationMs : episode.durationMs;
  return <section aria-label="播客播放器" className="space-y-2 rounded-2xl border border-sky-100 bg-white/80 p-3 dark:border-slate-700 dark:bg-slate-800/75">
    <div className="flex items-center gap-2">
      <span className="w-12 text-xs tabular-nums text-slate-500 dark:text-slate-300">{podcastTime(current ? player.atMs : 0)}</span>
      <input aria-label="播放进度" className="min-w-0 flex-1 accent-sky-700" type="range" min={0} max={duration || 1} step={250}
        value={current ? Math.min(duration, player.atMs) : 0} disabled={!current || player.loading || !duration} onChange={event => seekPodcast(Number(event.target.value))} />
      <span className="text-xs tabular-nums text-slate-500 dark:text-slate-300">{podcastTime(duration)}</span>
    </div>
    <div className="flex flex-wrap items-center gap-1.5">
      <button className={button} aria-label="后退15秒" disabled={!current} onClick={() => seekPodcast(player.atMs - 15000)}><Rewind size={16} />15</button>
      <button className={primary} aria-label={current && player.playing ? '暂停' : '播放'} disabled={!current || (!episode.audioUrl && !episode.localAudio)} onClick={togglePodcast}>
        {current && player.playing ? <Pause size={18} weight="fill" /> : <Play size={18} weight="fill" />}
      </button>
      <button className={button} aria-label="前进15秒" disabled={!current} onClick={() => seekPodcast(player.atMs + 15000)}><FastForward size={16} />15</button>
      <select aria-label="播放倍速" className={button} disabled={!current} value={current ? player.rate : 1} onChange={event => setPodcastRate(Number(event.target.value))}>
        {[0.75, 1, 1.25, 1.5, 1.75, 2].map(rate => <option key={rate} value={rate}>{rate}×</option>)}
      </select>
      <label className="flex min-h-10 items-center gap-1 px-1 text-sky-800 dark:text-sky-200"><SpeakerHigh size={16} />
        <input aria-label="音量" className="w-12 accent-sky-700" type="range" min={0} max={1} step={0.05} disabled={!current} value={player.volume} onChange={event => setPodcastVolume(Number(event.target.value))} />
      </label>
    </div>
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-sky-800 dark:text-sky-200">
      {current && <span>{player.loading ? '正在加载音频' : player.source === 'local' ? '本机音频' : '在线音频'}</span>}
      {episode.localAudio && player.source !== 'local' && <button className="min-h-8 underline" onClick={() => onSource('local')}>使用本机音频</button>}
      {episode.audioUrl && player.source === 'local' && <button className="min-h-8 underline" onClick={() => onSource('online')}>使用在线音频</button>}
      <button className="inline-flex min-h-8 items-center gap-1 underline" onClick={onRefresh}><ArrowClockwise size={13} />刷新音源</button>
    </div>
    {current && player.error && <p role="alert" className="text-xs text-rose-700 dark:text-rose-300">{player.error}</p>}
  </section>;
}

export function TranscriptPanel({ episode, atMs, busy, onFetch, onImport, onQuote }: {
  episode: Episode; atMs: number; busy: boolean; onFetch: () => void; onImport: (file: File) => void; onQuote?: (segment: Segment) => void;
}) {
  const [search, setSearch] = useState('');
  const [all, setAll] = useState(false);
  const [page, setPage] = useState(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const segments = episode.transcript?.segments || [];
  let active = segments.length - 1;
  while (active >= 0 && segments[active].startMs > atMs) active--;
  const filtered = search.trim() ? segments.filter(segment => segment.text.toLowerCase().includes(search.trim().toLowerCase())) : segments;
  const paged = all || !!search.trim();
  const pageIndex = Math.min(page, Math.max(0, Math.ceil(filtered.length / 40) - 1));
  const shown = paged ? filtered.slice(pageIndex * 40, pageIndex * 40 + 40) : segments.slice(Math.max(0, active - 4), Math.max(0, active) + 7);
  return <section aria-label="节目文稿" className="flex min-h-0 flex-col gap-2">
    <div className="flex flex-wrap items-center gap-2">
      <button className={button} disabled={busy} onClick={onFetch}>{segments.length ? '刷新文稿' : '获取文稿'}</button>
      <button className={button} disabled={busy} onClick={() => fileInput.current?.click()}>导入 JSON</button>
      <input ref={fileInput} type="file" accept=".json,application/json" hidden onChange={event => {
        const file = event.target.files?.[0]; event.target.value = ''; if (file) onImport(file);
      }} />
      {episode.transcript && <span className="text-xs text-slate-500 dark:text-slate-300">{episode.transcript.source === 'online' ? '在线文稿' : '本机文稿'}</span>}
    </div>
    {segments.length ? <>
      <div className="flex gap-2">
        <input className={field + ' flex-1'} aria-label="查找文稿" placeholder="查找文稿" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} />
        <button className={button} onClick={() => { setAll(!paged); setSearch(''); setPage(0); }}>{paged ? '跟随播放' : '查看全文'}</button>
      </div>
      {paged && <div className="flex items-center gap-2 text-xs">
        <button className={button} disabled={!pageIndex} onClick={() => setPage(pageIndex - 1)}>上一页</button>
        <span>{filtered.length ? pageIndex + 1 : 0} / {Math.ceil(filtered.length / 40)}</span>
        <button className={button} disabled={(pageIndex + 1) * 40 >= filtered.length} onClick={() => setPage(pageIndex + 1)}>下一页</button>
      </div>}
      <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-sky-100 dark:border-slate-700">
        {shown.map(segment => <article key={segment.startMs} className={'border-b border-sky-100 px-3 py-2.5 last:border-0 dark:border-slate-700 ' + (segments[active] === segment ? 'bg-sky-100/80 dark:bg-sky-950/70' : '')}>
          <div className="flex items-center justify-between text-xs text-sky-800 dark:text-sky-200">
            <button className="min-h-8 font-mono underline" aria-label={'跳转到 ' + podcastTime(segment.startMs)} onClick={() => seekPodcast(segment.startMs)}>{podcastTime(segment.startMs)}</button>
            {onQuote && <button className="min-h-8 px-2 underline" disabled={busy} onClick={() => onQuote(segment)}>引用讨论</button>}
          </div>
          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{segment.text}</p>
        </article>)}
        {!shown.length && <p className="p-3 text-sm text-slate-500">未找到匹配的文稿。</p>}
      </div>
    </> : <p className="rounded-xl bg-sky-100/60 p-3 text-sm text-slate-600 dark:bg-sky-950/50 dark:text-slate-200">这集还没有可用文稿。音频仍可播放，也可以导入本机导出的时间戳 JSON。</p>}
  </section>;
}
