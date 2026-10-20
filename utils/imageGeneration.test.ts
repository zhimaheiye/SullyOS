import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    buildImageApiProxyUrl,
    extractImageGenerationDirective,
    fetchImageGenerationModels,
    filterImageModels,
    generateCharacterImage,
    isExplicitImageRequest,
    isImageApiVerified,
    imageApiSignature,
    normalizeImageApiBase,
    parseGeneratedImageResponse,
    persistGeneratedCharacterImage,
    pickImageSize,
    replaceGeneratedCharacterImage,
    stripImageGenerationDirectives,
    testImageApiConnection,
    type ImageGenerationDirective,
} from './imageGeneration';
import { DB } from './db';
import { putImageBlob } from './blobRef';
import type { CharacterProfile, ImageGenerationApiConfig } from '../types';

const mockPutImageBlob = vi.mocked(putImageBlob);
const mockSaveMessage = vi.mocked(DB.saveMessage);
const mockSaveGalleryImage = vi.mocked(DB.saveGalleryImage);
const mockUpdateMessage = vi.mocked(DB.updateMessage);
const mockUpdateMessageMetadata = vi.mocked(DB.updateMessageMetadata);

vi.mock('./blobRef', async importOriginal => ({
    ...(await importOriginal<typeof import('./blobRef')>()),
    putImageBlob: vi.fn(async () => 'blobref:mock-token'),
    dataUrlToBlob: vi.fn(async () => new Blob(['mock-decoded'], { type: 'image/png' })),
}));

vi.mock('./db', () => ({
    DB: {
        saveMessage: vi.fn(async () => 123),
        saveGalleryImage: vi.fn(async () => undefined),
        updateMessage: vi.fn(async () => undefined),
        updateMessageMetadata: vi.fn(async () => undefined),
    },
}));

const jsonResponse = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
    });

const imageResponse = (bytes: string): Response =>
    new Response(bytes, { status: 200, headers: { 'content-type': 'image/png' } });

const buildApiConfig = (overrides: Partial<ImageGenerationApiConfig> = {}): ImageGenerationApiConfig => ({
    baseUrl: 'https://relay.example.com/v1',
    apiKey: 'sk-test',
    model: 'gpt-image-1',
    ...overrides,
});

const buildChar = (overrides: Partial<CharacterProfile['imageGeneration']> = {}): CharacterProfile => ({
    id: 'char-1',
    name: '小雅',
    avatar: '',
    description: '',
    systemPrompt: '',
    memories: [],
    imageGeneration: {
        enabled: true,
        appearanceAnchors: '黑色长发，棕色瞳孔',
        ...overrides,
    },
} as CharacterProfile);

const buildDirective = (overrides: Partial<ImageGenerationDirective> = {}): ImageGenerationDirective => ({
    prompt: '黄昏的天台自拍，侧脸微笑',
    selfie: true,
    ...overrides,
});

