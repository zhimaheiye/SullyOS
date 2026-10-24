import { describe, expect, it, vi } from 'vitest';
import type { CharacterProfile, Emoji, EmojiCategory, Message, UserProfile } from '../types';
import { DB } from './db';
import { ChatPrompts } from './chatPrompts';
import { planIndividualForward, validateIndividualForwardMedia } from './chatForwardIndividual';

const message = (id: number, role: Message['role'], type: Message['type'], content: string,
    metadata?: Message['metadata']): Message => ({ id, charId: 'A', role, type, content, timestamp: 100 + id, metadata });

const emojis: Emoji[] = [
    { name: '通用', url: 'https://example.test/common.png', categoryId: 'public' },
    { name: '私有', url: 'https://example.test/private.png', categoryId: 'onlyA' },
];
const categories: EmojiCategory[] = [
    { id: 'public', name: '公共' },
    { id: 'onlyA', name: '私有', allowedCharacterIds: ['A'] },
];

describe('逐条转发 payload', () => {
    it('只把选中消息按原顺序变成目标独立 user 消息，保留文本换行且不携带内部 metadata', () => {
        const selected = [
            message(8, 'assistant', 'text', '角色原话\n第二行', { thinkingChain: '秘密', toolTrace: undefined }),
            message(2, 'user', 'text', '你好🌙'),
            message(5, 'user', 'image', 'data:image/png;base64,AAAA'),
        ];
        const plan = planIndividualForward(selected, 'A', 'B', emojis, categories);
        expect(plan.skippedCount).toBe(0);
        expect(plan.messages).toEqual([
            { charId: 'B', role: 'user', type: 'text', content: '你好🌙' },
            { charId: 'B', role: 'user', type: 'image', content: 'data:image/png;base64,AAAA' },
            { charId: 'B', role: 'user', type: 'text', content: '角色原话\n第二行' },
        ]);
        expect(selected[0].role).toBe('assistant');
        expect(selected[0].metadata?.thinkingChain).toBe('秘密');
    });

    it('拒绝系统、撤回、工具、卡片、坏图片与跨角色私有表情；只保留可见表情的安全视觉快照', () => {
        const selected = [
            message(1, 'system', 'text', '系统消息'),
            message(2, 'user', 'text', '已撤回', { withdrawal: { by: 'user' } }),
            message(3, 'assistant', 'text', '工具输出', { toolTrace: [{ secret: 1 }] }),
            message(4, 'user', 'transfer', '转账'),
            message(5, 'user', 'chat_forward', '{}'),
            message(6, 'user', 'image', 'blob:private-sandbox'),
            message(7, 'assistant', 'emoji', 'https://example.test/private.png'),
            message(8, 'assistant', 'emoji', 'https://example.test/common.png', {
                thinkingChain: '秘密', stickerVision: { eligible: true, name: '通用', description: '画面描述', model: 'private' },
            }),
        ];
        const plan = planIndividualForward(selected, 'A', 'B', emojis, categories);
        expect(plan.skippedCount).toBe(7);
        expect(plan.messages).toEqual([{
            charId: 'B', role: 'user', type: 'emoji', content: 'https://example.test/common.png',
            metadata: { stickerVision: { eligible: true, name: '通用', description: '画面描述' } },
        }]);
    });

    it('检查 blob 是否存在，缺失媒体按不支持计数', async () => {
        const plan = planIndividualForward([
            message(1, 'user', 'text', '保留'),
            message(2, 'user', 'image', 'blobref:gone'),
        ], 'A', 'B', emojis, categories);
        const readBlob = vi.fn(async () => null);
        const validated = await validateIndividualForwardMedia(plan, readBlob);
        expect(readBlob).toHaveBeenCalledOnce();
        expect(validated.messages).toHaveLength(1);
        expect(validated.skippedCount).toBe(1);
    });

    it('全是不可转发类型时不产生目标消息', async () => {
        const plan = planIndividualForward([
            message(1, 'system', 'text', '内部记录'),
            message(2, 'user', 'transfer', '红包'),
            message(3, 'assistant', 'image', 'blob:temporary'),
        ], 'A', 'B', emojis, categories);
        expect(plan.selectedCount).toBe(3);
        expect(plan.messages).toEqual([]);
        expect(plan.skippedCount).toBe(3);
        expect(await DB.saveMessagesAtomic([])).toEqual([]);
    });
});

describe('逐条转发批量落库', () => {
    it('一次事务保存多个新 ID，来源不变，失败整批回滚', async () => {
        const sourceId = await DB.saveMessage({ charId: 'forward-test-A', role: 'assistant', type: 'text', content: '原文' });
        const ids = await DB.saveMessagesAtomic([
            { charId: 'forward-test-B', role: 'user', type: 'text', content: '甲', timestamp: 1000 },
            { charId: 'forward-test-B', role: 'user', type: 'text', content: '乙\n🌙', timestamp: 1001 },
        ]);
        expect(ids).toHaveLength(2);
        expect(ids[0]).not.toBe(ids[1]);
        expect((await DB.getMessagesByCharId('forward-test-B')).map(row => [row.id, row.role, row.content, row.timestamp]))
            .toEqual([[ids[0], 'user', '甲', 1000], [ids[1], 'user', '乙\n🌙', 1001]]);
        expect((await DB.getMessagesByCharId('forward-test-A')).map(row => row.id)).toEqual([sourceId]);
        const history = ChatPrompts.buildMessageHistory(
            await DB.getMessagesByCharId('forward-test-B'), 10,
            { id: 'forward-test-B', name: '乙角色' } as CharacterProfile,
            { name: '我' } as UserProfile, [], undefined, { timeAwarenessEnabled: false },
        ).apiMessages;
        expect(history.filter(row => row.role === 'user')).toHaveLength(2);
        expect(history.map(row => row.content).join('\n')).toContain('乙\n🌙');

        await expect(DB.saveMessagesAtomic([
            { charId: 'forward-test-B', role: 'user', type: 'text', content: '不能留下' },
            { charId: 'forward-test-B', role: 'user', type: 'text', content: (() => 1) as unknown as string },
        ])).rejects.toBeTruthy();
        expect((await DB.getMessagesByCharId('forward-test-B')).map(row => row.content)).toEqual(['甲', '乙\n🌙']);
        await DB.deleteMessages([sourceId, ...ids]);
    });
});
