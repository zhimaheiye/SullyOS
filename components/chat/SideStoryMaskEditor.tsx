import React, { useState } from 'react';
import { loadStoryMaskWords, saveStoryMaskWords } from '../../utils/sideStoryMask';
export function useSideStoryMaskEditor() {
    const [rules, setRules] = useState(loadStoryMaskWords);
    const [draft, setDraft] = useState('');
    const reset = () => setDraft('');
    const save = (next: string[]) => { setRules(next); saveStoryMaskWords(next); };
    const apply = () => { if (draft.trim()) save([...new Set([...rules, draft.trim()])]); reset(); };
    return { rules, draft, setDraft, reset, save, apply, finishEdit: reset, previewRules: rules };
}
export default function SideStoryMaskEditor({ editor }: { editor: ReturnType<typeof useSideStoryMaskEditor> }) {
    return <div className="space-y-3 text-sm" data-manual-relay-control="">
        <p className="text-slate-500">只影响截图显示，复制仍保留原文。</p>
        <div className="flex gap-2">
            <input aria-label="新增打码词" value={editor.draft} onChange={event => editor.setDraft(event.target.value)}
                className="min-w-0 flex-1 rounded-lg border p-2 dark:bg-slate-800" />
            <button type="button" onClick={editor.apply} disabled={!editor.draft.trim()} className="rounded-lg border p-2">添加</button>
        </div>
        {editor.rules.map(word => <div key={word} className="flex justify-between gap-2">
            <span className="break-all">{word}</span><button type="button" onClick={() => editor.save(editor.rules.filter(item => item !== word))}>删除</button>
        </div>)}
    </div>;
}