beforeEach(() => {
    vi.clearAllMocks();
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('URL 规范化', () => {
    it('兼容带/不带 /v1、尾斜杠与完整端点的填法，不会出现 /v1/v1', () => {
        expect(normalizeImageApiBase('https://api.example.com')).toBe('https://api.example.com');
        expect(normalizeImageApiBase('https://api.example.com/')).toBe('https://api.example.com');
        expect(normalizeImageApiBase('https://api.example.com/v1')).toBe('https://api.example.com');
        expect(normalizeImageApiBase('https://api.example.com/v1/')).toBe('https://api.example.com');
        expect(normalizeImageApiBase('https://api.example.com/v1/images/generations')).toBe('https://api.example.com');
        expect(normalizeImageApiBase('  https://api.example.com/v1  ')).toBe('https://api.example.com');
        expect(normalizeImageApiBase('')).toBe('');
    });
});

describe('配置验证绿灯', () => {
    it('签名随 baseUrl / apiKey / model 任一改动而变化', () => {
        const base = imageApiSignature({ baseUrl: 'https://a.com/v1', apiKey: 'k1', model: 'm1' });
        expect(base).not.toBe(imageApiSignature({ baseUrl: 'https://a.com/v1', apiKey: 'k1', model: 'm2' }));
        expect(base).not.toBe(imageApiSignature({ baseUrl: 'https://a.com/v1', apiKey: 'k2', model: 'm1' }));
        expect(base).not.toBe(imageApiSignature({ baseUrl: 'https://b.com/v1', apiKey: 'k1', model: 'm1' }));
        // URL 填法不同但指向一致 → 同一签名
        expect(base).toBe(imageApiSignature({ baseUrl: 'https://a.com', apiKey: 'k1', model: 'm1' }));
    });

    it('绿灯只在签名匹配时亮起；旧 channel 版签名失配后安全地回到未验证', () => {
        const config = buildApiConfig();
        expect(isImageApiVerified(config)).toBe(false);
        const verified = { ...config, verifiedAt: Date.now(), verifiedSignature: imageApiSignature(config) };
        expect(isImageApiVerified(verified)).toBe(true);
        // 旧版配置（channel + 基于 channel 的签名）：不报错，且不误报绿灯
        const legacy = { ...config, channel: 'default' as const, model: '', verifiedSignature: 'deadbeef' };
        expect(isImageApiVerified(legacy)).toBe(false);
    });

    it('proxyUrl / proxyKey 改动后绿灯自动失效', () => {
        const config = buildApiConfig();
        const verified = { ...config, verifiedAt: Date.now(), verifiedSignature: imageApiSignature(config) };
        expect(isImageApiVerified(verified)).toBe(true);
        expect(isImageApiVerified({ ...verified, proxyUrl: 'http://127.0.0.1:18061' })).toBe(false);
        expect(isImageApiVerified({ ...verified, proxyKey: 'secret' })).toBe(false);
        // proxyUrl 置空串与「未配置」语义一致 → 签名不变，绿灯保持
        expect(isImageApiVerified({ ...verified, proxyUrl: '' })).toBe(true);
    });
});

describe('跨域代理（?target= 约定，与 MCP 代理同一套）', () => {
    it('buildImageApiProxyUrl：无代理直连、有代理包 target、代理带 query 用 &', () => {
        const target = 'https://api.example.com/v1/models';
        expect(buildImageApiProxyUrl('', target)).toBe(target);
        expect(buildImageApiProxyUrl(undefined, target)).toBe(target);
        expect(buildImageApiProxyUrl('http://127.0.0.1:18061', target))
            .toBe(`http://127.0.0.1:18061?target=${encodeURIComponent(target)}`);
        expect(buildImageApiProxyUrl('http://127.0.0.1:18061/', target))
            .toBe(`http://127.0.0.1:18061?target=${encodeURIComponent(target)}`);
        expect(buildImageApiProxyUrl('http://127.0.0.1:18061/?a=1', target))
            .toBe(`http://127.0.0.1:18061/?a=1&target=${encodeURIComponent(target)}`);
    });

    it('拉模型经代理：请求包成 ?target= 且带 X-Proxy-Key', async () => {
        const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ data: [{ id: 'm1' }] }));
        vi.stubGlobal('fetch', fetchMock);
        const models = await fetchImageGenerationModels('https://api.example.com/v1', 'sk-test', {
            proxyUrl: 'http://127.0.0.1:18061', proxyKey: 'proxy-secret',
        });
        expect(models).toEqual(['m1']);
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            `http://127.0.0.1:18061?target=${encodeURIComponent('https://api.example.com/v1/models')}`,
        );
        expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('X-Proxy-Key')).toBe('proxy-secret');
    });

    it('生图 POST 经代理：URL 与请求体都落在 target 上', async () => {
        const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ data: [{ b64_json: 'QUJD' }] }));
        vi.stubGlobal('fetch', fetchMock);
        const image = await generateCharacterImage(
            buildApiConfig({ proxyUrl: 'http://127.0.0.1:18061' }),
            buildChar(),
            buildDirective(),
        );
        expect(image).toBeInstanceOf(Blob);
        expect(String(fetchMock.mock.calls[0][0])).toBe(
            `http://127.0.0.1:18061?target=${encodeURIComponent('https://relay.example.com/v1/images/generations')}`,
        );
    });

    it('返回图片 URL 时，下载图片同样经代理', async () => {
        const fetchMock = vi.fn(async (url: string) => {
            if (String(url).includes(encodeURIComponent('/v1/images/generations'))) {
                return jsonResponse({ data: [{ url: 'https://cdn.example.com/pic/face.png' }] });
            }
            return imageResponse('proxied-image-bytes');
        });
        vi.stubGlobal('fetch', fetchMock);
        const image = await generateCharacterImage(
            buildApiConfig({ model: 'flux-portrait', proxyUrl: 'http://127.0.0.1:18061' }),
            buildChar(),
            buildDirective(),
        );
        expect(image).toBeInstanceOf(Blob);
        expect(String(fetchMock.mock.calls[1][0])).toBe(
            `http://127.0.0.1:18061?target=${encodeURIComponent('https://cdn.example.com/pic/face.png')}`,
        );
    });

    it('直连 fetch 失败提示跨域代理方向；经代理失败提示检查代理；代理 502 提示目标失败', async () => {
        vi.stubGlobal('fetch', vi.fn(async (_url: string, _init?: RequestInit) => { throw new TypeError('Failed to fetch'); }));
        await expect(fetchImageGenerationModels('http://127.0.0.1:8000/v1', 'k'))
            .rejects.toThrow(/跨域限制（CORS）/);
        await expect(fetchImageGenerationModels('http://127.0.0.1:8000/v1', 'k'))
            .rejects.toThrow(/跨域代理（可选）/);

        await expect(fetchImageGenerationModels('http://127.0.0.1:8000/v1', 'k', { proxyUrl: 'http://127.0.0.1:18061' }))
            .rejects.toThrow(/无法连接代理/);

        vi.stubGlobal('fetch', vi.fn(async (_url: string, _init?: RequestInit) => new Response('Proxy error: ECONNREFUSED', { status: 502 })));
        await expect(fetchImageGenerationModels('http://127.0.0.1:8000/v1', 'k', { proxyUrl: 'http://127.0.0.1:18061' }))
            .rejects.toThrow(/代理访问目标接口失败/);
    });
});

