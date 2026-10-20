import { describe, expect, it } from 'vitest';
import type { CharacterProfile } from '../types';
import {
    analyzeWriterPersonaSimple,
    buildWriterPersonaPrompt,
    extractWritingTaboos,
    extractWritingTags,
    generateWriterPersonaDeep,
    getFewShotExamples,
    writerPersonaSettingsBlock,
} from './novelUtils';

const character = (overrides: Partial<CharacterProfile> = {}): CharacterProfile => ({
    id: 'kiki',
    name: 'Kiki',
    avatar: '',
    description: '温柔、细腻，喜欢观察自然与人的微小情绪。',
    systemPrompt: '性格安静克制，表达含蓄，习惯先观察再行动。',
    worldview: '在海边小镇长大，熟悉植物、潮汐与手工绘画。',
    memories: [{ date: '2026-08-28', summary: '芝麻最近一直在研究物联网、MCP、API、编程与数据库。' } as any],
    impression: {
        version: 1,
        value_map: { likes: ['自动化', '数据库'], dislikes: [], core_values: '技术效率' },
        behavior_profile: { tone_style: '技术讨论', emotion_summary: '', response_patterns: '总在聊 API' },
        emotion_schema: {
            triggers: { positive: [], negative: [] },
            comfort_zone: '',
            stress_signals: [],
        },
        personality_core: {
            observed_traits: ['程序员', '理性'],
            interaction_style: '与芝麻讨论技术',
            summary: '芝麻是热衷物联网的用户',
        },
    },
    ...overrides,
});

describe('Character-only 写作人格', () => {
    it('请求只包含角色稳定设定，不泄露用户印象、近期记忆或技术话题', () => {
        const settings = writerPersonaSettingsBlock(character());
        const prompt = buildWriterPersonaPrompt(character());

        // 角色稳定设定由 writerPersonaSettingsBlock 提供，其余分区由 ContextBuilder 注入。
        expect(settings).toContain('温柔、细腻');
        expect(settings).toContain('海边小镇');
        ['芝麻', '物联网', 'MCP', 'API', '编程', '数据库', '自动化'].forEach(value => {
            expect(settings).not.toContain(value);
            expect(prompt).not.toContain(value);
        });
        expect(prompt).toContain('叙事本能:');
        expect(prompt).toContain('作者气质:');
        expect(prompt).toContain('知识影响:');
        expect(prompt).not.toContain('剧情态度:');
        expect(prompt).not.toContain('互动模式:');
        expect(prompt).not.toContain('专业术语:');
    });

    it('用户印象和近期 memories 改变时，Deep 与 Simple 写作人格输入保持不变', () => {
        const before = character();
        const after = character({
            memories: [{ date: '2026-08-29', summary: '用户刚经历失恋，正在讨论创伤疗愈。' } as any],
            impression: {
                ...character().impression!,
                value_map: { likes: ['失恋文学'], dislikes: ['技术'], core_values: '情绪疗愈' },
                personality_core: {
                    observed_traits: ['感性'],
                    interaction_style: '安慰用户',
                    summary: '用户正处于失恋期',
                },
            },
        });

        expect(buildWriterPersonaPrompt(after)).toBe(buildWriterPersonaPrompt(before));
        expect(analyzeWriterPersonaSimple(after)).toBe(analyzeWriterPersonaSimple(before));
        expect(extractWritingTags(after)).toEqual(extractWritingTags(before));
        expect(extractWritingTaboos(after)).toBe(extractWritingTaboos(before));
        expect(getFewShotExamples(after)).toBe(getFewShotExamples(before));
    });

    it('不同角色的输入差异只来自各自稳定设定，且生成 API 不再接收用户参数', () => {
        const quiet = character();
        const direct = character({
            id: 'ash',
            name: 'Ash',
            description: '直率、急躁，没受过写作训练。',
            systemPrompt: '说话短促，重行动，不爱解释。',
            worldview: '长期在荒野中独自求生。',
        });

        expect(writerPersonaSettingsBlock(quiet)).not.toBe(writerPersonaSettingsBlock(direct));
        expect(writerPersonaSettingsBlock(direct)).toContain('没受过写作训练');
        // 指令本身不再内嵌角色卡（改由 ContextBuilder 按分区注入），所以两者相同；
        // 角色差异体现在 writerPersonaSettingsBlock 与最终请求分区里。
        expect(buildWriterPersonaPrompt(quiet)).toBe(buildWriterPersonaPrompt(direct));
        expect(generateWriterPersonaDeep.length).toBe(5);
    });
});
