import React, { useEffect, useState } from 'react';
import type { APIConfig, ApiPreset, CharacterProfile } from '../../types';
import type { MemoryPalaceGlobalConfig } from '../../context/OSContext';
import { DB } from '../../utils/db';
import { extractModelIds } from '../../utils/modelList';
import { FEATURE_APIS, loadFeatureApiSettings, resolveFeatureApi, saveFeatureApiSetting, type FeatureApiId, type TextFeatureApi } from '../../utils/featureApi';
import DialogueApiFields from './DialogueApiFields';
import ModelPicker from './ModelPicker';

const EMPTY: TextFeatureApi = { baseUrl: '', apiKey: '', model: '' };

function FeatureCard({ feature, mainApi, memoryApi, presets, characters, latest }: {
  feature: typeof FEATURE_APIS[number]; mainApi: APIConfig; memoryApi: MemoryPalaceGlobalConfig['lightLLM'];
  presets: ApiPreset[]; characters: CharacterProfile[]; latest?: { ok: boolean; status?: number; timestamp: number; model: string; durationMs?: number };
}) {
  const saved = loadFeatureApiSettings()[feature.id];
  const [draft, setDraft] = useState<TextFeatureApi>(saved?.api || { ...EMPTY });
  const [mode, setMode] = useState<'follow' | 'independent'>(saved?.mode || 'follow');
  const [dirty, setDirty] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);
  const [picker, setPicker] = useState(false);
  const [pickerModel, setPickerModel] = useState('');
  const [status, setStatus] = useState('');
  useEffect(() => {
    const sync = (event: Event) => {
      const changedId = (event as CustomEvent<{ featureId?: FeatureApiId }>).detail?.featureId;
      if (changedId && changedId !== feature.id) return;
      const current = loadFeatureApiSettings()[feature.id];
      setMode(current?.mode || 'follow');
      setDraft(current?.api || { ...EMPTY });
      setDirty(false);
    };
    window.addEventListener('sully-feature-api-changed', sync);
    return () => window.removeEventListener('sully-feature-api-changed', sync);
  }, [feature.id]);
  const roleOverrides = feature.id === 'emotion' ? characters.filter(c => !!c.emotionConfig?.api?.baseUrl) : [];
  const effective = resolveFeatureApi(feature.id, { mainApi, memoryApi });

  const patch = (next: Partial<TextFeatureApi>) => { setDraft(old => ({ ...old, ...next })); setDirty(true); setStatus('有未保存的修改'); };
  const choosePreset = (id: string) => {
    const preset = presets.find(item => item.id === id);
    if (preset) { setMode('independent'); patch({ baseUrl: preset.config.baseUrl, apiKey: preset.config.apiKey,
      model: preset.config.model, stream: preset.config.stream, temperature: preset.config.temperature }); }
  };
  const save = () => {
    if (mode === 'independent' && (!draft.baseUrl.trim() || !draft.model.trim())) {
      setStatus('请填写 URL 和 Model；本地免鉴权接口可以留空 Key'); return;
    }
    try {
      saveFeatureApiSetting(feature.id, mode === 'follow' ? { mode, ...(draft.baseUrl ? { api: draft } : {}) } : { mode, api: draft });
      setDirty(false); setStatus('已保存');
    } catch { setStatus('本机存储失败，请检查存储空间后重试'); }
  };
  const cancel = () => {
    const current = loadFeatureApiSettings()[feature.id];
    setMode(current?.mode || 'follow'); setDraft(current?.api || { ...EMPTY });
    setDirty(false); setStatus('已取消修改');
  };
  const fetchModels = async () => {
    const base = draft.baseUrl.trim().replace(/\/+$/, '');
    if (!base) { setStatus('请先填写 URL'); return; }
    setFetching(true); setStatus('正在拉取模型…');
    try {
      const response = await fetch(`${base}/models`, { headers: { Authorization: `Bearer ${draft.apiKey.trim()}` } });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const list = extractModelIds(await response.json());
      if (!list.length) throw new Error('模型列表为空或格式不兼容');
      setModels(list); setPickerModel(draft.model); setPicker(true); setStatus(`获取到 ${list.length} 个模型`);
    } catch (error) { setStatus(`拉取失败：${error instanceof Error ? error.message : '网络错误'}；可手动填写模型 ID`); }
    finally { setFetching(false); }
  };
  return <details className="rounded-xl border border-slate-200 bg-white p-3" open={dirty || undefined}>
    <summary className="cursor-pointer list-none">
      <div className="flex items-center justify-between gap-2"><strong className="text-sm text-slate-700">{feature.name}</strong>
        <span className="text-[10px] text-slate-500">{effective.source}</span></div>
      <p className="mt-1 text-[11px] text-slate-500">{feature.description}</p>
      <p className="mt-1 break-all text-[11px] text-indigo-600">当前模型：{effective.api?.model || '未配置'}{effective.api?.baseUrl ? ` · ${(() => { try { return new URL(effective.api.baseUrl).host; } catch { return effective.api.baseUrl; } })()}` : ''}</p>
      {status && <p role="status" className="mt-1 text-[11px] text-slate-500">{status}</p>}
    </summary>
    <div className="mt-3 space-y-3 border-t border-slate-100 pt-3">
      <p className="text-[11px] text-slate-500">沿用规则：{feature.follow}</p>
      {roleOverrides.length > 0 && <p className="text-[11px] text-amber-700">角色专属配置优先：{roleOverrides.map(c => `${c.name}（${c.emotionConfig?.api?.model || '未选模型'}）`).join('、')}</p>}
      <div className="flex gap-2 text-xs">
        <button type="button" className={`rounded-lg px-3 py-2 ${mode === 'follow' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100'}`} onClick={() => { setMode('follow'); setDirty(true); setStatus('有未保存的修改'); }}>沿用原有来源</button>
        <button type="button" className={`rounded-lg px-3 py-2 ${mode === 'independent' ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100'}`} onClick={() => { setMode('independent'); setDirty(true); setStatus('有未保存的修改'); }}>独立配置</button>
      </div>
      {mode === 'independent' && <>
        {presets.length > 0 && <select className="w-full rounded-lg border border-slate-200 p-2 text-xs" value="" onChange={event => choosePreset(event.target.value)} aria-label={`${feature.name}选择预设`}>
          <option value="">从已有 API 预设载入…</option>{presets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
        </select>}
        <DialogueApiFields value={draft} onChange={patch} fetchModels={() => void fetchModels()} isLoadingModels={fetching} openModelPicker={() => { setPickerModel(draft.model); setPicker(true); }} showAdvancedOptions={false} />
        {feature.id === 'emotion' && <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={draft.stream === true} onChange={event => patch({ stream: event.target.checked })} />情绪评估使用流式响应</label>}
        {picker && <div className="rounded-xl border border-indigo-100 p-2"><ModelPicker availableModels={models} localModel={pickerModel} setLocalModel={setPickerModel} confirmModelPicker={model => { patch({ model: model.trim() }); setPicker(false); }} /><button type="button" className="mt-1 text-xs text-slate-500" onClick={() => setPicker(false)}>取消选模型</button></div>}
      </>}
      <div className="flex gap-2"><button type="button" className="rounded-lg bg-indigo-600 px-4 py-2 text-xs font-bold text-white" onClick={save}>保存本功能</button>
        <button type="button" className="rounded-lg bg-slate-100 px-4 py-2 text-xs" onClick={cancel}>取消修改</button></div>
      {latest && <p className="text-[11px] text-slate-500">最近调用：{new Date(latest.timestamp).toLocaleString('zh-CN')} · {latest.model} · {latest.ok ? '成功' : `失败 HTTP ${latest.status || '网络错误'}`}{latest.durationMs != null ? ` · ${latest.durationMs}ms` : ''}</p>}
    </div>
  </details>;
}

