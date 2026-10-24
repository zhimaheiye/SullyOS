import type { Emoji } from '../types';

export interface EmojiTriggerMatch {
    query: string;
    triggerStart: number;
}

export function resolveEmojiTrigger(value: string, cursorPosition: number | null): EmojiTriggerMatch | null {
    const cursor = cursorPosition ?? value.length;
    const triggerStart = value.lastIndexOf('[', cursor - 1);
    if (triggerStart < 0) return null;

    const query = value.slice(triggerStart + 1, cursor);
    if (!query || /[\s\[\]]/.test(query)) return null;
    return { query, triggerStart };
}

export function removeEmojiTrigger(value: string, trigger: EmojiTriggerMatch): string {
    const triggerEnd = trigger.triggerStart + trigger.query.length + 1;
    return value.slice(0, trigger.triggerStart) + value.slice(triggerEnd);
}

export function filterTriggeredEmojis(emojis: Emoji[], query: string, limit = 20): Emoji[] {
    const normalizedQuery = query.toLocaleLowerCase();
    return emojis
        .filter(emoji => emoji.name.toLocaleLowerCase().includes(normalizedQuery))
        .sort((a, b) => (b.lastUsedAt || 0) - (a.lastUsedAt || 0))
        .slice(0, limit);
}
