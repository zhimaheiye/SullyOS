import { describe, expect, it } from 'vitest';
import { DB } from './db';
import { filterTriggeredEmojis, removeEmojiTrigger, resolveEmojiTrigger } from './emojiTrigger';

describe('emoji trigger', () => {
    it('only opens after [ plus a continuous query at the cursor', () => {
        expect(resolveEmojiTrigger('[', 1)).toBeNull();
        expect(resolveEmojiTrigger('[想哭', 3)).toEqual({ query: '想哭', triggerStart: 0 });
        expect(resolveEmojiTrigger('[想 哭', 4)).toBeNull();
        expect(resolveEmojiTrigger('先说[想哭再说', 5)).toEqual({ query: '想哭', triggerStart: 2 });
    });

    it('removes only the active trigger fragment and keeps surrounding text', () => {
        const value = '前文[想哭后文';
        const trigger = resolveEmojiTrigger(value, 5);
        expect(trigger && removeEmojiTrigger(value, trigger)).toBe('前文后文');
    });

    it('filters by name and puts recently used matches first', () => {
        const emojis = [
            { name: '想哭一下', url: 'old', lastUsedAt: 1 },
            { name: '忍住不哭', url: 'new', lastUsedAt: 9 },
            { name: '开心', url: 'other', lastUsedAt: 20 },
        ];
        expect(filterTriggeredEmojis(emojis, '哭').map(item => item.url)).toEqual(['new', 'old']);
    });

    it('persists the last-used timestamp without changing the emoji itself', async () => {
        const name = `trigger-${Date.now()}`;
        await DB.saveEmoji(name, 'emoji-url', 'default');
        await DB.touchEmoji(name, 12345);
        expect((await DB.getEmojis()).find(item => item.name === name)).toMatchObject({
            name,
            url: 'emoji-url',
            categoryId: 'default',
            lastUsedAt: 12345,
        });
        await DB.deleteEmoji(name);
    });
});
