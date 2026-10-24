import type { AppID } from '../types';

const key = (appId: AppID) => `sullyos:app-intent:${appId}`;

export function setAppLaunchIntent<T>(appId: AppID, intent: T): void {
  sessionStorage.setItem(key(appId), JSON.stringify(intent));
  window.dispatchEvent(new CustomEvent('sullyos-app-intent', { detail: { appId } }));
}

export function consumeAppLaunchIntent<T>(appId: AppID): T | null {
  const raw = sessionStorage.getItem(key(appId));
  if (!raw) return null;
  sessionStorage.removeItem(key(appId));
  try { return JSON.parse(raw) as T; } catch { return null; }
}