describe('模型下拉本地过滤', () => {
    it('空查询返回全部；包含匹配大小写不敏感；不修改原数组', () => {
        const models = ['grok-imagine-image', 'GPT-Image-1', 'flux-pro'];
        expect(filterImageModels(models, '')).toEqual(models);
        expect(filterImageModels(models, '   ')).toEqual(models);
        expect(filterImageModels(models, 'grok')).toEqual(['grok-imagine-image']);
        expect(filterImageModels(models, 'IMAGE')).toEqual(['grok-imagine-image', 'GPT-Image-1']);
        expect(filterImageModels(models, '不存在')).toEqual([]);
        expect(models).toEqual(['grok-imagine-image', 'GPT-Image-1', 'flux-pro']);
    });
});

describe('拉取模型列表', () => {
    it('GET {base}/v1/models 并带 Bearer；解析 data[].id 并去重排序', async () => {
        const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ data: [{ id: 'b-model' }, { id: 'a-model' }, { id: 'b-model' }] }));
        vi.stubGlobal('fetch', fetchMock);
        const models = await fetchImageGenerationModels('https://relay.example.com/v1', 'sk-test');
        expect(models).toEqual(['a-model', 'b-model']);
        expect(String(fetchMock.mock.calls[0][0])).toBe('https://relay.example.com/v1/models');
        expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer sk-test');
    });

    it('URL 未带 /v1 时同样落在 /v1/models', async () => {
        const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ data: [{ id: 'm1' }] }));
        vi.stubGlobal('fetch', fetchMock);
        await fetchImageGenerationModels('https://api.example.com', 'sk');
        expect(String(fetchMock.mock.calls[0][0])).toBe('https://api.example.com/v1/models');
    });

    it('响应头里模型列表失败时按状态抛错（401 / 429 / CORS 网络失败）', async () => {
        vi.stubGlobal('fetch', vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ error: { message: 'Invalid key' } }, 401)));
        await expect(fetchImageGenerationModels('https://api.example.com/v1', 'bad')).rejects.toMatchObject({ status: 401 });

        vi.stubGlobal('fetch', vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ error: { message: 'rate limited' } }, 429)));
        await expect(fetchImageGenerationModels('https://api.example.com/v1', 'k')).rejects.toMatchObject({ status: 429 });

        vi.stubGlobal('fetch', vi.fn(async (_url: string, _init?: RequestInit) => { throw new TypeError('Failed to fetch'); }));
        await expect(fetchImageGenerationModels('https://api.example.com/v1', 'k')).rejects.toThrow();
    });

    it('/v1/models 404 时回退 {base}/models；空列表返回空数组；无 Key 时不带 Authorization', async () => {
        const fetchMock = vi.fn(async (url: string, _init?: RequestInit) => {
            if (String(url).endsWith('/v1/models')) return jsonResponse({ error: 'nope' }, 404);
            return jsonResponse({ data: [] });
        });
        vi.stubGlobal('fetch', fetchMock);
        const models = await fetchImageGenerationModels('https://api.example.com', '');
        expect(models).toEqual([]);
        expect(String(fetchMock.mock.calls[1][0])).toBe('https://api.example.com/models');
        expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Authorization')).toBeNull();
    });

    it('testImageApiConnection：空地址 / 空列表报错，成功返回列表', async () => {
        await expect(testImageApiConnection(buildApiConfig({ baseUrl: '' }))).rejects.toThrow('请先填写 API 地址');

        vi.stubGlobal('fetch', vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ data: [] })));
        await expect(testImageApiConnection(buildApiConfig())).rejects.toThrow('模型列表返回为空');

        vi.stubGlobal('fetch', vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ data: [{ id: 'm1' }] })));
        const { models } = await testImageApiConnection(buildApiConfig());
        expect(models).toEqual(['m1']);
    });
});

