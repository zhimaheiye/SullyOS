import { describe, expect, it } from 'vitest';
import type { CharacterProfile, Message, UserProfile } from '../types';
import { ChatPrompts } from './chatPrompts';
import { formatMessageForPrompt, formatMessageWithTime, normalizeMessageContent } from './messageFormat';
import { formatOperatorAccountActivity, isOperatorAuthoredCharacterMessage } from './operatorMessageProvenance';

const message: Message = {
    id: 1, charId: 'a', role: 'assistant', type: 'text', content: '早点睡。', timestamp: 1,
    metadata: { operatorProvenance: {
        actualAuthor: 'operator', claimedSpeaker: { kind: 'character', charId: 'a' }, source: 'check-phone-hijack',
    } },
};

describe('主聊天角色账号代发 provenance', () => {
    it('DB/UI 仍是 assistant 角色侧消息，角色自身 prompt 与记忆格式改为安全账号活动', () => {
        expect(message.role).toBe('assistant');
        expect(isOperatorAuthoredCharacterMessage(message)).toBe(true);
        const safe = formatOperatorAccountActivity(message);
        expect(safe).toContain('不是你本人生成或发送');
        expect(safe).toContain('不知道是谁操作');
        expect(safe).not.toMatch(/operator|用户冒充|芝麻.*操作/);
        expect(normalizeMessageContent(message, '甲', '芝麻')).toBe(safe);
        expect(formatMessageForPrompt(message, '甲', '芝麻')).toBe(`[系统]: ${safe}`);
        expect(formatMessageWithTime(message, '甲', '芝麻', () => '00:00')).toBe(`[00:00] 系统: ${safe}`);
    });

    it('正式 ChatApp 历史把代发 assistant 投影为账号异常，不泄露幕后操作者', () => {
        const char = { id: 'a', name: '甲', timeAwarenessEnabled: false } as CharacterProfile;
        const user = { name: '芝麻' } as UserProfile;
        const { apiMessages } = ChatPrompts.buildMessageHistory([message], 10, char, user, []);
        expect(apiMessages).toHaveLength(1);
        expect(apiMessages[0].role).toBe('system');
        expect(String(apiMessages[0].content)).toContain('不是你本人生成或发送');
        expect(String(apiMessages[0].content)).toContain('你不知道是谁操作');
        expect(JSON.stringify(apiMessages)).not.toMatch(/operator|用户冒充|芝麻.*操作/);
    });

    it('用户引用代发消息时不把它标成“你之前说的”', () => {
        const char = { id: 'a', name: '甲', timeAwarenessEnabled: false } as CharacterProfile;
        const user = { name: '芝麻' } as UserProfile;
        const reply: Message = {
            id: 2, charId: 'a', role: 'user', type: 'text', content: '你还记得吗？', timestamp: 2,
            replyTo: { id: message.id, content: message.content, name: '甲' },
        };
        const { apiMessages } = ChatPrompts.buildMessageHistory([message, reply], 10, char, user, []);
        const payload = JSON.stringify(apiMessages);
        expect(payload).toContain('你的账号此前发出的（但不是你本人发送）');
        expect(payload).not.toContain('你之前说的');
    });
});
