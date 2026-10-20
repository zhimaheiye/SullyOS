/**
 * 信号坠落处 · 旧存档兼容
 *
 * 公开版本不再提供信号坠落处，也不连接任何诗歌后端。
 * 这里只保留旧备份的导入/导出形状。
 */

const BACKUP_KEYS = ['signal_my_authorship', 'signal_my_lines', 'signal_notice_ack'] as const;

export function exportSignalLocal(): Record<string, string> | undefined {
    try {
        const out: Record<string, string> = {};
        for (const k of BACKUP_KEYS) { const v = localStorage.getItem(k); if (v) out[k] = v; }
        return Object.keys(out).length ? out : undefined;
    } catch { return undefined; }
}
export function importSignalLocal(data: Record<string, string> | null | undefined): void {
    if (!data || typeof data !== 'object') return;
    try {
        for (const k of BACKUP_KEYS) if (typeof data[k] === 'string' && data[k]) localStorage.setItem(k, data[k]);
    } catch { /* ignore */ }
}
