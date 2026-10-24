import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, BookOpenText, ChalkboardTeacher, DownloadSimple, PaperPlaneTilt, Trash } from '@phosphor-icons/react';
import type { APIConfig, CharacterProfile, UserProfile } from '../../types';
import { ThinkingChainBlock } from '../chat/MessageItem';
import { useCharacterStudy } from '../../hooks/useCharacterStudy';
import { characterStudyMarkdownFileName } from '../../utils/characterStudy';
import { shareOrDownloadFile } from '../../utils/shareExport';

type KatexRenderer = { renderToString: (latex: string, options: any) => string };

interface Props {
  characters: CharacterProfile[];
  initialCharId?: string;
  apiConfig: APIConfig;
  userProfile: UserProfile;
  katexRenderer?: KatexRenderer | null;
  addToast: (message: string, type?: 'info' | 'success' | 'error') => void;
  onBack: () => void;
}

const inline = (text: string, katexRenderer?: KatexRenderer | null) => text.split(/(\$\$[^$]+\$\$|\$[^$]+\$|\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*)/g).map((part, index) => {
  if (part.startsWith('$') && part.endsWith('$')) {
    const displayMode = part.startsWith('$$') && part.endsWith('$$');
    const latex = part.slice(displayMode ? 2 : 1, displayMode ? -2 : -1);
    try {
      const html = katexRenderer?.renderToString(latex, { displayMode, throwOnError: false, output: 'html' });
      if (html) return <span key={index} className={displayMode ? 'block overflow-x-auto py-1' : 'inline-block'} dangerouslySetInnerHTML={{ __html: html }} />;
    } catch { /* KaTeX unavailable or malformed: keep the source readable below. */ }
    return <code key={index} className="rounded bg-black/20 px-1 text-amber-100">{latex}</code>;
  }
  if (part.startsWith('**') && part.endsWith('**')) return <strong key={index} className="font-semibold text-emerald-100">{part.slice(2, -2)}</strong>;
  if (part.startsWith('`') && part.endsWith('`')) return <code key={index} className="rounded bg-black/25 px-1.5 py-0.5 text-amber-100">{part.slice(1, -1)}</code>;
  if (part.startsWith('*') && part.endsWith('*')) return <em key={index}>{part.slice(1, -1)}</em>;
  return <React.Fragment key={index}>{part}</React.Fragment>;
});

const MarkdownNotes: React.FC<{ text: string; katexRenderer?: KatexRenderer | null }> = ({ text, katexRenderer }) => (
  <div className="space-y-2 font-mono text-[13px] leading-6 text-emerald-50 sm:text-sm">
    {text.split('\n').map((raw, index) => {
      const line = raw.trimEnd();
      if (!line) return <div key={index} className="h-1" />;
      if (line.startsWith('### ')) return <h3 key={index} className="pt-2 text-base font-bold text-white">{inline(line.slice(4), katexRenderer)}</h3>;
      if (line.startsWith('## ')) return <h2 key={index} className="pt-3 text-lg font-bold text-white">{inline(line.slice(3), katexRenderer)}</h2>;
      if (line.startsWith('# ')) return <h1 key={index} className="mb-3 text-xl font-bold tracking-wide text-white">{inline(line.slice(2), katexRenderer)}</h1>;
      if (/^[-*] /.test(line)) return <div key={index} className="flex gap-2"><span className="text-emerald-300">•</span><span>{inline(line.slice(2), katexRenderer)}</span></div>;
      if (/^\d+\. /.test(line)) return <div key={index} className="pl-1">{inline(line, katexRenderer)}</div>;
      if (line.startsWith('> ')) return <blockquote key={index} className="border-l-2 border-amber-200/60 pl-3 text-emerald-100/75">{inline(line.slice(2), katexRenderer)}</blockquote>;
      return <p key={index}>{inline(line, katexRenderer)}</p>;
    })}
  </div>
);

