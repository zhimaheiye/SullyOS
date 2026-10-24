import { describe, expect, it } from 'vitest';
import { StudyCourse } from '../types';
import {
    addKnowledgeRelation,
    createKnowledgeCourse,
    getKnowledgeChildren,
    getStudySourceText,
    isKnowledgeCourse,
    removeKnowledgeNodeRelations,
    validateKnowledgeRelation,
    validateOrganizerProposal,
} from './studyKnowledge';
import { buildKnowledgeOrganizerPrompt } from './studyKnowledgeOrganizer';

const course = (id = 'course'): StudyCourse => ({
    id,
    title: id,
    rawText: '0123456789',
    chapters: [0, 1].map(index => ({ id: `ch-${index}`, title: `c${index}`, summary: '', difficulty: 'normal', isCompleted: false })),
    currentChapterIndex: 0,
    createdAt: 1,
    coverStyle: '',
    totalProgress: 0,
});

const knowledge = (id: string, parents: string[] = []) => ({
    ...createKnowledgeCourse({ id, title: id, markdown: `# ${id}\n## detail`, createdAt: 1 }),
    knowledgeParentIds: parents,
});

describe('study knowledge model', () => {
    it('treats missing kind as a normal course', () => expect(isKnowledgeCourse(course())).toBe(false));
    it('recognizes knowledge kind', () => expect(isKnowledgeCourse(knowledge('A'))).toBe(true));
    it('creates exactly one fixed chapter', () => {
        const item = knowledge('A');
        expect(item.chapters).toHaveLength(1);
        expect(item.chapters[0].id).toBe('knowledge-main');
    });
    it('does not split Markdown headings into chapters', () => expect(knowledge('A').chapters).toHaveLength(1));
    it('returns the complete Markdown source for knowledge', () => expect(getStudySourceText(knowledge('A'), 0)).toBe('# A\n## detail'));
    it('preserves the legacy course slicing algorithm', () => expect(getStudySourceText(course(), 1)).toBe('56789'));
    it('allows a child to have multiple parents', () => {
        let graph: StudyCourse[] = [knowledge('A'), knowledge('B'), knowledge('C')];
        graph = addKnowledgeRelation(graph, 'A', 'C');
        graph = addKnowledgeRelation(graph, 'B', 'C');
        expect(graph.find(node => node.id === 'C')?.knowledgeParentIds).toEqual(['A', 'B']);
    });
    it('rejects duplicate edges', () => {
        const graph = addKnowledgeRelation([knowledge('A'), knowledge('B')], 'A', 'B');
        expect(validateKnowledgeRelation(graph, 'A', 'B')).toContain('已经存在');
    });
    it('rejects self edges', () => expect(validateKnowledgeRelation([knowledge('A')], 'A', 'A')).toContain('自己'));
    it('rejects cycles', () => {
        let chain: StudyCourse[] = [knowledge('A'), knowledge('B'), knowledge('C')];
        chain = addKnowledgeRelation(chain, 'A', 'B');
        chain = addKnowledgeRelation(chain, 'B', 'C');
        expect(validateKnowledgeRelation(chain, 'C', 'A')).toContain('循环');
    });
    it('keeps child objects when a node is removed', () => {
        const graph = [knowledge('A'), knowledge('B', ['A']), knowledge('C', ['B'])];
        const cleaned = removeKnowledgeNodeRelations(graph, 'B');
        expect(cleaned).toHaveLength(3);
        expect(getKnowledgeChildren(cleaned, cleaned[0])).toEqual([expect.objectContaining({ id: 'B' })]);
    });
    it('cleans removed node ids from other parent lists', () => {
        const graph = [knowledge('A'), knowledge('B', ['A']), knowledge('C', ['B'])];
        const cleaned = removeKnowledgeNodeRelations(graph, 'B');
        expect(cleaned.find(node => node.id === 'C')?.knowledgeParentIds).toEqual([]);
    });
});

describe('knowledge organizer validation', () => {
    it('sends every title, content preview, and current parent ids to the organizer', () => {
        const prompt = buildKnowledgeOrganizerPrompt([knowledge('Parent'), knowledge('Child', ['Parent'])]);
        expect(prompt).toContain('"title": "Parent"');
        expect(prompt).toContain('"contentPreview": "# Child\\n## detail"');
        expect(prompt).toContain('"parentIds": [\n      "Parent"');
    });
    it('allows relations that reference a proposed temp node', () => {
        const result = validateOrganizerProposal([knowledge('A')], {
            createNodes: [{ tempId: 'new-1', title: 'Parent' }],
            addRelations: [{ parentId: 'new-1', childId: 'A' }],
            removeRelations: [],
        }, { 'new-1': 'generated-parent' });
        expect(result.errors).toEqual([]);
        expect(result.courses.find(node => node.id === 'A')?.knowledgeParentIds).toEqual(['generated-parent']);
    });
    it('rejects invalid ids', () => {
        expect(validateOrganizerProposal([knowledge('A')], {
            createNodes: [], addRelations: [{ parentId: 'missing', childId: 'A' }], removeRelations: [],
        }).errors[0]).toContain('不存在');
    });
    it('rejects proposals that target ordinary courses', () => {
        expect(validateOrganizerProposal([course('pdf'), knowledge('A')], {
            createNodes: [], addRelations: [{ parentId: 'pdf', childId: 'A' }], removeRelations: [],
        }).errors[0]).toContain('普通课程');
    });
    it('rejects proposals that create a cycle', () => {
        expect(validateOrganizerProposal([knowledge('A'), knowledge('B', ['A']), knowledge('C', ['B'])], {
            createNodes: [], addRelations: [{ parentId: 'C', childId: 'A' }], removeRelations: [],
        }).errors[0]).toContain('循环');
    });
    it('rejects a cyclic final graph even without a new edge', () => {
        const result = validateOrganizerProposal([knowledge('A', ['C']), knowledge('B', ['A']), knowledge('C', ['B'])], {
            createNodes: [], addRelations: [], removeRelations: [],
        });
        expect(result.errors[0]).toContain('循环');
    });
    it('rejects an obviously duplicated concept title', () => {
        const result = validateOrganizerProposal([knowledge('Existing')], {
            createNodes: [{ tempId: 'new-1', title: ' existing ' }], addRelations: [], removeRelations: [],
        });
        expect(result.errors[0]).toContain('同名');
    });
});
