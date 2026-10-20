// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyTextToClipboard } from './clipboard';

const html = `<style>
.foo::after { content: "</>"; }
</style>

<div class="foo">
  测试 &amp; 中文 😀
</div>`;

afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
});

describe('copyTextToClipboard', () => {
    it('passes the source through unchanged to the Clipboard API', async () => {
        const writeText = vi.fn().mockResolvedValue(undefined);
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

        await expect(copyTextToClipboard(html)).resolves.toBe(true);
        expect(writeText).toHaveBeenCalledWith(html);
    });

    it('falls back to a temporary textarea when the Clipboard API rejects', async () => {
        const writeText = vi.fn().mockRejectedValue(new Error('denied'));
        const execCommand = vi.fn().mockReturnValue(true);
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
        Object.defineProperty(document, 'execCommand', { configurable: true, value: execCommand });

        const appendChild = vi.spyOn(document.body, 'appendChild');
        await expect(copyTextToClipboard(html)).resolves.toBe(true);

        const textarea = appendChild.mock.calls[0][0] as HTMLTextAreaElement;
        expect(textarea.value).toBe(html);
        expect(execCommand).toHaveBeenCalledWith('copy');
        expect(textarea.isConnected).toBe(false);
    });

    it.each([0, 10 * 1024, 50 * 1024, 100 * 1024])(
        'copies ordinary strings without changing their length (%i bytes)',
        async (length) => {
            const text = 'x'.repeat(length);
            const writeText = vi.fn().mockResolvedValue(undefined);
            Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });

            await expect(copyTextToClipboard(text)).resolves.toBe(true);
            expect(writeText.mock.calls[0][0]).toBe(text);
            expect(writeText.mock.calls[0][0]).toHaveLength(text.length);
        },
    );
});
