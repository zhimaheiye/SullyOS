export type ApiPresetFloatingSide = 'left' | 'right';

export type ApiPresetFloatingSettings = {
  enabled: boolean;
  side: ApiPresetFloatingSide;
  yRatio: number;
};

export const API_PRESET_FLOATING_STORAGE_KEY = 'sullyos_api_preset_floating_v1';
export const API_PRESET_FLOATING_SETTINGS_EVENT = 'sullyos-api-preset-floating-settings-changed';
export const DEFAULT_API_PRESET_FLOATING_SETTINGS: ApiPresetFloatingSettings = {
  enabled: false,
  side: 'right',
  yRatio: 0.55,
};

type StorageReader = Pick<Storage, 'getItem'>;

const getLocalStorage = (): Storage | null => {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
};

const normalizeSettings = (value: unknown): ApiPresetFloatingSettings => {
  const stored = value && typeof value === 'object' ? value as Partial<ApiPresetFloatingSettings> : {};
  return {
    enabled: typeof stored.enabled === 'boolean' ? stored.enabled : DEFAULT_API_PRESET_FLOATING_SETTINGS.enabled,
    side: stored.side === 'left' || stored.side === 'right'
      ? stored.side
      : DEFAULT_API_PRESET_FLOATING_SETTINGS.side,
    yRatio: typeof stored.yRatio === 'number' && Number.isFinite(stored.yRatio)
      ? Math.min(1, Math.max(0, stored.yRatio))
      : DEFAULT_API_PRESET_FLOATING_SETTINGS.yRatio,
  };
};

export const loadApiPresetFloatingSettings = (
  storage: StorageReader | null = getLocalStorage(),
): ApiPresetFloatingSettings => {
  if (!storage) return { ...DEFAULT_API_PRESET_FLOATING_SETTINGS };
  try {
    return normalizeSettings(JSON.parse(storage.getItem(API_PRESET_FLOATING_STORAGE_KEY) ?? 'null'));
  } catch {
    return { ...DEFAULT_API_PRESET_FLOATING_SETTINGS };
  }
};

export const updateApiPresetFloatingSettings = (
  patch: Partial<ApiPresetFloatingSettings>,
): ApiPresetFloatingSettings => {
  const next = normalizeSettings({ ...loadApiPresetFloatingSettings(), ...patch });
  const storage = getLocalStorage();
  try {
    storage?.setItem(API_PRESET_FLOATING_STORAGE_KEY, JSON.stringify(next));
  } catch {
    // localStorage 不可用时仍通知当前标签页，开关本次会话立即生效。
  }
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<ApiPresetFloatingSettings>(API_PRESET_FLOATING_SETTINGS_EVENT, { detail: next }));
  }
  return next;
};

export const subscribeApiPresetFloatingSettings = (
  listener: (settings: ApiPresetFloatingSettings) => void,
): (() => void) => {
  if (typeof window === 'undefined') return () => {};
  const handleChange = (event: Event) => {
    if (event.type === 'storage' && (event as StorageEvent).key !== API_PRESET_FLOATING_STORAGE_KEY) return;
    const detail = event.type === API_PRESET_FLOATING_SETTINGS_EVENT
      ? (event as CustomEvent<ApiPresetFloatingSettings>).detail
      : null;
    listener(detail ? normalizeSettings(detail) : loadApiPresetFloatingSettings());
  };
  window.addEventListener(API_PRESET_FLOATING_SETTINGS_EVENT, handleChange);
  window.addEventListener('storage', handleChange);
  return () => {
    window.removeEventListener(API_PRESET_FLOATING_SETTINGS_EVENT, handleChange);
    window.removeEventListener('storage', handleChange);
  };
};
