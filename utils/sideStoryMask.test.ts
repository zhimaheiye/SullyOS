import { describe, expect, it } from 'vitest';
import { normalizeStoryMaskWords, splitStoryMaskedText } from './sideStoryMask';

const visible = (parts: ReturnType<typeof splitStoryMaskedText>) => parts.filter(part => part.kind === 'text').map(part => part.text).join('');
describe('literal screenshot blanks', () => {
    it('ignores empty and duplicate entries while preserving exact case and symbols', () => {
        expect(normalizeStoryMaskWords(['', '  ', '小雨', '小雨', 'a+b?', 'A+b?'])).toEqual(['小雨', 'a+b?', 'A+b?']);
        const parts = splitStoryMaskedText('小雨，a+b? 与 A+b?；a+B?', ['小雨', 'a+b?', 'A+b?']);
        expect(visible(parts)).toBe('， 与 ；a+B?');
        expect(parts.filter(part => part.kind === 'blank')).toHaveLength(3);
        expect(JSON.stringify(parts)).not.toMatch(/小雨|a\+b\?|A\+b\?/);
    });
    it('uses longest match first, including overlapping and adjacent words', () => {
        const parts = splitStoryMaskedText('小城主小城，小雨', ['小城', '小城主', '小雨']);
        expect(visible(parts)).toBe('，');
        expect(parts.filter(part => part.kind === 'blank')).toHaveLength(3);
        expect((parts[0] as any).widthEm).toBe(3);
    });
    it('conceals a streamed prefix until it completes, while completed text stays visible', () => {
        expect(visible(splitStoryMaskedText('今天见小', ['小雨'], true))).toBe('今天见');
        expect(visible(splitStoryMaskedText('今天见小雨', ['小雨'], true))).toBe('今天见');
        expect(visible(splitStoryMaskedText('今天见芝兰', ['小雨'], false))).toBe('今天见芝兰');
        expect(visible(splitStoryMaskedText('今天见芝', ['小雨'], false))).toBe('今天见芝');
    });
    it('handles a long reader without changing the original string', () => {
        const source = '开场 小雨，城主。\n'.repeat(5000);
        const parts = splitStoryMaskedText(source, ['小雨', '城主']);
        expect(source).toContain('小雨');
        expect(visible(parts)).not.toContain('小雨');
        expect(parts.filter(part => part.kind === 'blank')).toHaveLength(10_000);
    });
});