describe('生图请求（OpenAI Images 兼容协议）', () => {
    it('POST {base}/v1/images/generations，body 带模型；gpt-image 系不送 response_format', async () => {
        const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ data: [{ b64_json: 'QUJD' }] }));
        vi.stubGlobal('fetch', fetchMock);
        const image = await generateCharacterImage(buildApiConfig(), buildChar(), buildDirective());
        expect(image).toBeInstanceOf(Blob);
        expect(String(fetchMock.mock.calls[0][0])).toBe('https://relay.example.com/v1/images/generations');
        expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('Authorization')).toBe('Bearer sk-test');
        const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
        expect(body.model).toBe('gpt-image-1');
        expect(body.prompt).toContain('黄昏的天台自拍');
        expect(body.prompt).toContain('黑色长发');
        expect(body.n).toBe(1);
        expect(body.size).toBe('1024x1536');
        expect(body.response_format).toBeUndefined();
    });

    it('非 gpt-image 模型请求 b64_json；未知模型不送 size；b64 返回转成 Blob', async () => {
        const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ data: [{ b64_json: 'QUJD' }] }));
        vi.stubGlobal('fetch', fetchMock);
        const image = await generateCharacterImage(buildApiConfig({ model: 'seedream-4' }), buildChar(), buildDirective());
        expect(image).toBeInstanceOf(Blob);
        const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
        expect(body.model).toBe('seedream-4');
        expect(body.response_format).toBe('b64_json');
        expect(body.size).toBeUndefined();
    });

    it('URL 响应会被下载成本地图片', async () => {
        const fetchMock = vi.fn(async (url: string) => {
            if (String(url).endsWith('/v1/images/generations')) {
                return jsonResponse({ data: [{ url: 'https://cdn.example.com/pic/face.png?sig=1' }] });
            }
            return imageResponse('fake-png-bytes');
        });
        vi.stubGlobal('fetch', fetchMock);
        const image = await generateCharacterImage(buildApiConfig({ model: 'flux-portrait' }), buildChar(), buildDirective());
        expect(image).toBeInstanceOf(Blob);
        expect(String(fetchMock.mock.calls[1][0])).toBe('https://cdn.example.com/pic/face.png?sig=1');
    });

    it('直接返回 image/* 内容时按二进制处理', async () => {
        vi.stubGlobal('fetch', vi.fn(async (_url: string, _init?: RequestInit) => imageResponse('raw-image-bytes')));
        const image = await generateCharacterImage(buildApiConfig(), buildChar(), buildDirective());
        expect(image).toBeInstanceOf(Blob);
    });

    it('异常返回 / HTTP 错误都带可诊断信息；401/404/429/5xx 原样传播', async () => {
        vi.stubGlobal('fetch', vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ choices: [] })));
        await expect(generateCharacterImage(buildApiConfig(), buildChar(), buildDirective()))
            .rejects.toThrow('接口返回中没有找到图片');

        for (const status of [401, 404, 429, 500]) {
            vi.stubGlobal('fetch', vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ error: { message: 'boom' } }, status)));
            await expect(generateCharacterImage(buildApiConfig(), buildChar(), buildDirective()))
                .rejects.toMatchObject({ status });
        }
    });

    it('未配置 Key / 地址 / 模型或角色未开启时直接报错，不发请求', async () => {
        const fetchMock = vi.fn();
        vi.stubGlobal('fetch', fetchMock);
        await expect(generateCharacterImage(buildApiConfig({ apiKey: ' ' }), buildChar(), buildDirective())).rejects.toThrow('API Key');
        await expect(generateCharacterImage(buildApiConfig({ baseUrl: '' }), buildChar(), buildDirective())).rejects.toThrow('API 地址');
        await expect(generateCharacterImage(buildApiConfig({ model: '' }), buildChar(), buildDirective())).rejects.toThrow('模型');
        await expect(generateCharacterImage(buildApiConfig(), buildChar({ enabled: false }), buildDirective())).rejects.toThrow('尚未开启生图');
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('配置了参考图地址时仍只走文生图，不调用 images/edits', async () => {
        const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => jsonResponse({ data: [{ b64_json: 'QUJD' }] }));
        vi.stubGlobal('fetch', fetchMock);
        const image = await generateCharacterImage(
            buildApiConfig(),
            buildChar({ referenceImage: 'https://ref.example.com/face.jpg' }),
            buildDirective(),
        );
        expect(image).toBeInstanceOf(Blob);
        const calledUrls = fetchMock.mock.calls.map(call => String(call[0]));
        expect(calledUrls.some(url => url.endsWith('/v1/images/edits'))).toBe(false);
        expect(calledUrls.some(url => url.endsWith('/v1/images/generations'))).toBe(true);
        const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
        expect(body.prompt).not.toContain('supplied reference image');
    });
});

