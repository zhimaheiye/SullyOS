import React, { useMemo, useState } from 'react';
import { CaretLeft, DownloadSimple, MagnifyingGlass, Trash } from '@phosphor-icons/react';
import type { CharacterProfile, HealingMemoryNode } from '../../types';

const date = (timestamp: number): string => new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium' }).format(timestamp);

const HealingMemoryView: React.FC<{
  memories: HealingMemoryNode[];
  characters: CharacterProfile[];
  onBack: () => void;
  onDelete: (memory: HealingMemoryNode) => void;
  onSource: (memory: HealingMemoryNode) => void;
  onImport: () => void;
}> = ({ memories, characters, onBack, onDelete, onSource, onImport }) => {
  const [query, setQuery] = useState('');
  const charById = new Map(characters.map(char => [char.id, char]));
  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return memories.filter(memory => !needle || `${memory.content} ${memory.tags.join(' ')}`.toLowerCase().includes(needle)).sort((a, b) => b.updatedAt - a.updatedAt);
  }, [memories, query]);
  return <div className="absolute inset-0 flex flex-col bg-[#eef3e9] text-[#2e4638]">
    <header className="shrink-0 border-b border-emerald-100 bg-[#f6f8f2]/95 backdrop-blur" style={{ paddingTop: 'var(--chrome-top)' }}><div className="flex h-16 items-center px-3"><button onClick={onBack} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white" aria-label="返回"><CaretLeft size={27} /></button><h1 className="flex-1 text-center font-black">聊愈记忆</h1><button onClick={onImport} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white" aria-label="导入记忆"><DownloadSimple size={22} /></button></div></header>
    <main className="flex-1 overflow-y-auto px-4 pb-[calc(var(--safe-bottom)+24px)]">
      <div className="sticky top-0 z-10 bg-[#eef3e9] py-3"><label className="flex h-12 items-center gap-2 rounded-2xl bg-white px-4 shadow-sm"><MagnifyingGlass size={18} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="搜索记忆……" className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></label></div>
      {visible.length ? <div className="space-y-3">{visible.map(memory => { const char = memory.sourceCharId ? charById.get(memory.sourceCharId) : undefined; return <article key={memory.id} className="rounded-[24px] border border-white bg-white/85 p-4 shadow-sm"><div className="flex items-start justify-between gap-3"><time className="text-xs font-bold text-[#728174]">{date(memory.createdAt)}</time><button onClick={() => { if (window.confirm('删除这条聊愈记忆？原始疗愈手记不会被删除。')) onDelete(memory); }} className="text-[#a56b62]" aria-label="删除记忆"><Trash size={18} /></button></div>{memory.tags.length > 0 && <div className="mt-2 flex flex-wrap gap-1.5">{memory.tags.map(tag => <span key={tag} className="rounded-full bg-[#dcebdc] px-2 py-1 text-[10px] font-bold text-[#3f6a50]">{tag}</span>)}</div>}<p className="mt-3 whitespace-pre-wrap text-sm leading-6">{memory.content}</p><div className="mt-4 flex items-center justify-between border-t border-emerald-50 pt-3 text-[11px] text-[#7e897f]"><span>来源：{char ? `与 ${char.name} 的聊愈` : memory.origin === 'import' ? '导入记忆' : '聊愈手记'}</span>{memory.sourceSessionId && <button onClick={() => onSource(memory)} className="font-bold text-[#2f7451]">查看来源</button>}</div></article>; })}</div> : <div className="py-20 text-center text-sm text-[#849087]">{memories.length ? '没有匹配的记忆' : '聊得更久一点，值得记住的事会出现在这里'}</div>}
    </main>
  </div>;
};

export default HealingMemoryView;
