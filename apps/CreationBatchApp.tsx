import React, { useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import TokenImg from '../components/os/TokenImg';
import { ArrowUp, CaretLeft, FileCode, PenNib } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { useLocalBackHandler } from '../hooks/useLocalBackHandler';
import { settleApiDiagnostic } from '../utils/apiCallDiagnostics';
import { AppID, type CharacterProfile } from '../types';
import HtmlCard from '../components/chat/HtmlCard';
import SideStoryMaskEditor, { useSideStoryMaskEditor } from '../components/chat/SideStoryMaskEditor';
import { cardCreationErrorMessage, generateCardDraft, type CardDraft } from '../utils/cardCreation';
import { countSideStoryCharacters, generateSideStory, sideStoryErrorMessage } from '../utils/sideStoryCreation';
import { splitStoryMaskedText } from '../utils/sideStoryMask';
import { copyTextToClipboard } from '../utils/clipboard';
import { isManualRelayEnabled, subscribeManualRelay } from '../utils/manualModelRelay';
import { resolveDialogueApi } from '../utils/characterApi';
import { withCreationRunLock } from '../utils/creationRunLock';
import { isChatReplyGenerating } from '../utils/chatGenEvents';
import { DB } from '../utils/db';

type Status = 'waiting' | 'working' | 'done' | 'failed' | 'interrupted';
type Item = { id: string; identity: string; name: string; status: Status; story?: string; card?: CardDraft; error?: string };
type Batch = { instruction: string; items: Item[] };
type Plan = { batch: Batch; ids: string[] };
type Round = { kind: 'retry' | 'resume'; ids: Set<string> };
type RunAction = { kind: 'first' | 'resume' } | { kind: 'retry'; id?: string } | { kind: 'relay-retry'; plan: Plan };
const label: Record<Status, string> = { waiting: '等待', working: '生成中', done: '完成', failed: '失败', interrupted: '中断' };
const button = 'rounded-xl border border-slate-200 px-3 py-2 text-sm font-semibold disabled:opacity-40 dark:border-slate-600';
const primary = 'rounded-xl bg-violet-700 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40';
const field = 'rounded-2xl border border-slate-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-800';
const identity = (char: CharacterProfile) => JSON.stringify([char.id, char.name, char.systemPrompt]);
const resumable = (item: Item) => item.status === 'waiting' || item.status === 'interrupted';
const stopped = () => new DOMException('创作已中断', 'AbortError');

export default function CreationBatchApp({ kind, scrollTopRef }: { kind: 'story' | 'html'; scrollTopRef?: React.Ref<() => void> }) {
    const html = kind === 'html';
    const appId = html ? AppID.HtmlCreationBatch : AppID.SideStoryBatch;
    const title = html ? 'HTML 创作' : '番外创作';
    const Icon = html ? FileCode : PenNib;
    const { characters, apiConfig, userProfile, closeApp, activeApp, sysOperation, addToast } = useOS();
    const mainRef = useRef<HTMLElement>(null);
    const scrollToTop = useCallback(() => {
        const main = mainRef.current;
        if (activeApp !== appId || !main?.isConnected) return;
        main.scrollTo({ top: 0, behavior: window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    }, [activeApp, appId]);
    useImperativeHandle(scrollTopRef, () => scrollToTop, [scrollToTop]);
    const allowed = characters;
    const names = new Map<string, number>();
    for (const char of allowed) names.set(char.name, (names.get(char.name) || 0) + 1);
    const displayName = (name: string, id: string) => names.get(name)! > 1 ? `${name} · ${id.slice(-6)}` : name;
    const [selection, setSelection] = useState<string[]>([]);
    const [instruction, setInstruction] = useState('');
    const [batch, setBatch] = useState<Batch | null>(null);
    const [plan, setPlan] = useState<Plan | null>(null);
    const [round, setRound] = useState<Round | null>(null);
    const [detail, setDetail] = useState('');
    const [running, setRunning] = useState(false);
    const [phase, setPhase] = useState('');
    const [notice, setNotice] = useState('');
    const [relay, setRelay] = useState(isManualRelayEnabled);
    const [masked, setMasked] = useState(false);
    const [maskEditorOpen, setMaskEditorOpen] = useState(false);
    const maskEditor = useSideStoryMaskEditor();
    const maskButtonRef = useRef<HTMLButtonElement>(null);
    const hasMaskRules = maskEditor.rules.length > 0;
    const showMasked = masked && hasMaskRules;
    useEffect(() => { if (!hasMaskRules) setMasked(false); }, [hasMaskRules]);
    const closeMaskEditor = (finishEdit = false) => {
        if (finishEdit) maskEditor.finishEdit();
        maskEditor.reset();
        setMaskEditorOpen(false);
        maskButtonRef.current?.focus({ preventScroll: true });
    };
    useLocalBackHandler(() => { closeMaskEditor(); return true; }, 30, !html && maskEditorOpen && activeApp === appId);
    const [confirmNew, setConfirmNew] = useState(false);
    const batchRef = useRef<Batch | null>(null);
    const planRef = useRef<Plan | null>(null);
    const resultHeading = useRef<HTMLParagraphElement>(null);
    const runner = useRef<AbortController | null>(null);
    const mounted = useRef(false);
    const environment = useRef({ activeApp, apiConfig, userProfile, sysOperation });
    environment.current = { activeApp, apiConfig, userProfile, sysOperation };
    const replace = (next: Batch | null) => {
        batchRef.current = next;
        setBatch(next && { ...next, items: [...next.items] });
    };
    const replacePlan = (next: Plan | null) => {
        planRef.current = next;
        setPlan(next);
    };
    const clear = () => {
        setMaskEditorOpen(false);
        maskEditor.reset();
        runner.current?.abort();
        replace(null);
        setInstruction('');
        setSelection([]);
        replacePlan(null);
        setRound(null);
        setDetail('');
        setConfirmNew(false);
    };
    useEffect(() => {
        mounted.current = true;
        const reset = () => clear();
        window.addEventListener('personal-memory-reset', reset);
        let lastRelay = isManualRelayEnabled();
        const unsubscribeRelay = subscribeManualRelay(() => {
            const next = isManualRelayEnabled();
            if (next !== lastRelay) runner.current?.abort();
            lastRelay = next;
            setRelay(next);
        });
        return () => {
            mounted.current = false;
            runner.current?.abort();
            unsubscribeRelay();
            window.removeEventListener('personal-memory-reset', reset);
        };
    }, []);
    useEffect(() => {
        if (sysOperation.status !== 'idle' || activeApp !== appId) clear();
    }, [sysOperation.status, activeApp, appId]);
    useEffect(() => {
        if (round) resultHeading.current?.focus({ preventScroll: true });
    }, [round]);

    const run = async (current: Batch | null, action: RunAction) => {
        if (!current || runner.current || batchRef.current !== current || !mounted.current
            || environment.current.activeApp !== appId || environment.current.sysOperation.status !== 'idle') return;
        const retry = action.kind === 'retry' || action.kind === 'relay-retry';
        if (action.kind === 'relay-retry' ? planRef.current !== action.plan : !!planRef.current) return;
        const ids = current.items.filter(row => {
            if (action.kind === 'relay-retry') return row.status === 'failed' && action.plan.ids.includes(row.id);
            if (action.kind === 'retry') return row.status === 'failed' && (!action.id || row.id === action.id);
            return resumable(row);
        }).map(row => row.id);
        if (!ids.length) return;
        const controller = new AbortController();
        runner.current = controller;
        setRunning(true);
        setNotice('');
        setPhase('');
        if (action.kind !== 'relay-retry') {
            setDetail(ids[0]);
            setMasked(false);
            if (action.kind !== 'first') {
                setRound({ kind: action.kind, ids: new Set(ids) });
                scrollToTop();
            }
        }
        const manual = isManualRelayEnabled();
        const { apiConfig: api, userProfile: user } = environment.current;
        const check = () => {
            if (controller.signal.aborted || !mounted.current || batchRef.current !== current
                || environment.current.activeApp !== appId || environment.current.sysOperation.status !== 'idle') throw stopped();
            if (environment.current.apiConfig !== api || environment.current.userProfile !== user
                || isManualRelayEnabled() !== manual) throw new Error('生成来源或用户资料已改变，请手动继续');
        };
        const update = (id: string, patch: Partial<Item>) => {
            if (!mounted.current || batchRef.current !== current) return;
            const i = current.items.findIndex(item => item.id === id);
            current.items[i] = { ...current.items[i], ...patch };
            setBatch({ ...current, items: [...current.items] });
        };
        let consumed = 0;
        try {
            await withCreationRunLock('batch', controller.signal, async () => {
                for (const id of ids) {
                    check();
                    const item = current.items.find(row => row.id === id);
                    if (!item || item.status === 'done' || item.status === 'working') { consumed++; continue; }
                    const char = await DB.getCharacter(id);
                    check();
                    if (!char || identity(char) !== item.identity) {
                        update(id, { status: 'failed', error: '角色已删除或身份已改变' });
                        consumed++;
                        continue;
                    }
                    if (!manual) {
                        const selected = resolveDialogueApi(api, char);
                        if (!selected.baseUrl || !selected.model) throw new Error('请先配置聊天 API，或开启外部接力');
                    }
                    if (isChatReplyGenerating(id)) {
                        update(id, { status: 'failed', error: '角色正在回复，稍后可重试' });
                        consumed++;
                        continue;
                    }
                    update(id, { status: 'working', error: undefined });
                    setPhase('准备素材');
                    let partial = '';
                    let diagnosticResult: unknown;
                    try {
                        const request = { char, user, api, request: current.instruction,
                            signal: controller.signal, meta: { appId, appName: title, relayPriority: 'user' as const },
                            onDiagnosticResult: (result: unknown) => { diagnosticResult = result; },
                            beforeRequest: async () => {
                                check();
                                const live = await DB.getCharacter(id);
                                check();
                                if (!live || identity(live) !== item.identity
                                    || JSON.stringify(resolveDialogueApi(api, live)) !== JSON.stringify(resolveDialogueApi(api, char))) {
                                    throw new Error('角色或角色 API 已改变，未发送请求');
                                }
                                if (isChatReplyGenerating(id)) throw new Error('角色正在回复，未发送请求');
                            },
                            onStage: (stage: string) => {
                                if (runner.current === controller && !controller.signal.aborted) setPhase(stage === 'history' || stage === 'context' ? '准备素材' : stage === 'parse' ? '检查卡片' : '生成中');
                            },
                        };
                        if (html) {
                            const card = await generateCardDraft(request);
                            check();
                            update(id, { status: 'done', card });
                        } else {
                            const result = await generateSideStory({ ...request, onText: text => {
                                if (controller.signal.aborted || runner.current !== controller) return;
                                partial = text;
                                update(id, { story: text });
                            } });
                            check();
                            update(id, { status: result.complete ? 'done' : 'failed', story: result.text, error: result.complete ? undefined : '正文未完成，可重试' });
                        }
                        settleApiDiagnostic(diagnosticResult, current.items.find(row => row.id === id)?.status === 'done' ? 'success' : 'failure', '批次结果已更新');
                    } catch (error) {
                        const interrupted = controller.signal.aborted || (error instanceof Error && error.name === 'AbortError');
                        settleApiDiagnostic(diagnosticResult, interrupted ? 'cancelled' : 'failure', '批次结果处理',
                            error instanceof Error ? error.message : '无法更新批次结果');
                        update(id, { status: interrupted ? 'interrupted' : 'failed', story: partial || item.story,
                            error: interrupted ? '请求已在本机中断' : (html ? cardCreationErrorMessage : sideStoryErrorMessage)(error) });
                        if (interrupted) throw error;
                        check();
                    }
                    consumed++;
                    if (manual) break;
                }
            });
        } catch (error) {
            if (mounted.current && batchRef.current === current) {
                setNotice(controller.signal.aborted ? '本机已停止等待；服务端可能仍在处理或计费。' : (html ? cardCreationErrorMessage : sideStoryErrorMessage)(error));
            }
        } finally {
            if (runner.current === controller) {
                runner.current = null;
                if (mounted.current) {
                    setRunning(false);
                    if (batchRef.current === current && retry) {
                        const remaining = manual && !controller.signal.aborted
                            ? ids.slice(consumed).filter(id => current.items.some(item => item.id === id && item.status === 'failed')) : [];
                        replacePlan(remaining.length ? { batch: current, ids: remaining } : null);
                    }
                }
            }
        }
    };

    const chosen = allowed.filter(char => selection.includes(char.id));
    const ready = true;
    const start = () => {
        if (runner.current || batchRef.current || !ready || !instruction.trim() || !chosen.length || sysOperation.status !== 'idle') return;
        const next: Batch = { instruction,
            items: chosen.map(char => ({ id: char.id, identity: identity(char), name: char.name, status: 'waiting' })) };
        replace(next);
        void run(next, { kind: 'first' });
    };
    const visible = batch?.items.filter(row => !round || round.ids.has(row.id)) ?? [];
    const item = visible.find(row => row.id === detail);
    const working = visible.findIndex(row => row.status === 'working');
    const failedCount = batch?.items.filter(row => row.status === 'failed').length ?? 0;
    const hasUnfinished = batch?.items.some(resumable);
    const roundLabel = round ? round.kind === 'retry' ? '本轮重试 · ' : '本轮继续 · ' : '';
    return <div className="flex h-full min-h-0 flex-col bg-slate-50 text-slate-800 dark:bg-slate-900 dark:text-slate-100">
        <header className="flex items-center gap-2 border-b border-slate-200 bg-white px-3 py-3 dark:border-slate-700 dark:bg-slate-800">
            <button type="button" aria-label="返回桌面" onClick={() => { runner.current?.abort(); closeApp(); }} className="rounded-xl p-2 hover:bg-slate-100 dark:hover:bg-slate-700"><CaretLeft size={20} /></button>
            <Icon size={23} className="text-violet-600 dark:text-violet-300" />
            <h1 className="min-w-0 flex-1 truncate text-base font-bold">{title}</h1>
            {!html && <button ref={maskButtonRef} type="button" aria-expanded={maskEditorOpen} aria-controls="creation-mask-editor"
                className={`${button} min-h-11 shrink-0`}
                onClick={() => maskEditorOpen ? closeMaskEditor() : setMaskEditorOpen(true)}>打码词</button>}
            <button type="button" aria-label="回到顶部" title="回到顶部" onClick={scrollToTop}
                className="grid h-11 w-11 shrink-0 place-items-center rounded-xl hover:bg-slate-100 focus-visible:outline-violet-600 dark:hover:bg-slate-700">
                <ArrowUp size={20} aria-hidden="true" />
            </button>
        </header>
        {!html && maskEditorOpen && <section id="creation-mask-editor" aria-label="管理打码词"
            className="max-h-[45%] shrink-0 overflow-y-auto border-b border-slate-200 bg-white px-4 py-3 dark:border-slate-700 dark:bg-slate-800"
            onKeyDown={event => {
                if (event.key === 'Escape' && !event.nativeEvent.isComposing) { event.stopPropagation(); closeMaskEditor(); }
            }}>
            <div className="mx-auto max-w-3xl">
                <div className="mb-2 flex items-center justify-between gap-2">
                    <h2 className="text-sm font-bold">打码词表</h2>
                    <button type="button" className={button} onClick={() => closeMaskEditor(showMasked)}>
                        {showMasked ? '返回截图阅读' : '关闭词表'}
                    </button>
                </div>
                <SideStoryMaskEditor editor={maskEditor} />
            </div>
        </section>}
        <main ref={mainRef} className="min-h-0 flex-1 overflow-y-auto px-3 pb-8 pt-4 sm:px-5">
            <div className="mx-auto grid w-full max-w-3xl gap-4">
                {!batch && <section className={`${field} grid gap-3`}>
                    <label className="grid gap-2 text-sm font-semibold">创作要求
                        <textarea rows={6} className="w-full min-w-0 resize-y rounded-xl border border-slate-200 bg-slate-50 p-3 text-base font-normal dark:border-slate-600 dark:bg-slate-900"
                            value={instruction} onChange={event => setInstruction(event.target.value)} placeholder={html ? '写下卡片内容、排版或样式要求' : '写下想看的情节、视角或篇幅'} />
                    </label>
                    <div className="flex flex-wrap items-center gap-2">
                        <span className="mr-auto text-sm font-semibold">角色（{chosen.length}/{allowed.length}）</span>
                        <button type="button" className={button} disabled={!ready || !allowed.length} onClick={() => setSelection(allowed.map(char => char.id))}>全选</button>
                        <button type="button" className={button} disabled={!chosen.length} onClick={() => setSelection([])}>取消全选</button>
                    </div>
                    {!allowed.length ? <p className="text-sm text-slate-500">当前没有可用角色</p>
                        : <div className="grid max-h-56 gap-1 overflow-y-auto sm:grid-cols-2">{allowed.map(char => <label key={char.id} className="flex min-w-0 items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 dark:bg-slate-900">
                            <input type="checkbox" checked={selection.includes(char.id)} onChange={event => setSelection(event.target.checked ? [...selection, char.id] : selection.filter(id => id !== char.id))} />
                            {char.avatar && <TokenImg src={char.avatar} alt="" className="h-7 w-7 shrink-0 rounded-full object-cover" />}
                            <span className="min-w-0 break-words text-sm">{displayName(char.name, char.id)}</span>
                        </label>)}</div>}
                    <button type="button" data-manual-relay-action className={primary} disabled={running || !ready || !chosen.length || !instruction.trim()} onClick={start}>开始依次生成（{chosen.length}）</button>
                    <p className="text-xs text-slate-500 dark:text-slate-400">离开应用、刷新或切换玩法后，指令和结果会丢弃。</p>
                </section>}
                {batch && <section className={`${field} grid gap-3`}>
                    <p ref={resultHeading} tabIndex={-1} role="status" className="min-w-0 break-words text-sm font-semibold">{roundLabel}{working >= 0
                        ? `第 ${working + 1}/${visible.length} 位 · ${visible[working].name} · ${phase}`
                        : `完成 ${visible.filter(row => row.status === 'done').length}/${visible.length} · 失败 ${visible.filter(row => row.status === 'failed').length} · 等待 ${visible.filter(row => row.status === 'waiting').length} · 中断 ${visible.filter(row => row.status === 'interrupted').length}`}</p>
                    {notice && <p role="status" className="break-words text-sm text-amber-700 dark:text-amber-300">{notice}</p>}
                    <div aria-label="按角色查看结果" className="grid max-h-52 gap-1 overflow-y-auto sm:grid-cols-2">{visible.map(row => <button type="button" key={row.id} aria-pressed={row.id === detail}
                        onClick={() => { setDetail(row.id); setMasked(false); }} className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-transparent bg-slate-50 px-3 py-2 text-left text-sm aria-pressed:border-violet-400 dark:bg-slate-900">
                        <span className="min-w-0 break-words">{displayName(row.name, row.id)}</span><span className="shrink-0 text-xs text-slate-500 dark:text-slate-400">{label[row.status]}</span>
                    </button>)}</div>
                    <div className="flex flex-wrap gap-2">
                        {running ? <button type="button" className={button} onClick={() => runner.current?.abort()}>停止</button> : <>
                            {plan?.batch === batchRef.current ? <>
                                <button type="button" data-manual-relay-action className={primary} onClick={() => void run(plan.batch, { kind: 'relay-retry', plan })}>继续重试下一位（余 {plan.ids.length}）</button>
                                <button type="button" className={button} onClick={() => {
                                    if (!runner.current && planRef.current === plan) replacePlan(null);
                                }}>结束本轮重试</button>
                            </> : <>
                                {hasUnfinished && <button type="button" data-manual-relay-action className={primary} onClick={() => void run(batchRef.current, { kind: 'resume' })}>{relay ? '继续下一位' : '继续未完成'}</button>}
                                {failedCount > 0 && <button type="button" data-manual-relay-action className={button} onClick={() => void run(batchRef.current, { kind: 'retry' })}>重试全部失败（{failedCount}）</button>}
                            </>}
                            <button type="button" className={button} onClick={() => setConfirmNew(value => !value)}>新建批次</button>
                            {confirmNew && <button type="button" className={button} onClick={clear}>丢弃本批并新建</button>}
                        </>}
                    </div>
                </section>}
                {item && <section className={`${field} min-w-0 overflow-hidden`}>
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                        <h2 className="mr-auto min-w-0 break-words font-bold">{showMasked ? '截图阅读' : displayName(item.name, item.id)}</h2>
                        {item.story && hasMaskRules && <button type="button" className={button} aria-pressed={showMasked} onClick={() => {
                            if (!showMasked && maskEditorOpen) closeMaskEditor();
                            setMasked(!showMasked);
                        }}>{showMasked ? '关闭打码' : '截图打码'}</button>}
                        {(item.card || item.story) && <button type="button" className={button} onClick={() => void copyTextToClipboard(item.card?.html || item.story || '').then(ok => addToast(ok ? '已复制' : '复制失败', ok ? 'success' : 'error'))}>{html ? '复制源码' : '复制原文'}</button>}
                        {!running && !plan && item.status === 'failed' && <button type="button" data-manual-relay-action className={button} onClick={() => void run(batchRef.current, { kind: 'retry', id: item.id })}>单独重试</button>}
                    </div>
                    {item.error && <p className="mb-2 break-words text-sm text-amber-700 dark:text-amber-300">{item.error}</p>}
                    {item.card && <div className="flex justify-center"><HtmlCard html={item.card.html} /></div>}
                    {item.story && <>
                        <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">{countSideStoryCharacters(item.story)} 字{item.status !== 'done' && ' · 未完成'}</p>
                        <div className="whitespace-pre-wrap break-words text-base leading-8">{showMasked ? splitStoryMaskedText(item.story, maskEditor.previewRules, item.status === 'working').map((part, i) =>
                            part.kind === 'blank' ? <span key={i} aria-label="已打码" className="inline-block" style={{ width: `${part.widthEm}em` }} /> : <React.Fragment key={i}>{part.text}</React.Fragment>) : item.story}</div>
                    </>}
                    {!item.card && !item.story && !item.error && <p className="text-sm text-slate-500">{label[item.status]}</p>}
                </section>}
            </div>
        </main>
    </div>;
}
