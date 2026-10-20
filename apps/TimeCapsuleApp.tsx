import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown, ArrowUp, CaretLeft, ClockCountdown, EnvelopeSimpleOpen, HourglassMedium,
  LockKey, PencilSimple, Plus, Trash, UserCirclePlus, UsersThree,
} from '@phosphor-icons/react';
import { TIME_CAPSULE_UPDATED_EVENT } from '../components/timeCapsule/TimeCapsuleRuntime';
import { useOS } from '../context/OSContext';
import type { CharacterProfile, TimeCapsuleEntry, TimeCapsuleRecord, TimeCapsuleSettings } from '../types';
import { DB } from '../utils/db';
import {
  createUserTimeCapsule, DEFAULT_TIME_CAPSULE_SETTINGS, formatTimeCapsuleDistance,
  maxTimeCapsuleUnlockAt, toLocalDateTimeInput,
} from '../utils/timeCapsule';
import { requestCharacterTimeCapsule } from '../utils/timeCapsuleService';

type Tab = 'archive' | 'write' | 'invite' | 'visitors';

const Avatar: React.FC<{ char: Pick<CharacterProfile, 'name' | 'avatar'>; size?: string }> = ({ char, size = 'h-12 w-12' }) => (
  <div className={`${size} shrink-0 overflow-hidden rounded-full bg-[#efe4cc] ring-2 ring-white`}>
    {char.avatar
      ? <img src={char.avatar} alt={char.name} className="h-full w-full object-cover" />
      : <div className="flex h-full w-full items-center justify-center font-black text-[#7a433b]">{char.name.slice(0, 1)}</div>}
  </div>
);

const formatDate = (time: number) => new Date(time).toLocaleString('zh-CN', {
  year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
});

const sourceLabel = (capsule: TimeCapsuleEntry) => {
  if (capsule.source === 'user') return '由你封存';
  if (capsule.source === 'auto') return `${capsule.charName || '角色'}来访时留下`;
  return `你邀请${capsule.charName || '角色'}留下`;
};

