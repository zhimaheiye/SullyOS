// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIConfig, CharacterProfile, UserProfile } from '../types';
import CardCreationModal from '../components/chat/CardCreationModal';
import { generateCardDraft, publishCardDraft } from './cardCreation';

vi.mock('./cardCreation', async importOriginal => ({ ...await importOriginal<typeof import('./cardCreation')>(), generateCardDraft: vi.fn(), publishCardDraft: vi.fn() }));

const card = { html: '<div>今晚见</div>', textPreview: '今晚见' };
const role = { id: 'first', name: '甲' } as CharacterProfile;
const user = { name: '我' } as UserProfile;
const api = {} as APIConfig;
let container: HTMLDivElement;
let root: Root;
let active = 'first';
let onPublished: ReturnType<typeof vi.fn>;
let onClose: ReturnType<typeof vi.fn>;

const render = (char = role) => act(() => root.render(React.createElement(CardCreationModal, {
    key: char.id, char, user, api, isCurrentCharacter: (id: string) => id === active, onPublished, onClose,
})));
const button = (label: string) => [...container.querySelectorAll('button')].find(item => item.textContent?.includes(label))!;
const input = (value: string) => act(() => {
    const textarea = container.querySelector('textarea')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(textarea, value);
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
});

beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
    active = 'first';
    onPublished = vi.fn();
    onClose = vi.fn();
    vi.mocked(generateCardDraft).mockReset();
    vi.mocked(publishCardDraft).mockReset();
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

