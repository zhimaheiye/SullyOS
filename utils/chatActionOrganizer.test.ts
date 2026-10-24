// @vitest-environment jsdom
import React from 'react';
import { act } from 'react-dom/test-utils';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ChatActionOrganizer from '../components/chat/ChatActionOrganizer';
import { loadChatActionOrders } from './chatActionOrder';

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
const action = vi.fn();
const tiles = Array.from({ length: 10 }, (_, index) => React.createElement('button', {
    key: `tile-${index}`, onClick: action, disabled: index === 9,
}, `功能${index}`));
const find = (id: string) => host.querySelector<HTMLElement>(`[data-chat-action-id="${id}"]`)!;
const pointer = (target: Element, type: string, x: number, y = 90) => {
    const event = new MouseEvent(type, { bubbles: true, cancelable: true, button: 0, clientX: x, clientY: y });
    Object.defineProperty(event, 'pointerId', { value: 1 });
    act(() => target.dispatchEvent(event));
};
const click = (selector: string) => act(() => host.querySelector<HTMLButtonElement>(selector)!.click());
const clickText = (label: string) => act(() => [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.trim() === label)!.click());

beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    localStorage.clear();
    action.mockClear();
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    (document as any).elementFromPoint = vi.fn(() => null);
});
afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe('shared chat action organizer', () => {
    it('keeps ordinary buttons active, but editing blocks both enabled and disabled actions', () => {
        act(() => root.render(React.createElement(ChatActionOrganizer, { scope: 'private', tiles })));
        act(() => find('tile-0').querySelector('button')!.click());
        expect(action).toHaveBeenCalledTimes(1);
        click('[aria-label="编辑功能顺序"]');
        act(() => find('tile-0').querySelector('button')!.click());
        act(() => find('tile-9').querySelector('button')!.click());
        expect(action).toHaveBeenCalledTimes(1);
        expect(find('tile-9').querySelector('button')!.disabled).toBe(true);
        expect(loadChatActionOrders().private).toEqual([]);
    });

    it('moves a last-page tile to the first page by edge hover and saves only on Done', () => {
        vi.useFakeTimers();
        act(() => root.render(React.createElement(ChatActionOrganizer, { scope: 'private', tiles })));
        click('[aria-label="编辑功能顺序"]');
        click('[aria-label="第 2 页"]');
        const panel = host.querySelector<HTMLElement>('.overflow-y-auto.no-scrollbar')!;
        vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 400, top: 0, bottom: 300 } as DOMRect);
        (document as any).elementFromPoint = vi.fn(() => host.querySelector('[aria-label="聊天功能第 1 页"]')?.className.includes('hidden') ? null : find('tile-0'));
        pointer(find('tile-9'), 'pointerdown', 150);
        pointer(panel, 'pointermove', 140);
        pointer(panel, 'pointermove', 10);
        act(() => vi.advanceTimersByTime(449));
        expect(host.querySelector('[aria-label="聊天功能第 2 页"]')?.className).not.toContain('hidden');
        act(() => vi.advanceTimersByTime(1));
        expect(host.querySelector('[aria-label="聊天功能第 1 页"]')?.className).not.toContain('hidden');
        pointer(panel, 'pointermove', 100);
        pointer(panel, 'pointermove', 100); // repeated move over one tile must not toggle the order
        pointer(panel, 'pointerup', 100);
        expect(find('tile-9').parentElement?.getAttribute('aria-label')).toBe('聊天功能第 1 页');
        expect(loadChatActionOrders().private).toEqual([]);
        clickText('恢复默认顺序');
        // Reset confirmation is deliberately staged; the draft remains unsaved until Done.
        expect(loadChatActionOrders().private).toEqual([]);
        click('[aria-label="取消功能排序"]');
        expect(find('tile-9').parentElement?.getAttribute('aria-label')).toBe('聊天功能第 2 页');
        click('[aria-label="编辑功能顺序"]');
        click('[aria-label="第 2 页"]');
        pointer(find('tile-9'), 'pointerdown', 150);
        pointer(panel, 'pointermove', 10);
        act(() => vi.advanceTimersByTime(450));
        expect(host.querySelector('[aria-label="聊天功能第 1 页"]')?.className).not.toContain('hidden');
        pointer(panel, 'pointermove', 100);
        pointer(panel, 'pointerup', 100);
        expect(find('tile-9').parentElement?.getAttribute('aria-label')).toBe('聊天功能第 1 页');
        clickText('完成');
        expect(loadChatActionOrders().private?.[0]).toBe('tile-9');
        expect(action).not.toHaveBeenCalled();
    });

    it('puts the dots before editing controls and keeps the original tile appearance', () => {
        act(() => root.render(React.createElement(ChatActionOrganizer, { scope: 'private', tiles })));
        const firstPage = host.querySelector('[aria-label="聊天功能第 1 页"]')!;
        expect(firstPage.querySelectorAll('[data-chat-action-id]')).toHaveLength(8);
        expect(firstPage.className).toContain('p-6');
        expect(firstPage.className).toContain('gap-y-8');
        const dots = firstPage.parentElement!.querySelector('[data-chat-action-page="1"]')!.parentElement!;
        expect(dots.previousElementSibling?.getAttribute('aria-label')).toBe('聊天功能第 2 页');
        expect(dots.className).toContain('gap-3 pb-3 -mt-2');
        expect(dots.parentElement?.nextElementSibling?.querySelector('[aria-label="编辑功能顺序"]')).not.toBeNull();
        click('[aria-label="编辑功能顺序"]');
        expect(find('tile-0').className).not.toMatch(/outline|dashed|rounded-xl/);
        expect(dots.parentElement?.nextElementSibling?.textContent).toContain('完成');
    });

    it('drags directly from page three to page one through its dot and accepts a blank drop', () => {
        vi.useFakeTimers();
        const threePages = [...tiles, ...Array.from({ length: 8 }, (_, index) => React.createElement('button', { key: `tile-${index + 10}`, onClick: action }, `功能${index + 10}`))];
        act(() => root.render(React.createElement(ChatActionOrganizer, { scope: 'private', tiles: threePages })));
        click('[aria-label="编辑功能顺序"]');
        click('[aria-label="第 3 页"]');
        const panel = host.querySelector<HTMLElement>('.overflow-y-auto.no-scrollbar')!;
        vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 400, top: 0, bottom: 300 } as DOMRect);
        (document as any).elementFromPoint = vi.fn(() => host.querySelector('[data-chat-action-page="0"]'));
        pointer(find('tile-17'), 'pointerdown', 180);
        pointer(panel, 'pointermove', 170);
        pointer(panel, 'pointermove', 200, 260);
        act(() => vi.advanceTimersByTime(450));
        expect(host.querySelector('[aria-label="聊天功能第 1 页"]')?.className).not.toContain('hidden');
        expect(find('tile-17').parentElement?.getAttribute('aria-label')).toBe('聊天功能第 1 页');
        (document as any).elementFromPoint = vi.fn(() => null);
        pointer(panel, 'pointerup', 200, 260);
        clickText('完成');
        expect(loadChatActionOrders().private?.indexOf('tile-17')).toBeLessThan(8);
        expect(new Set(loadChatActionOrders().private).size).toBe(18);
        expect(action).not.toHaveBeenCalled();
    });

    it('clears a pending edge turn on leaving and cancels a drag dropped outside', () => {
        vi.useFakeTimers();
        act(() => root.render(React.createElement(ChatActionOrganizer, { scope: 'private', tiles })));
        click('[aria-label="编辑功能顺序"]');
        click('[aria-label="第 2 页"]');
        const panel = host.querySelector<HTMLElement>('.overflow-y-auto.no-scrollbar')!;
        vi.spyOn(panel, 'getBoundingClientRect').mockReturnValue({ left: 0, right: 400, top: 0, bottom: 300 } as DOMRect);
        pointer(find('tile-9'), 'pointerdown', 150);
        pointer(panel, 'pointermove', 10);
        pointer(panel, 'pointermove', 150);
        act(() => vi.advanceTimersByTime(500));
        expect(host.querySelector('[aria-label="聊天功能第 2 页"]')?.className).not.toContain('hidden');
        pointer(panel, 'pointermove', 10);
        act(() => vi.advanceTimersByTime(450));
        expect(find('tile-9').parentElement?.getAttribute('aria-label')).toBe('聊天功能第 1 页');
        pointer(panel, 'pointerup', 500);
        expect(find('tile-9').parentElement?.getAttribute('aria-label')).toBe('聊天功能第 2 页');
        act(() => vi.advanceTimersByTime(500));
        expect(loadChatActionOrders().private).toEqual([]);
    });

    it('keeps group order separate and appends a newly introduced action', () => {
        act(() => root.render(React.createElement(ChatActionOrganizer, { scope: 'group', tiles: tiles.slice(0, 7) })));
        click('[aria-label="编辑功能顺序"]');
        const first = find('tile-0');
        act(() => first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
        clickText('完成');
        expect(loadChatActionOrders().group).toEqual(['tile-1', 'tile-0', 'tile-2', 'tile-3', 'tile-4', 'tile-5', 'tile-6']);
        expect(loadChatActionOrders().private).toEqual([]);
        act(() => root.render(React.createElement(ChatActionOrganizer, { scope: 'group', tiles: tiles.slice(0, 8) })));
        expect(find('tile-7').parentElement?.getAttribute('aria-label')).toBe('聊天功能第 1 页');
    });

    it('cancels a pointer gesture and Escape without saving; confirmed reset affects only this scope', () => {
        act(() => root.render(React.createElement(ChatActionOrganizer, { scope: 'private', tiles })));
        click('[aria-label="编辑功能顺序"]');
        const panel = host.querySelector<HTMLElement>('.overflow-y-auto.no-scrollbar')!;
        (document as any).elementFromPoint = vi.fn(() => find('tile-1'));
        pointer(find('tile-0'), 'pointerdown', 100);
        pointer(panel, 'pointermove', 150);
        pointer(panel, 'pointercancel', 150);
        expect(find('tile-0').previousElementSibling).toBeNull();
        act(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })));
        expect(host.querySelector('[aria-label="编辑功能顺序"]')).not.toBeNull();
        expect(loadChatActionOrders().private).toEqual([]);
        // Save a real group order, then reset private without changing group.
        act(() => root.render(React.createElement(ChatActionOrganizer, { scope: 'group', tiles: tiles.slice(0, 7) })));
        click('[aria-label="编辑功能顺序"]');
        act(() => find('tile-0').dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })));
        clickText('完成');
        const groupOrder = loadChatActionOrders().group;
        act(() => root.render(React.createElement(ChatActionOrganizer, { scope: 'private', tiles })));
        click('[aria-label="编辑功能顺序"]');
        clickText('恢复默认顺序');
        clickText('确认恢复默认');
        clickText('完成');
        expect(loadChatActionOrders().private).toEqual(tiles.map(tile => String(tile.key)));
        expect(loadChatActionOrders().group).toEqual(groupOrder);
    });
});