const TimeCapsuleApp: React.FC = () => {
  const {
    closeApp, registerBackHandler, characters, userProfile, groups, apiConfig, realtimeConfig, addToast,
  } = useOS();
  const [tab, setTab] = useState<Tab>('archive');
  const [records, setRecords] = useState<TimeCapsuleRecord[]>([]);
  const [now, setNow] = useState(Date.now());
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [unlockValue, setUnlockValue] = useState(() => toLocalDateTimeInput(Date.now() + 30 * 86_400_000));
  const [inviteCharId, setInviteCharId] = useState('');
  const [busyCharId, setBusyCharId] = useState('');

  const capsules = useMemo(() => records
    .filter((item): item is TimeCapsuleEntry => item.kind === 'capsule')
    .sort((a, b) => b.createdAt - a.createdAt), [records]);
  const settings = useMemo(() => records.find((item): item is TimeCapsuleSettings => item.kind === 'settings') || DEFAULT_TIME_CAPSULE_SETTINGS, [records]);

  const load = useCallback(async () => setRecords(await DB.getTimeCapsuleRecords()), []);
  useEffect(() => {
    void load().catch(() => addToast('时间胶囊读取失败', 'error'));
    const onUpdate = () => void load();
    window.addEventListener(TIME_CAPSULE_UPDATED_EVENT, onUpdate);
    return () => window.removeEventListener(TIME_CAPSULE_UPDATED_EVENT, onUpdate);
  }, [addToast, load]);
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => {
    if (!inviteCharId) setInviteCharId(characters[0]?.id || '');
  }, [characters, inviteCharId]);

  const goBack = useCallback(() => {
    if (tab !== 'archive') { setTab('archive'); return true; }
    closeApp(); return true;
  }, [closeApp, tab]);
  useEffect(() => registerBackHandler(goBack), [goBack, registerBackHandler]);

  const saveSettings = async (patch: Partial<TimeCapsuleSettings>) => {
    await DB.saveTimeCapsuleRecord({ ...settings, ...patch, id: 'settings', kind: 'settings' });
    await load();
    window.dispatchEvent(new Event(TIME_CAPSULE_UPDATED_EVENT));
  };

  const sealOwn = async () => {
    try {
      const capsule = createUserTimeCapsule({ title, content, unlockAt: new Date(unlockValue).getTime() });
      await DB.saveTimeCapsuleRecord(capsule);
      setTitle(''); setContent('');
      setUnlockValue(toLocalDateTimeInput(Date.now() + 30 * 86_400_000));
      await load(); setTab('archive'); addToast('时间胶囊已封存', 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : '封存失败', 'error');
    }
  };

  const inviteCharacter = async () => {
    const char = characters.find(item => item.id === inviteCharId);
    if (!char) { addToast('请先选择一位角色', 'error'); return; }
    setBusyCharId(char.id);
    try {
      const capsule = await requestCharacterTimeCapsule({
        char, userProfile, groups, apiConfig, realtimeConfig, source: 'invited',
      });
      await DB.saveTimeCapsuleRecord(capsule);
      await load(); setTab('archive'); addToast(`${char.name}留下了一枚胶囊`, 'success');
    } catch (error) {
      addToast(error instanceof Error ? error.message : '邀请失败', 'error');
    } finally {
      setBusyCharId('');
    }
  };

  const openCapsule = async (capsule: TimeCapsuleEntry) => {
    if (capsule.unlockAt > Date.now()) return;
    await DB.saveTimeCapsuleRecord({ ...capsule, openedAt: capsule.openedAt || Date.now() });
    await load();
  };

  const deleteCapsule = async (capsule: TimeCapsuleEntry) => {
    if (!window.confirm(`删除“${capsule.title}”？这枚胶囊将无法恢复。`)) return;
    await DB.deleteTimeCapsuleRecord(capsule.id); await load(); addToast('胶囊已删除', 'success');
  };

  const toggleVisitor = async (charId: string) => {
    const ids = settings.visitorCharIds.includes(charId)
      ? settings.visitorCharIds.filter(id => id !== charId)
      : [...settings.visitorCharIds, charId];
    await saveSettings({ visitorCharIds: ids, nextVisitorIndex: 0, enabled: ids.length ? settings.enabled : false });
  };
  const moveVisitor = async (index: number, delta: number) => {
    const target = index + delta;
    if (target < 0 || target >= settings.visitorCharIds.length) return;
    const ids = [...settings.visitorCharIds];
    [ids[index], ids[target]] = [ids[target], ids[index]];
    await saveSettings({ visitorCharIds: ids, nextVisitorIndex: 0 });
  };

  const renderArchive = () => (
    <main className="min-h-0 flex-1 overflow-y-auto px-5 pb-[calc(var(--safe-bottom)+92px)] pt-3">
      <div className="flex items-end justify-between gap-4 border-b border-[#ddcdb3] pb-5">
        <div><p className="text-[10px] font-black uppercase tracking-[0.28em] text-[#a45b52]">Archive for later</p><h2 className="mt-2 text-3xl font-black tracking-[-0.05em] text-[#272c3a]">写给以后的事</h2></div>
        <div className="flex h-14 w-14 items-center justify-center rounded-full border border-[#d9c8aa] bg-[#f4ead6] text-[#8c5149]"><HourglassMedium size={27} weight="duotone" /></div>
      </div>
      <div className="mt-4 flex items-center justify-between text-xs text-[#7d7569]"><span>{capsules.length} 枚胶囊</span><span>{capsules.filter(item => !item.openedAt && item.unlockAt <= now).length} 枚等待开启</span></div>
      {capsules.length === 0 ? (
        <div className="py-24 text-center"><LockKey size={42} className="mx-auto text-[#cbb995]" /><p className="mt-4 text-sm font-bold text-[#665e54]">仓库还是空的</p><p className="mt-2 text-xs leading-5 text-[#9a9083]">写给未来的自己，或者请一位角色留下一段以后才会看到的话。</p></div>
      ) : <div className="mt-5 space-y-4">{capsules.map(capsule => {
        const due = capsule.unlockAt <= now;
        const opened = !!capsule.openedAt;
        const progress = Math.max(0, Math.min(100, ((now - capsule.createdAt) / Math.max(1, capsule.unlockAt - capsule.createdAt)) * 100));
        return <article key={capsule.id} className={`overflow-hidden rounded-[24px] border ${opened ? 'border-[#d8c8aa] bg-[#fffdf7]' : due ? 'border-[#bd6b60] bg-[#fff8ef]' : 'border-[#ded3c1] bg-[#f3ecdf]'}`}>
          <div className="p-5">
            <div className="flex items-start gap-3">
              {capsule.charName ? <Avatar char={{ name: capsule.charName, avatar: capsule.charAvatar || '' }} size="h-10 w-10" /> : <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#273044] text-white"><PencilSimple size={18} /></div>}
              <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><span className={`rounded-full px-2 py-1 text-[9px] font-black ${opened ? 'bg-[#e9dfc9] text-[#645b4d]' : due ? 'bg-[#a9534d] text-white' : 'bg-[#ddd0b8] text-[#655b4b]'}`}>{opened ? '已开启' : due ? '时间到了' : '封存中'}</span><span className="truncate text-[10px] text-[#94897a]">{sourceLabel(capsule)}</span></div><h3 className="mt-2 truncate text-base font-black text-[#2b3040]">{capsule.title}</h3></div>
              <button onClick={() => void deleteCapsule(capsule)} className="p-2 text-[#a3776e]" aria-label="删除胶囊"><Trash size={17} /></button>
            </div>
            {opened ? <div className="mt-5 border-t border-[#e6dac5] pt-4"><p className="whitespace-pre-wrap text-sm leading-7 text-[#46443f]">{capsule.content}</p><p className="mt-5 text-[10px] text-[#9a8f7f]">封存于 {formatDate(capsule.createdAt)}</p></div>
              : due ? <div className="mt-5"><p className="text-xs leading-5 text-[#7e685e]">它已经在这里等你了。正文只会在你按下开启后出现。</p><button onClick={() => void openCapsule(capsule)} className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#a9534d] text-xs font-black text-white"><EnvelopeSimpleOpen size={18} />开启这枚胶囊</button></div>
              : <div className="mt-5 border-t border-[#dfd2bd] pt-4"><div className="flex items-center justify-between"><span className="flex items-center gap-1.5 text-xs font-bold text-[#6d6356]"><LockKey size={15} />{formatTimeCapsuleDistance(capsule.unlockAt, now)}</span><span className="text-[10px] text-[#988c7b]">{formatDate(capsule.unlockAt)}</span></div><div className="mt-3 h-1 overflow-hidden rounded-full bg-[#ddd0bb]"><div className="h-full rounded-full bg-[#a9534d]" style={{ width: `${progress}%` }} /></div></div>}
          </div>
        </article>;
      })}</div>}
    </main>
  );

  const renderWrite = () => (
    <main className="min-h-0 flex-1 overflow-y-auto px-5 pb-[calc(var(--safe-bottom)+92px)] pt-3">
      <h2 className="text-2xl font-black tracking-[-0.04em] text-[#272c3a]">埋下一枚</h2><p className="mt-2 text-sm leading-6 text-[#786f63]">封存后不能编辑。到达开启时间前，仓库不会展示正文。</p>
      <label className="mt-7 block"><span className="mb-2 block text-[10px] font-black tracking-[0.18em] text-[#8c5149]">封面题签</span><input value={title} onChange={event => setTitle(event.target.value)} maxLength={80} placeholder="给未来的我" className="h-12 w-full rounded-2xl border border-[#d9cbb5] bg-[#fffdf8] px-4 text-sm outline-none focus:border-[#a9534d]" /></label>
      <label className="mt-5 block"><span className="mb-2 block text-[10px] font-black tracking-[0.18em] text-[#8c5149]">胶囊正文</span><textarea value={content} onChange={event => setContent(event.target.value)} maxLength={12000} placeholder="现在想留下什么？" className="h-56 w-full resize-none rounded-2xl border border-[#d9cbb5] bg-[#fffdf8] p-4 text-sm leading-6 outline-none focus:border-[#a9534d]" /></label>
      <label className="mt-5 block"><span className="mb-2 block text-[10px] font-black tracking-[0.18em] text-[#8c5149]">开启时间 · 一年以内</span><input type="datetime-local" value={unlockValue} min={toLocalDateTimeInput(Date.now() + 60_000)} max={toLocalDateTimeInput(maxTimeCapsuleUnlockAt())} onChange={event => setUnlockValue(event.target.value)} className="h-12 w-full rounded-2xl border border-[#d9cbb5] bg-[#fffdf8] px-4 text-sm outline-none focus:border-[#a9534d]" /></label>
      <button onClick={() => void sealOwn()} className="mt-7 flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-[#273044] py-4 text-sm font-black text-white"><LockKey size={19} />确认封存</button>
    </main>
  );

  const renderInvite = () => (
    <main className="min-h-0 flex-1 overflow-y-auto px-5 pb-[calc(var(--safe-bottom)+92px)] pt-3">
      <h2 className="text-2xl font-black tracking-[-0.04em] text-[#272c3a]">请 ta 留一枚</h2><p className="mt-2 text-sm leading-6 text-[#786f63]">角色会带着主聊天里的身份、语境与记忆来写，并自己决定一年以内的开启日。正文生成后也不会提前展示。</p>
      {characters.length === 0 ? <div className="py-20 text-center text-sm text-[#968b7d]">先去神经链接创建角色，才能邀请 ta。</div> : <div className="mt-7 grid grid-cols-3 gap-3">{characters.map(char => {
        const selected = inviteCharId === char.id;
        return <button key={char.id} onClick={() => setInviteCharId(char.id)} className={`flex flex-col items-center gap-2 rounded-[20px] border py-4 ${selected ? 'border-[#a9534d] bg-[#f6e7dc]' : 'border-[#ddd1bf] bg-[#fffdf8]'}`}><Avatar char={char} /><span className="w-full truncate px-2 text-xs font-black text-[#3c3d43]">{char.name}</span></button>;
      })}</div>}
      <div className="mt-8 rounded-2xl border border-dashed border-[#cdbb9e] p-4"><p className="text-xs font-black text-[#6d514b]">隐私边界</p><p className="mt-2 text-xs leading-5 text-[#81776b]">邀请只会新增本机胶囊：不发到聊天、不写长期记忆，也不会调用 MCP。到期后仍由你决定何时开启。</p></div>
      <button disabled={!inviteCharId || !!busyCharId} onClick={() => void inviteCharacter()} className="mt-6 flex h-13 w-full items-center justify-center gap-2 rounded-2xl bg-[#a9534d] py-4 text-sm font-black text-white disabled:opacity-50"><UserCirclePlus size={19} />{busyCharId ? `${characters.find(char => char.id === busyCharId)?.name || 'ta'}正在写…` : '邀请 ta 来写'}</button>
    </main>
  );

  const renderVisitors = () => (
    <main className="min-h-0 flex-1 overflow-y-auto px-5 pb-[calc(var(--safe-bottom)+92px)] pt-3">
      <h2 className="text-2xl font-black tracking-[-0.04em] text-[#272c3a]">来访名单</h2><p className="mt-2 text-sm leading-6 text-[#786f63]">像任务工坊一样按名单轮流来访。第一版仅在 SullyOS 打开且页面可见时运行。</p>
      <section className="mt-7 border-y border-[#d9cbb5] py-5"><div className="flex items-center justify-between"><div><h3 className="text-sm font-black text-[#343844]">自动来访</h3><p className="mt-1 text-xs text-[#8b8174]">同一角色有未开启自动胶囊时不会继续堆积</p></div><button disabled={!settings.visitorCharIds.length} onClick={() => void saveSettings({ enabled: !settings.enabled, lastVisitAt: settings.enabled ? settings.lastVisitAt : Date.now() })} className={`relative h-7 w-12 rounded-full transition-colors disabled:opacity-40 ${settings.enabled ? 'bg-[#a9534d]' : 'bg-[#d7cbbb]'}`}><span className={`absolute left-1 top-1 h-5 w-5 rounded-full bg-white shadow transition-transform ${settings.enabled ? 'translate-x-5' : ''}`} /></button></div>
        <label className="mt-5 block"><span className="mb-2 block text-[10px] font-black tracking-[0.15em] text-[#8c5149]">来访间隔</span><select value={settings.intervalMinutes} onChange={event => void saveSettings({ intervalMinutes: Number(event.target.value) })} className="h-11 w-full rounded-xl border border-[#d9cbb5] bg-[#fffdf8] px-3 text-sm"><option value={15}>15 分钟</option><option value={60}>1 小时</option><option value={360}>6 小时</option><option value={720}>12 小时</option><option value={1440}>24 小时</option><option value={4320}>3 天</option><option value={10080}>7 天</option></select></label></section>
      <div className="mt-6 grid grid-cols-4 gap-3">{characters.map(char => { const selected = settings.visitorCharIds.includes(char.id); return <button key={char.id} onClick={() => void toggleVisitor(char.id)} className={`flex flex-col items-center gap-1.5 rounded-2xl py-3 ${selected ? 'bg-[#f0ded2] text-[#71463f]' : 'bg-[#fffdf8] text-[#8c8174]'}`}><Avatar char={char} size="h-11 w-11" /><span className="w-full truncate px-1 text-[10px] font-bold">{char.name}</span></button>; })}</div>
      {settings.visitorCharIds.length > 0 && <div className="mt-7 divide-y divide-[#e2d7c7] border-t border-[#d9cbb5]">{settings.visitorCharIds.map((charId, index) => { const char = characters.find(item => item.id === charId); if (!char) return null; return <div key={charId} className="flex items-center gap-3 py-3"><span className="w-5 text-center text-xs font-black text-[#a69076]">{index + 1}</span><Avatar char={char} size="h-9 w-9" /><b className="min-w-0 flex-1 truncate text-xs text-[#3c3d43]">{char.name}</b><button disabled={index === 0} onClick={() => void moveVisitor(index, -1)} className="p-2 text-[#8c5149] disabled:opacity-20"><ArrowUp size={15} /></button><button disabled={index === settings.visitorCharIds.length - 1} onClick={() => void moveVisitor(index, 1)} className="p-2 text-[#8c5149] disabled:opacity-20"><ArrowDown size={15} /></button></div>; })}</div>}
    </main>
  );

  const nav = [
    ['archive', '仓库', HourglassMedium], ['write', '我来写', Plus], ['invite', '邀请', UserCirclePlus], ['visitors', '来访', UsersThree],
  ] as const;

  return <div className="relative flex h-full w-full flex-col overflow-hidden bg-[#f8f3e9] text-slate-900">
    <header className="shrink-0 border-b border-[#dfd3c1] bg-[#fbf7ef]" style={{ paddingTop: 'var(--safe-top)' }}><div className="flex h-16 items-center justify-between px-4"><button onClick={goBack} className="-ml-2 flex h-11 w-11 items-center justify-center rounded-full text-[#333846]" aria-label="返回"><CaretLeft size={27} /></button><div className="text-center"><h1 className="font-black tracking-[-0.02em] text-[#272c3a]">时间胶囊</h1><p className="text-[9px] font-bold tracking-[0.18em] text-[#a45b52]">TIME CAPSULE</p></div><ClockCountdown size={23} className="mr-2 text-[#8c5149]" /></div></header>
    {tab === 'archive' ? renderArchive() : tab === 'write' ? renderWrite() : tab === 'invite' ? renderInvite() : renderVisitors()}
    <nav className="absolute inset-x-0 bottom-0 grid grid-cols-4 border-t border-[#dfd3c1] bg-[#fffaf1]/95 px-2 pb-[var(--safe-bottom)]"><div className="contents">{nav.map(([id, label, Icon]) => <button key={id} onClick={() => setTab(id)} className={`flex h-16 flex-col items-center justify-center gap-1 text-[10px] font-black ${tab === id ? 'text-[#a14f48]' : 'text-[#9a8e7f]'}`}><Icon size={21} weight={tab === id ? 'fill' : 'regular'} />{label}</button>)}</div></nav>
  </div>;
};

export default TimeCapsuleApp;
