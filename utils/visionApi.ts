import { findStableVisionAsset, reuseCachedVisionMessages, seedKnownLocalVision, VISION_DESCRIPTION_LIMIT } from './visionAssetCache';
import type { ExplicitVisionPermit } from './explicitVisionAction';
import { isManualRelayEnabled } from './manualModelRelay';
import type { ApiPreset, Message, VisionApiConfig } from '../types';
import { DB } from './db';
import { safeFetchJson } from './safeApi';
import { normalizeApiBaseUrl, normalizeApiCredential, normalizeApiModel } from './apiConfigNormalize';
import { isBlobRef, resolveRefToDataUrl } from './blobRef';
import { readStickerVision, readStickerVisionDescription } from './stickerVision';

export const VISION_DESCRIPTION_METADATA_KEY = 'visionDescription';

/** 设置页测试识图能力时发送的 48×48 白底紫色圆点 PNG。 */
export const VISION_API_TEST_IMAGE_DATA_URL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAYAAABXAvmHAAAAAXNSR0IArs4c6QAAAARnQU1BAACxjwv8YQUAAAAJcEhZcwAADsMAAA7DAcdvqGQAAADKSURBVGhD7Y+5DQMxDASvLtfmll2DDQYHHDYwfxGCdoBJFGg513dzLnzYDQZMw4BpGDANA568Xx+zVZQE4HEes6QC8JiMUcIBeECFEUIBOFypF3cADnbowRWAQ51aOScAB1Zo4YwA/HilGgzoVoMB3WqoAfjhajXUAAE/XakGA7rVYEC3GqYAAT9eoYVzAgQc6NTKWQECDnXowR0g4GClXkIBAg5XGCEcIOABGaOkAm7wGI9ZSgJu8Lh/VlEaMAEDpmHANAyYZvuAH2hIrK7auxVfAAAAAElFTkSuQmCC';

const VISION_PROMPT = `请准确、具体地描述图片中实际可见的内容，供另一个无法看图的对话模型理解。
请覆盖主体、动作、场景、重要物品、画面中的文字或界面信息；不要猜测画面外的信息，不要寒暄，只输出描述正文。`;

/**
 * 这个值还能拿去识图吗。三种形态都算数：内嵌的 data URL、网络地址，以及本机存的
 * 图片令牌（`blobref:`，二进制在 blob_assets 里，见 utils/blobRef.ts）——令牌发出去
 * 之前会由网络出口统一还原成 data URL（utils/apiBlobRefs.ts），这里只负责别把它
 * 误判成「图没了」。
 *
 * 判漏的后果是静默的：图明明在，识图这步却直接跳过或报「图片数据不可用」，
 * 界面上一点征兆都没有。
 */
const canDescribeImage = (value: unknown): value is string =>
  typeof value === 'string' && (/^(data:image\/|https?:\/\/)/i.test(value) || isBlobRef(value));

export { canDescribeImage };

const inFlightDescriptions = new Map<string, Promise<string>>();

/** 把一份通用模型预设填入独立识图配置，不改变主 API 当前选择。 */
export const visionApiConfigFromPreset = (preset: ApiPreset, enabled = true): VisionApiConfig => ({
  enabled,
  baseUrl: normalizeApiBaseUrl(preset.config.baseUrl),
  apiKey: normalizeApiCredential(preset.config.apiKey),
  model: normalizeApiModel(preset.config.model),
});

export const isVisionApiReady = (config?: VisionApiConfig | null): config is VisionApiConfig =>
  config?.enabled === true
  && !!config.baseUrl?.trim()
  && !!config.apiKey?.trim()
  && !!config.model?.trim();

export const readVisionDescription = (message: Message): string => {
  const value = message.metadata?.[VISION_DESCRIPTION_METADATA_KEY];
  return typeof value === 'string' ? value.trim() : '';
};

