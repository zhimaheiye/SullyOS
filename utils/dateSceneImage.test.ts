import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
    buildDateScenePrompt,
    generateAndPersistDateSceneImage,
    isDateSceneImageMessage,
    stripSceneImageMessages,
    summarizeSceneTurn,
} from './dateSceneImage';
import { DB } from './db';
import { putImageBlob } from './blobRef';
import { generateImageFromPrompt } from './imageGeneration';
import type { CharacterProfile, DateObservation, ImageGenerationApiConfig, Message, UserProfile } from '../types';

vi.mock('./db', () => ({
    DB: {
        saveMessage: vi.fn(async () => 77),
        saveGalleryImage: vi.fn(async () => undefined),
    },
}));

vi.mock('./blobRef', () => ({
    putImageBlob: vi.fn(async () => 'blobref:scene-token'),
}));

vi.mock('./imageGeneration', () => ({
    generateImageFromPrompt: vi.fn(async () => new Blob(['scene'], { type: 'image/png' })),
}));

const mockSaveMessage = vi.mocked(DB.saveMessage);
const mockSaveGalleryImage = vi.mocked(DB.saveGalleryImage);
const mockPutImageBlob = vi.mocked(putImageBlob);
const mockGenerate = vi.mocked(generateImageFromPrompt);

const buildImageApi = (): ImageGenerationApiConfig => ({
    baseUrl: 'https://relay.example.com/v1',
    apiKey: 'sk-test',
    model: 'gpt-image-1',
});

const buildChar = (): CharacterProfile => ({
    id: 'char-1',
    name: '小雅',
    avatar: '',
    description: '',
    systemPrompt: '',
    memories: [],
    imageGeneration: { enabled: false, baseUrl: '', apiKey: '', model: '', appearanceAnchors: '黑色长发，棕色瞳孔' },
    dateSceneImage: { enabled: true },
} as CharacterProfile);

const buildUserProfile = (): UserProfile => ({
    name: '阿澈',
    avatar: '',
    bio: '',
});

const buildObservation = (): DateObservation => ({
    place: '海边的咖啡馆',
    time: '黄昏',
    state: '放松而愉快',
    detail: '她把咖啡杯转了半圈，看着窗外',
});

beforeEach(() => {
    vi.clearAllMocks();
});

describe('场景 prompt 构建（三层信息）', () => {
    it('包含身份锚点与双人构图要求，但不把原始台词交给生图模型', () => {
        const prompt = buildDateScenePrompt({
            charName: '小雅',
            charAnchors: '黑色长发，棕色瞳孔',
            userName: '阿澈',
            userText: '我们沿着海边散步吧',
            replyText: '她笑着拉住你的手腕，指向远处的灯塔。',
        });
        expect(prompt).toContain('黑色长发，棕色瞳孔');
        expect(prompt).not.toContain('我们沿着海边散步吧');
        expect(prompt).not.toContain('她笑着拉住你的手腕');
        expect(prompt).not.toContain("THIS TURN'S SCENE");
        expect(prompt).not.toContain('CONTINUITY:');
        expect(prompt).toContain('Strictly no text, no words, no letters');
        expect(prompt).toContain('阿澈');
        expect(prompt).toContain('Both people appear together');
        expect(prompt).toContain('This is the first scene');
    });

    it('观测协议内容进入动态层；连续性摘要与画风补充覆盖默认', () => {
        const prompt = buildDateScenePrompt({
            charName: '小雅',
            userName: '阿澈',
            userText: '坐下聊聊',
            replyText: '她把拿铁推到你面前。',
            observation: buildObservation(),
            previousSummary: '海边的咖啡馆：她聊起了童年的灯塔。',
            styleHint: '吉卜力水彩风',
        });
        expect(prompt).toContain('海边的咖啡馆');
        expect(prompt).toContain('黄昏');
        expect(prompt).toContain('她把咖啡杯转了半圈');
        expect(prompt).toContain('Continue naturally from the previous visual state');
        expect(prompt).toContain('海边的咖啡馆：她聊起了童年的灯塔。');
        expect(prompt).toContain('吉卜力水彩风');
        expect(prompt).not.toContain('pseudo-impasto');
    });

    it('锚点为空时使用安全的默认描述，不留空段落', () => {
        const prompt = buildDateScenePrompt({
            charName: '小雅',
            userName: '阿澈',
            userText: 'hi',
            replyText: '嗯。',
        });
        expect(prompt).toContain('Follow the established character identity consistently.');
        expect(prompt).toContain('Appearance unspecified');
    });
});

