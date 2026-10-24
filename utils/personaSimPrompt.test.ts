import { describe, expect, it } from 'vitest';
import { buildDirectorPrompt, buildLifeNoiseHints } from '../apps/PersonaSim';

describe('PersonaSim director prompt', () => {
  it('每场只提供 2～4 条不重复、且可全部不用的生活噪音灵感', () => {
    for (let i = 0; i < 100; i += 1) {
      const hints = buildLifeNoiseHints();
      const examples = hints.split('\n').filter(line => line.startsWith('- '));

      expect(examples.length).toBeGreaterThanOrEqual(2);
      expect(examples.length).toBeLessThanOrEqual(4);
      expect(new Set(examples).size).toBe(examples.length);
      expect(hints).toContain('可以一个都不用');
      expect(hints).not.toMatch(/没电|电量不足|天黑.*开灯|忘记开灯/);
    }
  });

  it('把变奏和生活碎片降为软灵感，并取消硬性 beat 配额', () => {
    const prompt = buildDirectorPrompt(
      '角色上下文',
      '最近对话',
      'daily',
      '在家整理旧书',
      '阿澄',
      '相识约半年',
      '小夏',
      'default',
      'mix',
    );

    expect(prompt).toContain('本场变奏 · 可选导演灵感');
    expect(prompt).toContain('用户输入的体验内容 / 当前剧情');
    expect(prompt).toContain('通常约 **20～60 个 beat**');
    expect(prompt).toContain('不是配额');
    expect(prompt).not.toMatch(/天快黑了还没开灯|没电|电量不足|环境碎片撒厚|40~64|40～64|宁多勿少|关灯/);
    expect(prompt).not.toContain('请严格贴合上面的【本场变奏】');
  });

  it('日常/事件、四种基调和三档存在感仍能构造完整 prompt', () => {
    const modes = ['daily', 'event'] as const;
    const tones = ['mix', 'depressive', 'darkhumor', 'cute'] as const;
    const presences = ['default', 'light', 'none'] as const;

    for (const mode of modes) {
      for (const tone of tones) {
        for (const presence of presences) {
          const prompt = buildDirectorPrompt('角色上下文', '最近对话', mode, '指定主题', '阿澄', '相识约半年', '小夏', presence, tone);
          expect(prompt).toContain('体验内容：「指定主题」');
          expect(prompt).toContain('最后一个 beat 必须是 end');
          expect(prompt).toContain('生活噪音 · 可选灵感');
        }
      }
    }
  });
});
