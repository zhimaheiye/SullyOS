import type {
    CharacterImageGenerationConfig,
    CharacterProfile,
    ImageGenerationApiConfig,
    UserProfile,
} from '../types';
import type { Message } from '../types';
import { DB } from './db';
import { dataUrlToBlob, putImageBlob } from './blobRef';
import { extractModelIds } from './modelList';
import { createImageGenerationError, readImageErrorResponse } from './imageGenerationError';
import { recordImageGenerationFailure, recordImageGenerationSuccess, type ImageGenerationLogContext } from './imageGenerationLog';

/**
 * 通用生图 API（OpenAI Images 兼容）：
 *   拉模型  GET  {base}/v1/models
 *   生图    POST {base}/v1/images/generations   body: {model, prompt, n:1, size?, response_format?}
 * 参考图上传与失败回退已停用。角色外观只通过文字锚点进入提示词。
 */
export const IMAGE_API_URL_PLACEHOLDER = 'https://api.example.com/v1';
export const IMAGE_GENERATION_OPEN = '[[GENERATE_IMAGE]]';
export const IMAGE_GENERATION_CLOSE = '[[/GENERATE_IMAGE]]';

/** 消息 metadata.imageProvider 的取值。gpt-image = 本文件的 OpenAI Images 兼容链路。 */
export type GeneratedImageProvider = 'gpt-image' | 'novelai' | 'legacy';

/** 跨域代理配置（可选）。与 MCP「代理 URL」同一套约定：留空直连，配置后走 <代理>?target=<url>。 */
export interface ImageApiProxyConfig {
    proxyUrl?: string;
    proxyKey?: string;
}

export interface ImageGenerationDirective {
    prompt: string;
    selfie: boolean;
    /** 提示词模式用的客观画面摘要。API 生图不要求。 */
    summary?: string;
    /** 画面中是否出现用户本人；主要供后续 NovelAI 2.0 注入用户形象锚点。 */
    includeUser?: boolean;
}

const DIRECTIVE_RE = /\[\[GENERATE_IMAGE\]\]\s*([\s\S]*?)\s*\[\[\/GENERATE_IMAGE\]\]/i;

/** 公开 OpenAI Images 约定：基址可以带或不带尾部 /v1。完整 generations 地址也剥到主机根，避免拼出 /v1/v1。 */
export function normalizeImageApiBase(value: string): string {
    let base = (value || '').trim().replace(/\/+$/, '');
    base = base.replace(/\/v1\/images\/(?:generations|edits)$/i, '');
    base = base.replace(/\/v1beta$/i, '').replace(/\/v1$/i, '');
    return base.replace(/\/+$/, '');
}

/** 实际请求地址：配了代理就包成 <proxy>?target=<url-encoded>（与 MCP / worker/mcp-proxy 同一约定），没配就直连。 */
export function buildImageApiProxyUrl(proxyUrl: string | undefined, targetUrl: string): string {
    const proxy = (proxyUrl || '').trim().replace(/\/+$/, '');
    if (!proxy) return targetUrl;
    const sep = proxy.includes('?') ? '&' : '?';
    return `${proxy}${sep}target=${encodeURIComponent(targetUrl)}`;
}

/**
 * 生图统一请求入口：直连或经跨域代理。请求失败（fetch 抛 TypeError）时按「直连 / 经代理」
 * 给出不同指向的提示；经代理时 502 视为「代理可达但目标接口失败」，与代理本身不可达区分。
 */
