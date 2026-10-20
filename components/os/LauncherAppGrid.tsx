import React from 'react';
import { INSTALLED_APPS, Icons } from '../../constants';
import { useOS } from '../../context/OSContext';
import type { AppID } from '../../types';
import { LAUNCHER_FOLDER_ID, LAUNCHER_EMPTY_SLOT_PREFIX } from '../../utils/launcherFolder';
import AppIcon from './AppIcon';
import TokenImg from './TokenImg';

type Props = {
    items: string[];
    offset?: number;
    columns?: 2 | 3 | 4;
    dense?: boolean;
    editing: boolean;
    folderApps: string[];
    folderName: string;
    openApp: (id: AppID) => void;
    openFolder: () => void;
};

export default function LauncherAppGrid({ items, offset = 0, columns = 4, dense = false, editing, folderApps, folderName, openApp, openFolder }: Props) {
    const { theme, customIcons } = useOS();
    const color = theme.skin === 'animalcrossing' ? '#725d42' : theme.contentColor || '#ffffff';
    return <div className={`grid place-items-center relative gap-x-2 ${dense ? 'gap-y-3' : 'gap-y-6'}`} style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
        {items.map((id, index) => {
            const app = INSTALLED_APPS.find(app => app.id === id);
            return <div key={id || `empty-${offset + index}`} data-launcher-item={id || `${LAUNCHER_EMPTY_SLOT_PREFIX}${offset + index}`} data-launcher-kind="app"
                className={`relative flex flex-col items-center justify-center min-w-0 min-h-[78px] w-full ${editing ? 'launcher-edit-item' : ''}`}>
                {id === LAUNCHER_FOLDER_ID ? <>
                    <button type="button" onClick={openFolder} aria-label={`打开文件夹：${folderName}`} className="flex flex-col items-center gap-1.5 w-full">
                        <span className="grid grid-cols-3 grid-rows-3 gap-0.5 p-1.5 w-14 h-14 rounded-[1.125rem] border border-white/30 shadow-sm" style={{ background: theme.skin === 'animalcrossing' ? '#e8e2d6' : 'rgba(224,221,215,0.45)', color }}>
                            {folderApps.slice(0, 9).map(id => {
                                const member = INSTALLED_APPS.find(app => app.id === id);
                                if (!member) return null;
                                const Icon = Icons[member.icon] || Icons.Settings;
                                return <span key={id} className="rounded overflow-hidden flex items-center justify-center bg-white/25">
                                    {customIcons[id] ? <TokenImg value={customIcons[id]} alt="" className="w-full h-full object-cover" /> : <Icon className="w-3 h-3" />}
                                </span>;
                            })}
                            {!folderApps.length && <span className="col-span-3 row-span-3 flex items-center justify-center text-xl">▦</span>}
                        </span>
                        <span className="text-[10px] font-semibold truncate max-w-full" style={{ color }}>{folderName}</span>
                    </button>
                    {editing && <button type="button" data-launcher-control onClick={openFolder} className="absolute -top-2 -right-1 rounded-full px-2 py-1 bg-white text-stone-700 text-[10px] shadow">整理</button>}
                </> : app ? <AppIcon app={app} onClick={() => { if (!editing) openApp(app.id); }} /> : <span aria-hidden="true" className={`w-14 h-14 rounded-[1.125rem] ${editing ? 'border border-dashed border-current opacity-30' : 'invisible'}`} style={{ color }}> </span>}
            </div>;
        })}
    </div>;
}
