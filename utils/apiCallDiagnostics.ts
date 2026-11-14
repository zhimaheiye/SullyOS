// Completed attempts retain sanitized evidence locally for one day.
// IndexedDB and memory share a rolling expiry; capacity limits can evict earlier.
export const DIAGNOSTIC_MAX_AGE = 24 * 60 * 60 * 1000;
export const DIAGNOSTIC_MAX_SAVED = 40;
export const DIAGNOSTIC_SAVED_BYTES = 4 * 1024 * 1024;
const RECENT_MS = DIAGNOSTIC_MAX_AGE;
const ACTIVE_MS = 20 * 60 * 1000;
const MEMORY_ROWS = 24;
const PENDING_ROWS = 8;
const RECENT_BYTES = 2 * 1024 * 1024;
const SECTION_CHARS = 48 * 1024;
const encoder = new TextEncoder();
export const API_DIAGNOSTICS_CHANGED = 'sully-api-diagnostics-changed';

type Outcome = 'success' | 'failure' | 'cancelled' | 'transport-only';
export interface ApiDiagnostic {
    id: string;
    startedAt: number;
    completedAt: number;
    layer: 'http' | 'adapted';
    status?: number;
    headersMs?: number;
    firstDeltaMs?: number;
    bodyMs?: number;
    outcome: Outcome;
    stage: string;
    error?: string;
    request?: string;
    response?: string;
    extracted?: string;
    finishReason?: string;
    requestNote?: string;
    responseNote?: string;
    partial?: boolean;
    retained?: 'automatic' | 'manual';
}

const active = new Map<string, { startedAt: number; release: () => void }>();
const recent = new Map<string, { snapshot: ApiDiagnostic; bytes: number }>();
const pending = new Map<string, { snapshot: ApiDiagnostic; written: Promise<void> }>();
const failedWrites = new Map<string, number>();
const receipts = new WeakMap<object, ApiDiagnosticAttempt>();
const safeErrors = new WeakMap<object, string>();
let externalClearAt = 0;
const externalClearedIds = new Set<string>();
let timer: ReturnType<typeof setTimeout> | undefined;
let channel: BroadcastChannel | undefined;
let flushing = false;
const announce = () => {
    if (typeof window !== 'undefined') window.dispatchEvent(new Event(API_DIAGNOSTICS_CHANGED));
};

function getChannel() {
    if (typeof window === 'undefined' || typeof BroadcastChannel === 'undefined') return;
    try {
        if (!channel) {
            channel = new BroadcastChannel('sully-api-diagnostic-invalidation');
            channel.onmessage = ({ data }) => invalidate(data?.at, data?.id);
        }
    } catch { /* IndexedDB's clear cutoff still guards concurrent writes. */ }
    return channel;
}

function prune(now: number) {
    for (const [id, item] of active) if (item.startedAt + ACTIVE_MS <= now) {
        item.release();
        active.delete(id);
    }
    for (const [id, item] of recent) if (item.snapshot.completedAt + RECENT_MS <= now) recent.delete(id);
    for (const [id, time] of failedWrites) if (time + RECENT_MS <= now) failedWrites.delete(id);
    while (active.size + recent.size > MEMORY_ROWS) {
        const oldRecent = recent.keys().next().value;
        if (oldRecent !== undefined) recent.delete(oldRecent);
        else {
            const oldest = active.entries().next().value;
            if (!oldest) break;
            oldest[1].release();
            active.delete(oldest[0]);
        }
    }
    let recentBytes = [...recent.values()].reduce((sum, item) => sum + item.bytes, 0);
    for (const [id, item] of recent) {
        if (recentBytes <= RECENT_BYTES) break;
        recent.delete(id);
        recentBytes -= item.bytes;
    }
    while (failedWrites.size > MEMORY_ROWS) {
        const id = failedWrites.keys().next().value;
        if (id !== undefined) failedWrites.delete(id);
    }
    clearTimeout(timer);
    const next = Math.min(
        ...[...active.values()].map(item => item.startedAt + ACTIVE_MS),
        ...[...recent.values()].map(item => item.snapshot.completedAt + RECENT_MS),
        ...[...failedWrites.values()].map(time => time + RECENT_MS),
    );
    if (Number.isFinite(next)) {
        timer = setTimeout(() => { prune(Date.now()); announce(); }, Math.max(1, next - now));
        (timer as { unref?: () => void }).unref?.();
    }
}

