import React, { useMemo, useState } from 'react';
import { CaretLeft, MagnifyingGlass, Tree } from '@phosphor-icons/react';
import type { CharacterGroup, CharacterProfile } from '../../types';
import { useBlobRefUrl } from '../../utils/blobRef';

const Avatar: React.FC<{ char: CharacterProfile }> = ({ char }) => {
  const src = useBlobRefUrl(char.avatar);
  return <div className="h-16 w-16 overflow-hidden rounded-[22px] bg-emerald-100 ring-4 ring-white shadow-sm">{src ? <img src={src} alt="" className="h-full w-full object-cover" /> : <span className="flex h-full items-center justify-center text-xl font-black text-emerald-800">{char.name.slice(0, 1)}</span>}</div>;
};

const HealingHome: React.FC<{
  characters: CharacterProfile[];
  groups: CharacterGroup[];
  onSelect: (char: CharacterProfile) => void;
  onClose: () => void;
  onMemory: () => void;
  onTranscripts: () => void;
}> = ({ characters, groups, onSelect, onClose, onMemory, onTranscripts }) => {
  const [query, setQuery] = useState('');
  const [groupId, setGroupId] = useState('all');
  const visible = useMemo(() => characters.filter(char =>
    (groupId === 'all' || (groupId === 'ungrouped' ? !char.groupId : char.groupId === groupId))
    && (!query.trim() || char.name.toLowerCase().includes(query.trim().toLowerCase())),
  ), [characters, groupId, query]);
  return <div className="absolute inset-0 flex flex-col overflow-hidden bg-[#f3f1e5] text-[#234233]">
    <header className="shrink-0 bg-gradient-to-b from-[#214d3c] to-[#2f674e] text-white" style={{ paddingTop: 'var(--chrome-top)' }}>
      <div className="flex h-16 items-center justify-between px-3">
        <button onClick={onClose} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10" aria-label="退出聊愈"><CaretLeft size={26} /></button>
        <div className="text-center"><h1 className="font-black tracking-[0.12em]">林间聊愈室</h1><p className="mt-0.5 text-[10px] text-emerald-100">选一位熟悉的人，陪你坐一会儿</p></div>
        <Tree size={25} weight="duotone" />
      </div>
    </header>
    <main className="flex-1 overflow-y-auto px-4 pb-[calc(var(--safe-bottom)+24px)]">
      <div className="my-4 grid grid-cols-2 gap-3">
        <button onClick={onMemory} className="rounded-2xl bg-[#dce9d7] px-4 py-3 text-left shadow-sm"><b className="block text-sm">共享记忆</b><span className="text-[11px] text-[#587061]">只在聊愈里被看见</span></button>
        <button onClick={onTranscripts} className="rounded-2xl bg-[#eadfc9] px-4 py-3 text-left shadow-sm"><b className="block text-sm">疗愈手记</b><span className="text-[11px] text-[#756750]">完整保留每句原话</span></button>
      </div>
      <label className="flex h-12 items-center gap-2 rounded-2xl border border-[#d8d5c5] bg-white/80 px-4 shadow-sm"><MagnifyingGlass size={18} /><input value={query} onChange={event => setQuery(event.target.value)} placeholder="找一位角色……" className="min-w-0 flex-1 bg-transparent text-sm outline-none" /></label>
      <div className="mt-3 flex gap-2 overflow-x-auto pb-2 text-xs font-bold">
        {[{ id: 'all', name: '全部' }, ...groups, { id: 'ungrouped', name: '未分组' }].map(group => <button key={group.id} onClick={() => setGroupId(group.id)} className={`shrink-0 rounded-full px-3 py-1.5 ${groupId === group.id ? 'bg-[#2f674e] text-white' : 'bg-white text-[#526657]'}`}>{group.name}</button>)}
      </div>
      {visible.length ? <div className="mt-2 grid grid-cols-2 gap-3">{visible.map(char => <button key={char.id} onClick={() => onSelect(char)} className="flex min-h-28 flex-col items-center justify-center rounded-[26px] border border-white/80 bg-white/75 p-4 text-center shadow-sm transition active:scale-[0.98]"><Avatar char={char} /><b className="mt-3 max-w-full truncate text-sm">{char.name}</b><span className="mt-1 text-[10px] text-[#789080]">进入聊愈</span></button>)}</div> : <div className="py-16 text-center text-sm text-[#768679]">{characters.length ? '没有找到符合条件的角色' : '先去“神经链接”创建一位角色吧'}</div>}
    </main>
  </div>;
};

export default HealingHome;
