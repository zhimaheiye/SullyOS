import React, { useEffect, useState } from 'react';
import Modal from '../os/Modal';

interface Props {
    open: boolean;
    onClose: () => void;
    onSave: (title: string, markdown: string) => Promise<void>;
}

const KnowledgeCardModal: React.FC<Props> = ({ open, onClose, onSave }) => {
    const [title, setTitle] = useState('');
    const [markdown, setMarkdown] = useState('');
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        if (open) {
            setTitle('');
            setMarkdown('');
            setSaving(false);
        }
    }, [open]);

    const submit = async () => {
        if (!title.trim() || saving) return;
        setSaving(true);
        try {
            await onSave(title, markdown);
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal isOpen={open} title="新建知识卡" onClose={onClose} footer={
            <button onClick={() => void submit()} disabled={!title.trim() || saving} className="w-full rounded-2xl bg-emerald-600 py-3 font-bold text-white disabled:opacity-40">
                {saving ? '保存中…' : markdown.trim() ? '保存并开始学习' : '保存节点'}
            </button>
        }>
            <div className="space-y-4">
                <div>
                    <label className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-slate-400">标题（必填）</label>
                    <input value={title} onChange={event => setTitle(event.target.value)} placeholder="手动填写知识点标题" className="w-full rounded-xl bg-slate-100 p-3 text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
                </div>
                <div>
                    <label className="mb-2 block text-[10px] font-bold uppercase tracking-widest text-slate-400">Markdown（可留空）</label>
                    <textarea value={markdown} onChange={event => setMarkdown(event.target.value)} placeholder="# 标题只用于排版，不会拆成章节" className="h-64 w-full resize-none rounded-xl bg-slate-100 p-3 font-mono text-sm outline-none focus:ring-2 focus:ring-emerald-500" />
                </div>
            </div>
        </Modal>
    );
};

export default KnowledgeCardModal;