async function imageApiFetch(
    targetUrl: string,
    init: RequestInit | undefined,
    proxy: ImageApiProxyConfig,
    stage: string,
): Promise<Response> {
    const viaProxy = !!(proxy.proxyUrl || '').trim();
    const url = viaProxy ? buildImageApiProxyUrl(proxy.proxyUrl, targetUrl) : targetUrl;
    const headers = new Headers(init?.headers);
    const proxyKey = (proxy.proxyKey || '').trim();
    if (viaProxy && proxyKey) headers.set('X-Proxy-Key', proxyKey);
    let response: Response;
    try {
        response = await fetch(url, { ...init, headers });
    } catch (cause) {
        throw createImageGenerationError(
            viaProxy
                ? '浏览器无法连接代理。请检查代理 URL 是否可访问（本地代理需先启动 node scripts/mcp-proxy.mjs）、代理密钥是否正确。'
                : '浏览器无法直接访问该生图接口，可能是跨域限制（CORS）。如果生图服务运行在本地或未配置跨域响应头，请在「生图 API → 跨域代理（可选）」中填写代理 URL（本地可运行 node scripts/mcp-proxy.mjs）。',
            { stage, endpoint: targetUrl, cause },
        );
    }
    if (viaProxy && response.status === 502) {
        // 本地 mcp-proxy.mjs / worker/mcp-proxy 在目标不可达时统一回 502 "Proxy error"。
        throw createImageGenerationError('代理已连通，但代理访问目标接口失败（502）。请确认 API 地址正确、目标服务正在运行。', {
            stage, endpoint: targetUrl, status: 502,
        });
    }
    return response;
}

/** 生图配置里的代理段，供各请求点统一取用。 */
const proxyOf = (config: Pick<ImageGenerationApiConfig, 'proxyUrl' | 'proxyKey'>): ImageApiProxyConfig => ({
    proxyUrl: config.proxyUrl,
    proxyKey: config.proxyKey,
});

/** 模型下拉的本地过滤：大小写不敏感的包含匹配；空查询返回全部；不修改原数组。 */
export function filterImageModels(models: string[], query: string): string[] {
    const needle = (query || '').trim().toLowerCase();
    if (!needle) return models;
    return models.filter(model => model.toLowerCase().includes(needle));
}

/** FNV-1a；只用于判断绿灯是否仍对应当前配置，不是安全散列。 */
export function imageApiSignature(config: Pick<ImageGenerationApiConfig, 'baseUrl' | 'apiKey' | 'model' | 'proxyUrl' | 'proxyKey'>): string {
    const input = [
        normalizeImageApiBase(config.baseUrl),
        (config.model || '').trim(),
        config.apiKey,
        (config.proxyUrl || '').trim(),
        (config.proxyKey || '').trim(),
    ].join('\u0000');
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i++) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, '0');
}

export function isImageApiVerified(config?: ImageGenerationApiConfig): boolean {
    return !!(
        config?.verifiedAt
        && config.verifiedSignature
        && config.verifiedSignature === imageApiSignature(config)
    );
}

/**
 * 拉取生图模型列表：GET {base}/v1/models（404 时回退 {base}/models，兼容 URL 已含 /v1 的填法）。
 * 配置了跨域代理时经代理请求。不过滤模型类型——中转站通常不标注生图能力，由用户自己选。
 */
export async function fetchImageGenerationModels(
    baseUrl: string,
    apiKey: string,
    proxy: ImageApiProxyConfig = {},
): Promise<string[]> {
    const base = normalizeImageApiBase(baseUrl);
    if (!base) throw createImageGenerationError('请先填写生图 API 地址', { stage: '拉取模型' });

    const attempt = (url: string) => imageApiFetch(
        url,
        {
            method: 'GET',
            ...(apiKey.trim() ? { headers: { Authorization: `Bearer ${apiKey.trim()}` } } : {}),
        },
        proxy,
        '拉取模型',
    );

    const primaryEndpoint = `${base}/v1/models`;
    let response = await attempt(primaryEndpoint);
    // 用户 URL 已含 /v1 时已被规范化剥掉，这里 404 多半是站点挂在根路径（…/models）。
    if (response.status === 404 && primaryEndpoint !== `${base}/models`) {
        response = await attempt(`${base}/models`);
    }
    if (!response.ok) throw createImageGenerationError('模型列表请求失败', {
        stage: '拉取模型', endpoint: primaryEndpoint,
        status: response.status, statusText: response.statusText, responseBody: await readImageErrorResponse(response),
    });
    const data = await response.json().catch(cause => {
        throw createImageGenerationError('模型列表接口返回的不是有效 JSON', {
            stage: '拉取模型', endpoint: primaryEndpoint, cause,
        });
    });
    const models = extractModelIds(data);
    return [...new Set(models)].sort((a, b) => a.localeCompare(b));
}

