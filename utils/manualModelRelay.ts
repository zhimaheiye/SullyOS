import { getApiCallAmbientContext, type ApiCallMeta } from './apiCallLog';

export interface ManualRelayRequest {
    id: string;
    source: string;
    purpose: string;
    charName?: string;
    messages: Array<{ role: string; content: string; name?: string }>;
    startedAt: number;
}

type RelayState = { status: 'off' | 'armed'; request: null } | { status: 'waiting'; request: ManualRelayRequest };
type Pending = { request: ManualRelayRequest; resolve: (value: any) => void; reject: (error: Error) => void;
    signal?: AbortSignal; onAbort: () => void; timer: ReturnType<typeof setTimeout>;
    appId?: string; ambientCharId?: string };
const listeners = new Set<(state: RelayState) => void>();
let state: RelayState = { status: 'off', request: null };
let pending: Pending | null = null;
let lastActionAt = 0;
let lastActionAppId: string | undefined;
let followUpGuard: { source: string; until: number } | null = null;
let sequence = 0;
const ENABLED_KEY = 'sully.manualModelRelay.enabled.v1';
const readEnabled = () => {
    try { return typeof localStorage !== 'undefined' && localStorage.getItem(ENABLED_KEY) === 'true'; }
    catch { return false; }
};
state = { status: readEnabled() ? 'armed' : 'off', request: null };
const saveEnabled = (enabled: boolean) => {
    try { if (enabled) localStorage.setItem(ENABLED_KEY, 'true'); else localStorage.removeItem(ENABLED_KEY); }
    catch { /* The in-memory switch still works when storage is unavailable. */ }
};
const ACTION_WINDOW_MS = 120_000;
const WAIT_LIMIT_MS = 30 * 60_000;
const BACKGROUND_FEATURES = new Set([
    'emotion', 'characterLife', 'lifeEpisodes', 'companionStartup', 'homeConversation',
    'memoryLight', 'healingMemory', 'storyArchive', 'forumDecision', 'worldHomeText',
]);

export function isManualRelayCompletionUrl(value: string): boolean {
    try {
        const url = new URL(value, typeof location === 'undefined' ? 'http://localhost' : location.href);
        return /\/chat\/completions\/?$/.test(url.pathname);
    } catch { return false; }
}

