import { describe, it, expect } from 'vitest';
import { ContextBuilder } from './context';
import { expandPromptMacros, expandWorldbookMacros } from './worldbook';

// Tavern 导入卡的宏约定（任务 三十二/三十三）：
//   数据库与编辑界面永远保留 {{char}}/{{user}} 原文（存储不改写）；
//   只有在运行时拼 LLM prompt 时才展开成当前角色名/用户名。
// 锁两个面：1) buildCoreContext / buildRoleSettingsContext 输出的 prompt 已展开；
//          2) 传入的原始 char 对象未被就地改写（否则会污染 DB 缓存里的原文）。

const makeChar = () => ({
    id: 'c-shen',
    name: '沈清和',
    systemPrompt: '我是{{char}}，我正在和{{user}}交流。',
    worldview: '{{user}}来到了我的小城。',
    description: '',
    timeAwarenessEnabled: false,
    memoryPalaceEnabled: false,
    emotionConfig: { enabled: false },
} as any);

const user = { name: '芝麻', bio: '' } as any;

describe('expandPromptMacros（通用宏展开）', () => {
    it('展开 {{char}} 与 {{user}}', () => {
        expect(expandPromptMacros('{{char}}看着{{user}}', '沈清和', '芝麻')).toBe('沈清和看着芝麻');
    });

    it('大小写与空白变体也能展开（{{CHAR}} / {{ User }}）', () => {
        expect(expandPromptMacros('{{CHAR}}和{{ User }}', '沈清和', '芝麻')).toBe('沈清和和芝麻');
    });

    it('userName 为空时 {{user}} 保留原文，不编造用户名', () => {
        expect(expandPromptMacros('{{char}}对{{user}}说', '沈清和', '')).toBe('沈清和对{{user}}说');
    });

    it('其它宏（如 {{random:1,2}}）原样保留', () => {
        expect(expandPromptMacros('{{random:1,2}} 与 {{char}}', '沈清和', '芝麻')).toBe('{{random:1,2}} 与 沈清和');
    });

    it('expandWorldbookMacros 是同一套语义的兼容别名（任务 三十三）', () => {
        expect(expandWorldbookMacros('{{char}}看着{{user}}', '沈清和', '芝麻')).toBe('沈清和看着芝麻');
        expect(expandWorldbookMacros).toBe(expandPromptMacros);
    });
});

describe('buildCoreContext 宏展开（任务 三十二）', () => {
    it('核心指令与世界观中的 {{char}}/{{user}} 在 prompt 里展开', async () => {
        const core = await ContextBuilder.buildCoreContext(makeChar(), user);
        expect(core).toContain('我是沈清和，我正在和芝麻交流。');
        expect(core).toContain('芝麻来到了我的小城。');
        // prompt 里不能再残留未展开的核心宏
        expect(core).not.toContain('{{char}}');
        expect(core).not.toContain('{{user}}');
    });

    it('原始 char 对象保持宏原文（DB 存储 = 宏原文）', async () => {
        const char = makeChar();
        await ContextBuilder.buildCoreContext(char, user);
        expect(char.systemPrompt).toBe('我是{{char}}，我正在和{{user}}交流。');
        expect(char.worldview).toBe('{{user}}来到了我的小城。');
    });
});

describe('buildRoleSettingsContext userName 选项', () => {
    it('传入 userName 时 {{char}}/{{user}} 一并展开', async () => {
        const text = await ContextBuilder.buildRoleSettingsContext(makeChar(), { skipMemories: true, userName: '芝麻' });
        expect(text).toContain('我是沈清和，我正在和芝麻交流。');
        expect(text).toContain('芝麻来到了我的小城。');
        expect(text).not.toContain('{{char}}');
        expect(text).not.toContain('{{user}}');
    });

    it('不传 userName 时 {{user}} 保留原文（没有用户语境的后台调用不编造用户名）', async () => {
        const text = await ContextBuilder.buildRoleSettingsContext(makeChar(), { skipMemories: true });
        expect(text).toContain('我是沈清和，我正在和{{user}}交流。');
        expect(text).toContain('{{user}}来到了我的小城。');
        expect(text).not.toContain('芝麻');
    });
});