/** Vision has no reasoning fallback. An incomplete answer cannot replace a good cache. */
export function extractVisionDescription(data: any): string {
  const choice = data?.choices?.[0], candidate = data?.candidates?.[0];
  const finish = choice?.finish_reason ?? data?.stop_reason ?? candidate?.finishReason;
  if (['length', 'max_tokens', 'MAX_TOKENS', 'content_filter', 'SAFETY', 'RECITATION', 'tool_calls', 'function_call', 'ERROR'].includes(finish)
    || ['incomplete','failed','cancelled'].includes(data?.status) || data?.incomplete_details || data?.truncated === true
    || data?.object === 'chat.completion.chunk' || data?.__sullySseComplete === false) throw Error('识图响应不完整；原描述未改动');
  const finalText = (value: any): string => typeof value === 'string' ? value : Array.isArray(value)
    ? value.filter(block => block && (block.type === 'text' || block.type === 'output_text') && typeof block.text === 'string').map(block => block.text).join('\n') : '';
  // Only documented final-text fields; independent reasoning/thinking blocks never enter this string.
  let text = choice ? finalText(choice.message?.content) : finalText(data?.content);
  if (!choice && !text && Array.isArray(candidate?.content?.parts)) text = candidate.content.parts.filter((part: any) => part.thought !== true && typeof part.text === 'string').map((part: any) => part.text).join('\n');
  if (!choice && !text && Array.isArray(data?.output)) text = data.output.filter((part: any) => part.type === 'message' && part.role === 'assistant').map((part: any) => finalText(part.content)).join('\n');
  const tag = /<\/?(think|thinking|thought)\b[^>]*>/gi, stack: string[] = []; let end = 0, visible = '', match: RegExpExecArray | null;
  while ((match = tag.exec(text))) {
    if (!stack.length) visible += text.slice(end, match.index);
    if (match[0].startsWith('</')) { if (stack.pop() !== match[1].toLowerCase()) throw Error('识图响应不完整；原描述未改动'); }
    else stack.push(match[1].toLowerCase());
    end = tag.lastIndex;
  }
  if (stack.length) throw Error('识图响应不完整；原描述未改动');
  text = (visible + text.slice(end)).trim();
  if (/^\[图片\s*[：:][\s\S]*\]$/.test(text)) text = text.replace(/^\[图片\s*[：:]\s*/, '').slice(0, -1).trim();
  if (!text) throw Error('识图未返回有效最终描述；原描述未改动');
  if (text.length > VISION_DESCRIPTION_LIMIT) throw Error('识图描述超过4000字；原描述未改动');
  return text;
}

/** 调用 OpenAI 兼容视觉端点，把一张图片变成可交给纯文本模型的描述。
 *  options.prompt 允许调用方换用专用提示词（如表情包识图）；默认仍是普通图片提示词，
 *  对现有 image 调用方零行为变化。in-flight 去重键包含 prompt，避免同图不同提示词串结果。 */
export async function describeImageWithVisionApi(
  imageUrl: string,
  config: VisionApiConfig,
  options?: { prompt?: string; signal?: AbortSignal; retries?: number; privateTransient?: boolean; explicitPermit?: ExplicitVisionPermit; frameUrls?: string[]; gif?: boolean },
): Promise<string> {
  if (!isVisionApiReady(config)) {
    throw new Error('识图 API 已开启，但 URL、Key 或 Model 尚未填写完整');
  }
  if (!options?.frameUrls?.length && !canDescribeImage(imageUrl)) {
    throw new Error('图片数据不可用，无法调用识图 API');
  }

  const prompt = options?.prompt?.trim() || VISION_PROMPT;
  const dedupKey = `${prompt}\u0000${imageUrl}`;
  const existing = inFlightDescriptions.get(dedupKey);
  if (existing && !options?.signal) return existing;

  const request = (async () => {
    options?.signal?.throwIfAborted();
    // Private transient requests deliberately bypass the general request-body resolver.
    // Resolve this one selected image explicitly without enabling persistent body captures.
    const outgoingImage = options?.frameUrls?.[0] || (isBlobRef(imageUrl) ? await resolveRefToDataUrl(imageUrl) : imageUrl);
    options?.signal?.throwIfAborted();
    if (!outgoingImage || isBlobRef(outgoingImage)) throw new Error('本机参考图已不可用，请重新选择图片');
    const baseUrl = config.baseUrl.trim().replace(/\/+$/, '');
    let data: any;
    try { data = await safeFetchJson(`${baseUrl}/chat/completions`, {
      method: 'POST',
      signal: options?.signal,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey.trim()}`,
      },
      body: JSON.stringify({
        model: config.model.trim(),
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: prompt + (options?.gif ? '\n以下是同一GIF按时间顺序选取的少量代表帧。综合描述可见动作、文字变化与语气；未覆盖全部帧，不猜遗漏的细节。' : '') },
            ...(options?.frameUrls || [outgoingImage]).map(url => ({ type: 'image_url', image_url: { url } })),
          ],
        }],
        temperature: 0,
        max_tokens: 1200,
        stream: false,
      }),
    }, options?.retries ?? 1, 60_000, { appName: '消息', purpose: options?.explicitPermit ? '手动补全图片描述' : options?.privateTransient ? '外貌标签' : '识图' }, undefined,
    { privateTransient: true, explicitVision: options?.explicitPermit });
    } catch (error) {
      if (options?.signal?.aborted || error instanceof Error && error.name === 'AbortError') throw error;
      const status = /(?:HTTP|API Error)\s*(\d{3})/i.exec(error instanceof Error ? error.message : '')?.[1];
      throw Error(status ? `识图请求失败（HTTP ${status}），原描述未改动` : '识图请求失败，请检查独立配置或服务；原描述未改动');
    }

    return extractVisionDescription(data);
  })();

  if (!options?.signal) inFlightDescriptions.set(dedupKey, request);
  try {
    return await request;
  } finally {
    if (inFlightDescriptions.get(dedupKey) === request) inFlightDescriptions.delete(dedupKey);
  }
}

/**
 * 为聊天历史里的图片补齐识图描述。
 *
 * 描述写回消息 metadata，因此同一条图片消息后续聊天、重 roll、主动消息都只识别一次；
 * 同一批里内容完全相同的图片也会复用第一次结果。
 */
export async function materializeVisionDescriptions(
  messages: Message[],
  config?: VisionApiConfig | null,
): Promise<Message[]> {
  messages = await reuseCachedVisionMessages(messages);
  if (isManualRelayEnabled() || config?.enabled !== true) return messages;
  if (!isVisionApiReady(config)) {
    throw new Error('识图 API 已开启，但 URL、Key 或 Model 尚未填写完整');
  }

  const descriptionByImage = new Map<string, string>();
  const prepared: Message[] = [];

  for (const message of messages) {
    if(message.type==='friend_feed_share_card') {
      const share=message.metadata?.friendFeedShare;
      if(!share?.imagesEnabled || !Array.isArray(share.imageRefs) || readVisionDescription(message)) {prepared.push(message);continue;}
      const refs=share.imageRefs.filter((r:unknown)=>typeof r==='string'&&(isBlobRef(r)||r.startsWith('data:image/'))).slice(0,18);
      const descriptions:string[]=[];
      for(const [index,ref] of refs.entries()){
        const description=descriptionByImage.get(ref)||await describeImageWithVisionApi(ref,config);
        descriptionByImage.set(ref,description);descriptions.push(`配图 ${index+1}：${description}`);
      }
      if(!descriptions.length){prepared.push(message);continue;}
      const metadata={...message.metadata,visionDescription:descriptions.join('\n'),visionRecognizedAt:Date.now(),visionModel:config.model.trim()};
      await DB.updateMessageMetadata(message.id,prev=>({...prev,...metadata}));prepared.push({...message,metadata});continue;
    }
    if (message.type !== 'image') {
      prepared.push(message);
      continue;
    }

    const cached = readVisionDescription(message);
    if (cached || message.metadata?.visionPreflightState?.image?.manualBlank) {
      descriptionByImage.set(message.content, cached); await seedKnownLocalVision(message.content, 'photo-v1', cached);
      prepared.push(message);
      continue;
    }

    const imageUrl = typeof message.content === 'string' ? message.content : '';
    // 纯文字备份会保留 image 消息但移除原图数据；这种历史沿用“图片已不可用”占位，
    // 不能因为新开了识图 API 就让整轮聊天失败。
    if (!canDescribeImage(imageUrl)) {
      prepared.push(message);
      continue;
    }
    let description = descriptionByImage.get(imageUrl)
      || await describeImageWithVisionApi(imageUrl, config);
    descriptionByImage.set(imageUrl, description); await seedKnownLocalVision(imageUrl, 'photo-v1', description);
    const latest = await findStableVisionAsset(imageUrl, 'photo-v1');
    if (latest) description = latest.description;

    let metadata = {
      ...(message.metadata || {}),
      [VISION_DESCRIPTION_METADATA_KEY]: description,
      visionRecognizedAt: Date.now(),
      visionModel: config.model.trim(),
      ...(latest ? { visionPreflightState: { ...message.metadata?.visionPreflightState, image: { revision: latest.revision, manualBlank: latest.origin === 'manual' && !latest.description, assetKey: latest.key } } } : {}),
    };
    // 先写回 DB 再调用主模型：下一轮与刷新页面后都会直接命中，不重复扣识图额度。
    await DB.updateMessageMetadata(message.id, prev => {
      if (prev?.visionDescription || prev?.visionPreflightState?.image?.manualBlank
        || prev?.visionPreflightState?.image?.revision !== message.metadata?.visionPreflightState?.image?.revision) { metadata = prev as typeof metadata; return prev; }
      metadata = { ...prev, visionDescription: metadata.visionDescription, visionRecognizedAt: metadata.visionRecognizedAt, visionModel: metadata.visionModel, ...(latest ? { visionPreflightState: { ...prev?.visionPreflightState, image: metadata.visionPreflightState.image } } : {}) };
      return metadata;
    });
    prepared.push({ ...message, metadata });
  }

  return prepared;
}

/** 表情包专用识图提示词。与普通图片不同：重视聊天语义、图内文字与 meme 含义；
 *  刻意不给视觉模型表情包名称，避免它被名称诱导「看图说名称」。名称由客户端另拼。 */
export const STICKER_VISION_PROMPT = `这是一张聊天中使用的表情包 / meme 图片。
请准确描述图片实际可见的内容，并帮助另一个无法看图的聊天模型理解它在对话中的表达效果。

重点关注：
1. 图片中的人物、动物、物体、动作和表情；
2. 图片上的文字；
3. 夸张、荒诞、反差、抽象等视觉元素；
4. 这张图通常可能表达的语气、情绪或 meme 式含义。

不要根据文件名或表情包名称猜测画面；
不要编造画面外的信息；
“可能表达”可以结合图像本身判断，但不要把不确定的网络梗来源说成事实；
输出简洁自然的描述，不要寒暄。`;

/**
 * 为聊天窗口内的 eligible 表情包补齐视觉描述。与普通图片的 materializeVisionDescriptions
 * 平行、互不干扰：
 *  - 只处理 type === 'emoji' 且 metadata.stickerVision.eligible === true 且尚无 description 的消息；
 *    旧表情（无资格）永远不会被它碰，无论当前开关如何。
 *  - 识别结果写回 metadata.stickerVision.description/recognizedAt/model，一次识别永久复用。
 *  - 同批次相同资源复用第一次结果；失败过的资源同批次不再重试。
 *  - 全程 fail-soft：识图配置不完整 / 网络失败 / 返回为空都只让该表情降级为名称模式，
 *    绝不 throw 让整轮聊天失败（这是与 materializeVisionDescriptions 最大的语义差异）。
 */
export async function materializeStickerVisionDescriptions(
  messages: Message[],
  config?: VisionApiConfig | null,
): Promise<Message[]> {
  messages = await reuseCachedVisionMessages(messages);
  if (isManualRelayEnabled() || config?.enabled !== true || !isVisionApiReady(config)) return messages;

  const descriptionByImage = new Map<string, string>();
  const failedImages = new Set<string>();
  const prepared: Message[] = [];

  for (const message of messages) {
    if (message.type !== 'emoji') {
      prepared.push(message);
      continue;
    }
    const vision = readStickerVision(message);
    if (readStickerVisionDescription(message)) await seedKnownLocalVision(message.content, 'meme-v1', readStickerVisionDescription(message)!);
    if (!vision || readStickerVisionDescription(message) || message.metadata?.visionPreflightState?.sticker?.manualBlank) {
      prepared.push(message);
      continue;
    }
    const imageUrl = typeof message.content === 'string' ? message.content : '';
    if (failedImages.has(imageUrl)) {
      prepared.push(message);
      continue;
    }
    const shared = descriptionByImage.get(imageUrl);
    if (shared) {
      prepared.push(await writeStickerVisionDescription(message, shared, config));
      continue;
    }
    // 纯文字备份会保留消息但移除原图数据；这种历史沿用名称模式，不能让它失败。
    if (!canDescribeImage(imageUrl)) {
      failedImages.add(imageUrl);
      prepared.push(message);
      continue;
    }
    try {
      const description = await describeImageWithVisionApi(imageUrl, config, { prompt: STICKER_VISION_PROMPT });
      descriptionByImage.set(imageUrl, description);
      prepared.push(await writeStickerVisionDescription(message, description, config));
    } catch (error) {
      console.warn('[stickerVision] 表情包识图失败，该表情本轮降级为名称模式');
      failedImages.add(imageUrl);
      prepared.push(message);
    }
  }

  return prepared;
}

/** 把识别到的描述合并进 metadata.stickerVision 并落库；DB 写回失败同样 fail-soft（只丢描述不丢消息）。 */
async function writeStickerVisionDescription(message: Message, description: string, config: VisionApiConfig): Promise<Message> {
  await seedKnownLocalVision(message.content, 'meme-v1', description);
  const latest = await findStableVisionAsset(message.content, 'meme-v1');
  if (latest) description = latest.description;
  let metadata: NonNullable<Message['metadata']> = {
    ...(message.metadata || {}),
    stickerVision: {
      ...(readStickerVision(message) || { eligible: true, name: '未知表情' }),
      description,
      recognizedAt: Date.now(),
      model: config.model.trim(),
    },
    ...(latest ? { visionPreflightState: { ...message.metadata?.visionPreflightState, sticker: { revision: latest.revision, manualBlank: latest.origin === 'manual' && !latest.description, assetKey: latest.key } } } : {}),
  };
  try {
    await DB.updateMessageMetadata(message.id, prev => {
      if (prev?.stickerVision?.description || prev?.visionPreflightState?.sticker?.manualBlank
        || prev?.visionPreflightState?.sticker?.revision !== message.metadata?.visionPreflightState?.sticker?.revision) { metadata = prev || {}; return prev; }
      metadata = { ...prev, stickerVision: { ...prev?.stickerVision, ...metadata.stickerVision }, ...(latest ? { visionPreflightState: { ...prev?.visionPreflightState, sticker: metadata.visionPreflightState.sticker } } : {}) };
      return metadata;
    });
  } catch (error) {
    console.warn('[stickerVision] 描述写回 metadata 失败，本轮仍按已识别内容渲染', error);
  }
  return { ...message, metadata };
}
