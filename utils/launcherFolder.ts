import type { OSTheme } from '../types';

export const LAUNCHER_FOLDER_ID = 'launcher:folder';
export const LAUNCHER_EMPTY_SLOT_PREFIX = 'slot:';
export type LauncherFolderLayout = { order: string[]; folderApps: string[] };

/** 兼容旧紧密排序，保留新空位；每个可用应用只出现在桌面或文件夹之一。 */
export function normalizeLauncherLayout(theme: Pick<OSTheme, 'launcherAppOrder' | 'launcherFolderApps'>, available: string[]): LauncherFolderLayout {
    const valid = new Set(available);
    const seen = new Set<string>();
    const folderApps = (Array.isArray(theme.launcherFolderApps) ? theme.launcherFolderApps : []).filter(id => {
        if (!valid.has(id) || seen.has(id)) return false;
        seen.add(id);
        return true;
    });
    const order = (Array.isArray(theme.launcherAppOrder) ? theme.launcherAppOrder : []).map(id => {
        if (!id) return '';
        if ((id !== LAUNCHER_FOLDER_ID && !valid.has(id)) || seen.has(id)) return '';
        seen.add(id);
        return id;
    });
    for (const id of [...available, LAUNCHER_FOLDER_ID]) {
        if (!seen.has(id)) { order.push(id); seen.add(id); }
    }
    // 前两页各八个位置；第三页始终提供一行空位，便于从文件夹拖回。
    while (order.length < 16) order.push('');
    while (order.length > 16 && order.at(-1) === '') order.pop();
    while (order.length % 4) order.push('');
    order.push('', '', '', '');
    return { order, folderApps };
}

export function moveLauncherItem(layout: LauncherFolderLayout, source: string, target: string): LauncherFolderLayout {
    if (!source || source === target) return layout;
    const order = [...layout.order];
    const folderApps = [...layout.folderApps];
    const from = order.indexOf(source);
    const fromFolder = folderApps.indexOf(source);
    if (from < 0 && fromFolder < 0) return layout;
    if (target === LAUNCHER_FOLDER_ID && source !== LAUNCHER_FOLDER_ID) {
        if (fromFolder >= 0) return layout;
        order[from] = '';
        folderApps.push(source);
    } else if (target.startsWith(LAUNCHER_EMPTY_SLOT_PREFIX)) {
        const to = Number(target.slice(LAUNCHER_EMPTY_SLOT_PREFIX.length));
        if (!Number.isInteger(to) || to < 0 || to >= order.length || order[to] !== '') return layout;
        order[to] = source;
        if (fromFolder >= 0) folderApps.splice(fromFolder, 1);
        else order[from] = '';
    } else if (fromFolder >= 0 && folderApps.includes(target)) {
        folderApps.splice(fromFolder, 1);
        folderApps.splice(layout.folderApps.indexOf(target), 0, source);
    } else if (from >= 0 && order.includes(target)) {
        const to = order.indexOf(target);
        order.splice(from, 1);
        order.splice(to, 0, source);
    } else return layout;
    return { order, folderApps };
}
