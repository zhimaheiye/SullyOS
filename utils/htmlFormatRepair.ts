import type { Message } from '../types';
import { htmlToText } from './htmlPrompt';

export type HtmlRepairSegment = { kind: 'text'; text: string } | { kind: 'html'; html: string; textPreview: string };
export interface HtmlRepairPlan {
    anchor: Message;
    sources: Message[];
    segments: HtmlRepairSegment[];
    content: string;
    type: 'html_card';
    deleteIds: number[];
    cardCount: number;
}

const ROOT = /<(div|html|section|article)\b/i;
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

function tagAt(source: string, at: number): { name: string; closing: boolean; end: number; selfClosing: boolean } | null {
    if (source[at] !== '<') return null;
    if (source.startsWith('<!--', at)) {
        const end = source.indexOf('-->', at + 4);
        return end < 0 ? null : { name: '!comment', closing: false, end: end + 3, selfClosing: true };
    }
    const head = /^<(\/)?([a-z][\w:-]*)\b/i.exec(source.slice(at));
    if (!head) return null;
    let quote = '';
    for (let i = at + head[0].length; i < source.length; i++) {
        const ch = source[i];
        if (quote) { if (ch === quote) quote = ''; }
        else if (ch === '"' || ch === "'") quote = ch;
        else if (ch === '>') return {
            name: head[2].toLowerCase(), closing: !!head[1], end: i + 1,
            selfClosing: /\/\s*$/.test(source.slice(at, i)) || VOID.has(head[2].toLowerCase()),
        };
    }
    return null;
}

/** Scan the original bytes. DOMParser repairs broken markup, so its output cannot prove completeness. */
function completeRootEnd(source: string, start: number): number | null {
    const first = tagAt(source, start);
    if (!first || first.closing || !ROOT.test(source.slice(start, first.end))) return null;
    const stack: string[] = [];
    let pos = start;
    while (pos < source.length) {
        const next = source.indexOf('<', pos);
        if (next < 0) return null;
        const tag = tagAt(source, next);
        if (!tag) return null;
        if (tag.closing) {
            if (stack.pop() !== tag.name) return null;
            if (!stack.length) return tag.end;
        } else if (!tag.selfClosing) {
            stack.push(tag.name);
            if (tag.name === 'style' || tag.name === 'script') {
                const close = new RegExp(`</${tag.name}\\s*>`, 'gi');
                close.lastIndex = tag.end;
                const match = close.exec(source);
                if (!match) return null;
                stack.pop();
                pos = close.lastIndex;
                continue;
            }
        }
        pos = tag.end;
    }
    return null;
}

function validWrappedHtml(inner: string): string | null {
    const html = inner.trim();
    const start = html.search(ROOT);
    return start === 0 && completeRootEnd(html, 0) === html.length ? html : null;
}

/** Keeps exact ordinary text, including incomplete source, in its original order. */
export function extractRepairSegments(source: string): HtmlRepairSegment[] {
    const spans: Array<{ start: number; end: number; html: string }> = [];
    let pos = 0;
    while (pos < source.length) {
        const fence = source.indexOf('```', pos);
        const marker = source.slice(pos).search(/\[html\]/i);
        const marked = marker < 0 ? -1 : pos + marker;
        const root = source.slice(pos).search(ROOT);
        const bare = root < 0 ? -1 : pos + root;
        const starts = [fence, marked, bare].filter(n => n >= 0);
        if (!starts.length) break;
        const start = Math.min(...starts);
        if (start === fence) {
            const header = /^```([^\r\n]*)\r?\n/.exec(source.slice(start));
            const endFence = header ? source.indexOf('```', start + header[0].length) : -1;
            if (endFence < 0) { pos = start + 3; continue; }
            if (/^html\s*$/i.test(header![1])) {
                const html = validWrappedHtml(source.slice(start + header![0].length, endFence));
                if (html) spans.push({ start, end: endFence + 3, html });
            }
            pos = endFence + 3; // never interpret examples inside a non-HTML code fence
        } else if (start === marked) {
            const endTag = /\[\/html\]/gi;
            endTag.lastIndex = start + 6;
            const close = endTag.exec(source);
            if (!close) { pos = start + 6; continue; }
            const html = validWrappedHtml(source.slice(start + 6, close.index));
            if (html) spans.push({ start, end: endTag.lastIndex, html });
            pos = endTag.lastIndex;
        } else {
            const end = completeRootEnd(source, start);
            if (end !== null) spans.push({ start, end, html: source.slice(start, end) });
            // A broken outer root may contain a balanced inner div. Do not promote that inner
            // fragment to a card: the user's original outer structure is still incomplete.
            pos = end ?? source.length;
        }
    }
    const segments: HtmlRepairSegment[] = [];
    let cursor = 0;
    for (const span of spans) {
        if (span.start > cursor) segments.push({ kind: 'text', text: source.slice(cursor, span.start) });
        const preview = htmlToText(span.html);
        segments.push({ kind: 'html', html: span.html, textPreview: preview.length > 120 ? `${preview.slice(0, 120)}…` : preview });
        cursor = span.end;
    }
    if (cursor < source.length) segments.push({ kind: 'text', text: source.slice(cursor) });
    return segments;
}

