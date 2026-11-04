/** 公开版. Local settings only; never serialize this target into a Worker pack. */
export const OBSIDIAN_DIARY_KEY = 'sullyos_obsidian_diary_v1';
export const OBSIDIAN_DIARY_CHANGED = 'obsidian-diary-config-changed';
export const OBSIDIAN_DIARY_EPOCH = 'obsidian-diary-runtime:epoch';
export interface DiaryToolBinding {
    name: string;
    pathKey: string;
    contentKey?: string;
    fixed: Record<string, unknown>;
}
export interface ObsidianDiaryConfig {
    enabled: boolean;
    serverId: string;
    directory: string;
    charIds: string[];
    autonomous: boolean;
    /** Legacy backup fields only; execution always resolves the verified adapter. */
    read: DiaryToolBinding;
    write: DiaryToolBinding;
    readContentKey: string;
    createOnly: boolean;
}
export const blankObsidianDiary = (): ObsidianDiaryConfig => ({ enabled: false, serverId: '', directory: '', charIds: [], autonomous: false, read: { name: '', pathKey: '', fixed: {} }, write: { name: '', pathKey: '', contentKey: '', fixed: {} }, readContentKey: 'content', createOnly: false });
export function loadObsidianDiary(): ObsidianDiaryConfig { try {
    const raw = JSON.parse(localStorage.getItem(OBSIDIAN_DIARY_KEY) || 'null'), base = blankObsidianDiary();
    if (!raw || typeof raw !== 'object')
        return base;
    const value = { ...base, ...raw };
    for (const key of ['serverId', 'directory', 'readContentKey'] as const)
        if (typeof value[key] !== 'string')
            value[key] = base[key];
    for (const key of ['enabled', 'autonomous', 'createOnly'] as const)
        value[key] = value[key] === true;
    value.charIds = Array.isArray(raw.charIds) ? raw.charIds.filter((id: unknown) => typeof id === 'string') : [];
    for (const key of ['read', 'write'] as const) {
        const b = raw[key];
        value[key] = b && typeof b === 'object' ? { name: typeof b.name === 'string' ? b.name : '', pathKey: typeof b.pathKey === 'string' ? b.pathKey : '', contentKey: typeof b.contentKey === 'string' ? b.contentKey : '', fixed: b.fixed && typeof b.fixed === 'object' && !Array.isArray(b.fixed) ? b.fixed : {} } : base[key];
    }
    return value;
}
catch {
    return blankObsidianDiary();
} }
export function diaryDirectory(input: string, maxLength = 120) { const value = String(input || '').normalize('NFKC').replace(/\\/g, '/').trim(); if (!value || value.length > maxLength || value.startsWith('/') || value.split('/').some(p => !p || p === '.' || p === '..' || /[\u0000-\u001f:%*?"<>|]/.test(p) || /[. ]$/.test(p) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p)))
    throw Error('请填写安全的 vault 内相对子目录，不使用盘符、绝对路径或 ..'); return value; }
export function saveObsidianDiary(value: ObsidianDiaryConfig) { if (value.enabled) {
    diaryDirectory(value.directory);
    if (!value.serverId || !value.charIds.length || !value.autonomous)
        throw Error('请选择已有服务、适用角色及自主新建范围');
} localStorage.setItem(OBSIDIAN_DIARY_KEY, JSON.stringify(value)); window.dispatchEvent(new Event(OBSIDIAN_DIARY_CHANGED)); }
export function restoreDiaryAsset<T extends {
    id: string;
    data?: any;
}>(asset: T): T { if (!asset.id.startsWith('obsidian-diary:') || typeof asset.data !== 'string')
    return asset; try {
    const row = JSON.parse(asset.data);
    if (row?.kind !== 'obsidian-diary')
        return asset;
    return { ...asset, data: JSON.stringify({ ...row, ...(row.status === 'writing' ? { status: 'uncertain', message: '存档恢复后需重新核对文件' } : {}), operation: undefined, leaseUntil: undefined }) };
}
catch {
    return asset;
} }
