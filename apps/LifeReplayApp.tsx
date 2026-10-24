import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowRight, CaretLeft, ClockCounterClockwise, FilmSlate, LockKey, NotePencil,
  Plus, ShieldCheck, Trash,
} from '@phosphor-icons/react';
import { LifeReplayEditor } from '../components/lifeReplay/LifeReplayEditor';
import { LifeReplayScene } from '../components/lifeReplay/LifeReplayScene';
import { useOS } from '../context/OSContext';
import { useLifeReplay } from '../hooks/useLifeReplay';
import type { CharacterProfile, LifeReplayBlueprint, LifeReplayPreset } from '../types';
import { emptyLifeReplayBlueprint } from '../utils/lifeReplay';

type View = 'home' | 'compose' | 'editor' | 'select' | 'scene';

const Header: React.FC<{ title: string; onBack: () => void; right?: React.ReactNode }> = ({ title, onBack, right }) => (
  <header className="shrink-0 border-b border-slate-200 bg-[#f7f6fb]" style={{ paddingTop: 'var(--safe-top)' }}>
    <div className="flex h-16 items-center justify-between px-4">
      <button onClick={onBack} className="-ml-2 flex h-11 w-11 items-center justify-center rounded-full text-slate-700 hover:bg-white" aria-label="返回"><CaretLeft size={27} /></button>
      <h1 className="font-black tracking-[-0.02em] text-slate-900">{title}</h1>
      <div className="flex min-w-11 justify-end">{right}</div>
    </div>
  </header>
);

