// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import JournalTextarea from '../components/journal/JournalTextarea';

// jsdom has no layout: mock measured dimensions, never launch a browser.
let root: Root;
let paper: HTMLDivElement;
let width: number;
let contentHeight: number;
let notifyResize: () => void;
const disconnect = vi.fn();

beforeEach(() => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
    vi.stubGlobal('ResizeObserver', class {
        constructor(callback: () => void) { notifyResize = callback; }
        observe() {}
        disconnect = disconnect;
    });
    width = 320;
    contentHeight = 600;
    paper = document.createElement('div');
    paper.className = 'sully-journal-page-content';
    document.body.appendChild(paper);
    root = createRoot(paper);
    vi.spyOn(HTMLTextAreaElement.prototype, 'clientWidth', 'get').mockImplementation(() => width);
    vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get').mockImplementation(() => {
        // Simulate the scroll clamping caused by measuring a temporarily short input.
        paper.scrollTop = 0;
        return contentHeight;
    });
});

afterEach(() => {
    act(() => root.unmount());
    paper.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    disconnect.mockClear();
});

function renderText(value: string) {
    act(() => root.render(createElement(JournalTextarea, {
        value,
        readOnly: true,
        className: 'min-h-24',
        style: { border: '1px solid black' },
    })));
    return paper.querySelector('textarea')!;
}

describe('journal continuous-paper textareas', () => {
    it('fits saved text, grows and shrinks without an inner scrollbar or paper scroll jump', () => {
        paper.scrollTop = 240;
        const input = renderText('已保存的长日记\n第二段');
        expect(input.style.height).toBe('602px');
        expect(input.style.overflow).toBe('hidden');
        expect(input.style.resize).toBe('none');
        expect(input.style.boxSizing).toBe('border-box');
        expect(paper.scrollTop).toBe(240);
        expect(input.value).toBe('已保存的长日记\n第二段');
        expect(input.readOnly).toBe(true);

        contentHeight = 900;
        expect(renderText('更长的内容')).toBe(input); // Keep focus/selection DOM identity.
        expect(input.style.height).toBe('902px');
        contentHeight = 96;
        renderText('短内容');
        expect(input.style.height).toBe('98px');
        expect(paper.scrollTop).toBe(240);
    });

    it('measures collapsed observations when opened and reflows on width changes, not height-only notifications', () => {
        width = 0;
        const input = renderText('折叠区中已有的事情');
        expect(input.style.height).toBe('');
        width = 320;
        act(() => notifyResize());
        expect(input.style.height).toBe('602px');

        contentHeight = 1000;
        act(() => notifyResize()); // Own resize notification: no measurement loop.
        expect(input.style.height).toBe('602px');
        width = 180;
        act(() => notifyResize());
        expect(input.style.height).toBe('1002px');

        width = 0;
        act(() => notifyResize());
        expect(input.style.height).toBe('1002px');
        width = 500;
        contentHeight = 300;
        act(() => notifyResize());
        expect(input.style.height).toBe('302px');
        act(() => root.render(null));
        expect(disconnect).toHaveBeenCalledOnce();
    });
});
