export interface Segment { startMs: number; text: string }
export type PlayedRange = [number, number];
export const EPISODE_ID = /^[a-f0-9]{24}$/;

export function episodeIdFromShare(value: string) {
  const eid = /https:\/\/(?:www\.)?xiaoyuzhoufm\.com\/episode\/([a-f0-9]{24})(?=$|[/?#\s，。；！、）】])/i.exec(value)?.[1];
  if (!eid) throw new Error('请粘贴小宇宙单集链接或分享文字。');
  return eid.toLowerCase();
}

export function normalizeTranscript(value: unknown): Segment[] {
  if (!Array.isArray(value) || value.length > 12_000) throw new Error('文稿格式无效或超过大小限制。');
  const segments = new Map<number, string>();
  let length = 0;
  for (const row of value) {
    if (!Number.isSafeInteger(row?.startMs) || row.startMs < 0 || typeof row.text !== 'string' || !row.text.trim()) continue;
    const text = row.text.trim();
    length += text.length;
    if (length > 1_500_000 || text.length > 4000) throw new Error('文稿正文超过大小限制。');
    const previous = segments.get(row.startMs);
    const merged = previous ? previous + '\n' + text : text;
    if (merged.length > 4000) throw new Error('同一时间点的文稿段落过长。');
    segments.set(row.startMs, merged);
  }
  if (!segments.size) throw new Error('没有可用的带时间戳文稿。');
  return [...segments].sort(([a], [b]) => a - b).map(([startMs, text]) => ({ startMs, text }));
}

export function mergePlayedRanges(ranges: PlayedRange[]): PlayedRange[] {
  const merged: PlayedRange[] = [];
  for (const [from, to] of ranges.filter(([from, to]) => Number.isFinite(from) && Number.isFinite(to) && from >= 0 && to > from).sort(([a], [b]) => a - b)) {
    const last = merged.at(-1);
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  return merged;
}

export function heardExcerpts(segments: Segment[], ranges: PlayedRange[], atMs: number, finalMs: number | undefined, question: string) {
  const heard = segments.filter((segment, i) => {
    const end = segments[i + 1]?.startMs ?? finalMs;
    return end !== undefined && end > segment.startMs && end <= atMs
      && ranges.some(([from, to]) => from <= segment.startMs && to >= end);
  });
  const terms = new Set(question.toLowerCase().match(/[a-z0-9]{2,}|[\p{Script=Han}]{2,}/gu)?.flatMap(term =>
    /^[a-z0-9]+$/.test(term) ? [term] : [...term].slice(1).map((char, i) => [...term][i] + char)) || []);
  const recent = heard.filter(segment => segment.startMs >= atMs - 180_000);
  const older = heard.filter(segment => segment.startMs < atMs - 180_000).map(segment => ({
    segment, matches: [...terms].filter(term => segment.text.toLowerCase().includes(term)).length,
  })).filter(item => item.matches).sort((a, b) => b.matches - a.matches || b.segment.startMs - a.segment.startMs).slice(0, 3);
  const chosen: Segment[] = [];
  let remaining = 5000;
  for (const segment of [...recent.reverse(), ...older.map(item => item.segment)]) {
    if (segment.text.length > remaining) continue;
    chosen.push(segment);
    remaining -= segment.text.length;
  }
  return chosen.sort((a, b) => a.startMs - b.startMs);
}

export function podcastTime(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(seconds / 60);
  const sec = String(seconds % 60).padStart(2, '0');
  return minutes >= 60 ? `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, '0')}:${sec}` : `${minutes}:${sec}`;
}

export function podcastCdn(value: unknown): string {
  if (typeof value !== 'string' || value.length > 4096) return '';
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname.endsWith('.xyzcdn.net') && !url.port && !url.username && !url.password) return url.href;
  } catch { /* No supported source. */ }
  return '';
}
