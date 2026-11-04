import { beforeEach, describe, expect, it, vi } from 'vitest';
import { endMetaExperience, prepareMetaPrompt, readActiveMeta, recordMetaReroll, startMetaExperience } from './metaExperience';

describe('public Meta experience', () => {
    beforeEach(() => {
        vi.stubGlobal('localStorage', (() => {
            const data = new Map<string, string>();
            return { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => data.set(key, value), removeItem: (key: string) => data.delete(key) };
        })());
        vi.stubGlobal('window', { dispatchEvent: vi.fn() });
        vi.stubGlobal('crypto', { randomUUID: () => 'meta-id' });
    });

    it('starts, counts rerolls and ends only the active character experience', () => {
        startMetaExperience('char-a');
        recordMetaReroll('char-b');
        expect(readActiveMeta()?.rerollCount).toBe(0);
        recordMetaReroll('char-a');
        expect(readActiveMeta()?.rerollCount).toBe(1);
        endMetaExperience();
        expect(readActiveMeta()).toBeNull();
    });

    it('injects an honest development prompt only for the selected character', () => {
        startMetaExperience('char-a');
        expect(prepareMetaPrompt({ id: 'char-b', name: 'B' }, [])).toBeNull();
        expect(prepareMetaPrompt({ id: 'char-a', name: 'A' }, []))
            .toContain('仍在开发中的 Meta 功能');
    });
});