describe('card creation modal request isolation', () => {
    it('uses only the preview card source bar to copy the complete draft HTML', async () => {
        const html = '<div data-note="a &amp; b">今晚见\n<span>别迟到</span></div>';
        const writeText = vi.fn().mockResolvedValue(undefined);
        const previousClipboard = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
        try {
            vi.mocked(generateCardDraft).mockResolvedValue({ html, textPreview: '今晚见 别迟到' });
            render();
            expect(container.querySelector('iframe')).toBeNull();
            input('做邀请函');
            await act(async () => { button('生成卡片').click(); });
            expect(container.querySelector('iframe')?.srcdoc).toContain(html);
            expect([...container.querySelectorAll('button')].filter(item => item.textContent?.includes('复制源码') && !item.closest('.sully-html-source-bar'))).toHaveLength(0);
            const copyButton = container.querySelector<HTMLButtonElement>('.sully-html-copy-button')!;
            expect(copyButton.getAttribute('aria-hidden')).toBe('true');
            act(() => container.querySelector<HTMLButtonElement>('[aria-label="展开 HTML 源码操作"]')!.click());
            expect(copyButton.getAttribute('aria-hidden')).toBe('false');
            await act(async () => { copyButton.click(); });
            expect(writeText).toHaveBeenCalledWith(html);
            expect(copyButton.textContent).toContain('已复制');
            writeText.mockRejectedValueOnce(new Error('clipboard unavailable'));
            await act(async () => { copyButton.click(); });
            expect(copyButton.textContent).toContain('复制失败');
            expect(publishCardDraft).not.toHaveBeenCalled();
        } finally {
            if (previousClipboard) Object.defineProperty(navigator, 'clipboard', previousClipboard);
            else Reflect.deleteProperty(navigator, 'clipboard');
        }
    });

    it.each([
        ['API Error 429: server busy: global concurrency limit reached', '全局并发'],
        ["API Error 500: convert_request_failed: mime type is not supported by Gemini: 'image/gif'", 'image/gif'],
        ['网络断开', '网络断开'],
        ['CARD_CREATION_TIMEOUT', '180 秒'],
    ])('shows a useful error, ends waiting and keeps the request after %s', async (failure, expected) => {
        vi.mocked(generateCardDraft).mockRejectedValueOnce(new Error(failure)).mockResolvedValueOnce(card);
        render();
        input('  做邀请函  ');
        await act(async () => { button('生成卡片').click(); });
        expect(container.textContent).toContain(expected);
        expect(button('生成卡片')).toBeTruthy();
        expect(container.querySelector('textarea')?.value).toBe('  做邀请函  ');
        await act(async () => { button('生成卡片').click(); });
        expect(container.querySelector('iframe')?.srcdoc).toContain('今晚见');
        expect(container.querySelector('[role=status]')).toBeNull();
    });

    it('shows a live phase and elapsed time, then resets immediately when stopped', async () => {
        vi.useFakeTimers();
        vi.mocked(generateCardDraft).mockReturnValue(new Promise(() => {}));
        try {
            render();
            input('做邀请函');
            await act(async () => { button('生成卡片').click(); });
            expect(container.querySelector('[role=status]')?.textContent).toContain('0 秒');
            act(() => vi.advanceTimersByTime(2000));
            expect(container.querySelector('[role=status]')?.textContent).toContain('2 秒');
            act(() => button('停止生成').click());
            expect(button('生成卡片')).toBeTruthy();
            expect(container.querySelector('[role=status]')).toBeNull();
            expect(container.querySelector('textarea')?.value).toBe('做邀请函');
        } finally {
            vi.useRealTimers();
        }
    });

    it('keeps a successful preview after a failed retry and ignores an older late error', async () => {
        let rejectOld!: (error: Error) => void;
        vi.mocked(generateCardDraft)
            .mockResolvedValueOnce(card)
            .mockReturnValueOnce(new Promise((_resolve, reject) => { rejectOld = reject; }))
            .mockRejectedValueOnce(new Error('API Error 429: server busy: global concurrency limit reached'));
        render();
        input('做邀请函');
        await act(async () => { button('生成卡片').click(); });
        expect(container.querySelector('iframe')?.srcdoc).toContain('今晚见');
        await act(async () => { button('重新生成').click(); });
        act(() => button('停止生成').click());
        await act(async () => { button('重新生成').click(); });
        expect(container.textContent).toContain('全局并发');
        await act(async () => { rejectOld(new Error('旧请求的错误')); });
        expect(container.textContent).not.toContain('旧请求的错误');
        expect(container.querySelector('iframe')?.srcdoc).toContain('今晚见');
        expect(publishCardDraft).not.toHaveBeenCalled();
    });

    it('aborts on close and ignores a response after unmount', async () => {
        let resolve!: (value: typeof card) => void;
        vi.mocked(generateCardDraft).mockReturnValue(new Promise(done => { resolve = done; }));
        render();
        input('请做卡片');
        await act(async () => { button('生成卡片').click(); });
        const signal = vi.mocked(generateCardDraft).mock.calls[0][0].signal;
        act(() => button('丢弃返回').click());
        expect(signal.aborted).toBe(true);
        expect(onClose).toHaveBeenCalledTimes(1);
        act(() => root.unmount());
        await act(async () => { resolve(card); });
        expect(onPublished).not.toHaveBeenCalled();
    });
    it.each([10_000, 30_000])('keeps a %i-character multiline request through send, stop and failure', async length => {
        const line = '中文＆<div>\n```ts\nconst x = 1;\n```\n';
        const prompt = ` 开头\n${line.repeat(Math.ceil(length / line.length)).slice(0, length - 8)}\n结尾 `;
        expect(prompt).toHaveLength(length);
        vi.mocked(generateCardDraft).mockRejectedValueOnce(new Error('模型上下文不足'));
        render();
        expect(container.querySelector('textarea')?.hasAttribute('maxlength')).toBe(false);
        input(prompt);
        expect(container.querySelector('textarea')?.value).toBe(prompt);
        await act(async () => { button('生成卡片').click(); });
        expect(vi.mocked(generateCardDraft).mock.calls[0][0].request).toBe(prompt);
        expect(container.querySelector('textarea')?.value).toBe(prompt);
        expect(container.textContent).toContain('模型上下文不足');
        let resolve!: (value: typeof card) => void;
        vi.mocked(generateCardDraft).mockReturnValueOnce(new Promise(done => { resolve = done; }));
        await act(async () => { button('生成卡片').click(); });
        act(() => button('停止生成').click());
        await act(async () => { resolve(card); });
        expect(container.querySelector('textarea')?.value).toBe(prompt);
        expect(container.querySelector('iframe')).toBeNull();
    });
    it.each([10_000, 30_000])('drops a late response to a %i-character request after changing characters', async length => {
        let resolve!: (value: typeof card) => void;
        vi.mocked(generateCardDraft).mockReturnValue(new Promise(done => { resolve = done; }));
        render();
        input('长提示词\n'.repeat(length / 5));
        await act(async () => { button('生成卡片').click(); });
        active = 'second';
        render({ id: 'second', name: '乙' } as CharacterProfile);
        await act(async () => { resolve(card); });
        expect(container.textContent).not.toContain('今晚见');
        expect(publishCardDraft).not.toHaveBeenCalled();
        expect(onPublished).not.toHaveBeenCalled();
    });

    it('publishes once on a double click and keeps the draft when persistence fails', async () => {
        vi.mocked(generateCardDraft).mockResolvedValue(card);
        let reject!: (error: Error) => void;
        vi.mocked(publishCardDraft).mockReturnValue(new Promise((_done, fail) => { reject = fail; }));
        render();
        input('做邀请函');
        await act(async () => { button('生成卡片').click(); });
        await act(async () => { button('加入主聊天').click(); button('加入主聊天').click(); });
        expect(publishCardDraft).toHaveBeenCalledTimes(1);
        await act(async () => { reject(new Error('存储失败')); });
        expect(container.textContent).toContain('加入聊天失败');
        expect(container.querySelector('iframe')?.srcdoc).toContain('今晚见');
        expect(onPublished).not.toHaveBeenCalled();
    });

    it('stops an in-flight request and ignores its late result after retry', async () => {
        let finishFirst!: (value: typeof card) => void;
        vi.mocked(generateCardDraft)
            .mockReturnValueOnce(new Promise(done => { finishFirst = done; }))
            .mockResolvedValueOnce({ html: '<div>新卡</div>', textPreview: '新卡' });
        render();
        input('做邀请函');
        await act(async () => { button('生成卡片').click(); button('生成卡片')?.click(); });
        expect(generateCardDraft).toHaveBeenCalledTimes(1);
        act(() => button('停止生成').click());
        await act(async () => { button('生成卡片').click(); });
        await act(async () => { finishFirst(card); });
        expect(container.querySelector('iframe')?.srcdoc).toContain('新卡');
        expect(container.querySelector('iframe')?.srcdoc).not.toContain('今晚见');
        expect(publishCardDraft).not.toHaveBeenCalled();
    });
});