function invalidate(at: number, id?: string) {
    if (!Number.isFinite(at)) return;
    if (id) {
        externalClearedIds.add(id);
        while (externalClearedIds.size > 128) externalClearedIds.delete(externalClearedIds.values().next().value!);
    }
    else { externalClearAt = Math.max(externalClearAt, at); externalClearedIds.clear(); }
    for (const [key, item] of active) if (id ? key === id : item.startedAt <= at) {
        item.release();
        active.delete(key);
    }
    for (const [key, item] of recent) if (id ? key === id : item.snapshot.startedAt <= at) recent.delete(key);
    for (const [key, item] of pending) if (id ? key === id : item.snapshot.startedAt <= at) pending.delete(key);
    for (const [key, time] of failedWrites) if (id ? key === id : time <= at) failedWrites.delete(key);
    prune(Date.now());
    announce();
}

async function flushDiagnostics() {
    if (flushing) return;
    flushing = true;
    try {
        for (const [id, item] of pending) {
            try {
                await item.written;
                if (pending.get(id) !== item) continue;
                const { DB } = await import('./db');
                if (pending.get(id) !== item) continue;
                const saved = await DB.saveApiDiagnostic(item.snapshot);
                if (!saved && pending.get(id) === item) failedWrites.set(id, Date.now());
            } catch {
                if (pending.get(id) === item) failedWrites.set(id, Date.now());
            } finally {
                if (pending.get(id) === item) pending.delete(id);
                prune(Date.now());
                announce();
            }
        }
    } finally { flushing = false; }
}

function retainDiagnostic(snapshot: ApiDiagnostic, written: Promise<void>) {
    // A slow or unavailable database cannot make the page retain an unlimited
    // number of responses. Never leave a rejected write unobserved.
    void written.catch(() => {});
    while (pending.size >= PENDING_ROWS) {
        const oldest = pending.keys().next().value;
        if (oldest === undefined) break;
        pending.delete(oldest);
        failedWrites.set(oldest, Date.now());
    }
    pending.set(snapshot.id, { snapshot, written });
    void flushDiagnostics();
}

export function invalidateApiDiagnostics(at: number, id?: string) {
    invalidate(at, id);
    try { getChannel()?.postMessage({ at, id }); } catch { /* same-tab invalidation already applied */ }
}

export function getRecentApiDiagnostic(id: string) {
    prune(Date.now());
    return recent.get(id)?.snapshot;
}

export function listRecentApiDiagnosticIds() {
    prune(Date.now());
    return new Set(recent.keys());
}

export function clearRecentApiDiagnostics() {
    recent.clear();
    prune(Date.now());
    announce();
}

export function apiDiagnosticWriteFailed(id: string) {
    prune(Date.now());
    return failedWrites.has(id);
}

export async function saveRecentApiDiagnostic(id: string) {
    const snapshot = getRecentApiDiagnostic(id);
    if (!snapshot) return false;
    const { DB } = await import('./db');
    const current = getRecentApiDiagnostic(id);
    if (current !== snapshot) return false;
    return DB.saveApiDiagnostic({ ...snapshot, retained: 'manual' });
}

