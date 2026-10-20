import { describe, expect, it } from 'vitest';
import type { CharacterProfile, Message } from '../types';
import {
    buildOfficialImagePrompt,
    formatPositiveNegative,
    imagePromptSummaryForHistory,
    parseImagePromptResult,
} from './imagePromptCard';
import { resolveJournalTemplate } from './journal';

describe('image prompt cards stay text-only', () => {
    const char = { name: '林', imageGeneration: { enabled: true, appearanceAnchors: '黑短发', referenceImage: 'https://example.test/face.png' } } as CharacterProfile;

    it('parses a fenced JSON result and ignores a response without both fields', () => {
        expect(parseImagePromptResult('```json\n{"summary":"窗边","fullPrompt":"窗边的人","negative":"文字"}\n```')).toEqual({
            summary: '窗边', fullPrompt: '窗边的人', negative: '文字',
        });
        expect(parseImagePromptResult('{"summary":"只有摘要"}')).toBeNull();
        expect(parseImagePromptResult('不是 JSON')).toBeNull();
    });

    it('keeps the full prompt out of routine history and does not claim a reference upload', () => {
        const prompt = buildOfficialImagePrompt(char, '靠窗坐下', true);
        const card = { type: 'image_prompt', content: '窗边的自拍', metadata: { imagePrompt: { source: 'chat', fullPrompt: prompt } } } as Message;
        expect(prompt).toContain('黑短发');
        expect(prompt).toContain('没有自动上传');
        expect(imagePromptSummaryForHistory(card)).toContain('窗边的自拍');
        expect(imagePromptSummaryForHistory(card)).not.toContain(prompt);
        expect(formatPositiveNegative(prompt, '水印')).toContain('反向提示词：\n水印');
    });
});

describe('journal template resolver', () => {
    it('keeps the built-in page unless the user chose custom or blank', () => {
        expect(resolveJournalTemplate(null)).toContain('今天的一个不足之处');
        expect(resolveJournalTemplate({ mode: 'blank' })).toBe('');
        expect(resolveJournalTemplate({ mode: 'custom', customText: '只写一句' })).toBe('只写一句');
        expect(resolveJournalTemplate({ mode: 'builtin', customText: '先留着' })).toContain('今天的一个不足之处');
    });
});
