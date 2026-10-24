// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIConfig, CharacterProfile, UserProfile } from '../types';
import SideStoryModal from '../components/chat/SideStoryModal';
import { generateSideStory } from './sideStoryCreation';
import { copyTextToClipboard } from './clipboard';
import { SIDE_STORY_MASK_WORDS_KEY } from './sideStoryMask';

vi.mock('./sideStoryCreation', async original => ({ ...await original<typeof import('./sideStoryCreation')>(), generateSideStory: vi.fn() }));
vi.mock('./clipboard', () => ({ copyTextToClipboard: vi.fn(async () => true) }));
const role = { id: 'first', name: '甲' } as CharacterProfile;
const user = { name: '我' } as UserProfile;
let container: HTMLDivElement; let root: Root; let active = 'first'; let onClose: ReturnType<typeof vi.fn>;
const render = (char = role) => act(() => root.render(React.createElement(React.StrictMode, null, React.createElement(SideStoryModal, {
    key: char.id, char, user, api: {} as APIConfig, isCurrentCharacter: (id: string) => id === active, onClose,
}))));
const button = (label: string) => [...container.querySelectorAll('button')].find(item => item.textContent?.includes(label))!;
const input = (value: string) => act(() => {
    const textarea = container.querySelector('textarea')!;
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    setter.call(textarea, value); textarea.dispatchEvent(new Event('input', { bubbles: true }));
});
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div'); document.body.append(container); root = createRoot(container);
    active = 'first'; onClose = vi.fn(); vi.mocked(generateSideStory).mockReset(); vi.mocked(copyTextToClipboard).mockReset().mockResolvedValue(true);
    localStorage.removeItem(SIDE_STORY_MASK_WORDS_KEY);
});
afterEach(() => { act(() => root.unmount()); container.remove(); localStorage.removeItem(SIDE_STORY_MASK_WORDS_KEY); });

