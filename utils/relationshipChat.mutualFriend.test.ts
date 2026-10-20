import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterProfile, Message, UserProfile } from '../types';
import { loadCharacterContextMessages } from './chatContextRange';
import { injectMemoryPalace } from './memoryPalace/pipeline';
import { flipTranscript, runRealConversation } from './relationshipChat';

vi.mock('./chatContextRange', () => ({ loadCharacterContextMessages: vi.fn() }));
vi.mock('./memoryPalace/pipeline', () => ({ injectMemoryPalace: vi.fn() }));
vi.mock('./db', () => ({ DB: { getRecentMessagesByCharId: vi.fn(async () => []) } }));

const user = { name: 'CANONICAL_USER_SECRET', bio: 'GLOBAL_PROFILE_SECRET' } as UserProfile;
const makeChar = (id: string, name: string): CharacterProfile => ({
    id, name, avatar: '', description: '', memories: [],
    timeAwarenessEnabled: false, memoryPalaceEnabled: true,
    systemPrompt: `我是{{char}}，我与{{user}}相识。${id}_PERSONALITY`,
    worldview: `${id}_WORLD，与{{user}}共同生活。`,
    refinedMemories: { '2026-09': `${id}_PRIVATE_MEMORY` },
    impression: { personality_core: { summary: `${id}_PRIVATE_IMPRESSION` } } as CharacterProfile['impression'],
    memoryPalaceInjection: `${id}_STALE_RECALL`, roomPlatesInjection: `${id}_STALE_PLATES`,
});
const makeParams = () => ({
    a: makeChar('a', '甲'), b: makeChar('b', '乙'), user,
    api: { baseUrl: 'https://fixture.invalid', apiKey: 'test', model: 'test' },
    affinityA: 12, affinityB: -5,
    bNote: 'A_NOTE_FOR_B', aNote: 'B_NOTE_FOR_A',
    bLearned: 'A_OLD_LEARNED', aLearned: 'B_OLD_LEARNED',
    aSummary: 'A_TOPIC_SUMMARY', bSummary: 'B_TOPIC_SUMMARY',
});
const transcriptBlocks = (count: number, linesPerBlock = 1): string => Array.from({ length: count }, (_, block) =>
    Array.from({ length: linesPerBlock }, (_, line) => `${block % 2 ? '对方' : '我'}: 第 ${block + 1} 次发言第 ${line + 1} 条`).join('\n'),
).join('\n');
let prompts: string[];

beforeEach(() => {
    prompts = [];
    vi.mocked(loadCharacterContextMessages).mockImplementation(async char => [{
        charId: typeof char === 'string' ? char : char.id, role: 'user', type: 'text',
        content: `${typeof char === 'string' ? char : char.id}_PRIVATE_CHAT`, timestamp: 1,
    } as Message]);
    vi.mocked(injectMemoryPalace).mockImplementation(async (char, _recent, other, label) => {
        char.memoryPalaceInjection = `${char.id}_RECALLED_FOR_${other}_${label}`;
        char.roomPlatesInjection = `${char.id}_PLATES_FOR_${label}`;
        return {} as Awaited<ReturnType<typeof injectMemoryPalace>>;
    });
    vi.stubGlobal('fetch', vi.fn(async (_url, init) => {
        const prompt = JSON.parse(String(init?.body)).messages.map((message: { content: string }) => message.content).join('\n');
        prompts.push(prompt);
        const reply = prompts.length % 2 ? '甲: A_ACTUAL_MESSAGE\n再说一句\n[[Δ:+3]]\n[[了解:乙也认识那个人]]'
            : '乙: B_ACTUAL_MESSAGE\n[[Δ:-2]]\n[[了解:甲也认识那个人]]';
        return new Response(JSON.stringify({ choices: [{ message: { content: reply } }] }));
    }));
});
afterEach(() => { vi.clearAllMocks(); vi.unstubAllGlobals(); });

