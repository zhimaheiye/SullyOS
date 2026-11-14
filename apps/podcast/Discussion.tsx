import React, { useEffect, useRef } from 'react';
import { PaperPlaneTilt, X } from '@phosphor-icons/react';
import { podcastTime, type Segment } from '../../utils/podcast/core';
import { seekPodcast } from '../../utils/podcast/player';
import type { ListeningSession, PodcastTurn } from '../../utils/podcast/store';
import { button, field, primary } from './Panels';

export function pendingQuestion(session: ListeningSession) {
  const last = session.turns.at(-1);
  return last?.role === 'user' && !last.abandoned ? last : undefined;
}

export default function Discussion(props: {
  session: ListeningSession; name: string; draft: string; quote?: Segment; summary: string; busy: boolean; modelBusy: boolean;
  canSupplement: boolean; canSave: boolean; onSavePending: () => void; onDiscardPending: () => void; onDraft: (draft: string) => void;
  onQuoteClear: () => void; onSend: (fallback?: string) => void; onRetry: (question: PodcastTurn) => void;
  onAbandon: () => void; onSummary: () => void; onSummaryChange: (text: string) => void; onSummarySave: () => void;
  onShare: () => void; onStop: () => void; onCancel: () => void; onSupplement: () => void;
}) {
  const { session, draft, quote, busy } = props;
  const pending = pendingQuestion(session);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { if (list.current) list.current.scrollTop = list.current.scrollHeight; }, [session.id, session.turns.length]);
  return <section aria-label="一起听讨论" className="flex min-h-0 flex-1 flex-col gap-2">
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sky-100 pb-2 dark:border-slate-700">
      <div><h2 className="text-sm font-semibold">和 {props.name} 一起听</h2><div className="text-xs text-slate-500 dark:text-slate-300">从 {podcastTime(session.joinedAtMs)} 加入</div></div>
      {props.canSupplement && <button className={button} disabled={busy} onClick={props.onSupplement}>补充此前已听内容</button>}
    </div>
    <div ref={list} className="min-h-32 flex-1 space-y-2 overflow-y-auto pr-1" aria-live="polite">
      {!session.turns.length && <p className="rounded-2xl bg-sky-100/70 p-3 text-sm text-slate-600 dark:bg-sky-950/70 dark:text-slate-200">听到想聊的地方就发条消息。暂停之后也可以接着聊。</p>}
      {session.turns.map(turn => <article key={turn.id} className={'max-w-[94%] rounded-2xl px-3 py-2 ' + (turn.role === 'user' ? 'ml-auto bg-sky-100 dark:bg-sky-950' : 'bg-white dark:bg-slate-800')}>
        <div className="flex items-center gap-2 text-xs text-sky-800 dark:text-sky-200">
          <span>{turn.role === 'user' ? '我' : props.name}</span>
          <button className="min-h-7 font-mono underline" aria-label={'回听 ' + podcastTime(turn.atMs)} onClick={() => seekPodcast(turn.atMs)}>{podcastTime(turn.atMs)}</button>
        </div>
        {turn.quote && <p className="mb-2 border-l-2 border-sky-300 pl-2 text-xs text-slate-600 dark:text-slate-300">引用 {podcastTime(turn.quote.startMs)} · {turn.quote.text}</p>}
        <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{turn.text}</p>
      </article>)}
      {props.modelBusy && <p role="status" className="text-xs text-sky-700 dark:text-sky-200">正在回复…</p>}
    </div>
    {quote && <div className="flex items-center gap-2 rounded-xl bg-sky-100 p-2 text-xs dark:bg-sky-950">
      <span className="min-w-0 flex-1 truncate">引用 {podcastTime(quote.startMs)} · {quote.text}</span>
      <button className="p-2" aria-label="移除引用" onClick={props.onQuoteClear}><X size={14} /></button>
    </div>}
    {props.canSave ? <div className="flex flex-wrap gap-2"><button className={primary} disabled={busy} onClick={props.onSavePending}>再次保存已生成内容</button><button className={button} disabled={busy} onClick={props.onDiscardPending}>放弃候选</button></div> :
      pending && !busy && <div className="flex gap-2"><button className={button} onClick={() => props.onRetry(pending)}>重试回复</button><button className={button} onClick={props.onAbandon}>跳过回复</button></div>}
    <form className="flex items-end gap-2" onSubmit={event => { event.preventDefault(); props.onSend(); }}>
      <textarea aria-label="讨论消息" className={field + ' flex-1 resize-y'} rows={2} maxLength={2000} placeholder="想跟 TA 说什么？" value={draft} onChange={event => props.onDraft(event.target.value)} />
      <button className={primary} aria-label="发送讨论" type="submit" disabled={busy || props.canSave || !!pending || (!draft.trim() && !quote)}><PaperPlaneTilt size={17} /></button>
    </form>
    <div className="flex flex-wrap gap-2">
      <button className={button} disabled={busy || props.canSave || !!pending} onClick={() => props.onSend('聊聊刚才这段。')}>聊聊刚才这段</button>
      <button className={button} disabled={busy || props.canSave || !session.turns.length} onClick={props.onSummary}>整理这次讨论</button>
      <button className={button} disabled={busy} onClick={props.onStop}>今天先听到这里</button>
      {props.modelBusy && <button className={button} onClick={props.onCancel}>取消请求</button>}
    </div>
    {(props.summary || session.summary) && <div className="space-y-2 rounded-xl bg-sky-50 p-2 dark:bg-slate-800">
      <textarea className={field + ' w-full'} aria-label="讨论小结" maxLength={8000} rows={4} value={props.summary} disabled={!!session.sharedId} onChange={event => props.onSummaryChange(event.target.value)} />
      {session.sharedId ? <p role="status" className="text-xs">已带回聊天</p> : <div className="flex flex-wrap gap-2">
        <button className={button} disabled={busy || !props.summary.trim()} onClick={props.onSummarySave}>保存小结</button>
        <button className={primary} disabled={busy || !session.summary?.trim() || props.summary.trim() !== session.summary} onClick={props.onShare}>带回聊天</button>
      </div>}
    </div>}
    {!!session.summaries?.length && <details className="rounded-xl bg-white/70 p-2 text-xs dark:bg-slate-800">
      <summary className="cursor-pointer">此前的小结</summary>
      {session.summaries.map(item => <div key={item.id} className="mt-2 border-t border-sky-100 pt-2 dark:border-slate-600">
        <p className="text-sky-800 dark:text-sky-200">{podcastTime(item.atMs)}{item.sharedId ? ' · 已带回聊天' : ''}</p>
        <p className="mt-1 whitespace-pre-wrap break-words leading-relaxed">{item.text}</p>
      </div>)}
    </details>}
  </section>;
}
