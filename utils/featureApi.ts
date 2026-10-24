import type { APIConfig, CharacterProfile } from '../types';

export type FeatureApiId = 'emotion' | 'thinkingTranslation' | 'characterLife' | 'memoryLight' | 'characterSchedule' | 'myScheduleParse' | 'memorySummary' | 'healingMemory' | 'storyArchive' | 'memoryImport' | 'lifeReplayAnalysis' | 'communitySummary' | 'debateJudging' | 'murderMystery' | 'boardGame';
export type TextFeatureApi = Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model' | 'stream' | 'temperature'>;
export type FeatureApiSetting = { mode: 'follow'; api?: TextFeatureApi } | { mode: 'independent'; api: TextFeatureApi };
export type FeatureApiSettings = Partial<Record<FeatureApiId, FeatureApiSetting>>;
export const FEATURE_API_STORAGE_KEY = 'sully_feature_apis_v1';

export const FEATURE_APIS: ReadonlyArray<{ id: FeatureApiId; name: string; description: string; follow: string }> = [
  { id: 'emotion', name: '角色情绪与意识流', description: '情绪评估、意识流及相关表演判断', follow: '角色专属配置 → 主 API' },
  { id: 'thinkingTranslation', name: '心象翻译', description: '把外语心象译成中文', follow: '记忆轻量副 API → 角色情绪副 API；均无配置时停止' },
  { id: 'memoryLight', name: '记忆宫殿轻量分析', description: '提取、归纳、整理与判断', follow: '原记忆宫殿轻量副 API → 主 API' },
  { id: 'myScheduleParse', name: '我的日程文字解析', description: '从自然语言提取日程事项', follow: '主 API' },
];

/** characterLife 与 communitySummary 已从设置列表撤下（对应入口未挂载），旧配置仍允许读回，避免备份往返丢字段。 */
const IDS = new Set<FeatureApiId>([...FEATURE_APIS.map(feature => feature.id), 'characterLife', 'communitySummary', 'characterSchedule', 'memorySummary', 'healingMemory', 'storyArchive', 'memoryImport', 'lifeReplayAnalysis', 'debateJudging']);
const clean = (value: unknown) => typeof value === 'string' ? value.trim() : '';
const complete = (api: Partial<TextFeatureApi> | null | undefined): api is TextFeatureApi =>
  !!(clean(api?.baseUrl) && clean(api?.model));
const completeWithKey = (api: Partial<TextFeatureApi> | null | undefined): api is TextFeatureApi =>
  complete(api) && !!clean(api.apiKey);

export function normalizeFeatureApiSettings(value: unknown): FeatureApiSettings {
  const input = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const result: FeatureApiSettings = {};
  for (const [key, raw] of Object.entries(input)) {
    if (!IDS.has(key as FeatureApiId) || !raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    if (item.mode === 'follow') {
      const previous = item.api && typeof item.api === 'object' ? item.api as Record<string, unknown> : null;
      result[key as FeatureApiId] = previous ? { mode: 'follow', api: {
        baseUrl: clean(previous.baseUrl).replace(/\/+$/, ''), apiKey: clean(previous.apiKey), model: clean(previous.model),
        ...(typeof previous.stream === 'boolean' ? { stream: previous.stream } : {}),
        ...(typeof previous.temperature === 'number' && Number.isFinite(previous.temperature) ? { temperature: previous.temperature } : {}),
      } } : { mode: 'follow' };
    }
    if (item.mode === 'independent' && item.api && typeof item.api === 'object') {
      const api = item.api as Record<string, unknown>;
      result[key as FeatureApiId] = { mode: 'independent', api: {
        baseUrl: clean(api.baseUrl).replace(/\/+$/, ''), apiKey: clean(api.apiKey), model: clean(api.model),
        ...(typeof api.stream === 'boolean' ? { stream: api.stream } : {}),
        ...(typeof api.temperature === 'number' && Number.isFinite(api.temperature) ? { temperature: api.temperature } : {}),
      } };
    }
  }
  return result;
}

export function loadFeatureApiSettings(): FeatureApiSettings {
  try { return normalizeFeatureApiSettings(JSON.parse(localStorage.getItem(FEATURE_API_STORAGE_KEY) || '{}')); }
  catch { return {}; }
}

export function saveFeatureApiSettings(value: FeatureApiSettings, changedId?: FeatureApiId): void {
  localStorage.setItem(FEATURE_API_STORAGE_KEY, JSON.stringify(normalizeFeatureApiSettings(value)));
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('sully-feature-api-changed', { detail: { featureId: changedId } }));
}