/**
 * 测试连接 = 拉一次模型列表（零成本，绝不生成图片）。列表不可用或为空时抛错，
 * 由 UI 决定「已手填模型 → 保存为未验证」的降级路径。代理模式下走同一代理。
 */
export async function testImageApiConnection(config: ImageGenerationApiConfig): Promise<{ models: string[] }> {
    if (!normalizeImageApiBase(config.baseUrl)) throw new Error('请先填写 API 地址');
    const models = await fetchImageGenerationModels(config.baseUrl, config.apiKey, proxyOf(config));
    if (models.length === 0) throw new Error('模型列表返回为空，请确认中转站支持 /v1/models，或手动填写模型');
    return { models };
}

/** 默认关闭主动发图时的客户端保险丝：只允许最新用户消息明确索图。 */
export function isExplicitImageRequest(text: string): boolean {
    const value = (text || '').trim();
    if (!value) return false;
    return /(?:生图|(?:拍|发|来|给|传|生成|画).{0,8}(?:自拍|照片|相片|图片|张图|一张)|(?:想|要|让我|给我).{0,8}(?:看|看看).{0,8}(?:你|样子|照片|自拍)|看看.{0,6}(?:你|样子)|(?:自拍|照片|相片).{0,5}(?:给我|发我|看看)|show\s+me|send\s+(?:me\s+)?(?:a\s+)?(?:selfie|photo|picture)|take\s+(?:a\s+)?(?:selfie|photo|picture))/i.test(value);
}

export function buildImageGenerationDecisionPrompt(
    char: CharacterProfile,
    userProfile: UserProfile,
): string {
    const cfg = char.imageGeneration;
    if (!cfg?.enabled) return '';
    const promptMode = cfg.mode === 'prompt';
    const proactiveRule = cfg.allowProactive
        ? `当 ${userProfile.name} 在最新一条消息中明确要求看照片、自拍或要求生成图片时，必须使用。除此之外你也可以极低频地主动发图，但只在当前情境下真的自然、有意义时使用；不要连续两轮发图，也不要把发图当成固定节目。`
        : `当 ${userProfile.name} 在最新一条消息中明确要求看照片、自拍或要求生成图片时，必须使用；除此之外绝不能使用。仅仅谈到图片、外貌或旧照片不算请求。你绝不能主动发图。`;
    return `
## 本地私聊生图工具（严格规则）
你可以决定是否给 ${userProfile.name} 发一张${promptMode ? '画面记录' : '图片'}。${proactiveRule}

需要发图时，先以角色当前的语气自然回复 ${userProfile.name}，可以是一至三个简短气泡；然后在回复末尾附加下面的控制块。控制块不会显示给用户，不要在正文中解释工具、API 或提示词：
${IMAGE_GENERATION_OPEN}
${promptMode ? '{"prompt":"具体描述本轮照片的主体、动作、构图、环境、光线、服装和画风","summary":"一句客观精练的画面摘要","selfie":true}' : '{"prompt":"用简洁、可视化的语言描述画面、环境、表情、姿势、镜头和光线；不要重复人物固定长相","selfie":true}'}
${IMAGE_GENERATION_CLOSE}

- selfie=true：自拍或明显由角色自己拍摄的照片；其他画面填 false。
- prompt 只描述本轮聊天决定出的画面。人物身份、发型发色、瞳色与参考脸由客户端固定提供，你不要自行改写。
${promptMode ? '- summary 必须是可供日后回忆的客观画面描述，不是角色对白。完整提示词由客户端在本机补足，不要在正文解释生成机制。' : ''}
- 不需要发图时正常聊天，绝不输出上述控制块，也不要谈论这个工具。`;
}

export function extractImageGenerationDirective(raw: string, promptMode = false): {
    directive: ImageGenerationDirective | null;
    cleaned: string;
} {
    const match = (raw || '').match(DIRECTIVE_RE);
    if (!match) return { directive: null, cleaned: raw };
    let directive: ImageGenerationDirective | null = null;
    try {
        const parsed = JSON.parse(match[1]);
        const prompt = typeof parsed?.prompt === 'string' ? parsed.prompt.trim() : '';
        const summary = typeof parsed?.summary === 'string' ? parsed.summary.trim() : '';
        if (prompt && (!promptMode || summary)) {
            directive = {
                prompt: promptMode ? prompt : prompt.slice(0, 2000),
                selfie: parsed?.selfie !== false,
                ...(summary ? { summary } : {}),
            };
        }
    } catch { /* malformed controls are stripped but never executed */ }
    return { directive, cleaned: raw.replace(DIRECTIVE_RE, '').trim() };
}