describe('生图响应解析', () => {
    it('只接受 OpenAI Images 的 data[].b64_json 和 data[].url', () => {
        expect(parseGeneratedImageResponse({ data: [{ b64_json: 'QUJD' }] })).toMatchObject({ kind: 'data-url', value: 'data:image/png;base64,QUJD' });
        expect(parseGeneratedImageResponse({ data: [{ url: 'https://cdn.example.com/pic/face.png' }] })).toMatchObject({ kind: 'url' });
        expect(() => parseGeneratedImageResponse({ images: [{ base64: 'QUJD' }] })).toThrow('没有找到图片');
        expect(() => parseGeneratedImageResponse({ artifacts: [{ base64: 'QUJD' }] })).toThrow('没有找到图片');
        expect(() => parseGeneratedImageResponse('A'.repeat(600))).toThrow('没有找到图片');
    });
});

describe('图片落库（聊天 + 相册）与重生', () => {
    it('persistGeneratedCharacterImage 写入图片消息与相册并回链 sourceMessageId', async () => {
        mockSaveMessage.mockResolvedValue(321);
        const ref = await persistGeneratedCharacterImage(
            new Blob(['x'], { type: 'image/png' }),
            buildChar(),
            [],
            buildDirective(),
        );
        expect(mockPutImageBlob).toHaveBeenCalled();
        expect(mockSaveMessage).toHaveBeenCalledWith(expect.objectContaining({
            charId: 'char-1',
            role: 'assistant',
            type: 'image',
            metadata: expect.objectContaining({ generatedImage: true, imageProvider: 'gpt-image', imageDirective: buildDirective() }),
        }));
        expect(mockSaveGalleryImage).toHaveBeenCalledWith(expect.objectContaining({
            charId: 'char-1',
            url: ref,
            sourceMessageId: 321,
        }));
    });

    it('replaceGeneratedCharacterImage 原地更新消息并保留原 provider', async () => {
        await replaceGeneratedCharacterImage(
            'https://cdn.example.com/new.png',
            { id: 9, metadata: { imageProvider: 'gpt-image' } } as any,
            buildChar(),
            [],
            buildDirective({ prompt: '新画面' }),
        );
        expect(mockUpdateMessage).toHaveBeenCalledWith(9, 'https://cdn.example.com/new.png');
        expect(mockUpdateMessageMetadata).toHaveBeenCalledWith(9, expect.any(Function));
        expect(mockSaveGalleryImage).toHaveBeenCalledWith(expect.objectContaining({ sourceMessageId: 9 }));
    });
});

