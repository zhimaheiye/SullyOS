import React, { useEffect, useMemo, useRef, useState } from 'react';
import { BookOpenText, Brain, CaretLeft, PaperPlaneRight, Plus } from '@phosphor-icons/react';
import type { ChatTheme, CharacterProfile, HealingMessage } from '../../types';
import { useBlobRefUrl } from '../../utils/blobRef';
import { resolveHealingPortrait } from '../../utils/healing/portrait';
import MessageItem from '../chat/MessageItem';
import HealingToolMenu from './HealingToolMenu';

const theme: ChatTheme = {
  id: 'healing', name: '聊愈', type: 'preset',
  user: { textColor: '#173b2d', backgroundColor: '#cfe7d3', borderRadius: 18, tailMode: 'last', opacity: 1 },
  ai: { textColor: '#37443b', backgroundColor: '#ffffff', borderRadius: 18, tailMode: 'last', opacity: 0.96 },
};
const noop = () => {};

const HealingBubble: React.FC<{ message: HealingMessage; messages: HealingMessage[]; index: number; char: CharacterProfile; charAvatar: string; userAvatar: string }> = ({ message, messages, index, char, charAvatar, userAvatar }) => {
  const imageUrl = useBlobRefUrl(message.type === 'image' ? message.content : undefined);
  const rendered = message.type === 'image' ? { ...message, content: imageUrl || '' } : message;
  const before = messages[index - 1];
  const after = messages[index + 1];
  return <MessageItem
    msg={rendered}
    isFirstInGroup={!before || before.role !== message.role}
    isLastInGroup={!after || after.role !== message.role}
    isLatestMessage={index === messages.length - 1}
    activeTheme={theme}
    charAvatar={charAvatar}
    charName={char.name}
    userAvatar={userAvatar}
    onLongPress={noop}
    onReply={noop}
    selectionMode={false}
    isSelected={false}
    onToggleSelect={noop}
    showTimestamp="always"
  />;
};

const HealingChat: React.FC<{
  char: CharacterProfile;
  userAvatar: string;
  messages: HealingMessage[];
  busy: boolean;
  onBack: () => void;
  onMemory: () => void;
  onTranscripts: () => void;
  onSendText: (text: string) => void;
  onSendImage: (file: File) => void;
  onPlaceholder: (name: '读心卡' | '星语图') => void;
}> = ({ char, userAvatar, messages, busy, onBack, onMemory, onTranscripts, onSendText, onSendImage, onPlaceholder }) => {
  const [draft, setDraft] = useState('');
  const [toolsOpen, setToolsOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const portrait = useBlobRefUrl(useMemo(() => resolveHealingPortrait(char), [char]));
  const charAvatar = useBlobRefUrl(char.avatar) || '';
  const resolvedUserAvatar = useBlobRefUrl(userAvatar) || '';
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }); }, [busy, messages.length]);
  const submit = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    onSendText(text);
  };
  return <div className="absolute inset-0 flex flex-col overflow-hidden bg-[#eef2e8] text-[#274033]">
    <header className="z-10 shrink-0 border-b border-white/40 bg-[#244e3c]/95 text-white backdrop-blur" style={{ paddingTop: 'var(--chrome-top)' }}>
      <div className="flex h-16 items-center px-2">
        <button onClick={onBack} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10" aria-label="结束本次聊愈"><CaretLeft size={27} /></button>
        <div className="min-w-0 flex-1 text-center"><b className="block truncate text-sm">{char.name}</b><span className="text-[10px] text-emerald-100">林间聊愈室</span></div>
        <button onClick={onMemory} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10" aria-label="记忆"><Brain size={22} /></button>
        <button onClick={onTranscripts} className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-white/10" aria-label="疗愈手记"><BookOpenText size={22} /></button>
      </div>
    </header>
    <section className="relative h-[25%] min-h-32 shrink-0 overflow-hidden bg-gradient-to-b from-[#b9d7bd] to-[#e5eee0]">
      <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-[#eef2e8] to-transparent" />
      {portrait ? <img src={portrait} alt={char.name} className="mx-auto h-full max-w-[80%] object-contain object-bottom drop-shadow-[0_12px_18px_rgba(35,65,48,0.22)]" /> : <div className="flex h-full items-center justify-center text-5xl font-black text-emerald-800/30">{char.name.slice(0, 1)}</div>}
    </section>
    <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 pt-3">
      {messages.length ? messages.map((message, index) => <HealingBubble key={message.id} message={message} messages={messages} index={index} char={char} charAvatar={charAvatar} userAvatar={resolvedUserAvatar} />) : <div className="mx-auto mt-8 max-w-xs rounded-2xl bg-white/70 px-5 py-4 text-center text-xs leading-5 text-[#6b7b70]">这里不会写进普通 Message。你说过的话会完整留在疗愈手记里。</div>}
      {busy && <div className="mb-5 ml-12 w-fit rounded-2xl bg-white px-4 py-3 text-xs text-[#6b7b70] shadow-sm">{char.name} 正在听……</div>}
    </div>
    <div className="relative shrink-0 border-t border-emerald-100 bg-white/95 px-3 pt-2" style={{ paddingBottom: 'max(10px, var(--safe-bottom))' }}>
      {toolsOpen && <HealingToolMenu onImage={file => { setToolsOpen(false); onSendImage(file); }} onPlaceholder={name => { setToolsOpen(false); onPlaceholder(name); }} />}
      <div className="flex items-end gap-2">
        <button onClick={() => setToolsOpen(value => !value)} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#e5efe6] text-[#2d684d]" aria-label="更多工具"><Plus size={24} /></button>
        <textarea value={draft} onChange={event => setDraft(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); submit(); } }} rows={1} placeholder="慢慢说，我在听……" className="max-h-28 min-h-11 flex-1 resize-none rounded-[22px] border border-emerald-100 bg-[#f7f8f4] px-4 py-3 text-sm outline-none focus:border-emerald-400" />
        <button disabled={busy || !draft.trim()} onClick={submit} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-[#2d684d] text-white disabled:opacity-40" aria-label="发送"><PaperPlaneRight size={21} weight="fill" /></button>
      </div>
    </div>
  </div>;
};

export default HealingChat;
