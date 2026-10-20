import type { CharacterProfile, Message } from '../types';
import type { TextFeatureApi } from './featureApi';
import { DB } from './db';
import { extractContent, safeFetchJson } from './safeApi';

/** content 只保存画面摘要；完整提示词留在 metadata，不进日常对话。 */
export interface ImagePromptCardMeta {
    imagePrompt: {
        version: 1;
        source: 'chat' | 'date';
        fullPrompt: string;
        negative?: string;
        sourceAssistantMessageId: number;
        dateEncounterId?: string;
        selfie?: boolean;
    };
}

export const isImagePromptCard = (message: Message): boolean => message.type === 'image_prompt';

export const imagePromptSummaryForHistory = (message: Message): string =>
    message.metadata?.imagePrompt?.source === 'date'
        ? `[本轮见面场景画面：${message.content}]`
        : `[你曾向用户发来一张照片：${message.content}]`;

export function parseImagePromptResult(raw: string): { summary: string; fullPrompt: string; negative?: string } | null {
    const text = raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    try {
        const value = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
        const summary = typeof value.summary === 'string' ? value.summary.trim() : '';
        const fullPrompt = typeof value.fullPrompt === 'string' ? value.fullPrompt.trim() : '';
        const negative = typeof value.negative === 'string' ? value.negative.trim() : '';
        return summary && fullPrompt ? { summary, fullPrompt, ...(negative ? { negative } : {}) } : null;
    } catch {
        return null;
    }
}

export function buildOfficialImagePrompt(char: CharacterProfile, scene: string, selfie: boolean): string {
    const anchors = char.imageGeneration?.appearanceAnchors?.trim();
    const reference = char.imageGeneration?.referenceImage?.trim();
    return `请生成一张自然、有现场感的画面。主体是 ${char.name}，保持其一贯身份与面部特征。${anchors ? `固定外貌特征：${anchors}。` : ''}\n\n画面：${scene}\n\n${selfie ? '这是角色亲自拍摄的自拍；使用可信的手持手机前置镜头角度、自然目光和真实的拍摄距离。' : '按场景选择可信的镜头位置、构图、人物动作和相互关系，保持人物与环境的空间连续性。'}明确场景中的环境、光线、表情、服装与画风，让画面像当下这一瞬间。不要凭空指定未设定的用户长相。不要添加字幕、界面、水印、文字或多余人物。${reference ? '\n\n如需锁定角色面部，用户可自行在生图客户端附上参考脸图；本提示词没有自动上传该图片。' : ''}`;
}

export function formatPositiveNegative(fullPrompt: string, negative?: string): string {
    return `正向提示词：\n${fullPrompt.trim()}\n\n反向提示词：\n${negative?.trim() || '文字、字幕、水印、界面元素、重复人物、畸形肢体、身份不一致'}`;
}

export function linkedImagePromptIds(messages: Message[], deletedIds: Iterable<number>): number[] {
    const ids = new Set(deletedIds);
    return messages
        .filter(message => message.type === 'image_prompt' && ids.has(Number(message.metadata?.imagePrompt?.sourceAssistantMessageId)))
        .map(message => message.id);
}

export async function saveImagePromptCard(args: {
    charId: string; summary: string; fullPrompt: string; negative?: string;
    source: 'chat' | 'date'; sourceAssistantMessageId: number;
    dateEncounterId?: string; selfie?: boolean;
}): Promise<number> {
    if (!args.summary.trim() || !args.fullPrompt.trim()) throw new Error('画面摘要或提示词为空');
    return DB.saveMessage({
        charId: args.charId, role: 'assistant', type: 'image_prompt', content: args.summary.trim(),
        metadata: {
            source: args.source,
            ...(args.dateEncounterId ? { dateEncounterId: args.dateEncounterId } : {}),
            imagePrompt: {
                version: 1, source: args.source, fullPrompt: args.fullPrompt.trim(),
                ...(args.negative ? { negative: args.negative.trim() } : {}),
                sourceAssistantMessageId: args.sourceAssistantMessageId,
                ...(args.dateEncounterId ? { dateEncounterId: args.dateEncounterId } : {}),
                ...(args.selfie !== undefined ? { selfie: args.selfie } : {}),
            },
        } satisfies ImagePromptCardMeta & Record<string, unknown>,
    });
}

export async function updateImagePromptCard(message: Message, summary: string, fullPrompt: string, negative?: string): Promise<void> {
    if (!summary.trim() || !fullPrompt.trim()) throw new Error('摘要和完整提示词均不能为空');
    await DB.updateMessage(message.id, summary.trim());
    await DB.updateMessageMetadata(message.id, previous => ({
        ...previous,
        imagePrompt: {
            ...previous?.imagePrompt,
            fullPrompt: fullPrompt.trim(),
            negative: negative?.trim() || undefined,
        },
    }));
}

export async function generateImagePromptText(
    api: TextFeatureApi | null,
    char: CharacterProfile,
    context: string,
    sceneKind: 'chat' | 'date',
): Promise<{ summary: string; fullPrompt: string; negative?: string }> {
    if (!api?.baseUrl?.trim() || !api.model?.trim()) {
        throw new Error('请先配置当前角色的聊天 API 或本功能副 API');
    }
    const response = await safeFetchJson(`${api.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.apiKey || 'sk-none'}` },
        body: JSON.stringify({
            model: api.model,
            stream: false,
            temperature: api.temperature ?? 0.7,
            max_tokens: 3000,
            messages: [
                {
                    role: 'system',
                    content: `你是画面导演。只返回 JSON 对象：{"summary":"客观精练的中文画面摘要","fullPrompt":"可直接复制到生图客户端的完整自然语言指令","negative":"简短负面约束"}。目标是${sceneKind === 'date' ? '线下见面当前最新已完成场景' : '角色当轮发给用户的照片'}。理解前文连续性，但只画目标瞬间。明确主体身份、动作姿态、人物关系、镜头构图、环境光线、画风；保持角色外貌一致，避免文字水印和多余人物。不得捏造用户未设定的长相。${char.imageGeneration?.appearanceAnchors ? `角色外貌锚点：${char.imageGeneration.appearanceAnchors}` : ''}${char.dateSceneImage?.styleHint ? `画风偏好：${char.dateSceneImage.styleHint}` : ''}${char.imageGeneration?.referenceImage ? '用户可自行在生图客户端附参考脸图；不要声称已经上传。' : ''}`,
                },
                { role: 'user', content: context },
            ],
        }),
    }, 0, 60000, {
        featureId: sceneKind === 'date' ? 'dateScenePrompt' : undefined,
        appName: sceneKind === 'date' ? '见面' : '消息',
        charId: char.id,
        purpose: '生成画面提示词',
    });
    const parsed = parseImagePromptResult(extractContent(response));
    if (!parsed) throw new Error('模型未返回有效的画面摘要和完整提示词，请重试');
    return parsed;
}