const Blackboard: React.FC<{ notes: string; topic: string; katexRenderer?: KatexRenderer | null }> = ({ notes, topic, katexRenderer }) => {
  const scrollRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [metrics, setMetrics] = useState({ top: 0, height: 48 });

  const updateThumb = () => {
    const el = scrollRef.current;
    const track = trackRef.current;
    if (!el || !track) return;
    const trackHeight = track.clientHeight;
    const height = Math.max(48, trackHeight * Math.min(1, el.clientHeight / Math.max(el.scrollHeight, 1)));
    const travel = Math.max(0, trackHeight - height);
    const ratio = el.scrollHeight <= el.clientHeight ? 0 : el.scrollTop / (el.scrollHeight - el.clientHeight);
    setMetrics({ height, top: travel * ratio });
  };

  useEffect(() => {
    updateThumb();
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    requestAnimationFrame(updateThumb);
  }, [notes]);

  const moveToPointer = (clientY: number) => {
    const el = scrollRef.current;
    const track = trackRef.current;
    if (!el || !track) return;
    const rect = track.getBoundingClientRect();
    const travel = Math.max(1, rect.height - metrics.height);
    const thumbTop = Math.min(travel, Math.max(0, clientY - rect.top - metrics.height / 2));
    el.scrollTop = (thumbTop / travel) * Math.max(0, el.scrollHeight - el.clientHeight);
  };

  return (
    <section className="relative mx-4 mt-3 min-h-[270px] flex-[0_0_43%] overflow-hidden rounded-[26px] border-[7px] border-[#72543c] bg-[#173d34] shadow-[inset_0_0_38px_rgba(0,0,0,0.34),0_12px_30px_rgba(59,42,29,0.18)]">
      <div className="pointer-events-none absolute inset-x-6 top-3 flex items-center justify-between text-[10px] font-semibold uppercase tracking-[0.2em] text-emerald-100/45">
        <span>{topic}</span><span>课堂笔记</span>
      </div>
      <div ref={scrollRef} onScroll={updateThumb} className="no-scrollbar absolute inset-0 overflow-y-auto px-6 pb-8 pr-10 pt-11">
        <MarkdownNotes text={notes} katexRenderer={katexRenderer} />
      </div>
      <div
        ref={trackRef}
        onPointerDown={event => { dragging.current = true; event.currentTarget.setPointerCapture(event.pointerId); moveToPointer(event.clientY); }}
        onPointerMove={event => { if (dragging.current) moveToPointer(event.clientY); }}
        onPointerUp={event => { dragging.current = false; event.currentTarget.releasePointerCapture(event.pointerId); }}
        onPointerCancel={() => { dragging.current = false; }}
        className="absolute bottom-5 right-3 top-10 w-4 touch-none rounded-full bg-black/15 p-[5px]"
        aria-label="拖动黑板笔记滚动条"
      >
        <div className="absolute left-[5px] right-[5px] rounded-full bg-emerald-100/45 shadow-sm" style={{ height: metrics.height, top: metrics.top }} />
      </div>
    </section>
  );
};

