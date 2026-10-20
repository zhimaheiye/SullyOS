import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AppID } from '../types';
import { consumeAppLaunchIntent, setAppLaunchIntent } from './appLaunchIntent';

describe('generic app launch intent', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('sessionStorage', { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value), removeItem: (key: string) => values.delete(key), clear: () => values.clear() });
    const target = new EventTarget();
    vi.stubGlobal('window', target);
  });
  afterEach(() => vi.unstubAllGlobals());
  it('stores once per app and consumes exactly once', () => { setAppLaunchIntent(AppID.TimeCapsule, { sessionId: 's' }); expect(consumeAppLaunchIntent(AppID.TimeCapsule)).toEqual({ sessionId: 's' }); expect(consumeAppLaunchIntent(AppID.TimeCapsule)).toBeNull(); });
  it('does not consume another app intent', () => { setAppLaunchIntent(AppID.TimeCapsule, { sessionId: 's' }); expect(consumeAppLaunchIntent(AppID.Chat)).toBeNull(); expect(consumeAppLaunchIntent(AppID.TimeCapsule)).toEqual({ sessionId: 's' }); });
  it('emits a lightweight wake event', () => { const listener = vi.fn(); window.addEventListener('sullyos-app-intent', listener); setAppLaunchIntent(AppID.TimeCapsule, { sessionId: 's' }); expect(listener).toHaveBeenCalledOnce(); window.removeEventListener('sullyos-app-intent', listener); });
});
