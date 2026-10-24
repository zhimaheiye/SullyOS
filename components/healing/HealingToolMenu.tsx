import React, { useRef } from 'react';
import { CardsThree, Image, Sparkle } from '@phosphor-icons/react';

const HealingToolMenu: React.FC<{
  onImage: (file: File) => void;
  onPlaceholder: (name: '读心卡' | '星语图') => void;
}> = ({ onImage, onPlaceholder }) => {
  const fileRef = useRef<HTMLInputElement>(null);
  return <div className="absolute bottom-full left-3 mb-2 w-52 overflow-hidden rounded-2xl border border-emerald-100 bg-white p-2 text-[#294638] shadow-xl">
    <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={event => { const file = event.target.files?.[0]; if (file) onImage(file); event.currentTarget.value = ''; }} />
    <button onClick={() => fileRef.current?.click()} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-bold hover:bg-emerald-50"><Image size={21} />图片</button>
    <button onClick={() => onPlaceholder('读心卡')} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-bold hover:bg-emerald-50"><CardsThree size={21} />读心卡<span className="ml-auto text-[10px] font-normal text-slate-400">开发中</span></button>
    <button onClick={() => onPlaceholder('星语图')} className="flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-bold hover:bg-emerald-50"><Sparkle size={21} />星语图<span className="ml-auto text-[10px] font-normal text-slate-400">开发中</span></button>
  </div>;
};

export default HealingToolMenu;
