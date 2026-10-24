import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { copyTextToClipboard } from '../utils/clipboard';
import { cancelManualRelay, disarmManualRelay, getManualRelayState, manualRelayReplyError, submitManualRelay, subscribeManualRelay } from '../utils/manualModelRelay';

const ManualModelRelayPanel: React.FC = () => {
    const [state, setState] = useState(getManualRelayState);
    const [reply, setReply] = useState('');
    const [fullJson, setFullJson] = useState(false);
    const [error, setError] = useState('');
    const [copied, setCopied] = useState('');
    useEffect(() => subscribeManualRelay(setState), []);
    useEffect(() => { setReply(''); setError(''); setCopied(''); setFullJson(false); }, [state.request?.id]);
    useEffect(() => {
        if (state.status !== 'waiting') return;
        const onEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') cancelManualRelay(state.request.id);
        };
        window.addEventListener('keydown', onEscape);
        return () => window.removeEventListener('keydown', onEscape);
    }, [state]);
    const request = state.request;
    const messagesJson = useMemo(() => request ? JSON.stringify(request.messages, null, 2) : '', [request]);
    const oneText = useMemo(() => request ? request.messages.map((message, index) =>
        `===== ${index + 1}. ${message.role.toUpperCase()}${message.name ? ` (${message.name})` : ''} =====\n${message.content}`).join('\n\n') : '', [request]);
    const copy = async (kind: string, value: string) => {
        try { if (!await copyTextToClipboard(value)) throw new Error('copy failed'); setCopied(kind); window.setTimeout(() => setCopied(current => current === kind ? '' : current), 2200); }
        catch { setError('复制失败，请长按下方内容手动选择。'); }
    };
    const submit = () => {
        if (!request) return;
        let content = reply;
        if (fullJson) {
            try {
                const parsed = JSON.parse(reply);
                content = parsed?.choices?.[0]?.message?.content;
                if (typeof content !== 'string') throw new Error('missing content');
            } catch { setError('不是有效的 OpenAI choices[0].message.content，请检查粘贴内容。'); return; }
        }
        if (!content.trim()) { setError('请粘贴模型回复正文。'); return; }
        const unsafe = manualRelayReplyError(content);
        if (unsafe) { setError(unsafe); return; }
        if (!submitManualRelay(request.id, content)) setError('本轮已经结束，请在原 App 重新生成。');
    };
    if (state.status === 'off') return null;
    return createPortal(state.status === 'armed'
        ? <div data-manual-relay-control className="fixed bottom-5 right-3 z-[2147483647] max-w-[85vw] rounded-xl bg-emerald-950 px-3 py-2 text-xs text-white shadow-xl">
            外部模型接力已开启 <button type="button" onClick={disarmManualRelay} className="ml-2 underline">关闭接力模式</button>
        </div>
        : <div data-manual-relay-control className="fixed inset-0 z-[2147483647] flex items-center justify-center bg-black/65 p-3">
        {request && <div role="dialog" aria-modal="true" aria-label="外部模型接力" className="flex max-h-[94dvh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b px-4 py-3">
                <div><h2 className="font-bold text-slate-900">外部模型 · 手动接力</h2>
                <p className="text-xs text-slate-600">{request.source} · {request.purpose}{request.charName ? ` · ${request.charName}` : ''} · {request.id}</p>
                </div><button type="button" aria-label="关闭并取消本次接力" onClick={() => cancelManualRelay(request.id)} className="rounded px-2 text-lg text-slate-600">×</button>
            </div>
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4 text-sm">
                <p className="text-amber-800">请求含角色设定、记忆和对话。只在你主动复制时进入剪贴板；请自行决定分享范围。单文本版不能保证与多 role API 语义完全相同。</p>
                <p className="text-slate-600">{request.messages.length} 条消息 · JSON {messagesJson.length.toLocaleString()} 字符。接力模式持续开启；本轮只接管一条请求，自动后续补全会被阻止。</p>
                <p className="text-slate-600">本轮不调用工具。请一次粘贴完整的最终回复，可包含多个气泡；保留原任务要求的 JSON、HTML 或其它格式。</p>
                <div className="flex flex-wrap gap-2">
                    <button type="button" onClick={() => copy('json', messagesJson)} className="rounded-lg bg-slate-900 px-3 py-2 text-white">{copied === 'json' ? '已复制 JSON' : '复制完整 JSON messages'}</button>
                    <button type="button" onClick={() => copy('text', oneText)} className="rounded-lg bg-slate-100 px-3 py-2 text-slate-800">{copied === 'text' ? '已复制单文本' : '复制单文本版'}</button>
                </div>
                <details className="rounded-lg border p-2"><summary>查看本轮完整 messages</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-all text-xs">{messagesJson}</pre></details>
                <label className="block font-medium text-slate-900">粘贴外部 AI 的模型回复正文</label>
                <textarea value={reply} onChange={event => { setReply(event.target.value); setError(''); }} className="h-40 w-full resize-y rounded-lg border p-3 font-mono text-xs" placeholder="保留原有标签、JSON 或角色格式，原 App 将继续解析" />
                <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={fullJson} onChange={event => setFullJson(event.target.checked)} />粘贴的是完整 OpenAI choices JSON（仅提取 message.content）</label>
                <p className="text-xs text-slate-500">已粘贴 {reply.length.toLocaleString()} 字符。取消后不会自动调用原 API；需要正常调用请在原 App 重新触发。</p>
                {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
            </div>
            <div className="flex justify-end gap-2 border-t p-4">
                <button type="button" onClick={disarmManualRelay} className="mr-auto rounded-lg border border-red-200 px-3 py-2 text-sm text-red-700">关闭接力模式</button>
                <button type="button" onClick={() => cancelManualRelay(request.id)} className="rounded-lg border px-3 py-2 text-sm">取消本次接力</button>
                <button type="button" onClick={submit} className="rounded-lg bg-emerald-700 px-3 py-2 text-sm text-white">提交并继续原任务</button>
            </div>
        </div>}
    </div>, document.body);
};

export default ManualModelRelayPanel;
