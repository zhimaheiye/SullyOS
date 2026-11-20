import React, { useEffect, useRef, useState } from 'react';
import { ArrowClockwise, DownloadSimple, Plus, UploadSimple, Trash } from '@phosphor-icons/react';
import { useOS } from '../../context/OSContext';
import ConfirmDialog from '../os/ConfirmDialog';
import type { CharacterProfile } from '../../types';
import { importMemeEntries, loadMemeLibrary, saveMemeLibrary, mergeMemeEntries, memeChatProfile, selectMemeEntries, splitMemeKeywords, MEME_CHAT_EVENT, MEME_ENTRY_LIMIT, type MemeEntry, type MemeLibrary, type MemeSelection } from '../../utils/memeChat';

const button = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-40';
const inputStyle = 'w-full min-w-0 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-800 outline-none focus:border-indigo-400';
const panel = 'rounded-2xl border border-slate-200 bg-white p-4';

function CharacterMemeOptions({ char, library }: { char: CharacterProfile; library: MemeLibrary }) {
    const { updateCharacter } = useOS();
    const profile = memeChatProfile(char);
    const [text, setText] = useState('');
    const [preview, setPreview] = useState<{ kind: string; selection: MemeSelection } | null>(null);
    useEffect(() => setPreview(null), [library, char.systemPrompt]);
    const showPreview = (keywords: boolean) => {
        const previewChar = { ...char, memeChat: { enabled: true } };
        const selection = selectMemeEntries(library, previewChar, keywords ? [{ role: 'user', content: text }] : []);
        setPreview({ kind: keywords ? '用户关键词命中' : '主动候选', selection: keywords ? { ...selection, proactive: [] } : selection });
    };
    return <section className={`${panel} grid gap-3`}>
        <label className="flex items-center justify-between gap-3 text-sm font-semibold">允许 {char.name} 在聊天中参考热梗
            <input type="checkbox" aria-label={`为 ${char.name} 启用热梗`} checked={profile.enabled} onChange={event => updateCharacter(char.id, { memeChat: { enabled: event.target.checked } })} className="h-5 w-5 accent-indigo-600" />
        </label>
        <details className="border-t border-slate-100 pt-3">
            <summary className="cursor-pointer text-sm font-semibold">预览两条触发路径</summary>
            <div className="mt-3 grid gap-3">
                <p className="text-xs leading-5 text-slate-500">本机预览，不调用模型、不发送聊天，也不启用角色开关。实际聊天还会避开最近角色已说过的梗。</p>
                <button type="button" className={button} onClick={() => showPreview(false)}><ArrowClockwise size={16} />抽一次主动候选</button>
                <textarea aria-label="用户玩梗测试文本" className={inputStyle} rows={2} value={text} onChange={event => { setText(event.target.value); setPreview(null); }} placeholder="输入你想对角色说的话…" />
                <button type="button" className={button} disabled={!text.trim()} onClick={() => showPreview(true)}>仅检查用户关键词</button>
                {preview && <div role="status" className="rounded-xl bg-slate-50 p-3 text-xs leading-6">
                    <p className="font-semibold">{preview.kind}</p>
                    {[...preview.selection.triggered, ...preview.selection.proactive].map(entry => <details key={entry.id}><summary className="cursor-pointer">{entry.title}</summary><p className="whitespace-pre-wrap break-words">{entry.content}</p></details>)}
                    {!preview.selection.triggered.length && !preview.selection.proactive.length && <p>本次没有选中条目。</p>}
                </div>}
            </div>
        </details>
    </section>;
}

