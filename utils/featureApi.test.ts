import { afterEach, describe, expect, it } from 'vitest';
import { FEATURE_API_STORAGE_KEY, loadFeatureApiSettings, normalizeFeatureApiSettings,
  resolveFeatureApi, routeMarkedFeatureRequest, saveFeatureApiSetting } from './featureApi';

const main = { baseUrl: 'https://main.example/v1', apiKey: 'main-key', model: 'main-model' };
const memory = { baseUrl: 'https://memory.example/v1', apiKey: 'memory-key', model: 'memory-model' };
const role = { emotionConfig: { enabled: true, api: { baseUrl: 'https://role.example/v1', apiKey: 'role-key', model: 'role-model' } } };

afterEach(() => localStorage.removeItem(FEATURE_API_STORAGE_KEY));

describe('per-feature text API routing', () => {
  it('keeps four independent URL/Key/Model groups through storage reload', () => {
    const ids = ['emotion', 'thinkingTranslation', 'characterLife', 'memoryLight'] as const;
    for (const [index, id] of ids.entries()) saveFeatureApiSetting(id, { mode: 'independent', api: {
      baseUrl: `https://feature-${index}.example/v1`, apiKey: `key-${index}`, model: `model-${index}`,
    } });
    const loaded = loadFeatureApiSettings();
    for (const [index, id] of ids.entries()) {
      expect(loaded[id]).toEqual({ mode: 'independent', api: {
        baseUrl: `https://feature-${index}.example/v1`, apiKey: `key-${index}`, model: `model-${index}`,
      } });
    }
    saveFeatureApiSetting('thinkingTranslation', { mode: 'follow' });
    expect(loadFeatureApiSettings().memoryLight).toEqual(loaded.memoryLight);
  });

  it('preserves role precedence and legacy fallback without mixing fields', () => {
    const settings = normalizeFeatureApiSettings({ emotion: { mode: 'independent', api: {
      baseUrl: 'https://global.example/v1', apiKey: 'global-key', model: 'global-model' } } });
    expect(resolveFeatureApi('emotion', { mainApi: main, character: role }, settings).api?.model).toBe('role-model');
    expect(resolveFeatureApi('emotion', { mainApi: main }, settings).api).toEqual(settings.emotion?.mode === 'independent' && settings.emotion.api);
    expect(resolveFeatureApi('thinkingTranslation', { mainApi: main, memoryApi: memory }, {}).api?.model).toBe('memory-model');
    expect(resolveFeatureApi('thinkingTranslation', { mainApi: main }, {}).api).toBeNull();
    expect(resolveFeatureApi('characterLife', { mainApi: main }, {}).api).toBeNull();
    expect(resolveFeatureApi('memoryLight', { mainApi: main, memoryApi: memory }, {}).api?.model).toBe('memory-model');
    expect(resolveFeatureApi('memoryLight', { mainApi: main }, {}).api?.model).toBe('main-model');
  });

  it('routes a marked analysis request with one feature snapshot and leaves another request alone', () => {
    saveFeatureApiSetting('memoryLight', { mode: 'independent', api: {
      baseUrl: 'https://new-memory.example/v1/', apiKey: 'new-key', model: 'new-model' } });
    const oldOptions: RequestInit = { method: 'POST', headers: { Authorization: 'Bearer old-key' },
      body: JSON.stringify({ model: 'old-model', messages: [{ role: 'user', content: 'private' }] }) };
    const routed = routeMarkedFeatureRequest('memoryLight', 'https://old.example/v1/chat/completions', oldOptions);
    expect(routed.url).toBe('https://new-memory.example/v1/chat/completions');
    expect(new Headers(routed.options.headers).get('Authorization')).toBe('Bearer new-key');
    expect(JSON.parse(String(routed.options.body)).model).toBe('new-model');
    expect(routeMarkedFeatureRequest('myScheduleParse', 'https://old.example/v1/chat/completions', oldOptions).options).toBe(oldOptions);
    expect(JSON.parse(String(oldOptions.body)).model).toBe('old-model');
  });
});
