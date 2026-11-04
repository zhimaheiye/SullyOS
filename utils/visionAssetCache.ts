import { hashBlob } from '@rei-standard/blob-store';
/** PRIVATE_ONLY. Content identities and context-free descriptions live in the backed-up assets store. */
import { openDB } from './db';
import { getBlobForRef, isBlobRef, dataUrlToBlob } from './blobRef';
export type VisionSemantics = 'photo-v1' | 'meme-v1';
export interface VisionAssetDescription { key: string; semantics: VisionSemantics; description: string; origin: 'model' | 'manual' | 'message'; updatedAt: number; model?: string; gif?: boolean; revision?: string }
export const VISION_DESCRIPTION_LIMIT = 4000;
/** Legacy records have no revision. Compare their complete value, not a millisecond clock. */
export const visionAssetVersion = (value: VisionAssetDescription | null): string | null => value ? value.revision || JSON.stringify([value.key, value.description, value.origin, value.updatedAt, value.model, value.gif]) : null;
export const VISION_CACHE_EPOCH = 'vision-cache:epoch';
const stable = (ref: string) => isBlobRef(ref) || ref.startsWith('data:image/');
export async function digestVisionBytes(bytes: ArrayBuffer | Uint8Array): Promise<string> {
  if (!globalThis.crypto?.subtle) throw Error('当前环境无法计算素材内容身份，请使用localhost或HTTPS');
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes as BufferSource))].map(n => n.toString(16).padStart(2, '0')).join('');
}
async function assetRecord<T>(id: string): Promise<T | null> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const req = db.transaction('assets', 'readonly').objectStore('assets').get(id);
    req.onsuccess = () => { try { resolve(req.result ? JSON.parse(req.result.data) : null); } catch { resolve(null); } }; req.onerror = () => reject(req.error);
  });
}
export async function visionCacheEpoch(): Promise<string> {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction('assets', 'readwrite'), store = tx.objectStore('assets'), request = store.get(VISION_CACHE_EPOCH); let epoch = '';
    request.onsuccess = () => { epoch = request.result?.data || crypto.randomUUID(); if (!request.result) store.put({ id: VISION_CACHE_EPOCH, data: epoch }); };
    tx.oncomplete = () => resolve(epoch); tx.onabort = tx.onerror = () => reject(tx.error || Error('素材存档读取失败'));
  });
}
export const visionRefAlias = async (ref: string, semantics: VisionSemantics) => stable(ref) ? `vision-ref:${semantics}:${await digestVisionBytes(new TextEncoder().encode(ref))}` : null;
export async function readVisionAsset(key: string) {
  if (typeof key !== 'string' || !/^vision-cache:(?:photo|meme)-v1:[a-f0-9]{64}$/.test(key)) return null;
  const value = await assetRecord<VisionAssetDescription>(key);
  return value?.key === key && key.startsWith(`vision-cache:${value.semantics}:`) && typeof value.description === 'string'
    && value.description.length <= VISION_DESCRIPTION_LIMIT && ['manual', 'model', 'message'].includes(value.origin) && Number.isFinite(value.updatedAt) ? value : null;
}
export async function findStableVisionAsset(ref: string, semantics: VisionSemantics) {
  if (!stable(ref)) return null; // Remote URLs are locators, never immutable proof.
  const alias = await assetRecord<{ key: string }>((await visionRefAlias(ref, semantics))!);
  if (typeof alias?.key === 'string') { const value = await readVisionAsset(alias.key); if (value?.semantics === semantics) return value; }
  try { return readVisionAsset(await identifyVisionBlob(await readVisionBlob(ref), semantics)); } catch { return null; }
}
export async function readVisionBlob(ref: string, signal?: AbortSignal): Promise<Blob> {
  signal?.throwIfAborted(); let blob: Blob | null;
  if (isBlobRef(ref)) blob = await getBlobForRef(ref);
  else if (ref.startsWith('data:image/')) { if (ref.length > 17 * 1024 * 1024) throw Error('素材超过12MB'); blob = dataUrlToBlob(ref); }
  else {
    const url = new URL(ref, typeof location === 'undefined' ? 'http://localhost' : location.href);
    if (!/^https?:$/.test(url.protocol)) throw Error('素材地址不可读取');
    const response = await fetch(url, { signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!response.ok) throw Error('素材下载失败，可能已失效或受跨域限制');
    if (Number(response.headers.get('content-length') || 0) > 12 * 1024 * 1024) throw Error('素材超过12MB');
    if (response.body?.getReader) {
      const reader = response.body.getReader(), parts: Uint8Array[] = []; let size = 0;
      try { while (true) { signal?.throwIfAborted(); const chunk = await reader.read(); if (chunk.done) break; size += chunk.value.byteLength;
        if (size > 12 * 1024 * 1024) throw Error('素材超过12MB'); parts.push(chunk.value); }
      } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
      blob = new Blob(parts as BlobPart[], { type: response.headers.get('content-type') || '' });
    } else blob = await response.blob();
  }
  signal?.throwIfAborted();
  if (!blob?.size) throw Error('原图已不可用');
  if (blob.size > 12 * 1024 * 1024) throw Error('素材超过12MB');
  const magic = new Uint8Array(await blob.slice(0, 12).arrayBuffer());
  const signature = String.fromCharCode(...magic);
  const supported = signature.startsWith('GIF8') || magic[0] === 137 && signature.slice(1, 4) === 'PNG' || magic[0] === 255 && magic[1] === 216 || signature.startsWith('RIFF') && signature.slice(8) === 'WEBP';
  if (!supported) throw Error('只支持可解码的PNG、JPEG、WebP与GIF原图');
  const type = signature.startsWith('GIF8') ? 'image/gif' : magic[0] === 137 ? 'image/png' : magic[0] === 255 ? 'image/jpeg' : 'image/webp';
  return blob.type === type ? blob : new Blob([blob], { type });
}
export async function identifyVisionBlob(blob: Blob, semantics: VisionSemantics) {
  return `vision-cache:${semantics}:${await hashBlob(blob)}`;
}
export async function saveVisionAsset(value: VisionAssetDescription, ref: string, epoch: string, signal?: AbortSignal) {
  const alias = await visionRefAlias(ref, value.semantics);
  const db = await openDB();
  return new Promise<VisionAssetDescription>((resolve, reject) => {
    const tx = db.transaction(['assets', 'emojis'], 'readwrite'), store = tx.objectStore('assets'), gate = store.get(VISION_CACHE_EPOCH); let saved: VisionAssetDescription = { ...value, revision: value.revision || crypto.randomUUID() }, failure: unknown;
    const abort = () => { failure = new DOMException('操作已取消', 'AbortError'); try { tx.abort(); } catch { /* Already complete. */ } };
    signal?.addEventListener('abort', abort, { once: true });
    gate.onsuccess = () => {
      if (signal?.aborted || gate.result?.data !== epoch) { failure = new DOMException('存档或操作已变化，旧描述未保存', 'AbortError'); tx.abort(); return; }
      const get = store.get(value.key);
      get.onsuccess = () => {
        try { const old = get.result ? JSON.parse(get.result.data) as VisionAssetDescription : null;
          if (old && (old.description || old.origin === 'manual')) saved = old;
          store.put({ id: value.key, data: JSON.stringify(saved) }); if (alias) store.put({ id: alias, data: JSON.stringify({ key: value.key }) });
          if (alias && value.semantics === 'meme-v1') {
            const emojis = tx.objectStore('emojis'), all = emojis.getAll();
            all.onsuccess = () => { try { for (const emoji of all.result) if (emoji.url === ref || emoji.vision?.key === saved.key) emojis.put({ ...emoji, vision: saved, visionError: undefined }); } catch (error) { failure = error; tx.abort(); } };
          }
        } catch (error) { failure = error; tx.abort(); }
      };
    };
    tx.oncomplete = () => { signal?.removeEventListener('abort', abort); resolve(saved); }; tx.onerror = tx.onabort = () => { signal?.removeEventListener('abort', abort); reject(failure || tx.error || Error('素材描述保存失败')); };
  });
}

/** Read at send time; eligibility is still frozen by the original sending entry point. */
export async function snapshotCachedEmoji<T extends { type: string; content: string; metadata?: Record<string, any> }>(message: T): Promise<T> {
  if (message.type !== 'emoji' || !message.metadata?.stickerVision?.eligible || message.metadata.stickerVision.description || message.metadata?.visionPreflightState?.sticker?.manualBlank) return message;
  try {
    const asset = await findStableVisionAsset(message.content, 'meme-v1');
    if (!asset || !asset.description && asset.origin !== 'manual') return message;
    return { ...message, metadata: { ...message.metadata, visionPreflightState: { ...message.metadata.visionPreflightState, sticker: { revision: asset.revision, manualBlank: asset.origin === 'manual' && !asset.description, assetKey: asset.key } }, stickerVision: { ...message.metadata.stickerVision, description: asset.description, assetKey: asset.key, recognizedAt: asset.updatedAt, model: asset.model } } };
  } catch { return message; }
}
export async function reuseCachedVisionMessages(messages: import('../types').Message[]) {
  const prepared = [];
  for (const message of messages) {
    let next = await snapshotCachedEmoji(message);
    if (message.type === 'image' && !message.metadata?.visionDescription && !message.metadata?.visionPreflightState?.image?.manualBlank) {
      try { const asset = await findStableVisionAsset(message.content, 'photo-v1');
        if (asset && (asset.description || asset.origin === 'manual')) next = { ...message, metadata: { ...message.metadata, visionDescription: asset.description, visionPreflightState: { ...message.metadata?.visionPreflightState, image: { revision: asset.revision, manualBlank: asset.origin === 'manual' && !asset.description, assetKey: asset.key } } } };
      } catch { /* Old unavailable media remains readable as a placeholder. */ }
    }
    prepared.push(next);
  }
  return prepared;
}

/** Seed only immutable local resources, never crawl private chat or download on a render. */
export async function seedKnownLocalVision(ref: string, semantics: VisionSemantics, description: string, source?: Pick<VisionAssetDescription, 'origin' | 'model' | 'gif'>) {
  if (!stable(ref) || !description) return;
  try { const blob = await readVisionBlob(ref), key = await identifyVisionBlob(blob, semantics), epoch = await visionCacheEpoch();
    await saveVisionAsset({ key, semantics, description, origin: source?.origin || 'message', model: source?.model, gif: source?.gif, updatedAt: Date.now() }, ref, epoch);
  } catch { /* A historical description remains usable even when the original media is gone. */ }
}
