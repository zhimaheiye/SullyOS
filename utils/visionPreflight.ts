import type { Emoji, Message, VisionApiConfig } from '../types';
import { DB, openDB } from './db';
import { isBlobRef, putImageBlob } from './blobRef';
import { describeImageWithVisionApi, STICKER_VISION_PROMPT } from './visionApi';
import { withExplicitVisionPermit } from './explicitVisionAction';
import { findStableVisionAsset, identifyVisionBlob, readVisionAsset, readVisionBlob, saveVisionAsset, visionCacheEpoch, visionAssetVersion, visionRefAlias, VISION_DESCRIPTION_LIMIT, VISION_CACHE_EPOCH, type VisionAssetDescription, type VisionSemantics } from './visionAssetCache';
import { visionFrameUrls } from './visionFrames';

export interface VisionPreflightItem { id: string; label: string; ref: string; semantics: VisionSemantics; description: string; eligible: boolean; manualBlank?: boolean; assetSnapshot?: { key: string | null; version: string | null }; message?: Message; path: string; emoji?: Emoji }
/** Replacement stays transient until the asset AND selected source pass one transaction. */
export interface PreflightDescription extends VisionAssetDescription { replacement?: { assetVersion: string | null; localRef?: string } }
const refUsable = (ref: unknown): ref is string => typeof ref === 'string' && /^(?:data:image\/|blobref:|https?:\/\/|\/)/i.test(ref);
// URL locators cannot freeze a content version during a metadata-only scan.
const snapshotApplies = (item: VisionPreflightItem, key: string) => !!item.assetSnapshot && (item.assetSnapshot.key === key || !item.assetSnapshot.key && (isBlobRef(item.ref) || item.ref.startsWith('data:image/')));
export function collectVisionItems(messages: Message[]): VisionPreflightItem[] {
  const result: VisionPreflightItem[] = [];
  for (const message of messages) {
    const add = (path: string, ref: string, semantics: VisionSemantics, description = '', eligible = true) => result.push({ id: `${message.id}:${path}`, path, ref, semantics, description, eligible, manualBlank: message.metadata?.visionPreflightState?.[path]?.manualBlank === true, message: structuredClone(message), label: `${message.role === 'user' ? '用户' : '角色'} · ${new Date(message.timestamp).toLocaleString()} · ${semantics === 'meme-v1' ? '表情' : '图片'}` });
    if (message.type === 'image') add('image', message.content, 'photo-v1', message.metadata?.visionDescription || '');
    if (message.type === 'emoji') add('sticker', message.content, 'meme-v1', message.metadata?.stickerVision?.description || '', message.metadata?.stickerVision?.eligible === true);
    const share = message.metadata?.friendFeedShare;
    if (message.type === 'friend_feed_share_card' && share?.imagesEnabled && !message.metadata?.visionDescription)
      (share.imageRefs || []).slice(0, 18).forEach((ref: string, index: number) => add(`share:${index}`, ref, 'photo-v1', message.metadata?.visionAttachments?.[`share:${index}`] || ''));
    if (message.type === 'chat_forward') {
      try { const forward = JSON.parse(message.content); (forward.messages || []).forEach((row: any, index: number) => {
        if (row.type === 'emoji' && (row.stickerVision?.eligible || row.stickerVision?.description)) add(`forward:${index}`, row.content, 'meme-v1', message.metadata?.visionAttachments?.[`forward:${index}`] ?? row.stickerVision?.description ?? '');
      }); } catch { /* A malformed forward has no safe image reference. */ }
    }
  }
  return result;
}
export const emojiVisionItems = (emojis: Emoji[]): VisionPreflightItem[] => emojis.map(emoji => ({ id: `emoji:${emoji.name}`, path: 'emoji', ref: emoji.url, semantics: 'meme-v1', description: emoji.vision?.description || '', manualBlank: emoji.vision?.origin === 'manual' && !emoji.vision.description, eligible: true, label: emoji.name, emoji: structuredClone(emoji) }));
export const isPreflightRefUsable = refUsable;
const localLocks = new Map<string, Promise<void>>();
async function assetLock<T>(key: string, signal: AbortSignal, run: () => Promise<T>): Promise<T> {
  if (typeof navigator !== 'undefined' && navigator.locks) return navigator.locks.request(`sully-vision:${key}`, { signal }, run);
  const previous = localLocks.get(key) || Promise.resolve(); let release!: () => void;
  const wait = new Promise<void>(resolve => { release = resolve; }); localLocks.set(key, wait);
  await previous;
  try { signal.throwIfAborted(); return await run(); } finally { release(); if (localLocks.get(key) === wait) localLocks.delete(key); }
}
/** Explicit items only; this does not generate dialogue, modify drafts or acknowledge messages. */
export async function describePreflightItem(item: VisionPreflightItem, config: VisionApiConfig | undefined, signal: AbortSignal, epoch: string, failedAssets?: Set<string>, options?: { regenerate?: boolean }): Promise<PreflightDescription> {
  if (!refUsable(item.ref)) throw Error('没有可读取的原图');
  signal.throwIfAborted();
  let asset = await findStableVisionAsset(item.ref, item.semantics);
  const initial = item.assetSnapshot || { key: asset?.key || null, version: visionAssetVersion(asset) };
  if (!options?.regenerate && asset && (asset.description || asset.origin === 'manual')) return asset;
  const blob = await readVisionBlob(item.ref, signal), key = await identifyVisionBlob(blob, item.semantics);
  return assetLock(key, signal, async () => {
    signal.throwIfAborted();
    asset = await readVisionAsset(key);
    if (!options?.regenerate && asset && (asset.description || asset.origin === 'manual')) return saveVisionAsset(asset, item.ref, epoch, signal);
    if (!options?.regenerate && (item.description || item.manualBlank)) return saveVisionAsset({ key, semantics: item.semantics, description: item.description, origin: item.manualBlank ? 'manual' : 'message', updatedAt: Date.now() }, item.ref, epoch, signal);
    const expectedVersion = snapshotApplies({ ...item, assetSnapshot: initial }, key) ? initial.version : visionAssetVersion(asset);
    if (options?.regenerate && expectedVersion !== visionAssetVersion(asset)) throw Error('描述已在另一操作中更新，请重新扫描后再试');
    if (failedAssets?.has(key)) throw Error('同一素材本批识图已失败，请仅重试所选失败项');
    if (!config?.baseUrl?.trim() || !config.apiKey?.trim() || !config.model?.trim()) throw Error('请先配置独立识图API的URL、Key和模型');
    const frames = await visionFrameUrls(blob); signal.throwIfAborted();
    const vision = { ...config, enabled: true }, url = `${config.baseUrl.trim().replace(/\/+$/, '')}/chat/completions`;
    failedAssets?.add(key);
    const description = await withExplicitVisionPermit(signal, url, config.model.trim(), permit => describeImageWithVisionApi(item.ref, vision, { signal, explicitPermit: permit, frameUrls: frames.urls, gif: frames.gif, retries: 0, privateTransient: true, prompt: item.semantics === 'meme-v1' ? STICKER_VISION_PROMPT : undefined }));
    signal.throwIfAborted();
    const candidate = { key, semantics: item.semantics, description, origin: 'model' as const, updatedAt: Date.now(), model: config.model.trim(), gif: frames.gif, revision: crypto.randomUUID() };
    const saved = options?.regenerate ? { ...candidate, replacement: { assetVersion: expectedVersion } } : await saveVisionAsset(candidate, item.ref, epoch, signal);
    failedAssets?.delete(key); return saved;
  });
}
function sourceVersion(item: VisionPreflightItem, row: any): string {
  if (item.emoji) return visionAssetVersion(row.vision || null) || '';
  const current = collectVisionItems([row]).find(value => value.path === item.path);
  return JSON.stringify([current?.description, row.metadata?.visionPreflightState?.[item.path] || null]);
}
export async function commitPreflightItem(item: VisionPreflightItem, asset: PreflightDescription, epoch: string, signal: AbortSignal) {
  signal.throwIfAborted();
  // Import remote library bytes into immutable local storage once; animated original is untouched.
  const localRef = asset.replacement?.localRef || (item.emoji && asset.origin !== 'manual' && refUsable(item.ref) && !isBlobRef(item.ref) && !item.ref.startsWith('data:') ? await putImageBlob(await readVisionBlob(item.ref, signal)) : item.ref);
  if (localRef !== item.ref) {
    const blob = await readVisionBlob(localRef, signal);
    if (await identifyVisionBlob(blob, item.semantics) !== asset.key) throw Error('远程素材内容已变化，请重新扫描');
  }
  const alias = asset.key ? await visionRefAlias(localRef, item.semantics) : null;
  const db = await openDB();
  return new Promise<{ ref: string; description: string; item: VisionPreflightItem }>((resolve, reject) => {
    const tx = db.transaction(['assets', 'messages', 'emojis'], 'readwrite'), assets = tx.objectStore('assets'), gate = assets.get(VISION_CACHE_EPOCH); let failure: unknown, committedDescription = asset.description, committedItem = item;
    const fail = (message: string) => { failure = Error(message); tx.abort(); };
    const abort = () => { failure = new DOMException('操作已取消', 'AbortError'); try { tx.abort(); } catch { /* Already complete. */ } };
    signal.addEventListener('abort', abort, { once: true });
    gate.onsuccess = () => {
      if (signal.aborted || gate.result?.data !== epoch) { failure = new DOMException('操作或存档已变化', 'AbortError'); tx.abort(); return; }
      const cached = asset.key ? assets.get(asset.key) : null;
      const commit = () => {
      let old: VisionAssetDescription | null = null;
      try { old = cached?.result ? JSON.parse(cached.result.data) : null; } catch { /* Invalid old cache cannot become authority. */ }
      if (asset.replacement && visionAssetVersion(old) !== asset.replacement.assetVersion) { fail('描述已在另一操作中更新，请重新扫描后再试'); return; }
      const { replacement, ...candidate } = asset;
      const saved = replacement ? candidate : old && (old.description || old.origin === 'manual') ? old : candidate;
      const store = tx.objectStore(item.emoji ? 'emojis' : 'messages'), read = store.get(item.emoji ? item.emoji.name : item.message!.id);
      read.onsuccess = () => {
        try {
        const row = read.result;
        if (!row) { fail('源记录已删除，请重新扫描'); return; }
        if (replacement && sourceVersion(item, row) !== sourceVersion(item, item.emoji || item.message)) { fail('描述已在另一操作中更新，请重新扫描后再试'); return; }
        const persistAsset = () => {
          if (!saved.key) return; // A text-only backup may retain a description without recoverable bytes/identity.
          assets.put({ id: saved.key, data: JSON.stringify(saved) });
          if (alias) assets.put({ id: alias, data: JSON.stringify({ key: saved.key }) });
          if (saved.semantics === 'meme-v1') {
            const emojis = tx.objectStore('emojis'), all = emojis.getAll();
            all.onsuccess = () => { try { for (const emoji of all.result) if (emoji.vision?.key === saved.key || alias && emoji.url === localRef) emojis.put({ ...emoji, vision: saved, visionError: undefined }); } catch (error) { failure = error; tx.abort(); } };
          }
        };
        if (item.emoji) {
          if (row.url !== item.ref) { fail('素材已替换，请重新扫描'); return; }
          const vision = !replacement && row.vision?.origin === 'manual' ? row.vision : saved;
          committedDescription = vision.description;
          const next = { ...row, url: localRef, vision, visionError: undefined };
          store.put(next); persistAsset(); committedItem = { ...emojiVisionItems([next])[0], assetSnapshot: {key:saved.key || null,version:visionAssetVersion(saved.key ? saved : null)} }; return;
        }
        if (row.charId !== item.message!.charId || row.groupId !== item.message!.groupId || row.type !== item.message!.type || row.content !== item.message!.content
          || JSON.stringify(row.metadata?.friendFeedShare) !== JSON.stringify(item.message!.metadata?.friendFeedShare)) { fail('消息原图或归属已变化，请重新扫描'); return; }
        const metadata = { ...row.metadata };
        const existing = collectVisionItems([row]).find(value => value.path === item.path);
        const write = replacement || !existing?.description && !existing?.manualBlank;
        if (write) {
          const state = { revision: saved.revision || crypto.randomUUID(), manualBlank: saved.origin === 'manual' && !saved.description, assetKey: saved.key || undefined };
          metadata.visionPreflightState = { ...metadata.visionPreflightState, [item.path]: state };
          if (item.path === 'image') { metadata.visionDescription = saved.description; metadata.visionRecognizedAt = saved.updatedAt; metadata.visionModel = saved.model; }
          else if (item.path === 'sticker') metadata.stickerVision = { ...metadata.stickerVision, ...(!replacement ? { eligible: true, explicitlyDescribed: true } : {}), description: saved.description, recognizedAt: saved.updatedAt, model: saved.model, assetKey: saved.key || undefined };
          else metadata.visionAttachments = { ...metadata.visionAttachments, [item.path]: saved.description };
        }
        committedDescription = write ? saved.description : existing?.description || '';
        metadata.visionPreflightErrors = { ...metadata.visionPreflightErrors }; delete metadata.visionPreflightErrors[item.path];
        const next = { ...row, metadata }; store.put(next); persistAsset();
        committedItem = { ...collectVisionItems([next]).find(value => value.path === item.path)!, assetSnapshot: {key:saved.key || null,version:visionAssetVersion(saved.key ? saved : null)} };
        } catch (error) { failure = error; tx.abort(); }
      };
      };
      if (cached) cached.onsuccess = commit; else commit();
    };
    tx.oncomplete = () => { signal.removeEventListener('abort', abort); resolve({ ref: localRef, description: committedDescription, item: committedItem }); }; tx.onerror = tx.onabort = () => { signal.removeEventListener('abort', abort); reject(failure || tx.error || Error('描述未能保存')); };
  });
}
export async function seedVisionDescriptions(items: VisionPreflightItem[], signal: AbortSignal, epoch: string) {
  for (const item of items.filter(i => i.description)) {
    signal.throwIfAborted();
    try { await describePreflightItem(item, undefined, signal, epoch); } catch (error) { if (signal.aborted) throw error; /* Missing historical originals keep their existing text. */ }
  }
}
export async function editPreflightVision(item: VisionPreflightItem, description: string, signal: AbortSignal) {
  if (description.length > VISION_DESCRIPTION_LIMIT) throw Error('描述最多4000字，请缩短后保存；原描述未改动');
  if (description === item.description) return null;
  signal.throwIfAborted();
  const epoch = await visionCacheEpoch();
  let asset = await findStableVisionAsset(item.ref, item.semantics);
  let key = asset?.key || item.emoji?.vision?.key || item.message?.metadata?.visionPreflightState?.[item.path]?.assetKey || (item.path === 'sticker' ? item.message?.metadata?.stickerVision?.assetKey : '') || '';
  let localRef: string | undefined;
  if ((!key || item.emoji && !isBlobRef(item.ref) && !item.ref.startsWith('data:')) && refUsable(item.ref)) {
    try { const blob = await readVisionBlob(item.ref, signal); key = await identifyVisionBlob(blob, item.semantics); if (item.emoji && !isBlobRef(item.ref) && !item.ref.startsWith('data:')) localRef = await putImageBlob(blob); }
    catch (error) { if (signal.aborted) throw error; /* Text remains editable with no original. */ }
  }
  if (!new RegExp(`^vision-cache:${item.semantics}:[a-f0-9]{64}$`).test(key)) key = '';
  asset = key ? await readVisionAsset(key) : null;
  const expected = snapshotApplies(item, key) ? item.assetSnapshot!.version : visionAssetVersion(asset);
  return commitPreflightItem(item, { key, semantics: item.semantics, description: description.trim() ? description : '', origin: 'manual', updatedAt: Date.now(), revision: crypto.randomUUID(), replacement: { assetVersion: expected, localRef } }, epoch, signal);
}
export const editEmojiVision = editPreflightVision;