export function stripImageGenerationDirectives(raw: string): string {
    return (raw || '').replace(DIRECTIVE_RE, '').trim();
}

function buildGenerationPrompt(
    char: CharacterProfile,
    cfg: CharacterImageGenerationConfig,
    request: ImageGenerationDirective,
    hasReference: boolean,
): string {
    const anchors = cfg.appearanceAnchors?.trim() || 'Follow the established character identity consistently.';
    return `Create one polished, natural-looking image of ${char.name}.

IDENTITY ANCHORS:
${anchors}

SCENE REQUEST:
${request.prompt}

IDENTITY PRIORITY:
${hasReference
    ? 'Use the supplied reference image only for facial identity. Preserve the same recognizable face, facial proportions, bone structure, eyes, nose, mouth, face shape and distinctive facial features. Do not replace the person with a merely similar-looking person. Do not inherit the reference image\'s hairstyle, hair color, clothing, accessories, pose, composition, background, lighting or visual style; determine those from the identity anchors and current scene request instead.'
    : 'Keep the person internally consistent with the identity anchors. Do not invent conflicting hair color, eye color or defining features.'}
${request.selfie
    ? 'This is a selfie. Use a believable handheld/front-camera composition, natural eye contact and a candid phone-photo feeling. The photographed person must match the reference identity.'
    : 'Use the requested camera viewpoint and scene while keeping the same character identity.'}
VISUAL STYLE:
Default to a refined semi-realistic pseudo-impasto digital painting style (伪厚涂), with natural skin texture, soft painterly shading and cohesive brushwork. Give the background an appropriate depth-of-field treatment so the character remains the visual focus, using subtle blur or bokeh where suitable.
Clothing is flexible and may follow the scene; appearance anchors are guidance, not a rigid costume lock.
No captions, watermarks, UI, split panels or extra duplicate people unless the scene explicitly requires them.`;
}

/** OpenAI Images 各模型家族接受的尺寸不同；未知模型不送 size，让服务端用默认值，避免中转站 400。 */
export function pickImageSize(model: string): string | undefined {
    const value = (model || '').trim();
    if (!value) return undefined;
    if (/^gpt-image/i.test(value)) return '1024x1536';
    if (/dall-e-3/i.test(value)) return '1024x1792';
    if (/dall-e-2/i.test(value)) return '512x512';
    return undefined;
}

/**
 * OpenAI Images 公开请求。gpt-image 系列的公开说明是始终返回 b64_json，
 * 并且不接受 response_format；其它模型显式要 b64_json。
 */
function buildGenerationRequestBody(model: string, prompt: string): Record<string, unknown> {
    const body: Record<string, unknown> = { model, prompt, n: 1 };
    const size = pickImageSize(model);
    if (size) body.size = size;
    if (!/^gpt-image/i.test(model)) body.response_format = 'b64_json';
    return body;
}

export interface ParsedGeneratedImage {
    /** data-url = base64 图片数据（data:image/...）；url = 远程图片地址。 */
    kind: 'data-url' | 'url';
    value: string;
}

/** 只认 OpenAI Images 的 data[].b64_json / data[].url。其它包装不猜测。 */
export function parseGeneratedImageResponse(payload: unknown): ParsedGeneratedImage {
    const data = payload && typeof payload === 'object' ? (payload as { data?: unknown }).data : undefined;
    const rows = Array.isArray(data) ? data : [];
    for (const row of rows) {
        if (!row || typeof row !== 'object') continue;
        const record = row as { b64_json?: unknown; url?: unknown };
        if (typeof record.b64_json === 'string' && record.b64_json.trim()) {
            const text = record.b64_json.trim();
            return { kind: 'data-url', value: text.startsWith('data:image/') ? text : `data:image/png;base64,${text.replace(/\s+/g, '')}` };
        }
        if (typeof record.url === 'string' && /^https?:\/\//i.test(record.url.trim())) {
            return { kind: 'url', value: record.url.trim() };
        }
    }
    throw createImageGenerationError('接口返回中没有找到图片', {
        stage: '解析生图响应',
        responseBody: JSON.stringify(payload, null, 2).slice(0, 3000),
    });
}