const protectedText = /当前的位置|现在的定位|\[当前定位|\[\[OBS_DIARY|(?:密钥|访问令牌|密码)\s*[:：=]|\b(?:latitude|longitude|gps|private.?region|set-cookie|cookie|authorization|api[_ -]?key|password|passwd|(?:client[_ -]?)?secret|(?:(?:access|refresh|id|oauth|bearer|session)[_ -]?)?token|x-api-key|b64_json|audio_data)\b["'\\]*(?:\s*[:=]|\s+is\s+)/iu;
const media = /data:[^\s"'<>]+|blob:[^\s"'<>]+|[A-Za-z0-9+/_-]{256,}={0,2}/giu;
const hasProtectedText = (value: string) => protectedText.test(value)
    || (value.includes('\\u') && protectedText.test(value.replace(/\\u([\da-f]{4})/gi, (_, digits) => String.fromCharCode(parseInt(digits, 16)))));

function redactor(url: string, headers: HeadersInit | undefined) {
    const secrets = new Set<string>();
    const add = (value: string) => {
        if (!value) return;
        secrets.add(value);
        secrets.add(encodeURIComponent(value));
        secrets.add(JSON.stringify(value).slice(1, -1));
    };
    const parsed = new URL(url, 'http://localhost');
    add(decodeURIComponent(parsed.username));
    add(decodeURIComponent(parsed.password));
    parsed.searchParams.forEach(add);
    new Headers(headers).forEach((value, name) => {
        if (/auth|cookie|token|secret|key|pass|session/i.test(name)) {
            add(value);
            if (/^Basic\s+/i.test(value)) {
                try { atob(value.slice(6)).split(':').forEach(add); } catch { /* invalid Basic auth */ }
            }
            for (const part of value.replace(/^(Bearer|Basic)\s+/i, '').split(/;\s*/)) {
                add(part);
                if (name.includes('cookie')) add(part.slice(part.indexOf('=') + 1));
            }
        }
    });
    return (value: string) => {
        if (hasProtectedText(value)) return '[此段含受保护字段，已省略]';
        let text = value;
        for (const secret of secrets) text = text.split(secret).join('[已遮盖]');
        return text
            .replace(/\bhttps?:(?:\\?\/){2}[^\s"'<>]+/giu, '[链接已省略]')
            .replace(/\bBearer\s+[^\s"'<>]+|\b(?:sk-|ghp_|gho_|github_pat_|xox[baprs]-|AIza|eyJ)[\w.-]+/giu, '[凭据已遮盖]')
            .replace(media, value => {
                const kind = value.match(/^data:((?:image|audio|video)\/[\w.+-]{1,32})[;,]/i)?.[1] || '媒体或长编码';
                return `[${kind}已省略 · ${value.length} 字符]`;
            })
            .slice(0, SECTION_CHARS);
    };
}

export interface ApiDiagnosticAttempt {
    sent(url: string, options: RequestInit, adapted?: boolean): void;
    headers(status: number): void;
    chunk(text: string): void;
    body(result: unknown, firstDeltaMs?: number, extracted?: string): void;
    note(reason: string): void;
    recorded(write: Promise<void> | undefined): void;
    readonly status?: number;
    readonly isIncomplete: boolean;
    readonly excluded: boolean;
    discard(): void;
    incomplete(): void;
    rawComplete(): void;
    finish(outcome: Outcome, stage: string, error?: string, partial?: boolean): void;
}

export function beginApiDiagnostic(input: {
    id: string; startedAt: number; url: string; options: RequestInit; adapted: boolean;
    onBusinessResult: (outcome: 'success' | 'failure' | 'cancelled') => Promise<void>;
}): ApiDiagnosticAttempt | undefined {
    try {
        getChannel();
        const { id, startedAt, adapted, onBusinessResult } = input;
        let scrub: ((value: string) => string) | undefined;
        let draft: ApiDiagnostic | undefined = {
            id, startedAt, completedAt: 0, layer: adapted ? 'adapted' : 'http',
            outcome: 'transport-only', stage: '响应读取',
        };
        let protectedRequest = false;
        let raw = '';
        let overflow = false;
        let ended = false;
        let excluded = false;
        let capturedUpstream = false;
        let recorded: Promise<void> | undefined;
        const release = () => { draft = undefined; scrub = undefined; raw = ''; };
        const attempt: ApiDiagnosticAttempt = {
            sent(url, options, adaptedResponse) {
                if (!draft) return;
                try { scrub = redactor(url, options.headers); }
                catch { release(); return; }
                if (adaptedResponse) draft.layer = 'adapted';
                const body = options.body;
                protectedRequest = typeof body === 'string' && hasProtectedText(body);
                draft.request = undefined;
                draft.requestNote = undefined;
                if (protectedRequest) draft.requestNote = '请求包含受保护字段，输入与输出均省略';
                else if (typeof body !== 'string') draft.requestNote = '请求没有可捕获的文本正文';
                else if (body.length > SECTION_CHARS) draft.requestNote = '输入超过 49,152 字符，已省略';
                else draft.request = scrub(body);
            },
            headers(status) {
                if (!draft) return;
                draft.status = status;
                draft.headersMs ??= Date.now() - startedAt;
            },
            chunk(text) {
                if (!draft || protectedRequest || overflow || capturedUpstream) return;
                if (raw.length + text.length > SECTION_CHARS) {
                    overflow = true;
                    raw = '';
                } else raw += text;
            },
            body(result, firstDeltaMs, extracted) {
                if (result && typeof result === 'object') receipts.set(result, attempt);
                if (!draft || !scrub) return;
                draft.bodyMs = Date.now() - startedAt;
                draft.firstDeltaMs = firstDeltaMs;
                if (!result || typeof result !== 'object') return;
                const choice = (result as { choices?: { finish_reason?: unknown; text?: unknown }[] }).choices?.[0];
                const content = extracted || choice?.text;
                if (!protectedRequest && typeof content === 'string' && content.length <= SECTION_CHARS) draft.extracted = scrub(content);
                if (typeof choice?.finish_reason === 'string') draft.finishReason = scrub(choice.finish_reason.slice(0, 64));
            },
            note(reason) { if (draft) draft.responseNote = reason; },
            recorded(write) { recorded = write; },
            get status() { return draft?.status; },
            get isIncomplete() { return !!draft?.partial; },
            get excluded() { return excluded; },
            discard() {
                excluded = true;
                ended = true;
                release();
                active.delete(id);
                prune(Date.now());
            },
            incomplete() { if (draft) draft.partial = true; },
            rawComplete() { capturedUpstream = true; },
            finish(outcome, stage, error, partial) {
                if (ended) return;
                ended = true;
                const written = outcome !== 'transport-only' && stage.startsWith('业务')
                    ? Promise.resolve(recorded).then(() => onBusinessResult(outcome)) : Promise.resolve(recorded);
                if (!draft || !scrub) { void written.catch(() => {}).finally(announce); return; }
                const now = Date.now();
                const protectedResponse = protectedRequest || hasProtectedText(raw);
                const snapshot: ApiDiagnostic = {
                    ...draft, outcome, stage, partial: draft.partial || (partial && !!raw), completedAt: now,
                    error: error && (protectedResponse || overflow ? '错误原文随受限响应省略' : scrub(error).slice(0, 1024)),
                    response: raw && !protectedResponse ? scrub(raw) : undefined,
                    extracted: protectedResponse || overflow ? undefined : draft.extracted,
                    responseNote: protectedResponse ? '响应含受保护字段或可能回显受保护输入，已省略'
                        : overflow ? '收到的响应超过 49,152 字符，已省略'
                        : draft.responseNote,
                };
                release();
                active.delete(id);
                if (outcome !== 'cancelled') {
                    recent.set(id, { snapshot, bytes: apiDiagnosticBytes(snapshot) });
                    retainDiagnostic({ ...snapshot, retained: 'automatic' }, written);
                } else {
                    void written.catch(() => {}).finally(announce);
                }
                prune(now);
            },
        };
        attempt.sent(input.url, input.options);
        active.set(id, { startedAt, release });
        prune(startedAt);
        return attempt;
    } catch {
        return undefined;
    }
}

export function settleApiDiagnostic(result: unknown, outcome: Exclude<Outcome, 'transport-only'>, stage: string, error?: string) {
    if (result && typeof result === 'object') receipts.get(result)?.finish(outcome, `业务 · ${stage}`, error);
}

export function noteApiDiagnosticError(error: unknown, stage: string, status?: number) {
    if (error && typeof error === 'object') safeErrors.set(error,
        `${status == null ? '' : `HTTP ${status} · `}${stage}失败，详见 API 调用记录`);
}

export function apiDiagnosticErrorSummary(error: unknown, result?: unknown) {
    const transport = error && typeof error === 'object' ? safeErrors.get(error) : undefined;
    if (transport) return transport;
    if (result && typeof result === 'object' && receipts.has(result)) return '响应处理失败，详见 API 调用记录';
}

export async function consumeApiDiagnostic<T>(result: unknown, stage: string, consume: () => T | Promise<T>, deferSuccess = false): Promise<T> {
    try {
        const value = await consume();
        if (!deferSuccess) settleApiDiagnostic(result, 'success', stage);
        return value;
    } catch (error) {
        settleApiDiagnostic(result, error instanceof Error && error.name === 'AbortError' ? 'cancelled' : 'failure',
            stage, error instanceof Error ? error.message : '处理响应时发生错误');
        throw error;
    }
}

export function apiDiagnosticBytes(snapshot: ApiDiagnostic) {
    return encoder.encode(JSON.stringify(snapshot)).byteLength;
}
