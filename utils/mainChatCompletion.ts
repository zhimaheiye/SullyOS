import { safeFetchJson, type StreamHooks } from './safeApi';
import type { ApiCallMeta } from './apiCallLog';

interface MainChatCompletionOptions {
    body: Record<string, any>;
    url: string;
    headers: HeadersInit;
    scope: 'private' | 'group';
    signal?: AbortSignal;
    streamHooks?: StreamHooks;
    meta?: ApiCallMeta;
}

/** 普通私聊和群聊正文只走用户配置的 API URL、Key 和模型。 */
export async function completeMainChat(options: MainChatCompletionOptions): Promise<any> {
    return safeFetchJson(options.url, {
        method: 'POST', headers: options.headers, body: JSON.stringify(options.body), signal: options.signal,
    }, 2, 0, options.meta, options.streamHooks);
}
