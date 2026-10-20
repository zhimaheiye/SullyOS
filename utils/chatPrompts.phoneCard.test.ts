import { describe, expect, it } from 'vitest';
import { ChatPrompts } from './chatPrompts';

const char = { id: 'phone-owner', name: '机主' } as any;
const user = { name: '用户' } as any;

describe('buildMessageHistory phone_card context', () => {
    it('keeps the full card body in main-chat history before the user reply', () => {
        const cardBody = '[你手机的聊天软件] 你和「阿澄」的对话：周五老地方见。';
        const messages = [
            {
                id: 1,
                charId: char.id,
                role: 'assistant',
                type: 'phone_card',
                content: cardBody,
                timestamp: Date.now() - 1000,
                metadata: { phoneCard: { app: '聊天软件', kind: 'chat', title: '阿澄' } },
            },
            {
                id: 2,
                charId: char.id,
                role: 'user',
                type: 'text',
                content: '这件事你怎么解释？',
                timestamp: Date.now(),
            },
        ] as any[];

        const { apiMessages } = ChatPrompts.buildMessageHistory(messages, 10, char, user, []);

        expect(apiMessages).toHaveLength(2);
        expect(apiMessages[0].role).toBe('assistant');
        expect(apiMessages[0].content).toContain('阿澄');
        expect(apiMessages[0].content).toContain('周五老地方见');
        expect(apiMessages[1]).toMatchObject({ role: 'user' });
        expect(apiMessages[1].content).toContain('这件事你怎么解释');
    });
});