export function visionPreflightError(error: unknown) {
  if (error instanceof Error && error.name === 'AbortError') return '已取消，已保存项保留';
  const text = error instanceof Error ? error.message : '';
  if (['描述已在另一操作中更新，请重新扫描后再试', '描述最多4000字，请缩短后保存；原描述未改动', '识图未返回有效最终描述；原描述未改动', '识图响应不完整；原描述未改动', '识图描述超过4000字；原描述未改动'].includes(text)) return text;
  const known = ['没有可读取的原图', '原图已不可用', '素材下载失败，可能已失效或受跨域限制', '素材超过12MB', 'GIF超过12MB，请选择较小素材', 'GIF尺寸或帧数过大，未调用识图', 'GIF没有可识别画面', '当前浏览器无法抽取GIF代表帧', '只支持可解码的PNG、JPEG、WebP与GIF原图', '请先配置独立识图API的URL、Key和模型', '源记录已删除，请重新扫描', '素材已替换，请重新扫描', '消息原图或归属已变化，请重新扫描', '消息原图或归属已变化，请重新打开消息菜单', '这条消息已不再是可补全的图片', '远程素材内容已变化，请重新扫描', '描述未能保存', '图片解码失败，未调用识图', '图片尺寸过大，未调用识图', '同一素材本批识图已失败，请仅重试所选失败项'];
  if (known.includes(text)) return text;
  const status = /(?:HTTP|API Error)\s*(401|403|413|429|500|502|503|504)/i.exec(text)?.[1];
  return status ? `识图请求失败（HTTP ${status}），请检查配置、额度或服务后重试` : '识图或保存失败，请检查原图、模型多图能力与当前配置后重试';
}

export async function markPreflightFailure(item: VisionPreflightItem, epoch: string, error: string) {
  const db = await openDB();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(['assets', 'messages', 'emojis'], 'readwrite'), gate = tx.objectStore('assets').get(VISION_CACHE_EPOCH);
    gate.onsuccess = () => {
      if (gate.result?.data !== epoch) { tx.abort(); return; }
      const store = tx.objectStore(item.emoji ? 'emojis' : 'messages'), get = store.get(item.emoji ? item.emoji.name : item.message!.id);
      get.onsuccess = () => {
        const current = get.result;
        if (!current || (item.emoji ? current.url !== item.ref : current.content !== item.message!.content || current.charId !== item.message!.charId || current.groupId !== item.message!.groupId || current.type !== item.message!.type)
          || sourceVersion(item, current) !== sourceVersion(item, item.emoji || item.message)) return;
        store.put(item.emoji ? { ...current, visionError: error } : { ...current, metadata: { ...current.metadata, visionPreflightErrors: { ...current.metadata?.visionPreflightErrors, [item.path]: error } } });
      };
    };
    tx.oncomplete = () => resolve(); tx.onerror = tx.onabort = () => reject(tx.error || Error('失败状态未保存'));
  });
}
