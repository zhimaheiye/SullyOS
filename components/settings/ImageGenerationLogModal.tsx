import React, { useCallback, useEffect, useState } from 'react';
import Modal from '../os/Modal';
import {
    clearImageGenerationLog,
    getImageGenerationLog,
    type ImageGenerationLogEntry,
} from '../../utils/imageGenerationLog';

interface Props { isOpen: boolean; onClose: () => void }

function formatTime(timestamp: number): string {
    return new Date(timestamp).toLocaleString();
}

function duration(value: number): string {
    return value >= 1000 ? `${(value / 1000).toFixed(1)}s` : `${value}ms`;
}

/**
 * 生图 API 本地调用记录：只读 localStorage 日志（5 天 / 150 条），
 * 不含 Key、提示词原文或图片数据；失败条目可复制脱敏排错报告。
 */
const ImageGenerationLogModal: React.FC<Props> = ({ isOpen, onClose }) => {
    const [entries, setEntries] = useState<ImageGenerationLogEntry[]>([]);
    const [expandedId, setExpandedId] = useState<string | null>(null);

    const load = useCallback(() => setEntries(getImageGenerationLog()), []);
    useEffect(() => { if (isOpen) load(); }, [isOpen, load]);

    const clear = useCallback(() => {
        if (!window.confirm('确定清空所有生图 API 调用记录吗？')) return;
        clearImageGenerationLog();
        setEntries([]);
    }, []);

    const copy = useCallback(async (entry: ImageGenerationLogEntry) => {
        if (!entry.detail) return;
        try {
            await navigator.clipboard.writeText(entry.detail);
            window.alert('排错详情已复制');
        } catch {
            window.prompt('请手动复制下面的排错详情：', entry.detail);
        }
    }, []);

    return (
        <Modal isOpen={isOpen} title="生图 API 调用记录" onClose={onClose} footer={(
            <div className="flex gap-2 w-full">
                <button onClick={onClose} className="flex-1 py-3 bg-slate-100 text-slate-600 font-bold rounded-2xl">关闭</button>
                <button onClick={clear} disabled={!entries.length} className="px-5 py-3 bg-rose-50 text-rose-500 font-bold rounded-2xl disabled:opacity-40">清空</button>
            </div>
        )}>
            <p className="text-[11px] text-slate-400 leading-relaxed mb-3 px-1">
                仅保留最近 5 天的本地记录。不保存 API Key、提示词原文、参考图或生成图。
            </p>
            {!entries.length ? (
                <div className="py-10 text-center text-sm text-slate-400">暂无生图记录。<br /><span className="text-[11px]">下次生图成功或失败后，这里会自动留一条。</span></div>
            ) : (
                <div className="space-y-2">
                    {entries.map(entry => {
                        const expanded = expandedId === entry.id;
                        return (
                            <div key={entry.id} className={`rounded-2xl border p-3 ${entry.ok ? 'bg-white/70 border-slate-200/60' : 'bg-rose-50/60 border-rose-200/60'}`}>
                                <div className="flex items-center justify-between gap-2">
                                    <span className="text-[11px] text-slate-500">{formatTime(entry.timestamp)}</span>
                                    <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${entry.ok ? 'bg-emerald-100 text-emerald-600' : 'bg-rose-100 text-rose-600'}`}>
                                        {entry.ok ? '生成成功' : `生成失败${entry.status ? ` · HTTP ${entry.status}` : ''}`}
                                    </span>
                                </div>
                                <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
                                    <Field label="来源" value={entry.feature} />
                                    <Field label="耗时" value={duration(entry.durationMs)} />
                                    <Field label="服务" value={entry.provider} />
                                    <Field label="模型" value={entry.model} />
                                    {entry.stage && <Field label="阶段" value={entry.stage} />}
                                    {entry.endpoint && <div className="col-span-2"><Field label="接口" value={entry.endpoint} wrap /></div>}
                                </div>
                                <div className={`mt-2 rounded-xl px-3 py-2 text-[11px] leading-relaxed ${entry.ok ? 'bg-emerald-50 text-emerald-700' : 'bg-white/80 text-rose-700'}`}>
                                    <span className="font-bold">初步判断：</span>{entry.diagnosis}
                                </div>
                                {!entry.ok && entry.detail && (
                                    <div className="mt-2">
                                        <div className="flex gap-2">
                                            <button onClick={() => setExpandedId(expanded ? null : entry.id)} className="flex-1 py-2 rounded-xl bg-white/80 text-[11px] font-bold text-slate-500">{expanded ? '收起详情' : '查看详情'}</button>
                                            <button onClick={() => void copy(entry)} className="px-4 py-2 rounded-xl bg-slate-800 text-[11px] font-bold text-white">复制排错报告</button>
                                        </div>
                                        {expanded && <pre className="mt-2 p-3 rounded-xl bg-slate-900 text-slate-100 text-[10px] leading-relaxed whitespace-pre-wrap break-all max-h-64 overflow-y-auto">{entry.detail}</pre>}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            )}
        </Modal>
    );
};

const Field: React.FC<{ label: string; value?: string; wrap?: boolean }> = ({ label, value, wrap }) => (
    <div className="flex items-baseline gap-1.5 min-w-0">
        <span className="text-[10px] text-slate-400 shrink-0">{label}</span>
        <span className={`${wrap ? 'break-all' : 'truncate'} text-slate-600`} title={value || ''}>{value?.trim() || '—'}</span>
    </div>
);

export default ImageGenerationLogModal;
