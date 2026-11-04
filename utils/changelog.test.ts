// @vitest-environment jsdom
import React, { act, StrictMode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import FAQApp from '../apps/FAQApp';
import { INSTALLED_APPS } from '../constants';
import { AppID } from '../types';
import { normalizeLauncherLayout } from './launcherFolder';
import { handleLocalBack } from './localBackHandlers';
import { FAQ_TARGET_SECTION_KEY, CHANGELOG_2026_08_10 } from '../components/UpdateNotificationEvent';
import { HOME_CHANGELOG } from './homeUpdate';

const mocked = vi.hoisted(() => ({ closeApp: vi.fn() }));
vi.mock('../context/OSContext', () => ({ useOS: () => mocked }));
vi.mock('./analytics', () => ({ trackEvent: vi.fn() }));

let root: Root, host: HTMLDivElement;
beforeEach(() => {
    (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
    sessionStorage.clear(); mocked.closeApp.mockClear(); vi.stubEnv('BASE_URL', '/');
    host = document.createElement('div'); document.body.append(host); root = createRoot(host);
});
afterEach(async () => {
    await act(async () => root.unmount()); host.remove(); vi.unstubAllEnvs(); vi.restoreAllMocks();
});
const render = () => act(async () => root.render(React.createElement(StrictMode, null, React.createElement(FAQApp))));
async function click(text: string) {
    const button = [...host.querySelectorAll('button')].find(node => (node.getAttribute('aria-label') || node.textContent?.trim()) === text);
    expect(button).toBeTruthy(); await act(async () => button!.click());
}
async function openCard(title: string) {
    const card = [...host.querySelectorAll<HTMLButtonElement>('.release-card')].find(node => node.querySelector('h3')?.textContent === title);
    expect(card).toBeTruthy(); await act(async () => card!.click());
}

describe('public update journal', () => {
    it('opens personal history first, separates original history, and keeps help reachable', async () => {
        await render();
        expect(host.querySelector('h1')?.textContent).toBe('更新日志');
        expect([...host.querySelectorAll('time')].map(node => node.textContent)).toEqual(['2026-11-04', '2026-10-30', '2026-10-27', '2026-10-23', '2026-09-30', '2026-08-31']);
        expect([...host.querySelectorAll('.release-card h3')].map(node => node.textContent)).toEqual([
            '11 月 4 日更新', '10 月 30 日更新', '10 月 27 日更新', '10 月 2—23 日更新', '9 月更新', '8 月更新',
        ]);
        expect(host.textContent).toContain('已发布');
        expect(host.querySelector('.release-card-heading span')).toBeNull();
        expect(host.textContent).not.toContain('开发记录');
        await click('原版更新');
        expect(host.querySelectorAll('.release-card')).toHaveLength(15);
        expect(host.textContent).toContain('qegj567-cloud/SullyOS');
        expect(host.textContent).toContain('保留原文和原日期');
        expect(host.textContent).not.toContain('待发布');
        const dates = [...host.querySelectorAll('time')].map(node => node.textContent!);
        expect(dates).toEqual([...dates].sort().reverse());
        await click('常见问题'); expect(host.textContent).toContain('角色的记忆如何互通');
        await click('更新日志'); await click('个人二改');
        expect(host.querySelectorAll('.release-card')).toHaveLength(6);
    });

    it.each(['/', '/SullyOS/', './'])('loads real HTML under base %s and backs to the same list before the desktop', async base => {
        vi.stubEnv('BASE_URL', base); await render();
        await openCard('10 月 27 日更新');
        expect(host.querySelector('iframe')?.getAttribute('src')).toBe(`${base}changelogs/personal-2026-10-27.html`);
        expect(existsSync(path.resolve(__dirname, '../public/changelogs/personal-2026-10-27.html'))).toBe(true);
        await act(async () => { expect(handleLocalBack()).toBe(true); });
        expect(host.querySelector('iframe')).toBeNull(); expect(mocked.closeApp).not.toHaveBeenCalled();
        await openCard('8 月更新');
        expect(host.querySelector('iframe')?.getAttribute('src')).toBe(`${base}changelogs/personal-2026-08.html`);
        await click('返回更新列表');
        expect(host.querySelectorAll('.release-card')).toHaveLength(6);
        await click('返回桌面'); expect(mocked.closeApp).toHaveBeenCalledOnce();
        expect(handleLocalBack()).toBe(false);
    });

    it.each([
        [CHANGELOG_2026_08_10, '2026-8-10.html'],
        [HOME_CHANGELOG, '2026-10-home3d-beta.html'],
    ])('keeps legacy targeted original note %s through StrictMode and returns to original history', async (target, file) => {
        sessionStorage.setItem(FAQ_TARGET_SECTION_KEY, target); await render();
        expect(sessionStorage.getItem(FAQ_TARGET_SECTION_KEY)).toBeNull();
        expect(host.querySelector('iframe')?.getAttribute('src')).toBe(`/changelogs/${file}`);
        expect(host.querySelector('.release-reader-meta')?.textContent).toContain('原作 · qegj567-cloud/SullyOS');
        expect(host.querySelector('.release-reader-meta a')?.getAttribute('href')).toBe(`https://github.com/qegj567-cloud/SullyOS/blob/27f060c1bc0c5381d5fad0e03eae353fc8517599/public/changelogs/${file}`);
        await click('返回更新列表');
        expect(host.querySelector('[aria-pressed="true"]')?.textContent).toBe('原版更新');
        expect(host.querySelectorAll('.release-card')).toHaveLength(15);
    });

    it('falls back to the journal if the old target is unknown or storage is unavailable', async () => {
        sessionStorage.setItem(FAQ_TARGET_SECTION_KEY, 'unknown-note'); await render();
        expect(host.querySelectorAll('.release-card')).toHaveLength(6);
        await act(async () => root.unmount()); root = createRoot(host);
        vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('unavailable'); });
        await render(); expect(host.querySelectorAll('.release-card')).toHaveLength(6);
    });

    it('reuses the existing desktop ID and leaves saved folder positions and custom ordering intact', () => {
        const entries = INSTALLED_APPS.filter(app => app.id === AppID.FAQ);
        expect(entries).toHaveLength(1); expect(entries[0].name).toBe('更新日志');
        const available = [AppID.Chat, AppID.FAQ, AppID.User];
        const oldTheme = { launcherAppOrder: [AppID.User, '', AppID.Chat], launcherFolderApps: [AppID.FAQ] };
        const layout = normalizeLauncherLayout(oldTheme, available);
        expect(layout.order.slice(0, 3)).toEqual(oldTheme.launcherAppOrder);
        expect(layout.folderApps).toEqual([AppID.FAQ]); expect(layout.order).not.toContain(AppID.FAQ);
    });

    it('introduces personal features by period without development bookkeeping or numbered headings', () => {
        const page = (date: string) => readFileSync(path.resolve(__dirname, `../public/changelogs/personal-${date}.html`), 'utf8');
        expect(page('2026-08')).toContain('2026-08-05');
        expect(page('2026-08')).toContain('辩论赛');
        expect(page('2026-09')).toContain('表情');
        expect(page('2026-10')).toContain('剧本杀');
        expect(page('2026-10-30')).toContain('已发布');
        expect(page('2026-11-04')).toContain('Meta');
        expect(page('2026-11-04')).toContain('仍在开发中');
        expect(page('2026-11-04')).not.toMatch(/修复|迟到的旧读取|旧动态里的“今天”/);
        for (const date of ['2026-08', '2026-09', '2026-10', '2026-10-27', '2026-10-30', '2026-11-04']) {
            const html = page(date);
            expect(html).not.toMatch(/开发记录|推送日期|开发起点|Asia\/Shanghai|item-num|Sullyos-zhima|生图|自行配置的 API|私人版本|公开版/);
        }
    });
});
