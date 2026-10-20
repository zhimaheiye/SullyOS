// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ThinkingChainBlock } from '../components/chat/MessageItem';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks(); });

describe('thinking translation card controls', () => {
    it('switches preview and body without collapsing, and isolates pointer/click events', async () => {
        const host = document.createElement('div'); document.body.append(host);
        const root = createRoot(host);
        const outerClick = vi.fn(); const outerPointerDown = vi.fn();
        await act(async () => root.render(React.createElement('div', { onClick: outerClick, onPointerDown: outerPointerDown },
            React.createElement(ThinkingChainBlock, { chain: 'Original thought is here.', translation: '中文译文在这里。', onTranslate: async () => '' }))));
        const card = host.querySelector('.sully-psyche') as HTMLElement;
        const button = host.querySelector('.sully-psyche-translate') as HTMLButtonElement;
        expect(host.querySelector('.sully-psyche-preview')?.textContent).toContain('中文译文');
        await act(async () => card.click());
        expect(host.querySelector('.sully-psyche-body')?.textContent).toContain('中文译文');
        await act(async () => {
            button.dispatchEvent(new Event('pointerdown', { bubbles: true }));
            button.click();
        });
        expect(host.querySelector('.sully-psyche-body')?.textContent).toContain('Original thought');
        expect(host.querySelector('.sully-psyche-preview')).toBeNull();
        expect(button.getAttribute('aria-label')).toBe('查看译文');
        expect(outerClick).not.toHaveBeenCalled();
        expect(outerPointerDown).not.toHaveBeenCalled();
        await act(async () => root.unmount());
    });

    it('keeps the original readable after a failed request and permits a retry', async () => {
        const host = document.createElement('div'); document.body.append(host);
        const root = createRoot(host);
        const request = vi.fn().mockRejectedValueOnce(new Error('请先配置副 API')).mockResolvedValueOnce('我在想。');
        await act(async () => root.render(React.createElement(ThinkingChainBlock, { chain: 'I am thinking about it.', onTranslate: request })));
        const button = host.querySelector('.sully-psyche-translate') as HTMLButtonElement;
        await act(async () => button.click());
        expect(host.textContent).toContain('请先配置副 API');
        expect(host.querySelector('.sully-psyche-preview')?.textContent).toContain('I am thinking');
        await act(async () => button.click());
        expect(request).toHaveBeenCalledTimes(2);
        expect(host.querySelector('.sully-psyche-preview')?.textContent).toContain('我在想');
        await act(async () => root.unmount());
    });

    it('shows an automatic failure as a retryable state without hiding the source', async () => {
        const host = document.createElement('div'); document.body.append(host);
        const root = createRoot(host);
        const request = vi.fn().mockResolvedValue('我在想。');
        await act(async () => root.render(React.createElement(ThinkingChainBlock, {
            chain: 'I am thinking about it.', translationError: '副 API 暂时限流（HTTP 429）', onTranslate: request,
        })));
        expect(host.querySelector('.sully-psyche-preview')?.textContent).toContain('I am thinking');
        expect(host.textContent).toContain('副 API 暂时限流');
        await act(async () => (host.querySelector('.sully-psyche-translate') as HTMLButtonElement).click());
        expect(request).toHaveBeenCalledOnce();
        expect(host.querySelector('.sully-psyche-preview')?.textContent).toContain('我在想');
        await act(async () => root.unmount());
    });
});