const publish = () => { for (const listener of listeners) listener(state); };
export const getManualRelayState = (): RelayState => state;
export function subscribeManualRelay(listener: (state: RelayState) => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}
export function armManualRelay(): void {
    if (state.status !== 'off') return;
    lastActionAt = 0;
    lastActionAppId = undefined;
    state = { status: 'armed', request: null };
    saveEnabled(true);
    publish();
}
export function noteManualRelayUserAction(): void {
    if (state.status === 'waiting') return;
    followUpGuard = null;
    if (state.status !== 'armed') return;
    lastActionAt = Date.now();
    lastActionAppId = getApiCallAmbientContext().appId;
}
export function isManualRelayArmed(): boolean { return state.status === 'armed'; }
export function isManualRelayEnabled(): boolean { return state.status !== 'off'; }
export function assertManualRelayLocalRoute(cloudInstantChat: boolean): void {
    if (cloudInstantChat && isManualRelayEnabled()) {
        throw new Error('当前私聊会走云端即时聊天，外部模型接力无法接管；请关闭即时聊天或关闭接力模式后手动重试');
    }
}
export function isManualRelayReady(): boolean {
    return state.status === 'armed' && lastActionAt > 0 && Date.now() - lastActionAt <= ACTION_WINDOW_MS
        && (typeof document === 'undefined' || document.visibilityState !== 'hidden');
}
export function isManualRelayWaiting(): boolean { return state.status === 'waiting'; }
/** App/character navigation invalidates the frozen prompt without waiting for a stale reply. */
export function invalidateManualRelayContext(context: { appId?: string; charId?: string }): void {
    if (pending && ((pending.appId && context.appId !== pending.appId)
        || pending.ambientCharId !== context.charId)) cancelManualRelay(pending.request.id);
}
export function cancelManualRelayForApp(appId: string): void {
    if (pending?.appId === appId) cancelManualRelay(pending.request.id);
}
export function disarmManualRelay(): void {
    if (pending) cancelManualRelay(pending.request.id);
    state = { status: 'off', request: null };
    lastActionAt = 0;
    lastActionAppId = undefined;
    saveEnabled(false);
    publish();
}
const abortError = () => new DOMException('已取消外部模型接力', 'AbortError');
const finish = (item: Pending) => {
    if (pending !== item) return false;
    pending = null;
    clearTimeout(item.timer);
    item.signal?.removeEventListener('abort', item.onAbort);
    state = { status: 'armed', request: null };
    lastActionAt = 0;
    lastActionAppId = undefined;
    publish();
    return true;
};
export function cancelManualRelay(id?: string): boolean {
    const item = pending;
    if (!item || (id && item.request.id !== id) || !finish(item)) return false;
    followUpGuard = { source: item.request.source, until: Date.now() + 10 * 60_000 };
    item.reject(abortError());
    return true;
}
/** Pasted text must never become an instruction to run a local or network side effect. */
export function manualRelayReplyError(text: string): string | null {
    return /\[\[(?:ACTION|MUSIC_ACTION|GENERATE_IMAGE|RECALL|SEARCH|BROWSE|READ_[A-Z_]+|FS_[A-Z_]+|DIARY_[A-Z_]+|XHS_[A-Z_]+|MCP_[A-Z_]+)(?=\s*[:\]|])|\[schedule_message\s*\|/i.test(text)
        ? '回复含有会触发工具、网络或现实操作的控制标签；本轮不支持执行，请删除该标签后再提交。'
        : null;
}
const MANUAL_RELAY_OUTPUT_CONTRACT = `【外部文字接力：无工具，单次完整返回】
本轮没有任何可用工具，不会执行函数调用、联网搜索、读取设备状态、操作外部服务，也不会返回工具结果。上下文或历史中提到的工具、调用示例与分步执行要求，不代表本轮具有这些能力；本轮以此能力边界为准。
只依据已提供的角色设定、记忆、历史和任务材料直接完成本次回复。缺少实时信息时如实说明未知或避开相关断言，不假装查询、操作成功，不编造工具结果。
在同一条最终回复中一次性给出本次任务所需的全部内容，不要只输出计划、函数调用、等待提示，也不要要求用户发送“继续”才能取得本次剩余内容。不输出接力规则说明或额外的执行过程。
保留本次任务要求的正文、JSON、HTML、翻译及其它展示格式；需要多个聊天气泡时，在同一条回复内按原格式完整输出。一次性返回不等于只写一句话，也不要求把多条消息合并成一个气泡。不要输出会触发工具或外部操作的控制指令。`;
export function submitManualRelay(id: string, text: string): boolean {
    const item = pending;
    if (!item || item.request.id !== id || !text.trim() || manualRelayReplyError(text) || !finish(item)) return false;
    followUpGuard = { source: item.request.source, until: Date.now() + 10 * 60_000 };
    item.resolve({ id: `manual-relay-${id}`, object: 'chat.completion', created: Math.floor(Date.now() / 1000),
        model: 'external-manual-relay', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }] });
    return true;
}

/** A strict foreground text boundary. The returned promise belongs to the original caller. */
export function maybeInterceptTextCompletion(input: {
    body: unknown; meta?: ApiCallMeta; scope?: 'private' | 'group' | 'task';
    priority?: 'user' | 'background'; signal?: AbortSignal;
}): Promise<any> | null {
    const source = input.meta?.appName || (input.scope === 'group' ? '群聊' : input.scope === 'private' ? '私聊' : '当前应用');
    if (input.priority === 'background' || input.meta?.relayPriority === 'background'
        || (input.meta?.featureId && BACKGROUND_FEATURES.has(input.meta.featureId))) return null;
    if (followUpGuard && Date.now() < followUpGuard.until && source === followUpGuard.source) {
        throw new Error('手动接力后的自动后续模型请求已停止；请在原 App 手动触发下一次生成');
    }
    if (state.status === 'off' || input.signal?.aborted) return null;
    if (pending || state.status === 'waiting') throw new Error('当前有接力任务，请稍后重试；已阻止真实模型请求');
    if (!lastActionAt || (lastActionAppId && input.meta?.appId && lastActionAppId !== input.meta.appId)) {
        throw new Error('外部模型接力已开启，但本轮没有当前应用的有效生成操作；已阻止真实模型请求，请重新点击生成');
    }
    const body = input.body;
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('本轮不是可接力的纯文字请求；请关闭接力模式后手动重试');
    const data = body as Record<string, any>;
    if (data.tools || data.tool_choice || data.functions || data.function_call
        || (data.modalities && (!Array.isArray(data.modalities) || data.modalities.some((kind: unknown) => kind !== 'text'))))
        throw new Error('本轮含原生工具或多模态内容，不支持外部模型接力；请关闭接力模式后手动重试');
    if (!Array.isArray(data.messages) || !data.messages.length) throw new Error('本轮缺少可接力的文字消息；请关闭接力模式后手动重试');
    const messages: ManualRelayRequest['messages'] = [];
    for (const raw of data.messages) {
        if (!raw || !['system', 'developer', 'user', 'assistant'].includes(raw.role)
            || typeof raw.content !== 'string' || raw.tool_calls || raw.function_call
            || Object.keys(raw).some(key => !['role', 'content', 'name'].includes(key))
            || (raw.name != null && typeof raw.name !== 'string')
            || /blobref:|data:(?:image|audio|video)\/|[A-Za-z0-9+/]{200,}={0,2}/i.test(raw.content))
            throw new Error('本轮含不受支持的消息或多模态内容；请关闭接力模式后手动重试');
        messages.push({ ...raw });
    }
    // Both copy formats share this contract; never rewrite user history or business schemas.
    messages.push({ role: 'system', content: MANUAL_RELAY_OUTPUT_CONTRACT });
    if (Date.now() - lastActionAt > ACTION_WINDOW_MS
        || (typeof document !== 'undefined' && document.visibilityState === 'hidden')) {
        lastActionAt = 0;
        throw new Error('手动接力本轮已过期或页面已离开；已阻止真实模型请求，请重新点击生成');
    }
    const request: ManualRelayRequest = { id: `relay-${Date.now()}-${++sequence}`,
        source,
        purpose: input.meta?.purpose || input.meta?.featureId || (input.scope === 'group' ? '群聊回复' : '文字生成'),
        charName: input.meta?.charName, messages, startedAt: Date.now() };
    state = { status: 'waiting', request };
    lastActionAt = 0;
    lastActionAppId = undefined;
    const promise = new Promise<any>((resolve, reject) => {
        const ambient = getApiCallAmbientContext();
        const item: Pending = { request, resolve, reject, signal: input.signal, onAbort: () => cancelManualRelay(request.id),
            timer: setTimeout(() => cancelManualRelay(request.id), WAIT_LIMIT_MS),
            appId: input.meta?.appId || ambient.appId, ambientCharId: ambient.charId };
        pending = item;
        input.signal?.addEventListener('abort', item.onAbort, { once: true });
    });
    publish();
    return promise;
}

