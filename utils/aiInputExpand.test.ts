import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildAiInputExpandPrompt, cleanAiInputExpansion } from './aiInputExpand';

const base = {
    serviceName: '测试 AI',
    sourceText: 'SOURCE_TEXT_MARKER',
    transcript: '我: TRANSCRIPT_MARKER',
    recap: 'RECAP_MARKER',
};

describe('buildAiInputExpandPrompt', () => {
    it('为酒馆锁定身份、优先级、OOC 与小说式扩写边界', () => {
        const prompt = buildAiInputExpandPrompt({
            ...base,
            service: 'tavern',
            card: {
                name: 'CARD_NAME_MARKER',
                kind: 'character',
                persona: 'CARD_PERSONA_MARKER',
                scenario: 'CARD_SCENARIO_MARKER',
            },
        });

        expect(prompt).toContain('char 是人类玩家');
        expect(prompt).toContain('user 扮演 AI / 角色卡');
        expect(prompt).toContain('当前 sourceText（最高优先级，无条件胜出）');
        expect(prompt).toContain('OOC 永远低于 sourceText');
        expect(prompt).toContain('不得自行生成新的 OOC');
        expect(prompt).toContain('第三人称小说式 RP');
        expect(prompt).toContain('不得擅自新增');
        expect(prompt).toContain('RECAP_MARKER');
        expect(prompt).toContain('TRANSCRIPT_MARKER');
        expect(prompt).toContain('CARD_PERSONA_MARKER');
        expect(prompt).toContain('CARD_SCENARIO_MARKER');
        expect(prompt).toContain('SOURCE_TEXT_MARKER');
    });

    it('为助手补全专业知识、结构与 Markdown，但不编造现实事实', () => {
        const prompt = buildAiInputExpandPrompt({
            ...base,
            service: 'assistant',
            assistantStyleLore: 'STYLE_LORE_MARKER',
        });

        expect(prompt).toContain('专业知识');
        expect(prompt).toContain('结构');
        expect(prompt).toContain('Markdown 和 code block');
        expect(prompt).toContain('不得推翻 user 的明确立场');
        expect(prompt).toContain('不得编造 user 的个人经历或 char 没说过的私人事实');
        expect(prompt).toContain('STYLE_LORE_MARKER');
        expect(prompt).not.toContain('GLOBAL_REALITY_SECRET');
    });

    it('为深度对话补全承接、分析、洞察与追问，但不改核心立场', () => {
        const prompt = buildAiInputExpandPrompt({ ...base, service: 'claude' });

        expect(prompt).toContain('情绪承接');
        expect(prompt).toContain('温和分析');
        expect(prompt).toContain('自然的追问');
        expect(prompt).toContain('禁止编造 user 的个人经历');
        expect(prompt).toContain('禁止改写或反转 user 的核心立场');
    });
});

describe('cleanAiInputExpansion', () => {
    it('只移除明显违约前缀并保留 Markdown code fence', () => {
        expect(cleanAiInputExpansion('扩写结果：\n```ts\nconst ok = true;\n```', 'assistant'))
            .toBe('```ts\nconst ok = true;\n```');
        expect(cleanAiInputExpansion('对方: *她抬起眼。*', 'tavern')).toBe('*她抬起眼。*');
    });
});

describe('CheckPhone AI 扩写接线', () => {
    const source = readFileSync(path.resolve(__dirname, '../apps/CheckPhone.tsx'), 'utf8');
    const handler = source.slice(
        source.indexOf('const handleAiExpand = async () =>'),
        source.indexOf('const handleAiSend = async () =>'),
    );

    it('扩写只回填输入框，不发送、不写会话或现实上下文', () => {
        expect(handler).toContain('buildAiInputExpandPrompt');
        expect(handler).toContain('setAiInput(expandedText)');
        expect(handler).not.toContain('buildAiContext');
        expect(handler).not.toContain('patchAiSession');
        expect(handler).not.toContain('syncAiCardToChat');
        expect(handler).not.toContain('maybeSummarizeSession');
        expect(handler).not.toContain('handleAiSend');
        expect(handler).not.toContain('DB.');
    });

    it('通过会话与输入快照保护异步结果', () => {
        expect(handler).toContain('selectedAiSessionIdRef.current !== session.id');
        expect(handler).toContain('aiInputRef.current !== sourceInput');
        expect(handler).toContain('输入内容已变化，本次扩写结果未覆盖');
    });
});
