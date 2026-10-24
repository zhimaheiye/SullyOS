import React from 'react';
import type { HtmlRepairSegment } from '../../utils/htmlFormatRepair';
import HtmlCard from './HtmlCard';

/** One persisted message, one interaction target, several visual segments in source order. */
export default function HtmlRepairComposite({ segments, isUser, textStyle }: {
    segments: HtmlRepairSegment[];
    isUser: boolean;
    textStyle?: React.CSSProperties;
}) {
    return <div className="flex flex-col items-start gap-1" data-html-repair-composite="true">
        {segments.map((segment, index) => segment.kind === 'html'
            ? <HtmlCard key={index} html={segment.html} />
            : segment.text.trim() && <div key={index} className={`px-5 py-3 rounded-2xl shadow-sm whitespace-pre-wrap break-all select-text ${isUser ? 'sully-bubble-user' : 'sully-bubble-ai'}`} style={textStyle}>{segment.text}</div>)}
    </div>;
}
