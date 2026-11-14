import { mutatePodcast, type PodcastMode as StoryModeRecord } from './platform';
import { freezePlatform, readPlatform, rowId, updatePlatform, type PlatformLease } from './platform';
import type { PodcastRecord as StorySocialRecord } from './platform';
import { mergePlayedRanges, type PlayedRange, type Segment } from './core';

export interface Episode extends StorySocialRecord {
  kind: 'podcast_episode'; eid: string; title: string; podcast: string; cover: string; description: string;
  durationMs: number; audioUrl: string; localAudio: boolean; hasTranscript: boolean;
  transcript?: { segments: Segment[]; source: 'online' | 'local' | 'import'; updatedAt: number };
}
export interface PodcastTurn {
  id: string; role: 'user' | 'assistant'; text: string; atMs: number;
  quote?: Segment; evidence?: Segment[]; replyTo?: string; abandoned?: boolean;
}
export interface ListeningSession extends StorySocialRecord {
  kind: 'podcast_session'; eid: string; charId: string; scope: string; joinedAtMs: number;
  progress: { atMs: number; ranges: PlayedRange[]; rate: number; finalMs?: number; updatedAt: number };
  turns: PodcastTurn[]; draft?: string; summary?: string; summaryId?: string; sharedId?: number; stoppedAt?: number;
  summaries?: Array<{ id: string; text: string; atMs: number; sharedId?: number }>;
}

export const podcastScope = (_mode: StoryModeRecord | null) => 'normal';
export const podcastEpisodeKey = (eid: string) => 'podcast:episode:' + eid;
export const podcastModeToken = (mode: StoryModeRecord | null) => mode?.token ?? 'public';
export const podcastLease = () => freezePlatform('podcast');
export const readPodcastLibrary = () => readPlatform('podcast');

export function saveEpisode(eid: string, edit: (old?: Episode) => Episode, lease: PlatformLease, signal?: AbortSignal) {
  return updatePlatform('podcast', rows => {
    const id = podcastEpisodeKey(eid);
    const updated = edit(rows.find(row => row.id === id) as Episode | undefined);
    return { put: [updated], value: updated };
  }, lease, signal);
}

export function startListening(input: { eid: string; charId: string; scope: string; atMs: number; rate: number; newSession?: boolean }, lease: PlatformLease) {
  return updatePlatform('podcast', rows => {
    if (!rows.some(row => row.id === podcastEpisodeKey(input.eid))) throw new Error('节目已移除。');
    const existing = rows.filter(row => row.kind === 'podcast_session') as ListeningSession[];
    const match = existing.filter(row => row.eid === input.eid && row.charId === input.charId && row.scope === input.scope)
      .sort((a, b) => b.progress.updatedAt - a.progress.updatedAt)[0];
    if (match && (!input.newSession || !input.charId)) return { value: match };
    const session: ListeningSession = {
      kind: 'podcast_session', id: rowId('podcast', 'session'), eid: input.eid, charId: input.charId, scope: input.scope,
      joinedAtMs: input.atMs, progress: { atMs: input.atMs, rate: input.rate, ranges: [], updatedAt: Date.now() }, turns: [],
    };
    return { put: [session], value: session };
  }, lease);
}

export function editListening(id: string, change: (old: ListeningSession) => ListeningSession, lease: PlatformLease, signal?: AbortSignal, character?: { id: string; fingerprint: string }) {
  return updatePlatform('podcast', rows => {
    const old = rows.find(row => row.id === id && row.kind === 'podcast_session') as ListeningSession | undefined;
    if (!old) throw new Error('这场讨论已移除。');
    const next = change(old);
    return { put: [next], value: next };
  }, lease, signal, character);
}

export function saveListeningProgress(id: string, progress: ListeningSession['progress'], lease: PlatformLease) {
  return mutatePodcast(id, rows => {
    const session = rows.find(row => row.id === id && row.kind === 'podcast_session') as ListeningSession | undefined;
    if (!session) return { value: undefined };
    const ranges = mergePlayedRanges([...session.progress.ranges, ...progress.ranges]);
    const latest = progress.updatedAt >= session.progress.updatedAt ? progress : session.progress;
    return { put: [{ ...session, progress: { ...latest, ranges, finalMs: progress.finalMs ?? session.progress.finalMs } }], value: undefined };
  }, lease.canonToken, { name: 'podcast', epoch: lease.epoch });
}