/** The legacy fetch adapter returns the same JSON shape as a non-streaming completion. */
export function maybeInterceptTextResponse(input: Parameters<typeof maybeInterceptTextCompletion>[0]): Promise<Response> | null {
    const result = maybeInterceptTextCompletion(input);
    if (!result) return null;
    return result.then(data => {
        const streamed = !!(input.body && typeof input.body === 'object' && (input.body as Record<string, unknown>).stream === true);
        if (streamed) {
            const choice = data.choices[0];
            const first = { id: data.id, object: 'chat.completion.chunk', created: data.created, model: data.model,
                choices: [{ index: 0, delta: { role: 'assistant', content: choice.message.content }, finish_reason: null }] };
            const last = { id: data.id, object: 'chat.completion.chunk', created: data.created, model: data.model,
                choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] };
            return new Response(`data: ${JSON.stringify(first)}\n\ndata: ${JSON.stringify(last)}\n\ndata: [DONE]\n\n`,
                { status: 200, headers: { 'content-type': 'text/event-stream' } });
        }
        return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
    });
}

export function syncManualRelayPreference(enabled: boolean): void {
    if (enabled) {
        if (state.status === 'off') { state = { status: 'armed', request: null }; publish(); }
    } else if (state.status !== 'off') {
        if (pending) cancelManualRelay(pending.request.id);
        state = { status: 'off', request: null };
        lastActionAt = 0;
        lastActionAppId = undefined;
        publish();
    }
}

if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', () => cancelManualRelay());
    window.addEventListener('storage', event => {
        if (event.key === ENABLED_KEY) syncManualRelayPreference(event.newValue === 'true');
    });
    const eligibleAction = (target: EventTarget | null, key = '') => {
        const node = target instanceof Element ? target : null;
        if (!node || node.closest('[data-manual-relay-control], [aria-label="开发调试面板"]')) return false;
        if (key === 'Enter' && node.closest('textarea')) return true;
        const button = node.closest('button, [role="button"]');
        if (button?.hasAttribute('data-manual-relay-action')) return true;
        const label = `${button?.getAttribute('aria-label') || ''} ${button?.textContent || ''}`;
        return !!button && /发送|生成|续写|继续写|重新生成|重生|回复|讨论|演绎|创作|交换|提交|分析|整理|开始活动|发帖|抽取|总结|批注|留言|投稿|判定|写作|开局|行动|讲解|提问|下一轮|下一步|更新|去逛|逛逛|随便玩/.test(label);
    };
    window.addEventListener('pointerdown', event => { if (event.isTrusted && eligibleAction(event.target)) noteManualRelayUserAction(); }, true);
    window.addEventListener('keydown', event => {
        if (event.isTrusted && event.key === 'Enter' && eligibleAction(event.target, 'Enter')) noteManualRelayUserAction();
    }, true);
}
