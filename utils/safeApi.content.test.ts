import { describe, expect, it } from 'vitest';
import { extractContent, extractReasoningContent } from './safeApi';

describe('extractContent structured responses', () => {
    it('reads string content', () => {
        expect(extractContent({ choices: [{ message: { content: ' hello ' } }] })).toBe('hello');
    });

    it('joins OpenAI-style structured text parts', () => {
        expect(extractContent({ choices: [{ message: { content: [
            { type: 'text', text: '你' },
            { type: 'text', text: '好' },
        ] } }] })).toBe('你好');
    });

    it('accepts object content without calling string methods on the object', () => {
        expect(extractContent({ choices: [{ message: { content: { text: 'pong' } } }] })).toBe('pong');
    });

    it.each(['reasoning_content', 'reasoning', 'thinking'] as const)(
        'reads the %s reasoning channel used by compatible providers',
        (field) => {
            const response = { choices: [{ message: { content: '正文', [field]: '心象内容' } }] };
            expect(extractReasoningContent(response)).toBe('心象内容');
        },
    );

    it.each(['reasoning', 'thinking'] as const)(
        'falls back to %s when a thinking model leaves content empty',
        (field) => {
            expect(extractContent({ choices: [{ message: { content: '', [field]: '最终回复' } }] })).toBe('最终回复');
        },
    );
});