export function saveFeatureApiSetting(id: FeatureApiId, setting: FeatureApiSetting): void {
  saveFeatureApiSettings({ ...loadFeatureApiSettings(), [id]: setting }, id);
}

export interface FeatureApiContext {
  mainApi?: Partial<TextFeatureApi> | null;
  memoryApi?: Partial<TextFeatureApi> | null;
  character?: Pick<CharacterProfile, 'emotionConfig' | 'lifeConfig'> | null;
}
export interface ResolvedFeatureApi {
  api: TextFeatureApi | null;
  source: string;
}

/** Resolve URL, credential and model as one snapshot. A broken explicit override never borrows fields from another source. */
export function resolveFeatureApi(id: FeatureApiId, context: FeatureApiContext = {}, settings = loadFeatureApiSettings()): ResolvedFeatureApi {
  const role = id === 'emotion' ? context.character?.emotionConfig?.api
    : id === 'characterLife' ? context.character?.lifeConfig?.api : undefined;
  if (role?.baseUrl) return { api: complete(role) ? { ...role, baseUrl: clean(role.baseUrl).replace(/\/+$/, '') } : null, source: '角色专属配置' };
  const setting = FEATURE_APIS.some(feature => feature.id === id) ? settings[id] : undefined;
  if (setting?.mode === 'independent') return { api: complete(setting.api) ? setting.api : null, source: '本功能独立配置' };
  if (id === 'thinkingTranslation') {
    if (completeWithKey(context.memoryApi)) return { api: context.memoryApi, source: '原记忆轻量副 API' };
    const emotion = context.character?.emotionConfig?.api;
    return { api: completeWithKey(emotion) ? emotion : null, source: completeWithKey(emotion) ? '角色情绪副 API' : '未配置' };
  }
  if (id === 'characterLife') return { api: null, source: '本地规则' };
  if (id === 'memoryLight' && complete(context.memoryApi)) return { api: context.memoryApi, source: '原记忆轻量副 API' };
  if (id === 'healingMemory' && complete(context.memoryApi)) return { api: context.memoryApi, source: '原记忆轻量副 API' };
  if (id === 'memoryImport') return { api: null, source: '导入时选择的 API' };
  return { api: complete(context.mainApi) ? context.mainApi : null, source: complete(context.mainApi) ? '主 API' : '未配置' };
}

/** Some legacy analysis flows have several internal request builders; route their marked chat requests at one boundary. */
export const MARKED_FEATURE_IDS = ['memoryLight', 'myScheduleParse'] as const;
export type MarkedFeatureApiId = typeof MARKED_FEATURE_IDS[number];
export function isMarkedFeatureApiId(value: string): value is MarkedFeatureApiId {
  return (MARKED_FEATURE_IDS as readonly string[]).includes(value);
}
export function routeMarkedFeatureRequest(id: MarkedFeatureApiId, url: string, options: RequestInit): { url: string; options: RequestInit } {
  const setting = loadFeatureApiSettings()[id];
  if (setting?.mode !== 'independent') return { url, options };
  if (!complete(setting.api)) throw new Error('副 API 配置不完整');
  const body = JSON.parse(String(options.body || '{}')) as Record<string, unknown>;
  const headers = new Headers(options.headers);
  headers.set('Authorization', `Bearer ${setting.api.apiKey || 'sk-none'}`);
  return { url: `${setting.api.baseUrl.replace(/\/+$/, '')}/chat/completions`,
    options: { ...options, headers, body: JSON.stringify({ ...body, model: setting.api.model }) } };
}
