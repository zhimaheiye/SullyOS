/**
 * 彼方邮局 · 旧存档兼容
 *
 * 公开版本不再提供邮局和漂流瓶，也不再连接任何邮局后端。
 * 这里只保留旧备份的导入/导出形状，避免用户恢复旧备份时丢失本机身份记录。
 */

const BASE_KEY = 'vr_po_base';
const DEVICE_KEY = 'vr_po_device';

/** 打开数据库时清掉保存的邮局地址，避免旧配置重新指向作者的服务器。 */
export function forgetPublicPostOfficeBase(): void {
    try { localStorage.removeItem(BASE_KEY); } catch { /* ignore */ }
}

// ── 备份用：把邮局的本机配置随「设置 → 导出/导入备份」一起带走 ──────────
// 只带【身份 deviceId】。旧备份里的后端地址在导入时清除。
export function exportPostOfficeLocal(): Record<string, string> | undefined {
    try {
        const out: Record<string, string> = {};
        const dev = localStorage.getItem(DEVICE_KEY); if (dev) out[DEVICE_KEY] = dev;
        return Object.keys(out).length ? out : undefined;
    } catch { return undefined; }
}
export function importPostOfficeLocal(data: Record<string, string> | null | undefined): void {
    if (!data || typeof data !== 'object') return;
    try {
        if (typeof data[DEVICE_KEY] === 'string' && data[DEVICE_KEY]) localStorage.setItem(DEVICE_KEY, data[DEVICE_KEY]);
        forgetPublicPostOfficeBase();
    } catch { /* ignore */ }
}
