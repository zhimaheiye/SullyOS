/** PRIVATE_ONLY. A short-lived, single request capability, never a serialized flag. */
export interface ExplicitVisionPermit { readonly opaque: unique symbol }
const permits = new WeakMap<object, { signal: AbortSignal; url: string; model: string; bound: boolean; until: number; body?: BodyInit | null }>();
const marker = Symbol('explicit-image-description');
export async function withExplicitVisionPermit<T>(signal: AbortSignal, url: string, model: string, run: (permit: ExplicitVisionPermit) => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  const permit = {} as ExplicitVisionPermit;
  permits.set(permit, { signal, url, model, bound: false, until: Date.now() + 120_000 });
  try { return await run(permit); } finally { permits.delete(permit); }
}
export function bindExplicitVisionPermit(url: string, options: RequestInit, permit?: ExplicitVisionPermit): RequestInit {
  if (!permit) return options;
  const item = permits.get(permit);
  if (!item || item.bound || item.signal.aborted || item.signal !== options.signal || item.url !== url || Date.now() > item.until) throw Error('补图操作已失效，请重新点击开始');
  const body = JSON.parse(String(options.body));
  if (body.model !== item.model || Object.keys(body).some(key => !['model', 'messages', 'temperature', 'max_tokens', 'stream'].includes(key)) || body.messages?.[0]?.role !== 'user' || body.tools || body.functions || body.messages?.length !== 1 || !Array.isArray(body.messages[0].content)
    || !body.messages[0].content.every((part: any) => part.type === 'text' && typeof part.text === 'string' || part.type === 'image_url' && /^data:image\/(?:png|jpeg|webp);base64,/.test(part.image_url?.url || ''))
    || body.messages[0].content.filter((part: any) => part.type === 'image_url').length > 5
    || !body.messages[0].content.some((part: any) => part.type === 'image_url') || body.stream !== false) throw Error('补图许可不适用于当前请求');
  item.bound = true; item.body = options.body;
  return { ...options, [marker]: permit } as RequestInit;
}
export function isExplicitVisionRequest(url: string, options?: RequestInit): boolean {
  const item = options && permits.get((options as any)[marker]);
  return !!item && item.bound && !item.signal.aborted && Date.now() <= item.until && url === item.url && options?.body === item.body;
}