export async function generateCharacterImage(
    api: ImageGenerationApiConfig,
    char: CharacterProfile,
    request: ImageGenerationDirective,
    logContext: ImageGenerationLogContext = {},
): Promise<Blob | string> {
    const cfg = char.imageGeneration;
    if (!cfg?.enabled) throw new Error('当前角色尚未开启生图');
    const prompt = buildGenerationPrompt(char, cfg, request, false);
    return generateImageFromPrompt(api, prompt, { logContext });
}

/**
 * 低层入口：按给定 prompt 生成一张图（不走角色自拍 gate / prompt 组装）。
 * 见面场景图等其它功能复用这里；鉴权、代理、响应解析和日志走同一条文生图请求。
 */
export async function generateImageFromPrompt(
    api: ImageGenerationApiConfig,
    prompt: string,
    options: { referenceImageUrl?: string; logContext?: ImageGenerationLogContext } = {},
): Promise<Blob | string> {
    const startedAt = Date.now();
    const viaProxy = !!(api.proxyUrl || '').trim();
    const context: ImageGenerationLogContext = {
        feature: '生图',
        provider: 'OpenAI-compatible Image API',
        model: api.model,
        endpoint: viaProxy ? `${api.baseUrl}（经代理）` : api.baseUrl,
        ...options.logContext,
    };
    try {
        const image = await generateImageRequest(api, prompt);
        if (!context.skipLog) recordImageGenerationSuccess(context, startedAt);
        return image;
    } catch (error) {
        if (!context.skipLog) recordImageGenerationFailure(error, context, startedAt);
        throw error;
    }
}

async function generateImageRequest(
    api: ImageGenerationApiConfig,
    prompt: string,
): Promise<Blob | string> {
    if (!api.apiKey.trim()) throw new Error('生图 API Key 尚未配置');
    if (!normalizeImageApiBase(api.baseUrl)) throw new Error('请先在「设置 → 生图 API」中填写 API 地址');
    const model = (api.model || '').trim();
    if (!model) throw new Error('请先在「设置 → 生图 API」中选择或填写生图模型');

    const base = normalizeImageApiBase(api.baseUrl);
    const proxy = proxyOf(api);

    // 参考图 edits 与失败回退来自外部实现，公开版不再调用。画面仍使用文字锚点。
    return submitImageGenerationsRequest({ base, apiKey: api.apiKey.trim(), model, prompt, proxy });
}