describe('ephemeral side story modal', () => {
    it('blanks literal words in story and title, folds request/list for screenshots, but copies raw text', async () => {
        vi.mocked(generateSideStory).mockResolvedValueOnce({ text: '# 芝麻与广陵王\n**芝麻**，广陵王见张辽。\n> `芝麻`', complete: true, finishReason: 'stop' });
        render({ id: 'first', name: '广陵王' } as CharacterProfile);
        const wordInput = () => container.querySelector<HTMLInputElement>('[aria-label="新增打码词"]')!;
        const setWord = (word: string) => act(() => {
            const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
            setter.call(wordInput(), word); wordInput().dispatchEvent(new Event('input', { bubbles: true }));
        });
        act(() => container.querySelector('details')!.open = true);
        setWord('芝麻'); act(() => button('添加').click());
        setWord('广陵王'); act(() => button('添加').click());
        input('芝麻相关的番外');
        await act(async () => { button('生成番外').click(); });
        expect(container.querySelector('[aria-label="番外正文"]')?.textContent).toContain('芝麻');
        act(() => button('显示打码').click());
        expect(container.querySelector('h3')?.textContent).not.toContain('广陵王');
        expect(container.querySelector('[aria-label="番外正文"]')?.textContent).not.toMatch(/芝麻|广陵王/);
        expect(container.querySelector('[aria-label="番外正文"]')?.textContent).toContain('，');
        expect(container.querySelector('textarea')).toBeNull();
        expect(container.querySelector('details')).toBeNull();
        expect(container.querySelectorAll('[data-story-blank]').length).toBeGreaterThan(3);
        expect(container.querySelectorAll('strong, blockquote, h4, code').length).toBeGreaterThan(3);
        await act(async () => { button('复制全文').click(); });
        expect(copyTextToClipboard).toHaveBeenCalledWith('# 芝麻与广陵王\n**芝麻**，广陵王见张辽。\n> `芝麻`');
        act(() => button('编辑词表').click());
        act(() => container.querySelector('details')!.open = true);
        setWord('张辽'); act(() => button('添加').click());
        expect(container.querySelector('[aria-label="番外正文"]')?.textContent).not.toContain('张辽');
        act(() => button('返回截图阅读').click());
        expect(container.querySelector('details')).toBeNull();
        act(() => button('关闭打码').click());
        expect(container.querySelector('[aria-label="番外正文"]')?.textContent).toContain('芝麻');
        expect(container.querySelector('textarea')?.value).toBe('芝麻相关的番外');
    });

    it('keeps local vocabulary across discarded stories and role switches without persisting story text', async () => {
        vi.mocked(generateSideStory).mockResolvedValueOnce({ text: '芝麻的番外', complete: true, finishReason: 'stop' });
        render();
        act(() => container.querySelector('details')!.open = true);
        const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!;
        const field = container.querySelector<HTMLInputElement>('[aria-label="新增打码词"]')!;
        act(() => { setter.call(field, '芝麻'); field.dispatchEvent(new Event('input', { bubbles: true })); });
        act(() => button('添加').click());
        input('需求'); await act(async () => { button('生成番外').click(); });
        act(() => button('丢弃并关闭').click());
        active = 'second'; render({ id: 'second', name: '乙' } as CharacterProfile);
        expect(container.querySelector('[aria-label="番外正文"]')).toBeNull();
        expect(JSON.parse(localStorage.getItem(SIDE_STORY_MASK_WORDS_KEY)!)).toEqual(['芝麻']);
        act(() => container.querySelector('details')!.open = true);
        expect(container.querySelector('details')?.textContent).toContain('芝麻');
        act(() => button('清空词表').click());
        expect(JSON.parse(localStorage.getItem(SIDE_STORY_MASK_WORDS_KEY)!)).toEqual([]);
    });

    it('conceals a protected prefix during streaming and updates the blank when the word completes', async () => {
        let push!: (text: string) => void;
        vi.mocked(generateSideStory).mockImplementationOnce(async options => {
            push = options.onText!;
            options.onText?.('今天见芝');
            return new Promise(() => {});
        });
        localStorage.setItem(SIDE_STORY_MASK_WORDS_KEY, JSON.stringify(['芝麻']));
        render(); input('需求');
        await act(async () => { button('生成番外').click(); });
        act(() => button('显示打码').click());
        expect(container.querySelector('[aria-label="番外正文"]')?.textContent).toContain('今天见');
        expect(container.querySelector('[aria-label="番外正文"]')?.textContent).not.toContain('芝');
        await act(async () => push('今天见芝麻'));
        expect(container.querySelector('[aria-label="番外正文"]')?.textContent).not.toContain('芝麻');
        act(() => button('停止生成').click());
        await act(async () => { button('复制全文').click(); });
        expect(copyTextToClipboard).toHaveBeenCalledWith('今天见芝麻');
    });

    it('shares the reader with a group, clears copy feedback and aborts late output on close', async () => {
        const group = { group: { id: 'g', name: '旅行群', members: ['first'], createdAt: 1 } as any,
            members: [role], contextLimit: 30 };
        let lateText!: (text: string) => void;
        vi.mocked(generateSideStory).mockImplementationOnce(async options => {
            lateText = options.onText!;
            options.onText?.('群像第一章');
            return new Promise(() => {});
        });
        await act(async () => root.render(React.createElement(SideStoryModal, {
            group, user, api: {} as APIConfig, isCurrentGroup: id => id === 'g', onClose,
        })));
        expect(container.textContent).toContain('旅行群 · 番外创作');
        input('写他们一起旅行');
        await act(async () => { button('生成番外').click(); });
        expect(vi.mocked(generateSideStory).mock.calls[0][0].group).toBe(group);
        expect(container.textContent).toContain('群像第一章');
        await act(async () => { button('复制全文').click(); });
        expect(button('复制成功')).toBeTruthy();
        const signal = vi.mocked(generateSideStory).mock.calls[0][0].signal;
        act(() => button('丢弃并关闭').click());
        expect(signal.aborted).toBe(true);
        act(() => root.unmount());
        await act(async () => lateText('旧群迟到分片'));
        expect(container.textContent).toBe('');
    });
    it('shows copy success only after completion and restarts its recovery timer on another click', async () => {
        vi.useFakeTimers();
        try {
            vi.mocked(generateSideStory).mockResolvedValueOnce({ text: '番外正文', complete: true, finishReason: 'stop' });
            render(); input('需求');
            await act(async () => { button('生成番外').click(); });
            await act(async () => { button('复制全文').click(); });
            expect(button('复制成功')).toBeTruthy();
            expect(copyTextToClipboard).toHaveBeenCalledWith('番外正文');

            act(() => vi.advanceTimersByTime(2000));
            await act(async () => { button('复制成功').click(); });
            act(() => vi.advanceTimersByTime(500));
            expect(button('复制成功')).toBeTruthy();
            act(() => vi.advanceTimersByTime(2000));
            expect(button('复制全文')).toBeTruthy();
        } finally { vi.useRealTimers(); }
    });

    it('never reports a failed copy as success and clears feedback when the text or character changes', async () => {
        vi.useFakeTimers();
        try {
            vi.mocked(generateSideStory)
                .mockResolvedValueOnce({ text: '旧正文', complete: true, finishReason: 'stop' })
                .mockResolvedValueOnce({ text: '新正文', complete: true, finishReason: 'stop' });
            vi.mocked(copyTextToClipboard).mockResolvedValueOnce(false).mockResolvedValueOnce(true);
            render(); input('需求');
            await act(async () => { button('生成番外').click(); });
            await act(async () => { button('复制全文').click(); });
            expect(container.textContent).toContain('复制全文失败，请重试');
            expect(container.textContent).not.toContain('复制成功');

            await act(async () => { button('复制全文').click(); });
            expect(button('复制成功')).toBeTruthy();
            expect(container.textContent).not.toContain('复制全文失败，请重试');
            await act(async () => { button('重新生成').click(); });
            expect(button('复制全文')).toBeTruthy();
            expect(container.querySelector('[aria-label="番外正文"]')?.textContent).toContain('新正文');

            await act(async () => { button('复制全文').click(); });
            active = 'second'; render({ id: 'second', name: '乙' } as CharacterProfile);
            expect(container.textContent).not.toContain('复制成功');
            expect(vi.getTimerCount()).toBe(0);
        } finally { vi.useRealTimers(); }
    });

    it('shows live partial text, preserves it after stop, continues only on click, and copies the full result', async () => {
        vi.mocked(generateSideStory).mockImplementationOnce(async options => {
            options.onText?.('# 开头\n第一段');
            return new Promise(() => {});
        }).mockImplementationOnce(async options => {
            expect(options.previous).toBe('# 开头\n第一段');
            options.onText?.('\n第二段');
            return { text: '\n第二段', complete: true, finishReason: 'stop' };
        });
        render(); input(' 写 5000 字 ');
        await act(async () => { button('生成番外').click(); });
        expect(container.querySelector('[aria-label="番外正文"]')?.textContent).toContain('第一段');
        expect(generateSideStory).toHaveBeenCalledTimes(1);
        act(() => button('停止生成').click());
        expect(container.textContent).toContain('本轮未完成');
        await act(async () => { button('继续写').click(); });
        expect(container.querySelector('[aria-label="番外正文"]')?.textContent).toContain('第一段第二段');
        expect(generateSideStory).toHaveBeenCalledTimes(2);
        await act(async () => { button('复制全文').click(); });
        expect(copyTextToClipboard).toHaveBeenCalledWith('# 开头\n第一段\n第二段');
        expect(container.textContent).not.toMatch(/加入主聊天|保存作品|发布/);
    });

    it('keeps request and partial text after error; replacement clears old text and blocks double click', async () => {
        vi.mocked(generateSideStory).mockImplementationOnce(async options => {
            options.onText?.('旧文'); throw new Error('API Error 500: https://private.example sk-secretsecretsecret');
        }).mockImplementationOnce(async options => {
            expect(options.previous).toBe('');
            options.onText?.('新文'); return { text: '新文', complete: true, finishReason: 'stop' };
        });
        render(); input('  任意需求\n ');
        await act(async () => { button('生成番外').click(); });
        expect(container.textContent).toContain('旧文');
        expect(container.textContent).not.toContain('private.example');
        expect(container.querySelector('textarea')?.value).toBe('  任意需求\n ');
        await act(async () => { button('重新生成').click(); });
        expect(container.querySelector('[aria-label="番外正文"]')?.textContent).toContain('新文');
        expect(container.querySelector('[aria-label="番外正文"]')?.textContent).not.toContain('旧文');
    });

    it('aborts and drops all text on close or character change, ignoring old deltas', async () => {
        let oldText!: (text: string) => void;
        vi.mocked(generateSideStory).mockImplementationOnce(async options => { oldText = options.onText!; return new Promise(() => {}); });
        render(); input('需求'); await act(async () => { button('生成番外').click(); });
        const signal = vi.mocked(generateSideStory).mock.calls[0][0].signal;
        act(() => button('丢弃并关闭').click());
        expect(signal.aborted).toBe(true); expect(onClose).toHaveBeenCalledTimes(1);
        act(() => root.unmount());
        await act(async () => oldText('迟到正文'));
        expect(container.textContent).toBe('');
    });

    it('ignores an older request after stop and replacement, including its late error', async () => {
        let rejectOld!: (error: Error) => void;
        let oldText!: (text: string) => void;
        vi.mocked(generateSideStory).mockImplementationOnce(async options => {
            oldText = options.onText!;
            options.onText?.('旧开头');
            return new Promise((_resolve, reject) => { rejectOld = reject; });
        }).mockImplementationOnce(async options => {
            options.onText?.('新正文');
            return { text: '新正文', complete: true, finishReason: 'stop' };
        });
        render(); input('需求');
        await act(async () => { button('生成番外').click(); });
        act(() => button('停止生成').click());
        await act(async () => { button('重新生成').click(); });
        await act(async () => { oldText('旧的迟到正文'); rejectOld(new Error('旧请求错误')); });
        expect(container.querySelector('[aria-label="番外正文"]')?.textContent).toContain('新正文');
        expect(container.textContent).not.toMatch(/旧开头|迟到正文|旧请求错误/);
    });

    it('keeps a 30000-character input and does not execute model HTML', async () => {
        vi.mocked(generateSideStory).mockResolvedValueOnce({ text: '<script>window.bad=1</script>\n附言', complete: true, finishReason: 'stop' });
        render(); input(' 文\n'.repeat(10_000));
        expect(container.querySelector('textarea')?.value.length).toBe(30_000);
        await act(async () => { button('生成番外').click(); });
        expect(container.querySelector('script')).toBeNull();
        expect(container.querySelector('[aria-label="番外正文"]')?.textContent).toContain('<script>window.bad=1</script>');
    });
});