export function formatRepairSegments(segments: HtmlRepairSegment[]): string {
    return segments.map(s => s.kind === 'text' ? s.text : `[HTML卡片]${s.textPreview ? ` ${s.textPreview}` : ''}`).join('');
}

function makePlan(sources: Message[], segments: HtmlRepairSegment[]): HtmlRepairPlan {
    if (segments.filter(s => s.kind === 'html').length === 1 && segments.every(s => s.kind === 'html' || !s.text.trim())) {
        segments = segments.filter(s => s.kind === 'html');
    }
    const cardCount = segments.filter(s => s.kind === 'html').length;
    return {
        anchor: sources[0], sources, segments, cardCount,
        type: 'html_card', content: formatRepairSegments(segments),
        deleteIds: sources.slice(1).map(m => m.id),
    };
}

const eligible = (m: Message, selected: Message) => m.type === 'text' && !m.groupId &&
    m.charId === selected.charId && m.role === selected.role && !m.metadata?.withdrawal && !m.metadata?.htmlRepairSegments;

/** The caller supplies the full private history (including memory-palace processed rows). */
export function planHtmlFormatRepair(history: Message[], selectedId: number): HtmlRepairPlan | null {
    const ordered = [...history].sort((a, b) => a.id - b.id);
    const index = ordered.findIndex(m => m.id === selectedId);
    if (index < 0) return null;
    const selected = ordered[index];
    if (!eligible(selected, selected)) return null;
    const own = extractRepairSegments(selected.content);
    if (own.some(s => s.kind === 'html')) {
        if (selected.role !== 'assistant') return makePlan([selected], own);
        let from = index, to = index, segments = own;
        const count = (items: HtmlRepairSegment[]) => items.filter(s => s.kind === 'html').length;
        // Only take a neighbour if it proves the presence of another *complete* card.
        // Ordinary adjacent dialogue cannot enlarge a valid single-message repair.
        for (const direction of [-1, 1] as const) {
            let keepLooking = true;
            while (keepLooking) {
                keepLooking = false;
                for (let distance = 1; distance <= 3; distance++) {
                    const edge = direction < 0 ? from - distance : to + distance;
                    if (edge < 0 || edge >= ordered.length || Math.abs(edge - index) > 8) break;
                    const neighbor = ordered[edge];
                    const adjacent = ordered[direction < 0 ? edge + 1 : edge - 1];
                    if (!eligible(neighbor, selected) || Math.abs(neighbor.timestamp - adjacent.timestamp) > 120_000) break;
                    const joined = ordered.slice(direction < 0 ? edge : from, direction < 0 ? to + 1 : edge + 1).map(m => m.content).join('\n');
                    const proposed = extractRepairSegments(joined);
                    if (count(proposed) > count(segments)) {
                        if (direction < 0) from = edge; else to = edge;
                        segments = proposed;
                        keepLooking = true;
                        break;
                    }
                }
            }
        }
        return makePlan(ordered.slice(from, to + 1), segments);
    }
    if (selected.role !== 'assistant' || !/[<>\{\}]|[\w-]+\s*:|;\s*$/i.test(selected.content)) return null;

    let low = index, high = index;
    while (low > 0 && index - low < 8 && eligible(ordered[low - 1], selected) &&
        Math.abs(ordered[low].timestamp - ordered[low - 1].timestamp) <= 120_000) low--;
    while (high + 1 < ordered.length && high - index < 8 && eligible(ordered[high + 1], selected) &&
        Math.abs(ordered[high + 1].timestamp - ordered[high].timestamp) <= 120_000) high++;
    let best: { from: number; to: number; segments: HtmlRepairSegment[] } | null = null;
    for (let width = 2; width <= high - low + 1 && !best; width++) {
        for (let from = Math.max(low, index - width + 1); from <= index && from + width - 1 <= high; from++) {
            const to = from + width - 1;
            const joined = ordered.slice(from, to + 1).map(m => m.content).join('\n');
            const segments = extractRepairSegments(joined);
            const individualCards = ordered.slice(from, to + 1)
                .reduce((total, m) => total + extractRepairSegments(m.content).filter(s => s.kind === 'html').length, 0);
            if (segments.filter(s => s.kind === 'html').length > individualCards) {
                best = { from, to, segments };
                break;
            }
        }
    }
    if (!best) return null;
    // A second card may begin in a later chunk and close two chunks after it.
    for (let distance = 1; distance <= Math.min(3, high - best.to); distance++) {
        const to: number = best.to + distance;
        const joined = ordered.slice(best.from, to + 1).map(m => m.content).join('\n');
        const segments = extractRepairSegments(joined);
        if (segments.filter(s => s.kind === 'html').length > best.segments.filter(s => s.kind === 'html').length) {
            best = { ...best, to, segments };
            distance = 0;
        }
    }
    return makePlan(ordered.slice(best.from, best.to + 1), best.segments);
}