const CharacterStudyRoom: React.FC<Props> = ({ characters, initialCharId, apiConfig, userProfile, katexRenderer, addToast, onBack }) => {
  const study = useCharacterStudy({ apiConfig, userProfile });
  const [topic, setTopic] = useState('');
  const [selectedCharId, setSelectedCharId] = useState(initialCharId || characters[0]?.id || '');
  const [teaching, setTeaching] = useState('');
  const [allowQuestion, setAllowQuestion] = useState(true);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const activeChar = useMemo(() => characters.find(char => char.id === study.activeSession?.charId), [characters, study.activeSession?.charId]);

  useEffect(() => {
    if (!selectedCharId && characters[0]) setSelectedCharId(characters[0].id);
  }, [characters, selectedCharId]);

  useEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [study.activeSession?.turns.length, study.busy]);

  const handleStart = async () => {
    const char = characters.find(item => item.id === selectedCharId);
    if (!char || !topic.trim()) return addToast('请选择学生并填写学习主题', 'info');
    try { await study.start(char, topic.trim()); } catch (error) { addToast(error instanceof Error ? error.message : '课堂创建失败', 'error'); }
  };

  const handleTeach = async () => {
    if (!activeChar || !teaching.trim()) return;
    const text = teaching;
    setTeaching('');
    try { await study.teach(activeChar, text, allowQuestion); } catch (error) {
      setTeaching(text);
      addToast(error instanceof Error ? error.message : '回复生成失败', 'error');
    }
  };

  const handleExportNotes = async () => {
    const session = study.activeSession;
    if (!session) return;
    try {
      const result = await shareOrDownloadFile({
        content: session.notesMarkdown,
        fileName: characterStudyMarkdownFileName(session.topic),
        mimeType: 'text/markdown;charset=utf-8',
        shareTitle: `课堂笔记：${session.topic}`,
      });
      addToast(result === 'shared' ? '已打开笔记分享' : '课堂笔记已导出', 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : '课堂笔记导出失败', 'error');
    }
  };

  if (!study.activeSession) {
    return (
      <div className="flex h-full flex-col bg-[#f7f4ed] text-slate-800">
        <header className="shrink-0 border-b border-stone-200/80 bg-[#f7f4ed]/95 px-4 pb-3 backdrop-blur" style={{ paddingTop: 'calc(var(--safe-top) + 10px)' }}>
          <div className="flex items-center gap-3">
            <button onClick={onBack} className="rounded-full p-2 transition active:scale-90" aria-label="返回自习室"><ArrowLeft size={22} /></button>
            <div><h1 className="font-serif text-xl font-bold">角色自习室</h1><p className="text-xs text-stone-500">这一次，换你来讲</p></div>
          </div>
        </header>
        <main className="no-scrollbar flex-1 space-y-5 overflow-y-auto p-5 pb-10">
          <section className="rounded-[28px] bg-[#183d35] p-5 text-white shadow-lg shadow-emerald-950/10">
            <div className="mb-5 flex items-start gap-3"><div className="rounded-2xl bg-white/10 p-3"><ChalkboardTeacher size={26} /></div><div><h2 className="text-lg font-bold">开一堂费曼课</h2><p className="mt-1 text-sm leading-5 text-emerald-50/70">角色只根据你的讲解做笔记，并在易错处向你提问。</p></div></div>
            <label className="mb-2 block text-xs font-semibold tracking-wide text-emerald-100/65">今天要讲什么？</label>
            <input value={topic} onChange={event => setTopic(event.target.value)} placeholder="例如：为什么会有机会成本" className="w-full rounded-2xl border border-white/10 bg-black/15 px-4 py-3 text-sm text-white outline-none placeholder:text-white/35 focus:border-emerald-200/60" />
            <div className="mt-4 flex gap-3 overflow-x-auto pb-2 no-scrollbar">
              {characters.map(char => <button key={char.id} onClick={() => setSelectedCharId(char.id)} className={`min-w-[72px] rounded-2xl border p-2 transition ${selectedCharId === char.id ? 'border-emerald-200 bg-white/15' : 'border-white/10 bg-white/5 opacity-65'}`}><img src={char.avatar} alt="" className="mx-auto h-11 w-11 rounded-full object-cover" /><span className="mt-1.5 block truncate text-xs font-semibold">{char.name}</span></button>)}
            </div>
            <button onClick={handleStart} disabled={study.busy || !characters.length} className="mt-3 w-full rounded-2xl bg-[#f0c86e] py-3 text-sm font-bold text-[#18372f] transition active:scale-[0.98] disabled:opacity-45">{study.busy ? '正在准备座位…' : '邀请 TA 入座'}</button>
          </section>

          <div className="rounded-2xl border border-stone-200 bg-white/70 px-4 py-3 text-xs leading-5 text-stone-500">仅读取最近 50 条私聊以保持语境；课堂记录完全私密，不读取向量记忆，也不会写回聊天或长期记忆。</div>

          {study.sessions.length > 0 && <section><div className="mb-3 flex items-center gap-2"><BookOpenText size={18} /><h2 className="font-bold">最近的课堂</h2></div><div className="space-y-3">{study.sessions.map(session => {
            const char = characters.find(item => item.id === session.charId);
            return <div key={session.id} role="button" tabIndex={0} onClick={() => study.open(session)} onKeyDown={event => { if (event.key === 'Enter') study.open(session); }} className="flex w-full cursor-pointer items-center gap-3 rounded-2xl border border-stone-200 bg-white p-3 text-left shadow-sm transition active:scale-[0.99]"><img src={char?.avatar} alt="" className="h-11 w-11 rounded-full bg-stone-100 object-cover" /><div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">{session.topic}</div><div className="mt-1 text-xs text-stone-500">{char?.name || '已删除角色'} · {session.turns.length} 回合 · {session.status === 'completed' ? '已结束' : '进行中'}</div></div><button onClick={event => { event.stopPropagation(); if (window.confirm('删除这次私密课堂记录？')) void study.remove(session.id); }} className="rounded-full p-2 text-stone-400 hover:bg-stone-100" aria-label="删除课堂"><Trash size={17} /></button></div>;
          })}</div></section>}
        </main>
      </div>
    );
  }

  const session = study.activeSession;
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden bg-[#f7f4ed] text-slate-800">
      <header className="flex shrink-0 items-center gap-3 px-4 pb-2" style={{ paddingTop: 'calc(var(--safe-top) + 8px)' }}>
        <button onClick={study.close} disabled={study.busy} className="rounded-full p-2 active:scale-90 disabled:opacity-35" aria-label="返回课堂列表"><ArrowLeft size={21} /></button>
        <img src={activeChar?.avatar} alt="" className="h-9 w-9 rounded-full object-cover" />
        <div className="min-w-0 flex-1"><div className="truncate text-sm font-bold">给 {activeChar?.name || '角色'} 讲：{session.topic}</div><div className="truncate text-[11px] text-stone-500">{session.rationale}</div></div>
        <button onClick={() => void handleExportNotes()} className="flex items-center gap-1 rounded-full border border-stone-300 px-2.5 py-1.5 text-xs font-semibold text-stone-600" aria-label="导出课堂笔记"><DownloadSimple size={14} />导出</button>
        {session.status === 'active' && <button onClick={() => void study.finish()} disabled={study.busy} className="rounded-full border border-stone-300 px-3 py-1.5 text-xs font-semibold text-stone-600 disabled:opacity-35">结束</button>}
      </header>

      <Blackboard notes={session.notesMarkdown} topic={session.topic} katexRenderer={katexRenderer} />

      <section className="flex min-h-0 flex-1 flex-col">
        <div ref={transcriptRef} className="no-scrollbar flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div className="flex gap-2.5"><img src={activeChar?.avatar} alt="" className="mt-0.5 h-8 w-8 rounded-full object-cover" /><div className="max-w-[82%] rounded-2xl rounded-tl-md bg-white px-4 py-3 text-sm leading-6 shadow-sm">{session.opening}</div></div>
          {session.turns.map(turn => <React.Fragment key={turn.id}>
            <div className="flex justify-end"><div className="max-w-[84%] rounded-2xl rounded-tr-md bg-[#d9eadf] px-4 py-3 text-sm leading-6">{turn.userText}</div></div>
            <div className="flex gap-2.5"><img src={activeChar?.avatar} alt="" className="mt-0.5 h-8 w-8 rounded-full object-cover" /><div className="max-w-[82%] space-y-2 rounded-2xl rounded-tl-md bg-white px-4 py-3 text-sm leading-6 shadow-sm">{turn.beginnerThinking && <ThinkingChainBlock chain={turn.beginnerThinking} styleId={activeChar?.thinkingChainStyle} customColors={activeChar?.thinkingChainCustomColors} />}<p>{turn.charResponse}</p>{turn.question && <div className="rounded-xl bg-amber-50 px-3 py-2 text-amber-900"><span className="mr-1 font-bold">提问：</span>{turn.question}</div>}</div></div>
          </React.Fragment>)}
          {study.busy && <div className="flex items-center gap-2 text-xs text-stone-500"><span className="h-2 w-2 animate-pulse rounded-full bg-emerald-600" />{activeChar?.name} 正在整理笔记…</div>}
          {session.status === 'completed' && <div className="rounded-2xl border border-stone-200 bg-white/70 p-4 text-center text-sm text-stone-500">这堂课已结束。笔记仍保存在本机，没有写回聊天或记忆。</div>}
        </div>

        {session.status === 'active' && <div className="shrink-0 border-t border-stone-200 bg-[#f7f4ed]/95 px-4 pb-[calc(var(--safe-bottom)+12px)] pt-3 backdrop-blur">
          <div className="mb-2 flex items-center justify-between"><span className="text-xs font-semibold text-stone-500">继续用自己的话讲</span><label className="flex cursor-pointer items-center gap-2 text-xs text-stone-600"><span>允许这回合提问</span><input type="checkbox" checked={allowQuestion} onChange={event => setAllowQuestion(event.target.checked)} className="h-4 w-4 accent-emerald-700" /></label></div>
          <div className="flex items-end gap-2"><textarea value={teaching} onChange={event => setTeaching(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void handleTeach(); } }} placeholder="讲一句、一个例子，或回答刚才的问题…" rows={2} className="max-h-28 min-h-[52px] flex-1 resize-none rounded-2xl border border-stone-200 bg-white px-4 py-3 text-sm outline-none focus:border-emerald-600" /><button onClick={() => void handleTeach()} disabled={study.busy || !teaching.trim()} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[#183d35] text-white transition active:scale-90 disabled:opacity-35" aria-label="发送讲解"><PaperPlaneTilt size={21} weight="fill" /></button></div>
        </div>}
      </section>
    </div>
  );
};

export default CharacterStudyRoom;