function EntryEditor({ entry, onSave, onClose }: { entry: MemeEntry; onSave: (entry: MemeEntry) => void; onClose: () => void }) {
    const [draft, setDraft] = useState(entry);
    const [keywords, setKeywords] = useState(entry.keywords.join('\n'));
    const [affinity, setAffinity] = useState(entry.affinity.join('\n'));
    return <section aria-label="编辑热梗条目" className={`${panel} grid gap-3`}>
        <label className="grid gap-1 text-xs font-semibold">梗名称<input autoFocus className={inputStyle} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} /></label>
        <label className="grid gap-1 text-xs font-semibold">关键词与别名（每行一项，按字面匹配）<textarea className={inputStyle} rows={2} value={keywords} onChange={e => setKeywords(e.target.value)} /></label>
        <label className="grid gap-1 text-xs font-semibold">适合的性格／兴趣关键词（可选）<textarea className={inputStyle} rows={2} value={affinity} onChange={e => setAffinity(e.target.value)} placeholder="例如：幽默、游戏；在人设中出现时提高抽中机会" /></label>
        <label className="grid gap-1 text-xs font-semibold">含义、用法与示例<textarea className={inputStyle} rows={8} value={draft.content} onChange={e => setDraft({ ...draft, content: e.target.value })} /></label>
        {draft.content.length > MEME_ENTRY_LIMIT && <p className="text-xs text-amber-700">超过 {MEME_ENTRY_LIMIT} 字符，请拆成独立的梗；此条不会发送。</p>}
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.enabled} onChange={e => setDraft({ ...draft, enabled: e.target.checked })} />启用此条</label>
        <div className="flex gap-2"><button type="button" className={button} disabled={!draft.title.trim() || !draft.content.trim()} onClick={() => onSave({ ...draft, title: draft.title.trim(), keywords: splitMemeKeywords(keywords), affinity: splitMemeKeywords(affinity) })}>保存条目</button><button type="button" className={button} onClick={onClose}>取消</button></div>
    </section>;
}