describe('真人私聊共同好友分支', () => {
    it('两侧隔离统一身份，保留本人上下文/旧资料，仍仅 A 发 B 回并镜像且不写 learned', async () => {
        const params = makeParams();
        const aBefore = { ...params.a };
        const bBefore = { ...params.b };
        const result = await runRealConversation({ ...params, mode: 'mutual-friend', existingDetail: '我: 已交换的线索\n对方: 对上了' });
        expect(prompts).toHaveLength(2);
        for (const prompt of prompts) {
            expect(prompt).not.toContain(user.name);
            expect(prompt).not.toContain(user.bio);
            for (const rule of ['导演事实 ≠ 角色知识', '不是角色初始知识', '不能当现实称呼说出口',
                '系统内部 user 名称', '不得读取或偷偷引用另一角色与用户的私聊', '不得虚构不存在的共同经历',
                '每一轮都应自然地产生一点新的辨认进展', '称呼不要求同名', '证据已经充分时允许自然确认', '不要下一轮重新认一次']) {
                expect(prompt).toContain(rule);
            }
            expect(prompt).not.toContain('不要求本轮推进或认出');
            expect(prompt).toContain('已交换的线索');
            expect(prompt).toContain('对上了');
            expect(prompt).not.toContain('_STALE_');
        }
        expect(prompts[0]).toContain('那个人: a_PRIVATE_CHAT');
        expect(prompts[1]).toContain('那个人: b_PRIVATE_CHAT');
        for (const token of ['a_PERSONALITY', 'a_WORLD', 'a_PRIVATE_MEMORY', 'a_PRIVATE_IMPRESSION', 'a_RECALLED', 'a_PLATES', 'A_NOTE_FOR_B', 'A_OLD_LEARNED', 'A_TOPIC_SUMMARY', '12（']) expect(prompts[0]).toContain(token);
        for (const token of ['b_PERSONALITY', 'b_WORLD', 'b_PRIVATE_MEMORY', 'b_PRIVATE_IMPRESSION', 'b_RECALLED', 'b_PLATES', 'B_NOTE_FOR_A', 'B_OLD_LEARNED', 'B_TOPIC_SUMMARY', '-5（']) expect(prompts[1]).toContain(token);
        expect(prompts[0]).not.toMatch(/b_PRIVATE_CHAT|b_PRIVATE_MEMORY|b_PRIVATE_IMPRESSION|b_RECALLED|B_NOTE_FOR_A|B_OLD_LEARNED|B_TOPIC_SUMMARY/);
        expect(prompts[1]).not.toMatch(/a_PRIVATE_CHAT|a_PRIVATE_MEMORY|a_PRIVATE_IMPRESSION|a_RECALLED|A_NOTE_FOR_B|A_OLD_LEARNED|A_TOPIC_SUMMARY/);
        expect(prompts[1]).toContain('甲: A_ACTUAL_MESSAGE');
        expect(prompts[1]).not.toContain('[[了解:乙也认识那个人]]');
        expect(result).toMatchObject({ aDelta: 3, bDelta: -2, aLearnedNew: '', bLearnedNew: '' });
        expect(result.aDetail).toBe('我: 已交换的线索\n对方: 对上了\n我: A_ACTUAL_MESSAGE\n我: 再说一句\n对方: B_ACTUAL_MESSAGE');
        expect(result.bDetail).toBe(flipTranscript(result.aDetail));
        expect(params.a).toEqual(aBefore);
        expect(params.b).toEqual(bBefore);
        expect(user).toEqual({ name: 'CANONICAL_USER_SECRET', bio: 'GLOBAL_PROFILE_SECRET' });
        expect(vi.mocked(injectMemoryPalace).mock.calls[0][0]).not.toBe(params.a);
        expect(vi.mocked(injectMemoryPalace).mock.calls[1][0]).not.toBe(params.b);
    });

    it('真实聊天或记忆正文里的姓名/昵称不做字符串替换', async () => {
        const params = makeParams();
        params.a.refinedMemories = { '2026-09': `我见过${user.name}，我叫她广陵王。` };
        vi.mocked(loadCharacterContextMessages).mockImplementation(async char => [{
            charId: typeof char === 'string' ? char : char.id, role: 'user', type: 'text', content: `我叫${user.name}。`, timestamp: 1,
        } as Message]);
        await runRealConversation({ ...params, mode: 'mutual-friend' });
        expect(prompts[0]).toContain(`那个人: 我叫${user.name}。`);
        expect(prompts[0]).toContain(`我见过${user.name}，我叫她广陵王。`);
        expect(prompts[0]).not.toContain(`- 名字: ${user.name}`);
    });

    it('开场要求具体线索和每轮进展，但不准第一句直接认出', async () => {
        await runRealConversation({ ...makeParams(), mode: 'mutual-friend' });
        for (const prompt of prompts) {
            expect(prompt).toContain('每一轮都应自然地产生一点新的辨认进展');
            expect(prompt).toContain('具体、高辨识度');
            expect(prompt).toContain('不要输出这个分析');
            expect(prompt).toContain('起步阶段');
            expect(prompt).toContain('不必马上怀疑');
            expect(prompt).not.toContain('进度已经明显拖延');
        }
    });

    it('多行连发按连续说话人块计数，约两次往返后开始比较和针对性试探', async () => {
        await runRealConversation({ ...makeParams(), mode: 'mutual-friend', existingDetail: transcriptBlocks(4, 5) });
        for (const prompt of prompts) {
            expect(prompt).toContain('发展阶段');
            expect(prompt).toContain('比较已经交换的具体信息');
            expect(prompt).toContain('针对性');
            expect(prompt).not.toContain('进度已经明显拖延');
        }
        prompts = [];
        await runRealConversation({ ...makeParams(), mode: 'mutual-friend', existingDetail: transcriptBlocks(1, 20) });
        expect(prompts[0]).toContain('起步阶段');
        expect(prompts[0]).not.toContain('发展阶段');
    });

    it('四至八个往返尚未认亲时收束，明显拖延时要求强线索或明确验证', async () => {
        await runRealConversation({ ...makeParams(), mode: 'mutual-friend', existingDetail: transcriptBlocks(10) });
        for (const prompt of prompts) {
            expect(prompt).toContain('应当收束阶段');
            expect(prompt).toContain('更高辨识度');
            expect(prompt).toContain('确认身份的问题');
        }
        prompts = [];
        await runRealConversation({ ...makeParams(), mode: 'mutual-friend', existingDetail: transcriptBlocks(18) });
        for (const prompt of prompts) {
            expect(prompt).toContain('进度已经明显拖延');
            expect(prompt).toContain('不要继续进行与身份发现无关的闲聊');
            expect(prompt).toContain('最有辨识度的信息');
            expect(prompt).toContain('明确验证');
        }
    });

    it('transcript 已明确确认同一人后停止初次认亲压力，继续承接已知关系', async () => {
        const existingDetail = `${transcriptBlocks(18)}\n我: 原来我们认识的是同一个人。`;
        await runRealConversation({ ...makeParams(), mode: 'mutual-friend', existingDetail });
        for (const prompt of prompts) {
            expect(prompt).toContain('已确认后的对话');
            expect(prompt).toContain('不要下一轮重新认一次');
            expect(prompt).not.toContain('进度已经明显拖延');
            expect(prompt).not.toContain('在这一轮完成确认');
        }
    });

    it('疑似同一个人的提问不算已认亲，确认后接着追问也不重新加压', async () => {
        const longChat = transcriptBlocks(18);
        prompts.length = 0;
        await runRealConversation({ ...makeParams(), mode: 'mutual-friend', existingDetail: `${longChat}\n我: 难道我们认识的是同一个人？` });
        expect(prompts[0]).toContain('进度已经明显拖延');

        prompts.length = 0;
        await runRealConversation({ ...makeParams(), mode: 'mutual-friend', existingDetail: `${longChat}\n我: 原来我们认识的是同一个人！你怎么认识她的？` });
        expect(prompts[0]).toContain('已确认后的对话');
        expect(prompts[0]).not.toContain('进度已经明显拖延');
    });

    it('省略 mode 和显式 free 产生完全相同的旧 prompt，动机/了解与原始 context 行为保持', async () => {
        const params = makeParams();
        const implicit = await runRealConversation(params);
        const implicitPrompts = [...prompts];
        prompts = [];
        const explicit = await runRealConversation({ ...makeParams(), mode: 'free' });
        expect(prompts).toEqual(implicitPrompts);
        expect({ ...explicit, conversationTurns: undefined }).toEqual({ ...implicit, conversationTurns: undefined });
        expect(explicit.conversationTurns.map(({ id: _id, createdAt: _createdAt, ...turn }) => turn))
            .toEqual(implicit.conversationTurns.map(({ id: _id, createdAt: _createdAt, ...turn }) => turn));
        expect(implicit).toMatchObject({ aLearnedNew: '乙也认识那个人', bLearnedNew: '甲也认识那个人', aDelta: 3, bDelta: -2 });
        expect(prompts[0]).toContain('先想清楚这次的动机');
        expect(prompts[1]).toContain('别一味迎合、也别无故敌对');
        for (const prompt of prompts) {
            expect(prompt).toContain(`你和用户「${user.name}」的私聊背景（仅供参考，不是这场对话）`);
            expect(prompt).toContain(user.bio);
            expect(prompt).toContain('[[了解:一句话]]');
            expect(prompt).not.toContain('导演事实');
            expect(prompt).not.toContain('共同好友 ·');
            expect(prompt).not.toContain('【你认识的那个人】');
        }
        expect(vi.mocked(injectMemoryPalace).mock.calls[0][0]).toBe(params.a);
        expect(vi.mocked(injectMemoryPalace).mock.calls[1][0]).toBe(params.b);
    });

    it('共同好友召回失败丢弃 clone 的旧注入，仍能完成两次消息生成', async () => {
        vi.mocked(injectMemoryPalace).mockRejectedValue(new Error('recall unavailable'));
        const params = makeParams();
        await runRealConversation({ ...params, mode: 'mutual-friend' });
        expect(prompts).toHaveLength(2);
        expect(prompts.join('\n')).not.toContain('_STALE_');
        expect(params.a.memoryPalaceInjection).toBe('a_STALE_RECALL');
        expect(params.b.roomPlatesInjection).toBe('b_STALE_PLATES');
    });
});
