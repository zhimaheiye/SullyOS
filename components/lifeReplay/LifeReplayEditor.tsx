import React from 'react';
import { Plus, Trash } from '@phosphor-icons/react';
import type { LifeReplayBlueprint, LifeReplayNpc } from '../../types';

const labelClass = 'mb-1.5 block text-xs font-bold text-slate-600';
const inputClass = 'w-full rounded-xl bg-white px-3.5 py-3 text-sm leading-6 text-slate-900 shadow-[0_5px_18px_rgba(30,41,59,0.07)] outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-400';

const Field: React.FC<{
  label: string; value: string; onChange: (value: string) => void; placeholder?: string; rows?: number;
}> = ({ label, value, onChange, placeholder, rows }) => (
  <label className="block">
    <span className={labelClass}>{label}</span>
    {rows ? <textarea value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} rows={rows} className={`${inputClass} resize-y`} />
      : <input value={value} onChange={event => onChange(event.target.value)} placeholder={placeholder} className={inputClass} />}
  </label>
);

export const LifeReplayEditor: React.FC<{
  sourceText: string;
  blueprint: LifeReplayBlueprint;
  onSourceChange: (value: string) => void;
  onChange: (value: LifeReplayBlueprint) => void;
}> = ({ sourceText, blueprint, onSourceChange, onChange }) => {
  const set = <K extends keyof LifeReplayBlueprint>(key: K, value: LifeReplayBlueprint[K]) => onChange({ ...blueprint, [key]: value });
  const setPast = (key: keyof LifeReplayBlueprint['pastSelf'], value: string) => set('pastSelf', { ...blueprint.pastSelf, [key]: value });
  const updateNpc = (index: number, patch: Partial<LifeReplayNpc>) => set('npcs', blueprint.npcs.map((npc, i) => i === index ? { ...npc, ...patch } : npc));

  return (
    <div className="space-y-8 pb-8">
      <section>
        <h2 className="text-lg font-black tracking-[-0.02em] text-slate-900">原始叙述</h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">只保存在本机。修改后不会自动重新解析，当前蓝图仍由你手动决定。</p>
        <textarea value={sourceText} onChange={event => onSourceChange(event.target.value)} rows={8} className={`${inputClass} mt-3 resize-y`} />
      </section>

      <section className="border-t border-slate-200 pt-7">
        <h2 className="text-lg font-black tracking-[-0.02em] text-slate-900">事件轮廓</h2>
        <div className="mt-4 grid gap-4">
          <Field label="档案标题" value={blueprint.title} onChange={value => set('title', value)} placeholder="例如：初二那场雨" />
          <div className="grid grid-cols-2 gap-3">
            <Field label="当时的时期" value={blueprint.period} onChange={value => set('period', value)} placeholder="年龄、年级或年份" />
            <Field label="主要地点" value={blueprint.location} onChange={value => set('location', value)} placeholder="教室、家里……" />
          </div>
          <Field label="前因与背景" value={blueprint.background} onChange={value => set('background', value)} rows={4} />
          <Field label="事件触发点" value={blueprint.trigger} onChange={value => set('trigger', value)} rows={3} />
        </div>
      </section>

      <section className="border-t border-slate-200 pt-7">
        <div className="flex items-center justify-between gap-3">
          <div><h2 className="text-lg font-black tracking-[-0.02em] text-slate-900">事情经过</h2><p className="mt-1 text-xs text-slate-500">按先后顺序整理，随时可增删。</p></div>
          <button onClick={() => set('chronology', [...blueprint.chronology, ''])} className="flex h-10 items-center gap-1.5 rounded-xl bg-indigo-50 px-3 text-xs font-bold text-indigo-700"><Plus size={16} />增加一步</button>
        </div>
        <div className="mt-4 space-y-3">
          {blueprint.chronology.map((item, index) => (
            <div key={index} className="flex items-start gap-2">
              <span className="mt-3 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-bold text-white">{index + 1}</span>
              <textarea value={item} onChange={event => set('chronology', blueprint.chronology.map((entry, i) => i === index ? event.target.value : entry))} rows={2} className={`${inputClass} resize-y`} />
              <button onClick={() => set('chronology', blueprint.chronology.filter((_, i) => i !== index))} className="mt-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="删除这一步"><Trash size={18} /></button>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-slate-200 pt-7">
        <h2 className="text-lg font-black tracking-[-0.02em] text-slate-900">{blueprint.pastSelf.label || '过去的我'}</h2>
        <p className="mt-1 text-xs leading-5 text-slate-500">这是现场中的独立人物，不是当前由你控制的视角。</p>
        <div className="mt-4 grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="场景称呼" value={blueprint.pastSelf.label} onChange={value => setPast('label', value)} />
            <Field label="年龄 / 阶段" value={blueprint.pastSelf.ageStage} onChange={value => setPast('ageStage', value)} />
          </div>
          <Field label="当时的情绪状态" value={blueprint.pastSelf.emotionalState} onChange={value => setPast('emotionalState', value)} rows={3} />
          <Field label="当时相信什么" value={blueprint.pastSelf.beliefs} onChange={value => setPast('beliefs', value)} rows={3} />
          <Field label="当时真正需要什么" value={blueprint.pastSelf.needs} onChange={value => setPast('needs', value)} rows={3} />
          <Field label="害怕什么" value={blueprint.pastSelf.fears} onChange={value => setPast('fears', value)} rows={3} />
          <Field label="外在表现" value={blueprint.pastSelf.behavior} onChange={value => setPast('behavior', value)} rows={3} />
        </div>
      </section>

      <section className="border-t border-slate-200 pt-7">
        <div className="flex items-center justify-between gap-3">
          <div><h2 className="text-lg font-black tracking-[-0.02em] text-slate-900">现场人物</h2><p className="mt-1 text-xs text-slate-500">每个人只知道当时能知道的事。</p></div>
          <button onClick={() => set('npcs', [...blueprint.npcs, { id: `npc-${Date.now()}`, name: '', role: '', persona: '', knowledge: '' }])} className="flex h-10 items-center gap-1.5 rounded-xl bg-indigo-50 px-3 text-xs font-bold text-indigo-700"><Plus size={16} />增加人物</button>
        </div>
        <div className="mt-4 space-y-6">
          {blueprint.npcs.map((npc, index) => (
            <div key={npc.id} className="border-t border-slate-200 pt-5 first:border-0 first:pt-0">
              <div className="mb-3 flex items-center justify-between"><b className="text-sm text-slate-800">{npc.name || `人物 ${index + 1}`}</b><button onClick={() => set('npcs', blueprint.npcs.filter((_, i) => i !== index))} className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-rose-50 hover:text-rose-600" aria-label="删除人物"><Trash size={17} /></button></div>
              <div className="grid gap-3">
                <div className="grid grid-cols-2 gap-3"><Field label="姓名" value={npc.name} onChange={value => updateNpc(index, { name: value })} /><Field label="身份 / 关系" value={npc.role} onChange={value => updateNpc(index, { role: value })} /></div>
                <Field label="性格和当时的态度" value={npc.persona} onChange={value => updateNpc(index, { persona: value })} rows={3} />
                <Field label="当时知道的信息" value={npc.knowledge} onChange={value => updateNpc(index, { knowledge: value })} rows={3} />
              </div>
            </div>
          ))}
        </div>
      </section>

      <section className="border-t border-slate-200 pt-7">
        <h2 className="text-lg font-black tracking-[-0.02em] text-slate-900">重映规则</h2>
        <div className="mt-4 grid gap-4">
          <Field label="抵达时的第一幕" value={blueprint.openingScene} onChange={value => set('openingScene', value)} rows={4} />
          <Field label="希望改变的方向" value={blueprint.desiredChange} onChange={value => set('desiredChange', value)} rows={3} />
          <Field label="不希望出现的内容" value={blueprint.boundaries} onChange={value => set('boundaries', value)} rows={3} />
          <Field label="场景导演提示词" value={blueprint.scenePrompt} onChange={value => set('scenePrompt', value)} rows={7} />
        </div>
      </section>
    </div>
  );
};