export function MemeChatSettingsPanel() {
    const { characters } = useOS();
    const [library, setLibrary] = useState<MemeLibrary>({ version: 1, entries: [] });
    const [characterId, setCharacterId] = useState('');
    const [query, setQuery] = useState('');
    const [page, setPage] = useState(0);
    const [editing, setEditing] = useState<MemeEntry | null>(null);
    const [notice, setNotice] = useState('');
    const [error, setError] = useState('');
    const [importing, setImporting] = useState(false);
    const [confirmClear, setConfirmClear] = useState(false);
    const upload = useRef<HTMLInputElement>(null);
    useEffect(() => {
        const refresh = () => { try { setLibrary(loadMemeLibrary()); setError(''); } catch { setError('条目库读取失败，请保留现有数据后检查备份。'); } };
        refresh(); window.addEventListener(MEME_CHAT_EVENT, refresh); window.addEventListener('storage', refresh);
        return () => { window.removeEventListener(MEME_CHAT_EVENT, refresh); window.removeEventListener('storage', refresh); };
    }, []);
    const commit = (next: MemeLibrary) => {
        try { saveMemeLibrary(next); setError(''); return true; }
        catch { setError('保存失败，请检查条目格式或本机存储空间。'); return false; }
    };
    const saveEntry = (entry: MemeEntry, closeEditor = true) => {
        try {
            const latest = loadMemeLibrary();
            const exists = latest.entries.some(row => row.id === entry.id);
            if (commit({ version: 1, entries: exists ? latest.entries.map(row => row.id === entry.id ? entry : row) : [...latest.entries, entry] }) && closeEditor) setEditing(null);
        } catch { setError('条目库读取失败，未保存。'); }
    };
    const importFile = async (file: File) => {
        setImporting(true); setNotice(''); setError('');
        try {
            const entries = importMemeEntries(JSON.parse(await file.text()));
            const result = mergeMemeEntries(loadMemeLibrary(), entries);
            if (commit(result.library)) setNotice(`新增 ${result.added} 条，跳过重复 ${entries.length - result.added} 条。`);
        } catch (cause) { setError(cause instanceof Error ? cause.message : '导入失败'); }
        finally { setImporting(false); }
    };
    const exportLibrary = () => {
        const url = URL.createObjectURL(new Blob([JSON.stringify(library, null, 2)], { type: 'application/json' }));
        const anchor = document.createElement('a'); anchor.href = url; anchor.download = 'SullyOS-热梗条目.json'; anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    };
    const clearLibrary = () => {
        if (importing) return;
        setConfirmClear(false);
        if (!commit({ version: 1, entries: [] })) return;
        setEditing(null); setQuery(''); setPage(0);
        setNotice('已清空全部条目，可以重新导入。');
    };
    const char = characters.find(character => character.id === characterId);
    const filtered = library.entries.filter(entry => `${entry.title}\n${entry.keywords.join('\n')}`.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
    const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / 25) - 1));
    return <div className="grid gap-4">
        <p className="text-xs leading-6 text-slate-500">所有角色共用一份条目库，各自决定是否开启。关键词优先触发；每轮按人设加权抽取最多 2 条主动候选，角色可以完全不用。仅接私聊和群聊，不增加副 API 调用。</p>
        <section className={`${panel} grid gap-3`}>
            <div className="flex flex-wrap gap-2">
                <input ref={upload} type="file" accept=".json,application/json" className="hidden" aria-label="导入热梗文件" onChange={event => { const file = event.target.files?.[0]; event.target.value = ''; if (file) void importFile(file); }} />
                <button type="button" className={button} disabled={importing} onClick={() => upload.current?.click()}><UploadSimple size={16} />{importing ? '正在导入…' : '导入热梗条目'}</button>
                <button type="button" className={button} disabled={!library.entries.length} onClick={exportLibrary}><DownloadSimple size={16} />导出条目</button>
                <button type="button" className={button} onClick={() => setEditing({ id: crypto.randomUUID(), title: '', content: '', keywords: [], affinity: [], enabled: true })}><Plus size={16} />新建条目</button>
                <button type="button" className={`${button} !border-rose-200 !text-rose-600`} disabled={importing || !library.entries.length} onClick={() => setConfirmClear(true)}><Trash size={16} />清空全部条目</button>
            </div>
            <p className="text-xs text-slate-500">{library.entries.length} 条 · {library.entries.filter(entry => entry.enabled && entry.content.length <= MEME_ENTRY_LIMIT).length} 条可用。仅支持小手机导出的热梗条目文件，导入不会自动开启角色。</p>
            {notice && <p role="status" className="text-xs leading-5 text-emerald-700">{notice}</p>}
        </section>
        {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-xs text-rose-700">{error}</p>}
        <label className="grid gap-2 text-sm font-semibold">角色开关<select className={inputStyle} aria-label="选择要设置开关的角色" value={char?.id || ''} onChange={event => setCharacterId(event.target.value)}><option value="">选择角色…</option>{characters.map(character => <option key={character.id} value={character.id}>{character.name}{memeChatProfile(character).enabled ? ' · 已开启' : ' · 未开启'}</option>)}</select></label>
        {char && <CharacterMemeOptions key={char.id} char={char} library={library} />}
        {editing && <EntryEditor key={editing.id} entry={editing} onSave={saveEntry} onClose={() => setEditing(null)} />}
        {!!library.entries.length && <section className={`${panel} grid gap-3`}>
            <h3 className="text-sm font-semibold">共用条目库</h3>
            <input className={inputStyle} aria-label="搜索热梗条目" placeholder="搜索梗名称或关键词" value={query} onChange={event => { setQuery(event.target.value); setPage(0); }} />
            {filtered.slice(currentPage * 25, (currentPage + 1) * 25).map(entry => <div key={entry.id} className="flex min-w-0 items-start gap-3 border-b border-slate-100 pb-3">
                <input type="checkbox" aria-label={`启用 ${entry.title}`} checked={entry.enabled} onChange={event => saveEntry({ ...entry, enabled: event.target.checked }, false)} className="mt-2 h-4 w-4 shrink-0 accent-indigo-600" />
                <button type="button" onClick={() => setEditing(entry)} className="min-w-0 flex-1 break-words text-left"><span className="text-sm font-semibold">{entry.title}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{entry.keywords.join(' · ') || '仅主动候选'}{entry.importNote ? ` · ${entry.importNote}` : ''}</span></button>
                <button type="button" className={button} aria-label={`删除 ${entry.title}`} onClick={() => { try { const current = loadMemeLibrary(); if (commit({ ...current, entries: current.entries.filter(row => row.id !== entry.id) })) { if (editing?.id === entry.id) setEditing(null); } } catch { setError('条目库读取失败，未删除。'); } }}><Trash size={16} /></button>
            </div>)}
            <div className="flex items-center justify-between gap-2 text-xs text-slate-500"><button type="button" className={button} disabled={!currentPage} onClick={() => setPage(currentPage - 1)}>上一页</button><span>{filtered.length} 条 · {currentPage + 1} / {Math.max(1, Math.ceil(filtered.length / 25))}</span><button type="button" className={button} disabled={(currentPage + 1) * 25 >= filtered.length} onClick={() => setPage(currentPage + 1)}>下一页</button></div>
        </section>}
        <ConfirmDialog isOpen={confirmClear} title="清空全部热梗条目？" message={<>将删除当前用户空间的全部热梗条目，包括未启用的条目。此操作无法撤销，需要保留时请先导出。角色开关保持不变。</>} variant="danger" confirmText="清空全部条目" onConfirm={clearLibrary} onCancel={() => setConfirmClear(false)} />
    </div>;
}
