import React, { useEffect, useState } from 'react';
import type { Message } from '../../types';
import Modal from '../os/Modal';
import { formatPositiveNegative, updateImagePromptCard } from '../../utils/imagePromptCard';

interface Props {
    message: Message;
    onSaved?: () => Promise<void> | void;
    onRegenerate?: (message: Message) => Promise<void>;
    compact?: boolean;
}

const ImagePromptCard: React.FC<Props> = ({ message, onSaved, onRegenerate, compact }) => {
    const [open, setOpen] = useState(false);
    const [summary, setSummary] = useState(message.content);
    const [fullPrompt, setFullPrompt] = useState(String(message.metadata?.imagePrompt?.fullPrompt || ''));
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const [copied, setCopied] = useState('');
    const isDate = message.metadata?.imagePrompt?.source === 'date';
    const negative = String(message.metadata?.imagePrompt?.negative || '');

    useEffect(() => {
        setSummary(message.content);
        setFullPrompt(String(message.metadata?.imagePrompt?.fullPrompt || ''));
    }, [message.content, message.metadata?.imagePrompt?.fullPrompt]);

    const copy = async (value: string, label: string) => {
        try { await navigator.clipboard.writeText(value); setCopied(`已复制${label}`); }
        catch { setError('复制失败，请长按文本手动复制'); }
    };
    const save = async () => {
        setBusy(true); setError('');
        try {
            await updateImagePromptCard(message, summary, fullPrompt, negative);
            await onSaved?.();
            setOpen(false);
        } catch (reason) { setError(reason instanceof Error ? reason.message : '保存失败，请重试'); }
        finally { setBusy(false); }
    };
    const regenerate = async () => {
        if (!onRegenerate) return;
        setBusy(true); setError('');
        try { await onRegenerate(message); }
        catch (reason) { setError(reason instanceof Error ? reason.message : '重新生成失败，请重试'); }
        finally { setBusy(false); }
    };
    return <>
        <button type="button" onClick={event => { event.stopPropagation(); setSummary(message.content); setFullPrompt(String(message.metadata?.imagePrompt?.fullPrompt || '')); setError(''); setCopied(''); setOpen(true); }}
            className={`block w-full text-left rounded-2xl border border-sky-200 bg-sky-50 px-4 py-3 text-slate-700 shadow-sm ${compact ? 'max-w-md mx-auto' : 'max-w-[260px]'}`}>
            <div className="text-xs font-bold text-sky-700">{isDate ? '本轮场景 · 画面记录' : '角色发来了一张照片'}</div>
            <div className="mt-1 text-sm leading-relaxed whitespace-pre-wrap break-words line-clamp-3">{message.content}</div>
            <div className="mt-2 text-[11px] text-sky-600">查看、编辑或复制提示词 ›</div>
        </button>
        <Modal isOpen={open} title={isDate ? '本轮场景 · 画面记录' : '角色发来了一张照片'} onClose={() => setOpen(false)}>
            <div className="max-h-[75dvh] overflow-y-auto overscroll-contain space-y-4 pb-4 text-slate-700">
                <label className="block text-sm font-bold">画面摘要
                    <textarea value={summary} onChange={event => setSummary(event.target.value)} className="mt-2 w-full min-h-24 rounded-xl border border-slate-200 p-3 text-sm font-normal resize-y" />
                </label>
                <button type="button" onClick={() => void copy(summary, '摘要')} className="text-xs text-sky-700">复制摘要</button>
                <label className="block text-sm font-bold">完整自然语言提示词
                    <textarea value={fullPrompt} onChange={event => setFullPrompt(event.target.value)} className="mt-2 w-full min-h-64 rounded-xl border border-slate-200 p-3 text-sm font-normal leading-relaxed resize-y" />
                </label>
                <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => void copy(fullPrompt, '完整提示词')} className="rounded-xl bg-sky-100 px-3 py-2 text-xs text-sky-800">复制完整提示词</button>
                    <button type="button" onClick={() => void copy(formatPositiveNegative(fullPrompt, negative), '正反向提示词')} className="rounded-xl bg-slate-100 px-3 py-2 text-xs">复制正向 / 反向</button>
                </div>
                <details className="rounded-xl bg-slate-50 p-3 text-xs"><summary>查看正向 / 反向复制视图</summary><pre className="mt-2 whitespace-pre-wrap break-words font-sans">{formatPositiveNegative(fullPrompt, negative)}</pre></details>
                {onRegenerate && <button type="button" disabled={busy} onClick={() => void regenerate()} className="block text-xs text-sky-700 disabled:opacity-50">重新生成提示词（覆盖摘要和完整提示词）</button>}
                {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
                {copied && <p role="status" className="text-xs text-emerald-700">{copied}</p>}
                <button type="button" disabled={busy} onClick={() => void save()} className="w-full rounded-xl bg-sky-600 py-3 text-sm font-bold text-white disabled:opacity-50">保存</button>
            </div>
        </Modal>
    </>;
};

export default ImagePromptCard;
