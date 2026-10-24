import React, { useEffect, useRef, useState } from 'react';
import type { APIConfig, CharacterProfile, UserProfile } from '../../types';
import { copyTextToClipboard } from '../../utils/clipboard';
import { countSideStoryCharacters, generateSideStory, sideStoryErrorMessage, type SideStoryStage } from '../../utils/sideStoryCreation';
import type { GroupSideStorySource } from '../../utils/groupSideStory';
import { loadStoryMaskWords, saveStoryMaskWords, splitStoryMaskedText } from '../../utils/sideStoryMask';
import Modal from '../os/Modal';

type Props = { user: UserProfile; api: APIConfig; onClose: () => void } & (
    { char: CharacterProfile; group?: never; isCurrentCharacter: (id: string) => boolean; isCurrentGroup?: never }
    | { group: GroupSideStorySource; char?: never; isCurrentGroup: (id: string) => boolean; isCurrentCharacter?: never }
);
const stageText: Record<SideStoryStage, string> = {
    history: '正在准备聊天背景…', context: '正在整理角色设定与世界书…',
    http: '正在等待模型返回…', headers: '已连接，正在等待正文…', body: '正在写作…',
};

/** Small React-only Markdown reader. All model text is escaped by React; no raw HTML or links execute. */
const MaskedText: React.FC<{ text: string; words: string[]; streaming?: boolean }> = ({ text, words, streaming = false }) => <>{splitStoryMaskedText(text, words, streaming).map((part, index) => part.kind === 'text'
    ? <React.Fragment key={index}>{part.text}</React.Fragment>
    : <span key={index} aria-hidden="true" data-story-blank="" style={{ display: 'inline-block', width: `${part.widthEm}em`, maxWidth: '100%', height: '1em', verticalAlign: '-0.08em', userSelect: 'none' }} />)}</>;
const inline = (line: string, words: string[], streaming = false) => line.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`|\[[^\]]+\]\([^)]+\))/g).map((part, index, parts) => {
    const last = streaming && index === parts.length - 1;
    if (part.startsWith('**') && part.endsWith('**')) return <strong key={index}><MaskedText text={part.slice(2, -2)} words={words} streaming={last} /></strong>;
    if (part.startsWith('*') && part.endsWith('*')) return <em key={index}><MaskedText text={part.slice(1, -1)} words={words} streaming={last} /></em>;
    if (part.startsWith('`') && part.endsWith('`')) return <code key={index} className="rounded bg-slate-100 px-1"><MaskedText text={part.slice(1, -1)} words={words} streaming={last} /></code>;
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part);
    if (link) return <span key={index}><MaskedText text={`${link[1]}（${link[2]}）`} words={words} streaming={last} /></span>;
    return <React.Fragment key={index}><MaskedText text={part} words={words} streaming={last} /></React.Fragment>;
});
const StoryText: React.FC<{ text: string; words: string[]; streaming: boolean }> = ({ text, words, streaming }) => {
    let fenced = false;
    const lines = text.split('\n');
    return <div className="space-y-2 break-words text-sm leading-7 text-slate-800">
        {lines.map((line, index) => {
            const last = streaming && index === lines.length - 1;
            if (/^\s*```/.test(line)) { fenced = !fenced; return <div key={index} className="h-1" />; }
            if (fenced) return <pre key={index} className="overflow-x-auto whitespace-pre-wrap rounded bg-slate-100 px-2 font-mono text-xs"><MaskedText text={line || ' '} words={words} streaming={last} /></pre>;
            if (!line.trim()) return <div key={index} className="h-2" />;
            const heading = /^(#{1,3})\s+(.+)$/.exec(line);
            if (heading) return <h4 key={index} className={`font-bold ${heading[1].length === 1 ? 'text-lg' : 'text-base'}`}>{inline(heading[2], words, last)}</h4>;
            if (/^\s*>\s?/.test(line)) return <blockquote key={index} className="border-l-2 border-fuchsia-300 pl-3 text-slate-600">{inline(line.replace(/^\s*>\s?/, ''), words, last)}</blockquote>;
            if (/^\s*[-*]\s+/.test(line)) return <p key={index} className="pl-3">• {inline(line.replace(/^\s*[-*]\s+/, ''), words, last)}</p>;
            return <p key={index} className="whitespace-pre-wrap">{inline(line, words, last)}</p>;
        })}
    </div>;
};

