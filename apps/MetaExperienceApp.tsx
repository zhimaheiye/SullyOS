import React, { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, ChatCircleDots, Check, Planet, WarningCircle } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { AppID } from '../types';
import { endMetaExperience, META_EXPERIENCE_CHANGED, readActiveMeta, startMetaExperience, type MetaExperienceRecord } from '../utils/metaExperience';
import { useLocalBackHandler } from '../hooks/useLocalBackHandler';

export default function MetaExperienceApp() {
    const { closeApp, openApp, characters, activeCharacterId, setActiveCharacterId, addToast } = useOS();
    const [active, setActive] = useState<MetaExperienceRecord | null>(() => readActiveMeta());
    const [selectedId, setSelectedId] = useState(active?.charId || activeCharacterId || characters[0]?.id || '');
    useLocalBackHandler(() => { closeApp(); return true; }, 100, true);
    useEffect(() => {
        const reload = () => setActive(readActiveMeta());
        window.addEventListener(META_EXPERIENCE_CHANGED, reload);
        return () => window.removeEventListener(META_EXPERIENCE_CHANGED, reload);
    }, []);
    const selected = useMemo(() => characters.find(char => char.id === selectedId) || null, [characters, selectedId]);
    const activeChar = useMemo(() => characters.find(char => char.id === active?.charId) || null, [characters, active?.charId]);
    const begin = () => {
        if (!selected) return;
        const record = startMetaExperience(selected.id);
        setActive(record);
        setActiveCharacterId(selected.id);
        addToast(`已与「${selected.name}」开始 Meta 开发中体验`, 'success');
    };
    const finish = () => {
        endMetaExperience();
        setActive(null);
        addToast('已退出 Meta 体验，普通聊天数据没有删除', 'info');
    };
    const enterChat = () => {
        if (!activeChar) return;
        setActiveCharacterId(activeChar.id);
        openApp(AppID.Chat);
    };

    return <div className="flex h-full flex-col overflow-hidden bg-[radial-gradient(circle_at_top,#ede9fe,#f8fafc_52%)] text-slate-900" style={{ paddingTop: 'var(--safe-top, 0px)' }}>
        <header className="flex items-center gap-3 border-b border-white/70 bg-white/70 px-4 py-3 backdrop-blur">
            <button type="button" onClick={closeApp} aria-label="返回桌面" className="grid h-10 w-10 place-items-center rounded-full bg-white shadow-sm"><ArrowLeft size={19}/></button>
            <div><h1 className="font-bold">Meta</h1><p className="text-xs text-violet-700">单角色体验</p></div>
        </header>
        <main className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4 pb-8">
            <section className="rounded-3xl border border-amber-200 bg-amber-50 p-5 shadow-sm" role="note" aria-label="开发中提示">
                <div className="flex items-center gap-2 text-amber-800"><WarningCircle size={22} weight="fill"/><strong>目前仍在开发中</strong></div>
                <p className="mt-2 text-sm leading-6 text-amber-900/80">很多功能还不完善，部分互动尚未接入。这里展示的是当前已经可以体验的部分，后续行为和界面仍可能调整。</p>
            </section>
            <section className="rounded-3xl bg-white/90 p-5 shadow-sm">
                <div className="grid h-12 w-12 place-items-center rounded-2xl bg-violet-100 text-violet-700"><Planet size={25} weight="duotone"/></div>
                <h2 className="mt-4 text-lg font-bold">与一位角色一起进入 Meta</h2>
                <p className="mt-2 text-sm leading-6 text-slate-600">当前版本会让所选角色在聊天中意识到这是一段 Meta 体验，并能理解你主动重新生成过回复。它不会读取屏幕外的现实信息。</p>
            </section>
            {active ? <section className="rounded-3xl bg-violet-950 p-5 text-white shadow-sm">
                <p className="text-xs font-bold uppercase tracking-widest text-violet-200">正在体验</p>
                <h2 className="mt-2 text-xl font-bold">{activeChar?.name || '角色已不存在'}</h2>
                <p className="mt-2 text-sm text-violet-100">已记录重新生成 {active.rerollCount} 次。普通聊天和存档不会因退出而删除。</p>
                <div className="mt-5 grid gap-3"><button type="button" disabled={!activeChar} onClick={enterChat} className="flex min-h-12 items-center justify-center gap-2 rounded-2xl bg-white font-bold text-violet-900 disabled:opacity-50"><ChatCircleDots size={20}/>进入聊天</button><button type="button" onClick={finish} className="min-h-11 rounded-2xl bg-violet-800 text-sm font-bold text-white">结束这段体验</button></div>
            </section> : <section className="rounded-3xl bg-white/90 p-5 shadow-sm">
                <h2 className="font-bold">选择角色</h2>
                {characters.length ? <div className="mt-4 grid grid-cols-2 gap-3">{characters.map(char => <button type="button" key={char.id} onClick={() => setSelectedId(char.id)} aria-pressed={selectedId === char.id} className={`flex min-h-20 items-center gap-3 rounded-2xl border p-3 text-left ${selectedId === char.id ? 'border-violet-500 bg-violet-50' : 'border-slate-200 bg-white'}`}><img src={char.avatar} alt="" className="h-11 w-11 rounded-full object-cover"/><span className="min-w-0 flex-1 truncate text-sm font-bold">{char.name}</span>{selectedId === char.id && <Check size={18} className="text-violet-700"/>}</button>)}</div> : <p className="mt-3 text-sm text-slate-500">请先创建角色，再回来开始体验。</p>}
                <button type="button" disabled={!selected} onClick={begin} className="mt-4 min-h-12 w-full rounded-2xl bg-violet-700 text-sm font-bold text-white disabled:opacity-40">开始开发中体验</button>
            </section>}
        </main>
    </div>;
}
