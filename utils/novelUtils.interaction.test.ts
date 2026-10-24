import { describe, expect, it, vi } from 'vitest';
import type { CharacterProfile, NovelBook, NovelSegment, UserProfile } from '../types';

vi.mock('./context', () => ({
    ContextBuilder: { buildCoreContext: () => 'CORE CONTEXT' },
}));

import {
    buildNovelInteractionContext,
    buildNovelTurnInstruction,
    buildPrompt,
    createUserNovelSegment,
    hasSelectedGenerationTask,
} from './novelUtils';

const character = { id: 'char-a', name: '角色A', description: '' } as CharacterProfile;
const userProfile: UserProfile = { name: '芝麻', avatar: '', bio: '' };
const book = {
    id: 'book-1',
    title: '测试小说',
    summary: '',
    coverStyle: 'sakura',
    worldSetting: '测试世界',
    collaboratorIds: [character.id],
    protagonists: [],
    segments: [],
    createdAt: 1,
    lastActiveAt: 1,
} as NovelBook;

const options = (patch: Partial<{ write: boolean; comment: boolean; analyze: boolean }> = {}) => ({
    write: false,
    comment: false,
    analyze: false,
    ...patch,
});

const segment = (
    id: string,
    content: string,
    patch: Partial<NovelSegment>,
): NovelSegment => ({
    id,
    authorId: character.id,
    content,
    timestamp: Number(id.replace(/\D/g, '')) || 1,
    type: 'story',
    role: 'writer',
    ...patch,
});

const promptFor = (
    generationOptions: ReturnType<typeof options>,
    userText = '',
    storyContext = '已有上下文',
) => buildPrompt(
    character,
    userProfile,
    book,
    userText,
    storyContext,
    generationOptions,
    [],
    [character],
);

describe('小说共创的组合生成语义', () => {
    it('只选吐槽且空输入时直接发表看法，不要求续写', () => {
        const prompt = promptFor(options({ comment: true }));
        expect(prompt).toContain('直接发表吐槽/感想和看法');
        expect(prompt).not.toContain('请根据上文自然续写');
        expect(prompt).toContain('"comment"');
    });

    it('只选分析且空输入时直接分析已有上下文', () => {
        const prompt = promptFor(options({ analyze: true }));
        expect(prompt).toContain('直接进行深度分析');
        expect(prompt).toContain('不要要求用户补充或重新提出问题');
        expect(prompt).toContain('不是把自己视为小说事件的亲历者');
        expect(prompt).toContain('现实中你和芝麻的关系只影响讨论语气');
        expect(prompt).toContain('"analysis"');
    });

    it('吐槽与分析可在空输入时组合请求', () => {
        const prompt = promptFor(options({ comment: true, analyze: true }));
        expect(prompt).toContain('"comment"');
        expect(prompt).toContain('"analysis"');
        expect(prompt).not.toContain('"writer"');
    });

    it('空输入续写保持自然续写语义，并可组合吐槽', () => {
        expect(buildNovelTurnInstruction('', options({ write: true }))).toContain('自然续写正文');
        const prompt = promptFor(options({ write: true, comment: true }));
        expect(prompt).toContain('自然续写正文');
        expect(prompt).toContain('"writer"');
        expect(prompt).toContain('"comment"');
    });

    it('仅根据是否存在生成任务决定可发送', () => {
        expect(hasSelectedGenerationTask(options())).toBe(false);
        expect(hasSelectedGenerationTask(options({ write: true }))).toBe(true);
        expect(hasSelectedGenerationTask(options({ comment: true }))).toBe(true);
        expect(hasSelectedGenerationTask(options({ analyze: true }))).toBe(true);
    });

    it('同名作品人物仍与现实角色和用户保持虚构边界', () => {
        const prompt = promptFor(
            options({ comment: true }),
            '',
            '[正文｜芝麻]\n芝麻推开角色A的手，独自离开了房间。',
        );

        expect(prompt).toContain('角色与关系上下文只提供评论者的人格和现实互动语气，不提供小说事实');
        expect(prompt).toContain('小说《测试小说》中的正文、人物、事件、关系和经历都属于虚构作品');
        expect(prompt).toContain('即使作品人物与你、芝麻或其他现实互动对象同名');
        expect(prompt).toContain('角色视角是“你作为作者/读者的视角”，不是“你作为剧中亲历者的视角”');
        expect(prompt).toContain('不要把作品人物关系自动等同于现实关系或共同记忆');
        expect(prompt).toContain('作品里的我居然就这么让你走了？这写得不像我');
        expect(prompt).toContain('“第一人称”只表示发表评论的人是你，不代表你亲身经历了小说中的事件');
    });
});

describe('小说段落分类与章节上下文', () => {
    it('按续写开关将用户文字保存为正文或讨论，空输入不造消息', () => {
        expect(createUserNovelSegment('  创作指令  ', options({ write: true }), 10)).toMatchObject({
            role: 'writer', type: 'story', content: '创作指令', timestamp: 10,
        });
        expect(createUserNovelSegment('  我的看法  ', options({ comment: true }), 11)).toMatchObject({
            role: 'commenter', type: 'discussion', content: '我的看法', timestamp: 11,
        });
        expect(createUserNovelSegment('分析一下', options({ analyze: true }), 12)).toMatchObject({
            role: 'commenter', type: 'discussion', content: '分析一下', timestamp: 12,
        });
        expect(createUserNovelSegment('   ', options({ comment: true }), 13)).toBeNull();
        expect(createUserNovelSegment('有文字', options(), 14)).toBeNull();
    });

    it('保留当前章节正文、讨论、吐槽和分析的真实顺序与语义标签', () => {
        const context = buildNovelInteractionContext([
            segment('s1', '正文一', { authorId: 'user' }),
            segment('s2', '用户讨论', { authorId: 'user', role: 'commenter', type: 'discussion' }),
            segment('s3', '角色分析', { role: 'analyst', type: 'analysis' }),
            segment('s4', '角色吐槽', { role: 'commenter', type: 'discussion' }),
        ], [character], userProfile);

        const orderedMarkers = ['[正文｜芝麻]', '[讨论｜芝麻]', '[分析｜角色A]', '[吐槽｜角色A]'];
        orderedMarkers.reduce((previousIndex, marker) => {
            const currentIndex = context.indexOf(marker);
            expect(currentIndex).toBeGreaterThan(previousIndex);
            return currentIndex;
        }, -1);
    });

    it('历史章节只带总结，当前章节保留完整互动', () => {
        const context = buildNovelInteractionContext([
            segment('s1', '旧正文秘密', {}),
            segment('s2', '旧讨论秘密', { role: 'commenter', type: 'discussion' }),
            segment('s3', '旧分析秘密', { role: 'analyst', type: 'analysis' }),
            segment('s4', '第一章摘要', { authorId: 'system', role: 'analyst', type: 'analysis', focus: 'chapter_summary' }),
            segment('s5', '新正文', {}),
            segment('s6', '新讨论', { authorId: 'user', role: 'commenter', type: 'discussion' }),
        ], [character], userProfile);

        expect(context).toContain('第1章总结：\n第一章摘要');
        expect(context).not.toContain('旧正文秘密');
        expect(context).not.toContain('旧讨论秘密');
        expect(context).not.toContain('旧分析秘密');
        expect(context).toContain('新正文');
        expect(context).toContain('新讨论');
    });
});
