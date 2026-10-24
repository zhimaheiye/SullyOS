import type { Emoji, EmojiCategory, Message } from '../types';
import { isBlobRef } from './blobRef';
import { readStickerVision, readStickerVisionDescription, readStickerVisionName } from './stickerVision';

export const MAX_INDIVIDUAL_FORWARD = 100;

export type IndividualForwardMessage = {
    charId: string;
    role: 'user';
    type: 'text' | 'image' | 'emoji';
    content: string;
    metadata?: { stickerVision: { eligible: true; name: string; description: string } };
};

export type IndividualForwardPlan = {
    selectedCount: number;
    messages: IndividualForwardMessage[];
    skippedCount: number;
};

const isSafeDataImage = (value: string): boolean =>
    /^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(value);
const isSafeEmojiImage = (value: string): boolean =>
    isBlobRef(value) || isSafeDataImage(value) || /^https?:\/\/[^\s]+$/i.test(value);

/** Whitelist only ordinary chat payloads. Historical metadata never crosses characters. */
export function planIndividualForward(
    selected: Message[], sourceCharId: string, targetCharId: string,
    emojis: Emoji[], categories: EmojiCategory[],
): IndividualForwardPlan {
    const hiddenCategories = new Set(categories.filter(category =>
        category.allowedCharacterIds?.length && !category.allowedCharacterIds.includes(targetCharId),
    ).map(category => category.id));
    const visibleEmojiUrls = new Set(emojis.filter(emoji =>
        !emoji.categoryId || !hiddenCategories.has(emoji.categoryId),
    ).map(emoji => emoji.url));
    const messages: IndividualForwardMessage[] = [];
    const ordered = [...selected].sort((a, b) => a.id - b.id);
    for (const message of ordered) {
        if (message.charId !== sourceCharId || message.groupId || message.role === 'system'
            || message.metadata?.withdrawal || message.metadata?.source
            || message.metadata?.toolTrace || message.metadata?.toolCalls || message.metadata?.toolResult
            || message.metadata?.interaction || message.metadata?.transfer
            || typeof message.content !== 'string') continue;
        if (message.type === 'text' && message.content.length > 0) {
            messages.push({ charId: targetCharId, role: 'user', type: 'text', content: message.content });
        } else if (message.type === 'image'
            && (isBlobRef(message.content) || isSafeDataImage(message.content))
            && !message.metadata?.imageDirective && !message.metadata?.source) {
            messages.push({ charId: targetCharId, role: 'user', type: 'image', content: message.content });
        } else if (message.type === 'emoji' && visibleEmojiUrls.has(message.content)
            && isSafeEmojiImage(message.content)) {
            const description = readStickerVisionDescription(message);
            const metadata = readStickerVision(message) && description
                ? { stickerVision: { eligible: true as const, name: readStickerVisionName(message, emojis), description } }
                : undefined;
            messages.push({ charId: targetCharId, role: 'user', type: 'emoji', content: message.content,
                ...(metadata ? { metadata } : {}) });
        }
    }
    return { selectedCount: selected.length, messages, skippedCount: selected.length - messages.length };
}

/** Blob references may be stale even when their token syntax is valid. */
export async function validateIndividualForwardMedia(
    plan: IndividualForwardPlan,
    readBlob: (ref: string) => Promise<Blob | null>,
): Promise<IndividualForwardPlan> {
    const messages: IndividualForwardMessage[] = [];
    for (const message of plan.messages) {
        if ((message.type === 'image' || message.type === 'emoji') && isBlobRef(message.content)) {
            const blob = await readBlob(message.content);
            if (!blob || !blob.type.startsWith('image/')) continue;
        }
        messages.push(message);
    }
    return { selectedCount: plan.selectedCount, messages, skippedCount: plan.selectedCount - messages.length };
}