describe('控制块与索图保险丝（一期行为保持不变）', () => {
    it('extractImageGenerationDirective 正常解析、剥离，坏 JSON 只剥离不执行', () => {
        const raw = '好呀，稍等～[[GENERATE_IMAGE]] {"prompt":"咖啡店自拍","selfie":false} [[/GENERATE_IMAGE]]';
        const parsed = extractImageGenerationDirective(raw);
        expect(parsed.directive).toEqual({ prompt: '咖啡店自拍', selfie: false });
        expect(parsed.cleaned).toBe('好呀，稍等～');
        expect(stripImageGenerationDirectives(raw)).toBe('好呀，稍等～');

        const broken = '来了[[GENERATE_IMAGE]] {oops [[/GENERATE_IMAGE]]';
        const brokenParsed = extractImageGenerationDirective(broken);
        expect(brokenParsed.directive).toBeNull();
        expect(brokenParsed.cleaned).toBe('来了');

        expect(extractImageGenerationDirective('普通聊天').directive).toBeNull();
        expect(extractImageGenerationDirective('[[GENERATE_IMAGE]] {"prompt":"x"} [[/GENERATE_IMAGE]]').directive).toEqual({
            prompt: 'x', selfie: true,
        });
    });

    it('isExplicitImageRequest 只放行明确索图', () => {
        expect(isExplicitImageRequest('发张自拍看看你')).toBe(true);
        expect(isExplicitImageRequest('给我一张图片')).toBe(true);
        expect(isExplicitImageRequest('show me a selfie')).toBe(true);
        expect(isExplicitImageRequest('今天天气不错')).toBe(false);
        expect(isExplicitImageRequest('图片是什么东西')).toBe(false);
        expect(isExplicitImageRequest('')).toBe(false);
    });

    it('pickImageSize 只对已知 OpenAI 家族给竖版尺寸', () => {
        expect(pickImageSize('gpt-image-1')).toBe('1024x1536');
        expect(pickImageSize('dall-e-3')).toBe('1024x1792');
        expect(pickImageSize('dall-e-2')).toBe('512x512');
        expect(pickImageSize('seedream-4')).toBeUndefined();
        expect(pickImageSize('')).toBeUndefined();
    });
});
