import type { CharacterProfile, DateObservation, ImageGenerationApiConfig, Message, UserProfile } from '../types';
import { DB } from './db';
import { putImageBlob } from './blobRef';
import { generateImageFromPrompt } from './imageGeneration';

/**
 * 线下见面 · 场景生图：每轮见面对话在文字回复落库后，异步生成一张「本轮见面场景」
 * 双人场景图（非自拍）。prompt 由三层组成：固定身份锚点 / 本轮动态信息 / 上一轮连续性。
 * 生成与落库复用通用生图底层（generateImageFromPrompt + blobRef + 相册）。
 */

/** 场景图消息的 metadata 标记：阅读模式据此渲染场景卡片，上下文构建据此过滤。 */
export interface DateSceneImageMeta {
    sceneImage: true;
    /** 挂载在哪条本轮文本回复下（时间序上紧跟其后）。 */
    sceneImageForMessageId: number;
    /** 生成时使用的完整场景 prompt（重生/诊断用）。 */
    sceneImagePrompt: string;
}

export const isDateSceneImageMessage = (message: Message): boolean =>
    message.type === 'image' && message.metadata?.sceneImage === true;

/** 从消息列表里剥掉场景图消息：blobref 绝不能进入下一轮 LLM 上下文。 */
export function stripSceneImageMessages<T extends Message>(messages: T[]): T[] {
    return messages.filter(message => !isDateSceneImageMessage(message));
}

/** 场景 prompt 输入：三层信息（固定身份 / 本轮动态 / 上一轮连续性）。 */
export interface DateScenePromptInput {
    charName: string;
    /** 角色外貌锚点（复用角色生图配置的 appearanceAnchors）。 */
    charAnchors?: string;
    /** 用户外貌锚点（当前项目暂无此字段，允许为空；留接口）。 */
    userAnchors?: string;
    userName: string;
    /** 本轮用户消息。 */
    userText: string;
    /** 本轮角色文字回复（canonical）。 */
    replyText: string;
    /** OBSERVE 开启时的结构化观测（地点/时间/状态/细节），没有则留空。 */
    observation?: DateObservation;
    /** 上一轮场景摘要（连续性锚点），首轮为空。 */
    previousSummary?: string;
    /** 场景画风补充（char.dateSceneImage.styleHint）。 */
    styleHint?: string;
}

const clip = (value: string | undefined, max: number): string =>
    String(value || '').replace(/\s+/g, ' ').trim().slice(0, max);

const cleanVisualCue = (value: string | undefined, max: number): string => clip(String(value || '')
    .replace(/【[^】]{1,40}】/g, ' ')
    .replace(/\[[^\]]{1,40}\]/g, ' ')
    .replace(/“[^”]*”|「[^」]*」|『[^』]*』/g, ' '), max);

/** 场景图 prompt：只保留可视信息，不把对话、剧本标签或结构标题交给生图模型。 */
export function buildDateScenePrompt(input: DateScenePromptInput): string {
    const charAnchors = input.charAnchors?.trim() || 'Follow the established character identity consistently.';
    const userAnchors = input.userAnchors?.trim() || 'Appearance unspecified: depict a natural, consistent ordinary person.';
    const observation = input.observation;
    const sceneDetails = [
        observation?.place?.trim() ? `The setting is ${cleanVisualCue(observation.place, 120)}.` : '',
        observation?.time?.trim() ? `The time and lighting feel like ${cleanVisualCue(observation.time, 60)}.` : '',
        observation?.state?.trim() ? `${input.charName}'s visible mood and posture are ${cleanVisualCue(observation.state, 120)}.` : '',
        observation?.detail?.trim() ? `The visible action and environmental detail are ${cleanVisualCue(observation.detail, 160)}.` : '',
    ].filter(Boolean).join(' ');

    const continuity = input.previousSummary?.trim()
        ? `Continue naturally from the previous visual state, ${cleanVisualCue(input.previousSummary, 200)}. Keep the same location, outfits, lighting and overall atmosphere unless the setting visibly changed.`
        : 'This is the first scene of this meeting; establish the location and outfits for later scenes.';

    return `Create one polished, natural-looking illustration of an in-person meeting between ${input.charName} and ${input.userName}. Depict ${input.charName} with this established appearance: ${charAnchors} Depict ${input.userName} with this established appearance: ${userAnchors} ${sceneDetails || 'Show a natural shared moment through expressions, posture, gesture and environmental storytelling.'} ${continuity} Both people appear together in one believable cinematic mid-shot or two-shot whenever the scene allows it, with expressive body language and a coherent environment. Use appropriate depth of field so the two people remain the visual focus. Render the scene in ${input.styleHint?.trim() || 'a refined semi-realistic pseudo-impasto digital painting style (伪厚涂) with soft painterly shading, natural skin texture and cohesive brushwork'}. Clothing follows the visible situation; appearance anchors define identity, not a costume lock. Strictly no text, no words, no letters, no captions, no subtitles, no speech bubbles, no script, no dialogue overlay, no watermarks, no UI, no split panels, and no duplicate people; make it a completely text-free illustration.`;
}

