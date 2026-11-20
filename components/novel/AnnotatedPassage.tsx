import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { NovelSegment } from '../../types';

type Note = NonNullable<NovelSegment['marginNotes']>[number];
interface Props {
    segment: NovelSegment;
    onDiscuss: (segment: NovelSegment, quote: string, charId?: string, start?: number) => void;
}

// Older notes have only a quote. After edits, only reattach if the match is unique.
export function locateMarginQuote(text: string, note: Pick<Note, 'quote' | 'start'>) {
    if (!note.quote) return -1;
    if (note.start !== undefined && note.start >= 0 && text.startsWith(note.quote, note.start)) return note.start;
    const first = text.indexOf(note.quote);
    return first !== -1 && first === text.lastIndexOf(note.quote) ? first : -1;
}

export default function AnnotatedPassage({ segment, onDiscuss }: Props) {
    const body = useRef<HTMLDivElement>(null);
    const [picked, setPicked] = useState<{ quote: string; start: number; x: number; y: number } | null>(null);
    const parts = useMemo(() => {
        const anchors = (segment.marginNotes || []).map(note => ({ note, start: locateMarginQuote(segment.content, note) })).reverse();
        const cuts = new Set([0, segment.content.length]);
        for (const { note, start } of anchors) {
            if (start < 0) continue;
            cuts.add(start);
            cuts.add(start + note.quote.length);
        }
        const points = [...cuts].sort((a, b) => a - b);
        return points.slice(0, -1).map((start, i) => ({
            start, text: segment.content.slice(start, points[i + 1]),
            anchor: anchors.find(a => a.start >= 0 && a.start <= start && a.start + a.note.quote.length > start),
        }));
    }, [segment.content, segment.marginNotes]);

    useEffect(() => {
        const readSelection = () => {
            const el = body.current;
            const selection = window.getSelection();
            if (!el || !selection?.rangeCount || selection.isCollapsed) { setPicked(null); return; }
            const range = selection.getRangeAt(0);
            if (!el.contains(range.commonAncestorContainer)) { setPicked(null); return; }
            const quote = range.toString();
            if (!quote.trim()) { setPicked(null); return; }
            const prefix = range.cloneRange();
            prefix.selectNodeContents(el);
            prefix.setEnd(range.startContainer, range.startOffset);
            const edge = range.cloneRange();
            edge.setStart(selection.focusNode!, selection.focusOffset);
            edge.collapse(true);
            const rect = edge.getBoundingClientRect();
            const box = el.getBoundingClientRect();
            setPicked({
                quote, start: prefix.toString().length,
                x: Math.max(0, Math.min(rect.left - box.left, box.width - 88)),
                y: (rect.height ? rect.bottom : range.getBoundingClientRect().bottom) - box.top,
            });
        };
        document.addEventListener('selectionchange', readSelection);
        return () => document.removeEventListener('selectionchange', readSelection);
    }, []);

    const discussSelection = () => {
        if (!picked) return;
        onDiscuss(segment, picked.quote, undefined, picked.start);
        window.getSelection()?.removeAllRanges();
        setPicked(null);
    };
    return <div className="relative">
        <div ref={body} className="whitespace-pre-wrap" style={{ userSelect: 'text', WebkitUserSelect: 'text' }}>
            {parts.map(({ start, text, anchor }) => anchor ? <span key={start} role="button" tabIndex={0}
                className="cursor-pointer underline decoration-indigo-400 decoration-dotted underline-offset-4"
                onClick={() => { if (window.getSelection()?.isCollapsed) onDiscuss(segment, anchor.note.quote, anchor.note.charId, anchor.note.start); }}
                onKeyDown={e => { if (e.key === 'Enter') onDiscuss(segment, anchor.note.quote, anchor.note.charId, anchor.note.start); }}
            >{text}</span> : <React.Fragment key={start}>{text}</React.Fragment>)}
        </div>
        {picked && <button type="button" style={{ left: picked.x, top: picked.y }} className="absolute z-30 rounded-xl bg-indigo-600 px-3 py-2 font-sans text-xs font-bold text-white shadow-lg"
            onPointerDown={e => e.preventDefault()} onClick={discussSelection}>写旁批</button>}
        {!!segment.marginNotes?.length && <details className="mt-2 text-left font-sans text-xs">
            <summary className="cursor-pointer">全部旁批（{segment.marginNotes.length}）</summary>
            {segment.marginNotes.map((note, i) => <button key={i} onClick={() => onDiscuss(segment, note.quote, note.charId, note.start)}
                className="my-2 block w-full border-l-2 border-indigo-300 pl-2 text-left"><span className="line-clamp-1">{note.quote}</span>{note.charName} · {note.question}</button>)}
        </details>}
    </div>;
}
