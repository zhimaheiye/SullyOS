import React from 'react';
import { CaretLeft, Image as ImageIcon } from '@phosphor-icons/react';
import type { CharacterProfile, HealingMessage, HealingSession } from '../../types';
import { useBlobRefUrl } from '../../utils/blobRef';

const formatDate = (timestamp: number): string => new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp);

const RawLine: React.FC<{ message: HealingMessage; charName: string }> = ({ message, charName }) => {
  const image = useBlobRefUrl(message.type === 'image' ? message.content : undefined);
  return <article className="border-b border-[#e8e2d6] py-4 last:border-0">
    <div className="mb-2 flex items-center justify-between text-[11px] text-[#867c6c]"><b className="text-[#4d6656]">{message.role === 'user' ? '你' : charName}</b><time>{formatDate(message.timestamp)}</time></div>
    {message.type === 'image' ? image ? <img src={image} alt="发送的图片" className="max-h-80 max-w-full rounded-2xl object-contain" /> : <div className="flex items-center gap-2 text-sm text-[#9b9286]"><ImageIcon />图片已丢失</div> : <p className="whitespace-pre-wrap text-sm leading-7 text-[#3e463f]">{message.content}</p>}
  </article>;
};

const TranscriptAvatar: React.FC<{ char?: CharacterProfile }> = ({ char }) => {
  const src = useBlobRefUrl(char?.avatar);
  return src
    ? <img src={src} alt="" className="h-12 w-12 rounded-2xl object-cover" />
    : <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-[#dce7dc] font-black">{char?.name?.slice(0, 1) || '?'}</div>;
};

const HealingTranscript: React.FC<{
  sessions: HealingSession[];
  characters: CharacterProfile[];
  selected?: HealingSession;
  messages: HealingMessage[];
  onSelect: (session: HealingSession) => void;
  onBack: () => void;
}> = ({ sessions, characters, selected, messages, onSelect, onBack }) => {
  const charById = new Map(characters.map(char => [char.id, char]));
  const selectedChar = selected ? charById.get(selected.charId) : undefined;
  return <div className="absolute inset-0 flex flex-col bg-[#f5f0e5] text-[#38473e]">
    <header className="shrink-0 border-b border-[#ded7c8] bg-[#f8f4ea]/95 backdrop-blur" style={{ paddingTop: 'var(--chrome-top)' }}><div className="flex h-16 items-center px-3"><button onClick={onBack} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white" aria-label="返回"><CaretLeft size={27} /></button><h1 className="flex-1 pr-11 text-center font-black">{selected ? `${selectedChar?.name || '已删除角色'} · 聊愈原文` : '疗愈手记'}</h1></div></header>
    <main className="flex-1 overflow-y-auto px-4 pb-[calc(var(--safe-bottom)+24px)]">
      {selected ? <section className="mx-auto my-4 max-w-2xl rounded-[26px] bg-white/80 px-5 shadow-sm"><div className="border-b border-[#e8e2d6] py-5"><b className="block">{formatDate(selected.createdAt)}</b><span className="mt-1 block text-xs text-[#847b6d]">参与角色：{selectedChar?.name || '已删除角色'} · {messages.length} 条原始消息</span></div>{messages.map(message => <RawLine key={message.id} message={message} charName={selectedChar?.name || '角色'} />)}</section> : sessions.length ? <div className="space-y-3 py-4">{sessions.map(session => { const char = charById.get(session.charId); return <button key={session.id} onClick={() => onSelect(session)} className="w-full rounded-[24px] border border-white bg-white/75 p-4 text-left shadow-sm"><div className="flex items-center gap-3"><TranscriptAvatar char={char} /><div className="min-w-0"><b className="block truncate">与 {char?.name || '已删除角色'} 的聊愈</b><time className="mt-1 block text-xs text-[#827a6d]">{formatDate(session.createdAt)}</time></div></div></button>; })}</div> : <div className="py-20 text-center text-sm text-[#8d8578]">还没有疗愈手记</div>}
    </main>
  </div>;
};

export default HealingTranscript;