const Avatar: React.FC<{ char: CharacterProfile; selected?: boolean }> = ({ char, selected }) => (
  <div className={`h-14 w-14 overflow-hidden rounded-full bg-indigo-100 ${selected ? 'ring-4 ring-indigo-300' : 'ring-2 ring-white'}`}>
    {char.avatar ? <img src={char.avatar} alt={char.name} className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center text-lg font-black text-indigo-700">{char.name.slice(0, 1)}</div>}
  </div>
);

const LifeReplayApp: React.FC = () => {
  const { closeApp, registerBackHandler, addToast } = useOS();
  const {
    characters, userProfile, presets, sessions, busy, busyLabel, error, setError,
    analyze, savePreset, startSession, submitAction, completeSession, remove,
  } = useLifeReplay();
  const [view, setView] = useState<View>('home');
  const [sourceText, setSourceText] = useState('');
  const [desiredChange, setDesiredChange] = useState('');
  const [boundaries, setBoundaries] = useState('');
  const [draftBlueprint, setDraftBlueprint] = useState<LifeReplayBlueprint>(emptyLifeReplayBlueprint());
  const [editingPresetId, setEditingPresetId] = useState('');
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [selectedCharId, setSelectedCharId] = useState('');
  const [activeSessionId, setActiveSessionId] = useState('');

  const selectedPreset = presets.find(item => item.id === selectedPresetId) || null;
  const editingPreset = presets.find(item => item.id === editingPresetId) || null;
  const activeSession = sessions.find(item => item.id === activeSessionId) || null;
  const activeChar = characters.find(item => item.id === activeSession?.charId) || null;
  const activeSessions = useMemo(() => sessions.filter(item => item.status === 'active'), [sessions]);
  const completedSessions = useMemo(() => sessions.filter(item => item.status === 'completed'), [sessions]);

  const resetDraft = () => {
    setSourceText(''); setDesiredChange(''); setBoundaries('');
    setDraftBlueprint(emptyLifeReplayBlueprint()); setEditingPresetId(''); setError('');
  };

  const goHome = () => {
    setView('home'); setActiveSessionId(''); setSelectedPresetId(''); setSelectedCharId(''); setError('');
  };

  const goBack = useCallback(() => {
    if (view === 'home') { closeApp(); return true; }
    if (view === 'editor') { setView(editingPresetId ? 'select' : 'compose'); return true; }
    if (view === 'scene' || view === 'select' || view === 'compose') { goHome(); return true; }
    goHome(); return true;
  }, [closeApp, editingPresetId, view]);

  useEffect(() => registerBackHandler(goBack), [goBack, registerBackHandler]);

  const beginNew = () => { resetDraft(); setView('compose'); };

  const parseDraft = async () => {
    if (sourceText.trim().length < 20) { setError('请先写下更完整的事件经过，至少 20 个字。'); return; }
    try {
      const blueprint = await analyze(sourceText, desiredChange, boundaries);
      setDraftBlueprint(blueprint); setView('editor');
    } catch { /* hook 保留可恢复错误 */ }
  };

  const editPreset = (preset: LifeReplayPreset) => {
    setEditingPresetId(preset.id); setSelectedPresetId(preset.id); setSourceText(preset.sourceText);
    setDraftBlueprint(structuredClone(preset.blueprint)); setView('editor'); setError('');
  };

  const saveDraft = async () => {
    if (!draftBlueprint.title.trim()) { setError('请给这段过去一个档案标题。'); return; }
    if (!draftBlueprint.openingScene.trim()) { setError('请补充你们抵达时的第一幕。'); return; }
    try {
      const saved = await savePreset(sourceText, draftBlueprint, editingPreset);
      setSelectedPresetId(saved.id); setEditingPresetId(saved.id); setView('select');
      addToast('场景预设已保存在本机', 'success');
    } catch { setError('预设保存失败，请重试。'); }
  };

  const openPreset = (preset: LifeReplayPreset) => {
    setSelectedPresetId(preset.id); setSelectedCharId(''); setView('select'); setError('');
  };

  const enterReplay = async () => {
    if (!selectedPreset || !selectedCharId) { setError('请选择一位和你同行的角色。'); return; }
    try {
      const session = await startSession(selectedPreset, selectedCharId);
      setActiveSessionId(session.id); setView('scene');
    } catch { /* hook 已记录错误 */ }
  };

  const openSession = (id: string) => { setActiveSessionId(id); setView('scene'); setError(''); };

  const removeRecord = async (id: string, name: string) => {
    if (!window.confirm(`删除“${name}”？本机中的这条记录将无法恢复。`)) return;
    try { await remove(id); addToast('记录已删除', 'success'); } catch { addToast('删除失败，请重试', 'error'); }
  };

  const title = view === 'home' ? '人生重映' : view === 'compose' ? '写下一段过去' : view === 'editor' ? '编辑场景档案' : view === 'select' ? '选择同行者' : activeSession?.presetTitle || '重映现场';

  const renderHome = () => (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[calc(var(--safe-bottom)+28px)] pt-6">
      <div className="mx-auto max-w-2xl">
        <section className="overflow-hidden rounded-2xl bg-[#151a35] text-white shadow-[0_20px_55px_rgba(21,26,53,0.23)]">
          <div className="h-2 bg-[linear-gradient(90deg,#4057b8,#bf718e,#f0b38e)]" />
          <div className="p-6">
            <ClockCounterClockwise size={34} weight="duotone" className="text-rose-200" />
            <h2 className="mt-5 max-w-sm text-3xl font-black tracking-[-0.035em]">带一个现在愿意陪你的人，回到那一刻。</h2>
            <p className="mt-4 max-w-lg text-sm leading-7 text-indigo-100">AI 会先整理事件、过去的你和现场人物；所有内容都能编辑。重映只改变这次叙事模拟，不改写已经发生的事实。</p>
            <button onClick={beginNew} className="mt-6 flex h-12 items-center gap-2 rounded-xl bg-white px-5 text-sm font-black text-[#151a35] shadow-[0_8px_24px_rgba(0,0,0,0.18)]"><Plus size={19} weight="bold" />新建一段过去</button>
          </div>
        </section>

        <div className="mt-5 flex items-start gap-3 rounded-2xl bg-indigo-50 px-4 py-3 text-xs leading-5 text-indigo-900"><LockKey size={19} className="mt-0.5 shrink-0" /><span>原始日记、解析和演绎默认完全私密，只保存在本机；不会写入聊天或长期记忆。</span></div>

        {activeSessions.length > 0 && <section className="mt-8"><h2 className="text-lg font-black text-slate-900">继续重映</h2><div className="mt-3 divide-y divide-slate-200">{activeSessions.map(session => { const char = characters.find(item => item.id === session.charId); return <button key={session.id} onClick={() => openSession(session.id)} className="flex w-full items-center gap-3 py-4 text-left"><div className="flex -space-x-3"><div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 text-sm font-black text-rose-700 ring-2 ring-[#f7f6fb]">旧</div>{char && <Avatar char={char} />}</div><div className="min-w-0 flex-1"><b className="block truncate text-sm text-slate-900">{session.presetTitle}</b><span className="mt-1 block text-xs text-slate-500">和 {char?.name || '未知角色'} · 已进行 {session.turns.length} 幕</span></div><ArrowRight size={18} className="text-slate-400" /></button>; })}</div></section>}

        <section className="mt-8">
          <div className="flex items-end justify-between"><div><h2 className="text-lg font-black text-slate-900">场景档案</h2><p className="mt-1 text-xs text-slate-500">点开直接选人，再次进入前也能微调。</p></div><span className="text-xs font-bold text-slate-400">{presets.length} 件</span></div>
          {presets.length === 0 ? <div className="mt-4 py-10 text-center text-sm text-slate-500">还没有保存过的过去。</div> : <div className="mt-3 divide-y divide-slate-200">{presets.map(preset => (
            <div key={preset.id} className="flex items-center gap-3 py-4">
              <button onClick={() => openPreset(preset)} className="min-w-0 flex-1 text-left"><b className="block truncate text-sm text-slate-900">{preset.blueprint.title}</b><span className="mt-1 block truncate text-xs text-slate-500">{[preset.blueprint.period, preset.blueprint.location, `${preset.blueprint.npcs.length} 位现场人物`].filter(Boolean).join(' · ')}</span></button>
              <button onClick={() => editPreset(preset)} className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-500 hover:bg-white" aria-label="编辑预设"><NotePencil size={18} /></button>
              <button onClick={() => void removeRecord(preset.id, preset.blueprint.title)} className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="删除预设"><Trash size={18} /></button>
            </div>
          ))}</div>}
        </section>

        {completedSessions.length > 0 && (
          <section className="mt-8">
            <h2 className="text-lg font-black text-slate-900">已经停下的重映</h2>
            <div className="mt-3 divide-y divide-slate-200">
              {completedSessions.map(session => {
                const charName = characters.find(item => item.id === session.charId)?.name || '未知角色';
                const title = `${session.presetTitle}-${charName}`;
                return (
                  <div key={session.id} className="flex items-center gap-3 py-4">
                    <button onClick={() => openSession(session.id)} className="min-w-0 flex-1 text-left">
                      <b className="block truncate text-sm text-slate-800">{title}</b>
                      <span className="mt-1 block text-xs text-slate-500">{new Date(session.updatedAt).toLocaleString('zh-CN')}</span>
                    </button>
                    <button onClick={() => void removeRecord(session.id, title)} className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label={`删除记录：${title}`}>
                      <Trash size={18} />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        )}
      </div>
    </div>
  );

  const renderCompose = () => (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[calc(var(--safe-bottom)+28px)] pt-6">
      <div className="mx-auto max-w-2xl">
        <h2 className="text-2xl font-black tracking-[-0.03em] text-slate-900">不必先整理好，再交给这里。</h2>
        <p className="mt-3 text-sm leading-7 text-slate-600">可以是一整段日记、零散回忆或按时间写下的经过。AI 只负责整理，下一步每一项都由你确认和修改。</p>
        <label className="mt-6 block"><span className="mb-2 block text-xs font-black text-slate-700">当时发生了什么</span><textarea value={sourceText} onChange={event => setSourceText(event.target.value)} rows={13} placeholder="把你愿意交给这次重映的部分写在这里……" className="w-full resize-y rounded-2xl bg-white px-4 py-4 text-sm leading-7 text-slate-900 shadow-[0_8px_28px_rgba(30,41,59,0.08)] outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-400" /></label>
        <label className="mt-5 block"><span className="mb-2 block text-xs font-black text-slate-700">希望这次有什么不同</span><textarea value={desiredChange} onChange={event => setDesiredChange(event.target.value)} rows={3} placeholder="例如：希望有人相信当时的我，或只是陪在旁边。可以留空。" className="w-full resize-y rounded-2xl bg-white px-4 py-3 text-sm leading-6 text-slate-900 shadow-[0_5px_18px_rgba(30,41,59,0.07)] outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-400" /></label>
        <label className="mt-5 block"><span className="mb-2 block text-xs font-black text-slate-700">不要出现什么</span><textarea value={boundaries} onChange={event => setBoundaries(event.target.value)} rows={3} placeholder="不想重现的细节、不能接受的走向或明确边界。" className="w-full resize-y rounded-2xl bg-white px-4 py-3 text-sm leading-6 text-slate-900 shadow-[0_5px_18px_rgba(30,41,59,0.07)] outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-400" /></label>
        <div className="mt-5 flex items-start gap-3 text-xs leading-5 text-slate-500"><ShieldCheck size={19} className="mt-0.5 shrink-0 text-indigo-600" /><span>这是叙事模拟，不替代现实支持。你可以设置边界、随时退出，也不需要让故事变得“圆满”。</span></div>
        {error && <div className="mt-5 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>}
        <button onClick={() => void parseDraft()} disabled={busy || sourceText.trim().length < 20} className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-5 text-sm font-black text-white shadow-[0_10px_28px_rgba(79,70,229,0.24)] disabled:bg-slate-300 disabled:shadow-none"><FilmSlate size={20} weight="fill" />整理成可编辑场景</button>
      </div>
    </div>
  );

  const renderEditor = () => (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[calc(var(--safe-bottom)+28px)] pt-6">
      <div className="mx-auto max-w-2xl"><LifeReplayEditor sourceText={sourceText} blueprint={draftBlueprint} onSourceChange={setSourceText} onChange={setDraftBlueprint} />{error && <div className="mb-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>}<button onClick={() => void saveDraft()} disabled={busy} className="flex h-12 w-full items-center justify-center rounded-2xl bg-indigo-600 px-5 text-sm font-black text-white shadow-[0_10px_28px_rgba(79,70,229,0.24)] disabled:opacity-50">保存档案并选择同行者</button></div>
    </div>
  );

  const renderSelect = () => selectedPreset && (
    <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-[calc(var(--safe-bottom)+28px)] pt-6">
      <div className="mx-auto max-w-2xl">
        <div className="rounded-2xl bg-[#151a35] p-5 text-white shadow-[0_16px_45px_rgba(21,26,53,0.2)]"><h2 className="text-xl font-black tracking-[-0.02em]">{selectedPreset.blueprint.title}</h2><p className="mt-2 text-sm leading-6 text-indigo-100">{selectedPreset.blueprint.openingScene}</p><button onClick={() => editPreset(selectedPreset)} className="mt-4 flex items-center gap-2 text-xs font-bold text-rose-200"><NotePencil size={16} />进入前微调档案</button></div>
        <h2 className="mt-8 text-lg font-black text-slate-900">这一次，谁和你一起去？</h2>
        <p className="mt-2 text-xs leading-5 text-slate-500">ta 会带着你们的聊天上下文和长期记忆进入，并按自己的世界观理解眼前发生的事。</p>
        {characters.length === 0 ? <div className="mt-6 rounded-2xl bg-rose-50 p-4 text-sm text-rose-800">还没有可以同行的角色，请先在“神经链接”中创建角色。</div> : <div className="mt-5 grid grid-cols-3 gap-3">{characters.map(char => <button key={char.id} onClick={() => setSelectedCharId(char.id)} className={`flex min-h-28 flex-col items-center justify-center rounded-2xl px-2 py-3 text-center shadow-[0_5px_18px_rgba(30,41,59,0.07)] ${selectedCharId === char.id ? 'bg-indigo-600 text-white' : 'bg-white text-slate-800'}`}><Avatar char={char} selected={selectedCharId === char.id} /><span className="mt-2 max-w-full truncate text-xs font-black">{char.name}</span></button>)}</div>}
        <div className="mt-5 rounded-2xl bg-indigo-50 px-4 py-3 text-xs leading-5 text-indigo-900">入场和之后每一轮约调用 2 次 API：一次让角色自主回应，一次让中立导演推进过去的我、NPC 和环境。</div>
        {error && <div className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-sm text-rose-800">{error}</div>}
        <button onClick={() => void enterReplay()} disabled={busy || !selectedCharId} className="mt-6 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 px-5 text-sm font-black text-white shadow-[0_10px_28px_rgba(79,70,229,0.24)] disabled:bg-slate-300 disabled:shadow-none"><ClockCounterClockwise size={20} weight="bold" />一起抵达那一刻</button>
      </div>
    </div>
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-[#f7f6fb] text-slate-900">
      <Header title={title} onBack={goBack} />
      {view === 'home' && renderHome()}
      {view === 'compose' && renderCompose()}
      {view === 'editor' && renderEditor()}
      {view === 'select' && renderSelect()}
      {view === 'scene' && activeSession && activeChar && <LifeReplayScene key={activeSession.id} session={activeSession} char={activeChar} userName={userProfile.name || '现在的我'} busy={busy} busyLabel={busyLabel} error={error} onSubmit={async value => { await submitAction(activeSession, value); }} onComplete={async () => { await completeSession(activeSession); }} />}
      {busy && view !== 'scene' && <div className="pointer-events-none absolute inset-x-4 bottom-[calc(var(--safe-bottom)+18px)] z-20 mx-auto max-w-md rounded-2xl bg-[#151a35] px-4 py-3 text-center text-sm font-bold text-white shadow-[0_14px_35px_rgba(21,26,53,0.3)]"><span className="mr-2 inline-block h-2.5 w-2.5 animate-pulse rounded-full bg-rose-300" />{busyLabel}</div>}
    </div>
  );
};

export default LifeReplayApp;
