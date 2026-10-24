import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const readSource = (relativePath: string): string =>
    readFileSync(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8').replace(/\r\n?/g, '\n');

describe('debate character voice and post-match flow', () => {
    const appSource = readSource('../apps/DebateApp.tsx');
    const serviceSource = readSource('./debateService.ts');
    const rulesSource = readSource('./debate.ts');

    it('keeps established character voice stronger than a generic formal debate style', () => {
        expect(serviceSource).toContain('角色人格与一贯说话方式优先于传统书面辩论格式');
        expect(serviceSource).toContain('小性子与口头禅');
        expect(serviceSource).toContain('互相吐槽并让彼此羁绊进入攻防');
        expect(serviceSource).toContain('不得捏造关系或记忆');
        expect(serviceSource).toContain('辩位职责约束你要完成的内容，不限制你用自己的口吻表达');
        expect(rulesSource).not.toMatch(/建议 \d+[—-]\d+ 字/);
    });

    it('stops after the final score until the user asks for the report', () => {
        const finishSpeech = appSource.slice(
            appSource.indexOf('const finishSpeech'),
            appSource.indexOf('const submitUserSpeech'),
        );

        expect(finishSpeech).toContain("stage: 'summary'");
        expect(finishSpeech).not.toContain('pendingSpeech');
        expect(finishSpeech).not.toContain('finalizeDebate(');
        expect(appSource).toContain('查看总结 / 进入赛后报告');
        expect(appSource).toContain('你可以留在这里慢慢读完全部对局');
    });

    it('offers a collapsed full transcript on every completed report', () => {
        expect(appSource).toContain('<details className="group mt-5');
        expect(appSource).toContain('<summary className="flex min-h-16');
        expect(appSource).toContain('查看完整辩论对局记录');
        expect(appSource).toContain('逐轮复盘');
        expect(appSource).toContain('activeSession.speeches.map(speech => <DebateSpeechCard');
    });

    it('does not restore the chill arena options', () => {
        expect(appSource).not.toContain('复用历史辩题');
        expect(appSource).not.toContain('短句交锋');
        expect(appSource).not.toContain('虚构围观弹幕');
        expect(appSource).not.toContain('散场感言');
        expect(appSource).not.toContain('重新生成这次发言');
        expect(serviceSource).not.toContain('audienceComments');
        expect(serviceSource).not.toContain("purpose: 'recall' | 'speech' | 'epilogue'");
        expect(rulesSource).not.toContain('pendingSpeech');
    });
});
