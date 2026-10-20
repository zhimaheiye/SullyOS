import { describe, expect, it } from 'vitest';
import type { Message } from '../types';
import { ChatPrompts } from './chatPrompts';
import { formatMessageForPrompt, isMessageSemanticallyRelevant } from './messageFormat';

const char = { id: 'char-1', name: '角色' } as any;
const user = { name: '我' } as any;

const withdrawn = (caught: boolean, type: 'text' | 'emoji' = 'text'): Message => ({
    id: 1,
    charId: char.id,
    role: 'user',
    type,
    content: type === 'emoji' ? 'emoji://secret' : '绝不能泄漏的原文',
    timestamp: 1,
    metadata: {
        withdrawal: {
            by: 'user',
            withdrawnAt: 2,
            characterSawOriginal: caught,
            ...(type === 'emoji' ? { emojiName: '抱抱' } : {}),
        },
    },
});

describe('withdrawal context boundary', () => {
    it('uses the same hidden semantics in prompt, archive and memory formatting', () => {
        const message = withdrawn(false);
        const { apiMessages } = ChatPrompts.buildMessageHistory([message], 10, char, user, []);
        const chatText = JSON.stringify(apiMessages);
        const archiveText = formatMessageForPrompt(message, char.name, user.name);

        expect(chatText).toContain('不知道原文');
        expect(archiveText).toContain('不知道原文');
        expect(chatText).not.toContain(message.content);
        expect(archiveText).not.toContain(message.content);
    });

    it('keeps withdrawn emoji semantically relevant without leaking its name when missed', () => {
        const message = withdrawn(false, 'emoji');
        expect(isMessageSemanticallyRelevant(message)).toBe(true);
        const { apiMessages } = ChatPrompts.buildMessageHistory([message], 10, char, user, []);
        const text = JSON.stringify(apiMessages);
        expect(text).toContain('没看清是哪一个');
        expect(text).not.toContain('抱抱');
        expect(text).not.toContain('emoji://secret');
    });

    it('redacts a copied reply snapshot that points to an unseen withdrawn message', () => {
        const target = withdrawn(false);
        const reply: Message = {
            id: 2,
            charId: char.id,
            role: 'user',
            type: 'text',
            content: '算了',
            timestamp: 3,
            replyTo: { id: target.id, content: target.content, name: '我' },
        };
        const { apiMessages } = ChatPrompts.buildMessageHistory([target, reply], 10, char, user, []);
        const text = JSON.stringify(apiMessages);
        expect(text).toContain('引用了一条已经撤回、你未看到原文的消息');
        expect(text).not.toContain(target.content);
    });

    it('includes the original exactly as a withdrawn fact when caught', () => {
        const message = withdrawn(true);
        const { apiMessages } = ChatPrompts.buildMessageHistory([message], 10, char, user, []);
        expect(JSON.stringify(apiMessages)).toContain(message.content);
    });
});