export default function FeatureApiManager({ mainApi, memoryApi, presets, characters }: {
  mainApi: APIConfig; memoryApi: MemoryPalaceGlobalConfig['lightLLM']; presets: ApiPreset[]; characters: CharacterProfile[];
}) {
  const [latest, setLatest] = useState<Partial<Record<FeatureApiId, { ok: boolean; status?: number; timestamp: number; model: string; durationMs?: number }>>>({});
  const refreshLogs = async () => {
    const entries = await DB.getApiCallLog().catch(() => []);
    const next: typeof latest = {};
    for (const entry of entries.sort((a, b) => b.timestamp - a.timestamp)) {
      if (entry.featureId && !(entry.featureId in next)) next[entry.featureId as FeatureApiId] = entry;
    }
    setLatest(next);
  };
  useEffect(() => { void refreshLogs(); }, []);
  return <div className="space-y-3">
    <p className="text-xs text-slate-500">每项单独保存 URL、Key 和模型。角色专属配置仍优先；切回沿用原有来源不会删除独立配置的备份内容。</p>
    <button type="button" onClick={() => void refreshLogs()} className="text-xs text-indigo-600">刷新最近调用状态</button>
    {FEATURE_APIS.map(feature => <FeatureCard key={feature.id} feature={feature} mainApi={mainApi} memoryApi={memoryApi} presets={presets} characters={characters} latest={latest[feature.id]} />)}
  </div>;
}
