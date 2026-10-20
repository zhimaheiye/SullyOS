import React from 'react';

/** Shared reply indicator for life decisions, cached replies and live chat. */
export default function ChatReplyDots() {
    return <div role="status" aria-label="对方正在回复" className="flex gap-1">
        <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce" />
        <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-75" />
        <div className="w-1.5 h-1.5 bg-slate-400 rounded-full animate-bounce delay-150" />
    </div>;
}