async function submitImageGenerationsRequest(input: {
    base: string; apiKey: string; model: string; prompt: string; proxy: ImageApiProxyConfig;
}): Promise<Blob | string> {
    const endpoint = `${input.base}/v1/images/generations`;
    const response = await imageApiFetch(
        endpoint,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${input.apiKey}` },
            body: JSON.stringify(buildGenerationRequestBody(input.model, input.prompt)),
        },
        input.proxy,
        '提交生图请求',
    );
    if (!response.ok) {
        throw createImageGenerationError(await readServerErrorMessage(response, '生图请求失败'), {
            stage: '提交生图请求', endpoint,
            status: response.status, statusText: response.statusText, responseBody: await readImageErrorResponse(response),
        });
    }
    return resolveImageFromResponse(response, endpoint, input.proxy);
}

async function resolveImageFromResponse(response: Response, endpoint: string, proxy: ImageApiProxyConfig): Promise<Blob | string> {
    const contentType = response.headers.get('content-type') || '';
    if (contentType.startsWith('image/')) return await response.blob();

    const payload: unknown = await response.json().catch(() => null);
    if (payload == null) throw createImageGenerationError('生图接口返回的不是有效 JSON', {
        stage: '解析生图响应', endpoint,
    });
    const parsed = parseGeneratedImageResponse(payload);
    if (parsed.kind === 'url') return await downloadGeneratedImage(parsed.value, proxy);
    try {
        return await dataUrlToBlob(parsed.value);
    } catch (cause) {
        // 极端情况下 base64 解不开：保留原始 data URL 作为消息内容，仍可展示。
        console.warn('[image-generation] base64 图片转换失败，保留 data URL：', cause);
        return parsed.value;
    }
}

/** 服务端报错优先取业务 message（如「模型不存在」），取不到再用通用文案。 */
async function readServerErrorMessage(response: Response, fallback: string): Promise<string> {
    try {
        const data = await response.clone().json();
        return data?.error?.message || data?.message || fallback;
    } catch {
        return fallback;
    }
}

/** 同一个 blobref 同时写入角色图片消息与相册，避免 2K base64 双份占用。 */
export async function persistGeneratedCharacterImage(
    image: Blob | string,
    char: CharacterProfile,
    contextMessages: Message[],
    request: ImageGenerationDirective,
    provider: GeneratedImageProvider = 'gpt-image',
): Promise<string> {
    const ref = typeof image === 'string' ? image : await putImageBlob(image);
    const now = Date.now();
    const recentChat = contextMessages.slice(-10).map(message => {
        const sender = message.role === 'user' ? '用户' : char.name;
        return `${sender}: ${String(message.content || '').slice(0, 100)}`;
    });
    const savedMessageId = await DB.saveMessage({
        charId: char.id,
        role: 'assistant',
        type: 'image',
        content: ref,
        metadata: {
            generatedImage: true,
            imageProvider: provider,
            // 保留完整指令，单独重生图片时不必重新调用聊天模型，也不会改写对话。
            imageDirective: request,
            // 旧字段继续保留，兼容已发布版本与已有消息。
            scenePrompt: request.prompt,
            selfie: request.selfie,
            includeUser: request.includeUser,
        },
    });
    await DB.saveGalleryImage({
        id: `generated-${now}-${Math.random().toString(36).slice(2, 8)}`,
        charId: char.id,
        url: ref,
        timestamp: now,
        sourceMessageId: savedMessageId,
        savedDate: localDateKey(now),
        chatContext: recentChat,
    });
    return ref;
}

/** 用新生成结果替换聊天中的原图，并把新图作为独立记录保存到角色相册。 */
export async function replaceGeneratedCharacterImage(
    image: Blob | string,
    message: Message,
    char: CharacterProfile,
    contextMessages: Message[],
    request: ImageGenerationDirective,
): Promise<string> {
    const ref = typeof image === 'string' ? image : await putImageBlob(image);
    const now = Date.now();
    const recentChat = contextMessages.slice(-10).map(item => {
        const sender = item.role === 'user' ? '用户' : char.name;
        return `${sender}: ${String(item.content || '').slice(0, 100)}`;
    });
    const previousProvider = message.metadata?.imageProvider as GeneratedImageProvider | undefined;
    await DB.updateMessage(message.id, ref);
    await DB.updateMessageMetadata(message.id, previous => ({
        ...(previous || {}),
        generatedImage: true,
        imageProvider: previousProvider || 'gpt-image',
        imageDirective: request,
        scenePrompt: request.prompt,
        selfie: request.selfie,
        includeUser: request.includeUser,
        regeneratedAt: now,
    }));
    await DB.saveGalleryImage({
        id: `generated-reroll-${now}-${Math.random().toString(36).slice(2, 8)}`,
        charId: char.id,
        url: ref,
        timestamp: now,
        sourceMessageId: message.id,
        savedDate: localDateKey(now),
        chatContext: recentChat,
    });
    return ref;
}

async function downloadGeneratedImage(imageUrl: string, proxy: ImageApiProxyConfig): Promise<Blob | string> {
    try {
        const response = await imageApiFetch(imageUrl, { method: 'GET' }, proxy, '下载生成图片');
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        if (!blob.type.startsWith('image/')) throw new Error('返回内容不是图片');
        return blob;
    } catch (error) {
        console.warn('[image-generation] 结果图片无法下载到本地，改为保存远程地址', error);
        return imageUrl;
    }
}

function localDateKey(timestamp: number): string {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
