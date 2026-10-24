import type { ApiCallMeta } from './apiCallLog';
import type { FeatureApiId, TextFeatureApi } from './featureApi';
import { safeFetchJson, type StreamHooks } from './safeApi';

/** A single completion boundary for foreground text tasks. The selected route is frozen before dispatch. */
export function completeTextTask(input: {
  id: FeatureApiId;
  api: Partial<TextFeatureApi> | null | undefined;
  messages: unknown[];
  body?: Record<string, unknown>;
  signal?: AbortSignal;
  timeoutMs?: number;
  streamHooks?: StreamHooks;
  meta?: ApiCallMeta;
  privateTransient?: boolean;
}): Promise<any> {
  const api = input.api;
  const body = { ...input.body, model: api?.model || '', messages: input.messages };
  return safeFetchJson(`${api?.baseUrl?.replace(/\/+$/, '') || ''}/chat/completions`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api?.apiKey || 'sk-none'}` },
    body: JSON.stringify(body), signal: input.signal,
  }, 0, input.timeoutMs || 0, { ...input.meta, featureId: input.id }, input.streamHooks,
  input.privateTransient ? { privateTransient: true } : undefined);
}

/** Adapter for legacy callers that parse a Response after a single text completion. */
export async function completeTextTaskResponse(id: FeatureApiId, api: Partial<TextFeatureApi> | null | undefined,
  request: RequestInit, meta?: ApiCallMeta): Promise<Response> {
  const body = JSON.parse(String(request.body || '{}')) as Record<string, unknown>;
  const data = await completeTextTask({ id, api, messages: body.messages as unknown[], body, signal: request.signal || undefined, meta });
  return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
}
