import { useSyncExternalStore } from 'react';
import { mergePlayedRanges, podcastCdn, type PlayedRange } from './core';
import { podcastLease, saveListeningProgress, type Episode, type ListeningSession } from './store';
import type { PlatformLease } from './platform';

type PlayerState = {
  id: string; atMs: number; durationMs: number; playing: boolean; rate: number; volume: number;
  loading: boolean; source: 'online' | 'local'; error: string;
};
const initial: PlayerState = { id: '', atMs: 0, durationMs: 0, playing: false, rate: 1, volume: 1, loading: false, source: 'online', error: '' };
let state = initial;
let audio: HTMLAudioElement | undefined;
let active: { session: ListeningSession; lease: PlatformLease; position: number; ready: boolean; finalMs?: number } | undefined;
let lastSave = 0;
let lastError = '';
const listeners = new Set<() => void>();
let disposeAudio: (() => void) | undefined;
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };
function publish(patch: Partial<PlayerState>) {
  state = { ...state, ...patch };
  listeners.forEach(fn => fn());
}
export const usePodcastPlayer = () => useSyncExternalStore(subscribe, () => state, () => initial);

export function podcastProgress() {
  const el = audio;
  if (!el || !active) return;
  const played: PlayedRange[] = [];
  if (active.ready) {
    for (let i = 0; i < el.played.length; i++) played.push([el.played.start(i) * 1000, el.played.end(i) * 1000]);
  }
  return {
    atMs: active.ready ? el.currentTime * 1000 : active.position,
    ranges: mergePlayedRanges([...active.session.progress.ranges, ...played]),
    finalMs: active.finalMs ?? active.session.progress.finalMs,
    rate: el.playbackRate, updatedAt: Date.now(),
  };
}

export async function flushPodcastProgress() {
  const target = active, progress = podcastProgress();
  if (!target || !progress) return;
  lastSave = Date.now();
  try { await saveListeningProgress(target.session.id, progress, target.lease); }
  catch (error) {
    if (active !== target || (error instanceof Error && error.name === 'AbortError')) return;
    lastError = '播放进度暂未保存，将在下次进度更新时再试。';
    publish({ error: lastError });
  }
}

function getAudio() {
  if (audio) return audio;
  const el = new Audio();
  audio = el;
  el.preload = 'metadata';
  el.addEventListener('loadedmetadata', () => {
    if (!active || !Number.isFinite(el.duration)) return;
    el.currentTime = Math.min(el.duration, active.position / 1000);
    active.ready = true;
    publish({ atMs: el.currentTime * 1000, durationMs: el.duration * 1000, loading: false });
  });
  el.addEventListener('timeupdate', () => {
    if (!active?.ready) return;
    publish({ atMs: el.currentTime * 1000 });
    if (Date.now() - lastSave > 5000) void flushPodcastProgress();
  });
  el.addEventListener('play', () => {
    if (!active || el.paused) return;
    window.dispatchEvent(new Event('sully-podcast-playing'));
    publish({ playing: true, error: '' });
  });
  el.addEventListener('pause', () => {
    publish({ playing: false });
    void flushPodcastProgress();
  });
  el.addEventListener('ended', () => {
    if (active && Number.isFinite(el.duration) && el.currentTime >= el.duration) active.finalMs = el.duration * 1000;
    publish({ playing: false });
    void flushPodcastProgress();
  });
  el.addEventListener('ratechange', () => { publish({ rate: el.playbackRate }); void flushPodcastProgress(); });
  el.addEventListener('volumechange', () => publish({ volume: el.volume }));
  el.addEventListener('error', () => {
    if (active) publish({ loading: false, playing: false, error: '音频播放失败。可以刷新节目地址或切换本机音频。' });
  });
  const pauseForMusic = () => el.pause();
  const saveOnExit = () => { void flushPodcastProgress(); };
  window.addEventListener('sully-music-playing', pauseForMusic);
  window.addEventListener('pagehide', saveOnExit);
  const validate = () => {
    const target = active;
    if (!target) return;
    void podcastLease().then(lease => {
      if (active === target && (lease.canonToken !== target.lease.canonToken || lease.epoch !== target.lease.epoch)) stopPodcast();
    }).catch(() => { if (active === target) stopPodcast(); });
  };
  window.addEventListener('personal-memory-reset', validate);
  window.addEventListener('podcast-updated', validate);
  disposeAudio = () => {
    stopPodcast();
    window.removeEventListener('sully-music-playing', pauseForMusic);
    window.removeEventListener('pagehide', saveOnExit);
    window.removeEventListener('personal-memory-reset', validate);
    window.removeEventListener('podcast-updated', validate);
  };
  return el;
}

export function selectPodcast(session: ListeningSession, episode: Episode, lease: PlatformLease, source?: 'online' | 'local') {
  const online = podcastCdn(episode.audioUrl);
  const nextSource = source ?? (online ? 'online' : 'local');
  if (active?.session.id === session.id && !source) return;
  const current = active?.session.id === session.id ? podcastProgress() : undefined;
  const el = getAudio();
  void flushPodcastProgress();
  el.pause();
  const progress = current ?? session.progress;
  active = { session: { ...session, progress }, lease, position: progress.atMs, ready: false };
  el.playbackRate = [0.75, 1, 1.25, 1.5, 1.75, 2].includes(progress.rate) ? progress.rate : 1;
  const url = nextSource === 'online' ? online : episode.localAudio ? '/api/xiaoyuzhou/audio/' + episode.eid : '';
  publish({ id: session.id, atMs: progress.atMs, durationMs: episode.durationMs, playing: false,
    loading: !!url, source: nextSource, rate: el.playbackRate, error: url ? '' : '这集暂无可播放的公开或本机音频。' });
  if (url) el.src = url;
  else el.removeAttribute('src');
  el.load();
}

export function stopPodcast(id?: string) {
  if (!active || (id && active.session.id !== id)) return;
  void flushPodcastProgress();
  active = undefined;
  audio?.pause();
  audio?.removeAttribute('src');
  audio?.load();
  publish({ ...initial, volume: audio?.volume ?? 1 });
}

export function togglePodcast() {
  if (!audio || !active || !audio.getAttribute('src')) return;
  if (!audio.paused) { audio.pause(); return; }
  const target = active;
  void audio.play().catch(() => { if (active === target) publish({ playing: false, error: '无法开始播放，请检查音频来源。' }); });
}
export function seekPodcast(atMs: number) {
  if (!audio || !active?.ready || !Number.isFinite(audio.duration)) return;
  audio.currentTime = Math.max(0, Math.min(audio.duration, atMs / 1000));
  publish({ atMs: audio.currentTime * 1000 });
  void flushPodcastProgress();
}
export function setPodcastRate(rate: number) { if (audio) audio.playbackRate = rate; }
export function setPodcastVolume(volume: number) { if (audio) audio.volume = volume; }
if (import.meta.hot) import.meta.hot.dispose(() => disposeAudio?.());
