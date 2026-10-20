import { formatImageGenerationError, getImageGenerationDiagnosis, ImageGenerationError } from './imageGenerationError';

// 生图调用本地日志：只进 localStorage，保留 5 天、最多 150 条。
// 不保存 API Key、提示词原文、参考图或生成图，只留排障所需的服务/阶段/状态码。
const STORAGE_KEY = 'sullyos:image-generation-call-log:v1';
const RETENTION_MS = 5 * 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 150;

export interface ImageGenerationLogEntry {
    id: string;
    timestamp: number;
    ok: boolean;
    feature: string;
    provider: string;
    model?: string;
    endpoint?: string;
    durationMs: number;
    diagnosis: string;
    status?: number;
    stage?: string;
    detail?: string;
}

export interface ImageGenerationLogContext {
    feature?: string;
    provider?: string;
    model?: string;
    endpoint?: string;
    /** 上层正在记录整条复合链路时，避免底层请求重复记一条。 */
    skipLog?: boolean;
}

function safeEndpoint(value?: string): string | undefined {
    if (!value) return undefined;
    try {
        const url = new URL(value);
        return `${url.origin}${url.pathname}`;
    } catch {
        return value.replace(/\?.*$/, '');
    }
}

function readEntries(): ImageGenerationLogEntry[] {
    if (typeof window === 'undefined') return [];
    try {
        const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
        if (!Array.isArray(parsed)) return [];
        const cutoff = Date.now() - RETENTION_MS;
        return parsed.filter((entry): entry is ImageGenerationLogEntry =>
            !!entry && typeof entry.timestamp === 'number' && entry.timestamp >= cutoff,
        ).slice(0, MAX_ENTRIES);
    } catch {
        return [];
    }
}

function writeEntries(entries: ImageGenerationLogEntry[]): void {
    if (typeof window === 'undefined') return;
    try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES))); }
    catch { /* 日志不应阻断生图主流程 */ }
}

export function getImageGenerationLog(): ImageGenerationLogEntry[] {
    const entries = readEntries();
    writeEntries(entries);
    return entries;
}

export function clearImageGenerationLog(): void {
    if (typeof window === 'undefined') return;
    try { window.localStorage.removeItem(STORAGE_KEY); }
    catch { /* ignore */ }
}

export function recordImageGenerationSuccess(
    context: ImageGenerationLogContext,
    startedAt: number,
): void {
    const timestamp = Date.now();
    const entry: ImageGenerationLogEntry = {
        id: `img-ok-${timestamp}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp,
        ok: true,
        feature: context.feature || '生图',
        provider: context.provider || '生图接口',
        model: context.model,
        endpoint: safeEndpoint(context.endpoint),
        durationMs: Math.max(0, timestamp - startedAt),
        diagnosis: '调用成功，图片已返回。',
    };
    writeEntries([entry, ...readEntries()]);
}

export function recordImageGenerationFailure(
    error: unknown,
    context: ImageGenerationLogContext,
    startedAt: number,
): void {
    const timestamp = Date.now();
    const known = error instanceof ImageGenerationError ? error : undefined;
    const provider = known?.provider || context.provider || '生图接口';
    const feature = context.feature || '生图';
    const entry: ImageGenerationLogEntry = {
        id: known?.errorId || `img-fail-${timestamp}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp,
        ok: false,
        feature,
        provider,
        model: context.model,
        endpoint: safeEndpoint(known?.endpoint || context.endpoint),
        durationMs: Math.max(0, timestamp - startedAt),
        diagnosis: getImageGenerationDiagnosis(error),
        status: known?.status,
        stage: known?.stage,
        detail: formatImageGenerationError(error, { feature, provider }),
    };
    writeEntries([entry, ...readEntries()]);
}
