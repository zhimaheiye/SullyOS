import React, { useEffect, useRef, useState } from 'react';
import type { APIConfig, CharacterProfile, UserProfile } from '../../types';
import { cardCreationErrorMessage, generateCardDraft, publishCardDraft, type CardCreationStage, type CardDraft } from '../../utils/cardCreation';
import HtmlCard from './HtmlCard';
import Modal from '../os/Modal';

interface Props {
    char: CharacterProfile;
    user: UserProfile;
    api: APIConfig;
    isCurrentCharacter: (id: string) => boolean;
    onClose: () => void;
    onPublished: (id: string) => void;
}

const stageText: Record<CardCreationStage, string> = {
    history: '正在准备聊天背景…', context: '正在整理角色设定与世界书…',
    http: '正在等待模型返回…', headers: '已收到接口响应，正在读取内容…',
    body: '已收到内容，正在检查卡片结构…', parse: '正在检查卡片结构…',
};

const CardCreationModal: React.FC<Props> = ({ char, user, api, isCurrentCharacter, onClose, onPublished }) => {
    const [request, setRequest] = useState('');
    const [draft, setDraft] = useState<CardDraft | null>(null);
    const [busy, setBusy] = useState(false);
    const [publishing, setPublishing] = useState(false);
    const [error, setError] = useState('');
    const [stage, setStage] = useState<CardCreationStage>('history');
    const [elapsed, setElapsed] = useState(0);
    const controller = useRef<AbortController | null>(null);
    const clock = useRef<ReturnType<typeof setInterval> | null>(null);
    const generating = useRef(false);
    const requestId = useRef(0);
    const publishLock = useRef(false);
    const alive = useRef(true);

    useEffect(() => {
        // StrictMode replays setup after cleanup; the active mount must accept results again.
        alive.current = true;
        return () => {
            alive.current = false;
            requestId.current++;
            controller.current?.abort();
            if (clock.current) clearInterval(clock.current);
        };
    }, []);

    const cancelCurrent = () => {
        requestId.current++;
        controller.current?.abort();
        controller.current = null;
        if (clock.current) clearInterval(clock.current);
        clock.current = null;
        generating.current = false;
        setBusy(false);
    };

    const close = () => {
        if (publishLock.current) return;
        cancelCurrent();
        onClose();
    };

    const stop = () => {
        cancelCurrent();
        setError('已在本地停止等待；服务端是否完成未知。');
    };

    const generate = async () => {
        if (generating.current || publishLock.current || !request.trim() || !isCurrentCharacter(char.id)) return;
        generating.current = true;
        const id = ++requestId.current;
        controller.current?.abort();
        const abort = new AbortController();
        controller.current = abort;
        setBusy(true);
        setError('');
        setStage('history');
        setElapsed(0);
        const started = Date.now();
        clock.current = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
        try {
            const next = await generateCardDraft({
                char, user, api, request, signal: abort.signal, traceId: `card-${started}-${id}-${Math.random().toString(36).slice(2, 8)}`,
                onStage: nextStage => {
                    if (alive.current && requestId.current === id) setStage(nextStage);
                },
            });
            if (alive.current && requestId.current === id && isCurrentCharacter(char.id)) setDraft(next);
        } catch (cause) {
            if (alive.current && requestId.current === id && !abort.signal.aborted) {
                setError(cardCreationErrorMessage(cause));
            }
        } finally {
            if (alive.current && requestId.current === id) {
                if (clock.current) clearInterval(clock.current);
                clock.current = null;
                controller.current = null;
                generating.current = false;
                setBusy(false);
            }
        }
    };

    const publish = async () => {
        if (!draft || publishLock.current || busy || !isCurrentCharacter(char.id)) return;
        publishLock.current = true;
        setPublishing(true);
        setError('');
        try {
            await publishCardDraft(char.id, draft);
            if (alive.current) onPublished(char.id);
        } catch (cause) {
            publishLock.current = false;
            if (alive.current) {
                setPublishing(false);
                setError(cause instanceof Error ? `加入聊天失败：${cause.message}` : '加入聊天失败，请重试');
            }
        }
    };

    return <Modal isOpen title={`${char.name} · 卡片创作`} onClose={close} footer={<div className="flex w-full flex-col gap-2">
        {draft && <button type="button" disabled={publishing} onClick={() => void publish()} className="rounded-2xl bg-fuchsia-600 px-4 py-3 font-bold text-white disabled:opacity-50">{publishing ? '加入中…' : '加入主聊天'}</button>}
        <button type="button" disabled={publishing} onClick={close} className="rounded-2xl bg-slate-100 px-4 py-3 font-bold text-slate-600 disabled:opacity-50">丢弃返回</button>
    </div>}>
        <div className="flex flex-col gap-3">
            <p className="text-xs text-slate-500">描述想做的卡片。预览和重试都只保存在此页，加入主聊天后才发送。</p>
            <textarea aria-label="卡片内容需求" value={request} onChange={event => { cancelCurrent(); setRequest(event.target.value); setDraft(null); setError(''); }} placeholder="例如：做一张周末电影邀请函" rows={7} className="max-h-[50vh] min-h-40 w-full resize-y overflow-y-auto rounded-2xl border border-slate-200 p-3 text-sm outline-none focus:border-fuchsia-400" />
            <p className="text-right text-xs text-slate-400">已输入 {request.length.toLocaleString()} 字；模型能处理的上下文长度取决于当前 API，超出时请缩短需求后重试。</p>
            {busy && <p role="status" className="flex items-center gap-2 text-xs text-slate-600"><span aria-hidden="true" className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-fuchsia-200 border-t-fuchsia-600" />{stageText[stage]} 已用时 {elapsed} 秒</p>}
            {busy ? <button type="button" onClick={stop} className="rounded-2xl bg-slate-100 px-4 py-3 font-bold text-slate-600">停止生成</button>
                : <button type="button" disabled={publishing || !request.trim()} onClick={() => void generate()} className="rounded-2xl bg-fuchsia-100 px-4 py-3 font-bold text-fuchsia-700 disabled:opacity-50">{draft ? '重新生成' : '生成卡片'}</button>}
            {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-xs text-rose-600">{error}</p>}
            {draft && <div className="flex flex-col items-center gap-2"><HtmlCard html={draft.html} /></div>}
        </div>
    </Modal>;
};

export default CardCreationModal;
