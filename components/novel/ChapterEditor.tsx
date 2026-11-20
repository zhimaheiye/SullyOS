import React, { useState } from 'react';
import type { NovelSegment } from '../../types';
import Modal from '../os/Modal';

interface Props {
    chapter: NovelSegment[];
    index: number;
    count: number;
    onClose: () => void;
    onApply: (chapter: NovelSegment[] | null, destination: number) => void;
}

const field = 'w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm leading-relaxed focus:border-indigo-400';

export default function ChapterEditor({ chapter, index, count, onClose, onApply }: Props) {
    const marker = chapter[chapter.length - 1];
    const stories = chapter.slice(0, -1).filter(s => s.type === 'story');
    const [position, setPosition] = useState(index);
    const [title, setTitle] = useState(marker.chapterTitle || '');
    const [summary, setSummary] = useState(marker.content);
    const [edits, setEdits] = useState<Record<string, string>>({});
    const [rewrite, setRewrite] = useState(!stories.length);
    const [manuscript, setManuscript] = useState(() => stories.map(s => s.content).join('\n\n'));
    const [confirmDelete, setConfirmDelete] = useState(false);
    const canSave = !!summary.trim() && (rewrite ? !!manuscript.trim() || !stories.length : stories.every(s => (edits[s.id] ?? s.content).trim()));

    const save = () => {
        const body = chapter.slice(0, -1);
        let revised: NovelSegment[];
        if (rewrite && manuscript !== stories.map(s => s.content).join('\n\n')) {
            revised = body.filter(s => s.type !== 'story');
            const firstStory = body.findIndex(s => s.type === 'story');
            if (manuscript.trim()) {
                revised.splice(firstStory < 0 ? revised.length : firstStory, 0, {
                    id: `seg-rewrite-${Date.now()}`, type: 'story', role: 'writer', authorId: 'user',
                    timestamp: Date.now(), content: manuscript,
                });
            }
        } else {
            revised = body.map(s => !rewrite && edits[s.id] !== undefined ? { ...s, content: edits[s.id] } : s);
        }
        onApply([...revised, { ...marker, chapterTitle: title.trim() || undefined, content: summary }], position);
    };

    return <Modal isOpen title={`编辑第 ${index + 1} 章`} onClose={onClose} footer={<>
        <button onClick={onClose} className="flex-1 rounded-xl bg-slate-100 py-3 text-sm font-bold text-slate-600">取消</button>
        <button onClick={save} disabled={!canSave || confirmDelete} className="flex-1 rounded-xl bg-indigo-500 py-3 text-sm font-bold text-white disabled:opacity-40">保存</button>
    </>}>
        <div className="space-y-4 text-xs font-bold text-slate-600">
            <label className="block space-y-1"><span>章节标题（选填）</span>
                <input className={field} value={title} onChange={e => setTitle(e.target.value)} placeholder="例如：见面" />
            </label>
            <label className="flex items-center justify-between">章节位置
                <select value={position} onChange={e => setPosition(Number(e.target.value))} className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2">
                    {Array.from({ length: count }, (_, i) => <option key={i} value={i}>第 {i + 1} 章</option>)}
                </select>
            </label>
            <label className="block space-y-1"><span>章节总结（用于续写和转发）</span>
                <textarea className={field} rows={5} value={summary} onChange={e => setSummary(e.target.value)} />
            </label>
            <div className="flex items-center justify-between">章节正文
                {stories.length > 0 && <button className="rounded-lg bg-indigo-50 px-3 py-2 text-indigo-600" onClick={() => setRewrite(!rewrite)}>{rewrite ? '切回分段编辑' : '整章重写'}</button>}
            </div>
            {rewrite ? <label className="block space-y-1"><span>重写后的正文将署名为你</span>
                <textarea className={field} rows={10} value={manuscript} onChange={e => setManuscript(e.target.value)} />
            </label> : stories.map((s, i) => <textarea key={s.id} aria-label={`正文第 ${i + 1} 段`} className={field} rows={5} value={edits[s.id] ?? s.content} onChange={e => setEdits({ ...edits, [s.id]: e.target.value })} />)}
            {confirmDelete ? <div className="space-y-2 rounded-xl bg-red-50 p-3 text-red-700">
                <p>删除第 {index + 1} 章的正文、讨论、分析和总结？删除后无法撤销。</p>
                <div className="flex gap-4"><button onClick={() => setConfirmDelete(false)}>保留章节</button><button onClick={() => onApply(null, index)}>确认删除本章</button></div>
            </div> : <button onClick={() => setConfirmDelete(true)} className="rounded-lg px-2 py-2 text-red-600">删除本章</button>}
        </div>
    </Modal>;
}