describe('连续性摘要', () => {
    it('只组合可视观测并截断到上限', () => {
        expect(summarizeSceneTurn({
            replyText: '她把拿铁推到你面前，笑着说这家的豆子是她挑的。',
            observation: buildObservation(),
            userText: '坐下聊聊',
        })).toBe('海边的咖啡馆；放松而愉快；她把咖啡杯转了半圈，看着窗外');
        expect(summarizeSceneTurn({ replyText: 'x'.repeat(400), userText: '' }).length).toBeLessThanOrEqual(180);
    });
});

describe('场景图消息标记与上下文过滤', () => {
    it('只识别 sceneImage 标记的图片消息；普通图片与文本不受影响', () => {
        const sceneImage = { id: 1, role: 'assistant', type: 'image', content: 'blobref:a', metadata: { source: 'date', sceneImage: true, sceneImageForMessageId: 9 } } as unknown as Message;
        const normalImage = { id: 2, role: 'user', type: 'image', content: 'blobref:b', metadata: {} } as unknown as Message;
        const text = { id: 3, role: 'assistant', type: 'text', content: '你好', metadata: { source: 'date' } } as unknown as Message;
        expect(isDateSceneImageMessage(sceneImage)).toBe(true);
        expect(isDateSceneImageMessage(normalImage)).toBe(false);
        expect(isDateSceneImageMessage(text)).toBe(false);
        expect(stripSceneImageMessages([sceneImage, normalImage, text])).toEqual([normalImage, text]);
    });
});

describe('生成 + 落库', () => {
    it('走通用生图底层；图片消息带 source=date 与 sceneImageForMessageId；相册回链', async () => {
        mockSaveMessage.mockResolvedValue(77);
        const result = await generateAndPersistDateSceneImage({
            imageApi: buildImageApi(),
            char: buildChar(),
            userProfile: buildUserProfile(),
            assistantMessageId: 42,
            encounterId: 'meeting-42',
            userText: '我们沿着海边散步吧',
            replyText: '她笑着拉住你的手腕。',
            observation: buildObservation(),
            previousSummary: undefined,
            contextMessages: [],
        });
        expect(result.messageId).toBe(77);
        expect(result.ref).toBe('blobref:scene-token');
        expect(mockGenerate).toHaveBeenCalledTimes(1);
        const [, prompt, options] = mockGenerate.mock.calls[0];
        expect(prompt).not.toContain('沿着海边散步吧');
        expect(prompt).toContain('海边的咖啡馆');
        expect(options?.logContext?.feature).toBe('见面 · 场景图');
        expect(mockSaveMessage).toHaveBeenCalledWith(expect.objectContaining({
            charId: 'char-1',
            role: 'assistant',
            type: 'image',
            metadata: expect.objectContaining({
                source: 'date',
                sceneImage: true,
                sceneImageForMessageId: 42,
                dateEncounterId: 'meeting-42',
                generatedImage: true,
            }),
        }));
        expect(mockPutImageBlob).toHaveBeenCalled();
        expect(mockSaveGalleryImage).toHaveBeenCalledWith(expect.objectContaining({
            charId: 'char-1',
            sourceMessageId: 77,
        }));
        expect(result.summary).toContain('她把咖啡杯转了半圈');
    });
});
