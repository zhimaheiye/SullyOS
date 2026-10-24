import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const source = readFileSync(resolve(process.cwd(), 'apps/StudyApp.tsx'), 'utf8');

describe('StudyApp knowledge wiring', () => {
    it('bypasses curriculum generation when creating a knowledge card', () => {
        const handler = source.slice(source.indexOf('const handleCreateKnowledge'), source.indexOf('const handleOpenKnowledge'));
        expect(handler).toContain('createKnowledgeCourse');
        expect(handler).not.toContain('generateCurriculum');
    });

    it('routes lecture, question, and quiz source material through one helper', () => {
        expect(source.match(/getStudySourceText\(/g)).toHaveLength(3);
    });

    it('hides chapter navigation and exposes one-step knowledge completion', () => {
        expect(source).toContain("showChapterMenu && !isKnowledgeCourse(activeCourse)");
        expect(source).toContain("isKnowledgeCourse(activeCourse) ? '完成学习' : '下一章'");
    });
});