/**
 * 连续性摘要：只记录可视场景，不把本轮对白继续带给生图模型。
 * 刻意保持轻量——本期不做真正的场景状态机。
 */
export function summarizeSceneTurn(input: {
    replyText: string;
    observation?: DateObservation;
    userText: string;
}): string {
    const parts = [
        cleanVisualCue(input.observation?.place, 70),
        cleanVisualCue(input.observation?.state, 50),
        cleanVisualCue(input.observation?.detail, 100),
    ].filter(Boolean);
    return (parts.join('；') || '同一场景中的双人互动自然延续').slice(0, 180);
}

export interface DateSceneImageDeps {
    imageApi: ImageGenerationApiConfig;
    char: CharacterProfile;
    userProfile: UserProfile;
    assistantMessageId: number;
    encounterId?: string;
    userText: string;
    replyText: string;
    observation?: DateObservation;
    previousSummary?: string;
    contextMessages: Message[];
}

export interface DateSceneImageResult {
    ref: string;
    summary: string;
    messageId: number;
}

/** 生成 + 落库（聊天图片消息 + 相册）+ 返回连续性摘要。调用方负责 try/catch 与不阻塞回合。 */
export async function generateAndPersistDateSceneImage(deps: DateSceneImageDeps): Promise<DateSceneImageResult> {
    const prompt = buildDateScenePrompt({
        charName: deps.char.name,
        charAnchors: deps.char.imageGeneration?.appearanceAnchors,
        userName: deps.userProfile.name,
        userText: deps.userText,
        replyText: deps.replyText,
        observation: deps.observation,
        previousSummary: deps.previousSummary,
        styleHint: deps.char.dateSceneImage?.styleHint,
    });
    const image = await generateImageFromPrompt(deps.imageApi, prompt, {
        referenceImageUrl: deps.char.imageGeneration?.referenceImage,
        logContext: { feature: '见面 · 场景图' },
    });
    const ref = typeof image === 'string' ? image : await putImageBlob(image);
    const now = Date.now();
    const recentChat = deps.contextMessages.slice(-10).map(message => {
        const sender = message.role === 'user' ? deps.userProfile.name : deps.char.name;
        return `${sender}: ${String(message.content || '').slice(0, 100)}`;
    });
    const messageId = await DB.saveMessage({
        charId: deps.char.id,
        role: 'assistant',
        type: 'image',
        content: ref,
        metadata: {
            source: 'date',
            ...(deps.encounterId ? { dateEncounterId: deps.encounterId } : {}),
            generatedImage: true,
            imageProvider: 'gpt-image',
            sceneImage: true,
            sceneImageForMessageId: deps.assistantMessageId,
            sceneImagePrompt: prompt,
        } as Message['metadata'],
    });
    await DB.saveGalleryImage({
        id: `date-scene-${now}-${Math.random().toString(36).slice(2, 8)}`,
        charId: deps.char.id,
        url: ref,
        timestamp: now,
        sourceMessageId: messageId,
        savedDate: localDateKey(now),
        chatContext: recentChat,
    });
    return { ref, summary: summarizeSceneTurn({ replyText: deps.replyText, observation: deps.observation, userText: deps.userText }), messageId };
}

function localDateKey(timestamp: number): string {
    const date = new Date(timestamp);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}