const SideStoryModal: React.FC<Props> = ({ char, group, user, api, isCurrentCharacter, isCurrentGroup, onClose }) => {
    const sourceId = group?.group.id || char!.id;
    const isCurrent = () => group ? !!isCurrentGroup?.(group.group.id) : !!isCurrentCharacter?.(char!.id);
    const [request, setRequest] = useState('');
    const [text, setText] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [copied, setCopied] = useState(false);
    const [incomplete, setIncomplete] = useState(false);
    const [stage, setStage] = useState<SideStoryStage>('history');
    const [elapsed, setElapsed] = useState(0);
    const [maskWords, setMaskWords] = useState(loadStoryMaskWords);
    const [newMaskWord, setNewMaskWord] = useState('');
    const [maskOn, setMaskOn] = useState(false);
    const [screenshotView, setScreenshotView] = useState(false);
    const controller = useRef<AbortController | null>(null);
    const clock = useRef<ReturnType<typeof setInterval> | null>(null);
    const generating = useRef(false);
    const requestId = useRef(0);
    const alive = useRef(true);
    const currentText = useRef('');
    const copyFeedbackTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const copyRequestId = useRef(0);

    const changeMaskWords = (next: string[]) => { setMaskWords(next); saveStoryMaskWords(next); };
    const addMaskWord = () => {
        if (!newMaskWord.trim()) return;
        if (!maskWords.includes(newMaskWord)) changeMaskWords([...maskWords, newMaskWord]);
        setNewMaskWord('');
    };

    const resetCopyFeedback = () => {
        const id = ++copyRequestId.current;
        if (copyFeedbackTimer.current) clearTimeout(copyFeedbackTimer.current);
        copyFeedbackTimer.current = null;
        setCopied(false);
        return id;
    };

    useEffect(() => {
        alive.current = true;
        return () => {
            alive.current = false;
            requestId.current++;
            controller.current?.abort();
            if (clock.current) clearInterval(clock.current);
        };
    }, []);

    useEffect(() => {
        setCopied(false);
        return () => {
            copyRequestId.current++;
            if (copyFeedbackTimer.current) clearTimeout(copyFeedbackTimer.current);
            copyFeedbackTimer.current = null;
        };
    }, [sourceId]);

    const cancel = () => {
        requestId.current++;
        controller.current?.abort();
        controller.current = null;
        if (clock.current) clearInterval(clock.current);
        clock.current = null;
        generating.current = false;
        setBusy(false);
    };
    const close = () => { resetCopyFeedback(); cancel(); onClose(); };
    const stop = () => { cancel(); setIncomplete(true); setError('已停止，本轮未完成；已收到的正文仍可复制或继续写。'); };

    const generate = async (mode: 'replace' | 'continue') => {
        if (generating.current || !request.trim() || !isCurrent()) return;
        if (mode === 'continue' && !currentText.current) return;
        resetCopyFeedback();
        generating.current = true;
        const id = ++requestId.current;
        const abort = new AbortController();
        controller.current = abort;
        const previous = mode === 'continue' ? currentText.current : '';
        if (mode === 'replace') { currentText.current = ''; setText(''); }
        setBusy(true); setError(''); setIncomplete(false); setStage('history'); setElapsed(0);
        const started = Date.now();
        clock.current = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
        try {
            const result = await generateSideStory({ char, group, user, api, request, previous, signal: abort.signal,
                stillCurrent: isCurrent,
                onStage: next => { if (alive.current && requestId.current === id) setStage(next); },
                onText: segment => {
                    if (!alive.current || requestId.current !== id || !isCurrent()) return;
                    const nextText = previous + segment;
                    if (currentText.current !== nextText) resetCopyFeedback();
                    currentText.current = nextText;
                    setText(currentText.current);
                },
            });
            if (alive.current && requestId.current === id && isCurrent()) {
                const nextText = previous + result.text;
                if (currentText.current !== nextText) resetCopyFeedback();
                currentText.current = nextText;
                setText(currentText.current);
                setIncomplete(!result.complete);
                if (!result.complete) setError('本轮未确认完整结束，已收到的正文已保留。可手动继续写。');
            }
        } catch (cause) {
            if (alive.current && requestId.current === id && !abort.signal.aborted) {
                setIncomplete(true);
                setError(`${sideStoryErrorMessage(cause)} 已收到的正文仍在此页。`);
            }
        } finally {
            if (alive.current && requestId.current === id) {
                if (clock.current) clearInterval(clock.current);
                clock.current = null; controller.current = null; generating.current = false; setBusy(false);
            }
        }
    };

    const copyFullText = async () => {
        const id = resetCopyFeedback();
        const copiedText = currentText.current;
        const success = await copyTextToClipboard(copiedText);
        if (!alive.current || copyRequestId.current !== id || !isCurrent() || currentText.current !== copiedText) return;
        if (!success) { setError('复制全文失败，请重试'); return; }
        setError(previous => previous === '复制全文失败，请重试' ? '' : previous);
        setCopied(true);
        copyFeedbackTimer.current = setTimeout(() => {
            if (alive.current && copyRequestId.current === id) setCopied(false);
            copyFeedbackTimer.current = null;
        }, 2500);
    };

    const reading = maskOn && screenshotView && !!text && maskWords.length > 0;
    const activeWords = maskOn ? maskWords : [];
    return <Modal isOpen title={<MaskedText text={`${group?.group.name || char!.name} · 番外创作`} words={activeWords} />} onClose={close} footer={<button type="button" onClick={close} className="w-full rounded-2xl bg-slate-100 px-4 py-3 font-bold text-slate-600">丢弃并关闭</button>}>
        <div className="flex flex-col gap-3">
            {!reading && <>
            <p className="text-xs text-slate-500">独立非正史创作。关闭、切{group ? '群' : '角色'}或刷新即丢弃；需要留存请手动复制全文。</p>
            <textarea aria-label="番外创作需求" value={request} onChange={event => {
                if (busy) { cancel(); setIncomplete(true); }
                setRequest(event.target.value); setError('');
            }} placeholder="写下题材、视角、文风、篇幅或任何想看的番外…" rows={7} className="max-h-[50vh] min-h-40 w-full resize-y overflow-y-auto rounded-2xl border border-slate-200 p-3 text-sm outline-none focus:border-fuchsia-400" />
            <p className="text-right text-xs text-slate-400">需求 {request.length.toLocaleString()} 字符</p>
            <details className="rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-600">
                <summary className="cursor-pointer font-bold">指定词打码 · 管理词表</summary>
                <p className="mt-2 text-slate-500">只用于番外截图留白。词表保存在本机；复制全文仍保留原文。</p>
                <div className="mt-2 flex gap-2">
                    <input aria-label="新增打码词" value={newMaskWord} onChange={event => setNewMaskWord(event.target.value)} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); addMaskWord(); } }} className="min-w-0 flex-1 rounded-lg border border-slate-200 px-2 py-2" placeholder="输入要留白的精确词串" />
                    <button type="button" onClick={addMaskWord} disabled={!newMaskWord.trim()} className="shrink-0 rounded-lg bg-fuchsia-100 px-3 py-2 font-bold text-fuchsia-700 disabled:opacity-50">添加</button>
                </div>
                {!!maskWords.length && <div className="mt-2 max-h-28 overflow-y-auto space-y-1">{maskWords.map(word => <div key={word} className="flex items-center justify-between gap-2"><span className="min-w-0 break-all">{word}</span><button type="button" aria-label={`删除打码词 ${word}`} onClick={() => changeMaskWords(maskWords.filter(item => item !== word))} className="shrink-0 text-slate-500">删除</button></div>)}</div>}
                {!!maskWords.length && <button type="button" onClick={() => changeMaskWords([])} className="mt-2 text-rose-600">清空词表</button>}
            </details>
            </>}
            {!!maskWords.length && !!text && <div className="flex flex-wrap gap-2">
                <button type="button" role="switch" aria-checked={maskOn} aria-label="显示打码" onClick={() => { setMaskOn(value => !value); setScreenshotView(!maskOn); }} className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-700">{maskOn ? '关闭打码' : '显示打码 · 截图阅读'}</button>
                {maskOn && <button type="button" onClick={() => setScreenshotView(value => !value)} className="rounded-xl border border-slate-200 px-3 py-2 text-xs text-slate-600">{reading ? '编辑词表' : '返回截图阅读'}</button>}
            </div>}
            {busy && <p role="status" className="text-xs text-slate-600">{stageText[stage]} 已用时 {elapsed} 秒</p>}
            <div className="flex flex-wrap gap-2">
                {busy ? <button type="button" onClick={stop} className="rounded-xl bg-slate-100 px-3 py-2 text-sm font-bold">停止生成</button> : !reading && <>
                    <button type="button" disabled={!request.trim()} onClick={() => void generate('replace')} className="rounded-xl bg-fuchsia-100 px-3 py-2 text-sm font-bold text-fuchsia-700 disabled:opacity-50">{text ? '重新生成（替换）' : '生成番外'}</button>
                    {text && <button type="button" onClick={() => void generate('continue')} className="rounded-xl bg-fuchsia-100 px-3 py-2 text-sm font-bold text-fuchsia-700">继续写</button>}
                </>}
                {text && <button type="button" onClick={() => void copyFullText()} className={`rounded-xl border px-3 py-2 text-sm ${copied ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-slate-200'}`}>{copied ? '复制成功' : '复制全文'}</button>}
            </div>
            {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-xs text-rose-600">{error}</p>}
            {text && <section aria-label="番外正文" className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="mb-3 text-xs text-slate-500">当前正文 {countSideStoryCharacters(text).toLocaleString()} 字{incomplete ? ' · 本轮未完成' : ''}。篇幅以实际字数为准，不足时可手动继续写。</p>
                <StoryText text={text} words={activeWords} streaming={busy} />
            </section>}
        </div>
    </Modal>;
};

export default SideStoryModal;
