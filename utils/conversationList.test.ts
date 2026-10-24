import { describe, expect, it } from 'vitest';
import type { CharacterProfile, GroupProfile, Message } from '../types';
import { buildConversationSummaries, conversationMessagePreview, formatConversationTime, isConversationListMessage } from './conversationList';

const message = (id: number, timestamp: number, overrides: Partial<Message> = {}): Message => ({
    id, timestamp, charId: 'A', role: 'assistant', type: 'text', content: `消息${id}`, ...overrides,
});
const character = (id: string, avatar?: string): CharacterProfile => ({ id, name: id, avatar } as CharacterProfile);
const group = (id: string, createdAt: number): GroupProfile => ({ id, name: id, members: ['A'], createdAt });

describe('recent conversation list', () => {
    it('omits characters without messages and mixes private/group items by their effective latest time', () => {
        const result = buildConversationSummaries({
            characters: [character('A', 'avatar-a'), character('B')],
            groups: [group('G-empty', 150), group('G-live', 10)],
            privateLatest: { A: message(1, 100), B: undefined },
            groupLatest: { 'G-empty': undefined, 'G-live': message(2, 200, { groupId: 'G-live', charId: 'A' }) },
        });
        expect(result.map(item => item.id)).toEqual(['G-live', 'G-empty', 'A']);
        expect(result.find(item => item.id === 'G-empty')?.preview).toBe('暂无消息');
        expect(result.find(item => item.id === 'A')?.avatar).toBe('avatar-a');
        expect(result.some(item => item.id === 'B')).toBe(false);
    });

    it('does not expose media payloads in previews', () => {
        expect(conversationMessagePreview(message(1, 1, { type: 'image', content: 'data:image/png;base64,SECRET' }))).toBe('[图片]');
        expect(conversationMessagePreview(message(2, 2, { type: 'text', content: 'blobref:SECRET' }))).toBe('[媒体]');
    });

    it('uses the same hidden-message rules as the chat UI', () => {
        expect(isConversationListMessage(message(1, 1, { metadata: { source: 'date' } }))).toBe(false);
        expect(isConversationListMessage(message(2, 2, { metadata: { proactiveHint: true } }))).toBe(false);
        expect(isConversationListMessage(message(3, 3))).toBe(true);
    });

    it('formats today, yesterday and older dates compactly', () => {
        const now = new Date(2026, 7, 28, 12, 0);
        expect(formatConversationTime(new Date(2026, 7, 28, 9, 5).getTime(), now)).toBe('09:05');
        expect(formatConversationTime(new Date(2026, 7, 27, 20, 0).getTime(), now)).toBe('昨天');
        expect(formatConversationTime(new Date(2026, 6, 3, 20, 0).getTime(), now)).toBe('7月3日');
    });
});
