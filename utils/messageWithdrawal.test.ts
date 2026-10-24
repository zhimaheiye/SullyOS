import { describe, expect, it } from 'vitest';
import type { Message } from '../types';
import { formatWithdrawalForCharacterContext, stripWithdrawalMarkup } from './messageWithdrawal';

const message = (overrides: Partial<Message> = {}): Message => ({
    id: 1,
    charId: 'char-1',
    role: 'user',
    type: 'text',
    content: '不能泄漏的原文',
    timestamp: 1,
    ...overrides,
});

describe('withdrawal privacy formatting', () => {
    it('never exposes text or emoji name when the character missed the original', () => {
        const hiddenText = message({ metadata: { withdrawal: { by: 'user', withdrawnAt: 2, characterSawOriginal: false } } });
        const hiddenEmoji = message({
            type: 'emoji',
            content: 'secret-url',
            metadata: { withdrawal: { by: 'user', withdrawnAt: 2, characterSawOriginal: false, emojiName: '抱抱' } },
        });
        const textContext = formatWithdrawalForCharacterContext(hiddenText)!;
        const emojiContext = formatWithdrawalForCharacterContext(hiddenEmoji)!;
        expect(textContext).not.toContain(hiddenText.content);
        expect(emojiContext).not.toContain('抱抱');
        expect(emojiContext).not.toContain('secret-url');
    });

    it('keeps the original available when caught or withdrawn by the assistant', () => {
        const caught = message({ metadata: { withdrawal: { by: 'user', withdrawnAt: 2, characterSawOriginal: true } } });
        const assistant = message({ role: 'assistant', metadata: { withdrawal: { by: 'assistant', withdrawnAt: 2, characterSawOriginal: true } } });
        expect(formatWithdrawalForCharacterContext(caught)).toContain(caught.content);
        expect(formatWithdrawalForCharacterContext(assistant)).toContain(assistant.content);
    });
});

describe('legacy withdrawal markup', () => {
    it('drops the hidden text instead of turning it into a normal bubble', () => {
        expect(stripWithdrawalMarkup('A\n[[WITHDRAW_TEXT]]绝密[[/WITHDRAW_TEXT]]\nC\n[[WITHDRAW_EMOJI: 抱抱]]')).toBe('A\n\nC\n');
    });
});
