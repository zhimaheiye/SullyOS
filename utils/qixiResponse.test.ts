import { describe, expect, it } from 'vitest';
import { inspectQixiResponse } from './qixiResponse';

describe('Qixi response candidate inspection', () => {
    it('concatenates sequential text blocks without inserting characters into JSON strings', () => {
        const inspection = inspectQixiResponse({
            choices: [{ message: { content: [
                { type: 'text', text: '{"returnMessage":"刚才没' },
                { type: 'text', text: '说完的话。"}' },
            ] } }],
        });

        expect(inspection.candidates[0]).toEqual({
            name: 'content',
            text: '{"returnMessage":"刚才没说完的话。"}',
        });
    });

    it('preserves whitespace inside a JSON string when it falls on a block boundary', () => {
        const inspection = inspectQixiResponse({
            choices: [{ message: { content: [
                { type: 'text', text: '{"returnMessage":"以后想起 ' },
                { type: 'text', text: '彼此。"}' },
            ] } }],
        });

        expect(inspection.candidates[0]).toEqual({
            name: 'content',
            text: '{"returnMessage":"以后想起 彼此。"}',
        });
    });

    it('keeps block-level thinking as a separate candidate from short visible content', () => {
        const inspection = inspectQixiResponse({
            choices: [{ message: { content: [
                { type: 'text', text: '好的，我来写结局。' },
                { type: 'thinking', thinking: '{"reunion":{"lines":["找到你了。"]}}' },
            ] } }],
        });

        expect(inspection.candidates).toEqual([
            { name: 'content', text: '好的，我来写结局。' },
            { name: 'content_reasoning', text: '{"reunion":{"lines":["找到你了。"]}}' },
        ]);
    });
});
