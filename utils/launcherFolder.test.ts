import { describe, expect, it } from 'vitest';
import { LAUNCHER_FOLDER_ID as folder, normalizeLauncherLayout, moveLauncherItem } from './launcherFolder';

describe('桌面收纳与空位', () => {
    it('兼容旧排序、清理重复与失效 ID，新应用只追加一次，归一化可重复执行', () => {
        const layout = normalizeLauncherLayout({ launcherAppOrder: ['b', 'a', 'b', 'gone'], launcherFolderApps: ['c', 'c', 'gone'] }, ['a', 'b', 'c', 'new']);
        expect(layout.order.slice(0, 2)).toEqual(['b', 'a']);
        expect(layout.folderApps).toEqual(['c']);
        expect(layout.order.filter(Boolean)).toEqual(['b', 'a', 'new', folder]);
        expect(normalizeLauncherLayout({ launcherAppOrder: layout.order, launcherFolderApps: layout.folderApps }, ['a', 'b', 'c', 'new'])).toEqual(layout);
    });
    it('收纳留下原空位，拖回指定空位，刷新不会重复或补回已收纳应用', () => {
        const start = normalizeLauncherLayout({ launcherAppOrder: ['a', 'b'] }, ['a', 'b']);
        const stored = moveLauncherItem(start, 'a', folder);
        expect(stored.order.slice(0, 2)).toEqual(['', 'b']);
        expect(stored.folderApps).toEqual(['a']);
        const refreshed = normalizeLauncherLayout({ launcherAppOrder: stored.order, launcherFolderApps: stored.folderApps }, ['a', 'b']);
        expect(refreshed.order).not.toContain('a');
        const restored = moveLauncherItem(refreshed, 'a', 'slot:7');
        expect(restored.order[7]).toBe('a');
        expect(restored.order[0]).toBe('');
        expect(restored.folderApps).toEqual([]);
    });
    it('桌面与文件夹内部排序、文件夹自身移动，以及非法目标均不丢应用', () => {
        const start = normalizeLauncherLayout({ launcherAppOrder: ['a', 'b', folder], launcherFolderApps: ['c', 'd'] }, ['a', 'b', 'c', 'd']);
        expect(moveLauncherItem(start, 'a', 'b').order.slice(0, 2)).toEqual(['b', 'a']);
        expect(moveLauncherItem(start, 'd', 'c').folderApps).toEqual(['d', 'c']);
        expect(moveLauncherItem(start, folder, 'slot:7').order[7]).toBe(folder);
        for (const [source, target] of [['c', 'b'], ['c', 'slot:1'], ['c', 'slot:-1'], ['c', 'slot:999'], ['missing', folder], ['c', folder], [folder, folder]]) {
            expect(moveLauncherItem(start, source, target)).toBe(start);
        }
    });
    it('异常备份字段退回默认桌面，不隐藏应用；很多应用全部收纳后仍有三个桌面页', () => {
        const available = Array.from({ length: 50 }, (_, i) => `app-${i}`);
        const malformed = normalizeLauncherLayout({ launcherAppOrder: null, launcherFolderApps: {} } as any, available);
        expect(malformed.order.filter(id => available.includes(id))).toEqual(available);
        const stored = normalizeLauncherLayout({ launcherFolderApps: available }, available);
        expect(stored.folderApps).toEqual(available);
        expect(stored.order.filter(Boolean)).toEqual([folder]);
        expect(stored.order.length).toBe(20);
    });
});
