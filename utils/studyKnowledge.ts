import { StudyCourse } from '../types';

export type KnowledgeStudyCourse = StudyCourse & { kind: 'knowledge' };

export interface KnowledgeRelation {
    parentId: string;
    childId: string;
    reason?: string;
}

export interface KnowledgeOrganizerProposal {
    createNodes: Array<{ tempId: string; title: string; reason?: string }>;
    addRelations: KnowledgeRelation[];
    removeRelations: KnowledgeRelation[];
}

export interface ValidatedKnowledgeOrganizerProposal {
    proposal: KnowledgeOrganizerProposal;
    resolvedNodeIds: Record<string, string>;
    courses: StudyCourse[];
    errors: string[];
}

const uniqueIds = (ids: string[] = []) => [...new Set(ids)];

export const isKnowledgeCourse = (course: StudyCourse | null | undefined): course is KnowledgeStudyCourse =>
    course?.kind === 'knowledge';

export const hasKnowledgeContent = (course: StudyCourse): boolean =>
    isKnowledgeCourse(course) && course.rawText.trim().length > 0;

export const createKnowledgeCourse = ({
    title,
    markdown,
    id = `knowledge-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    createdAt = Date.now(),
}: {
    title: string;
    markdown: string;
    id?: string;
    createdAt?: number;
}): StudyCourse => {
    const cleanTitle = title.trim();
    if (!cleanTitle) throw new Error('知识卡标题不能为空');
    return {
        id,
        kind: 'knowledge',
        title: cleanTitle,
        rawText: markdown,
        knowledgeParentIds: [],
        chapters: [{
            id: 'knowledge-main',
            title: cleanTitle,
            summary: '',
            difficulty: 'normal',
            isCompleted: false,
        }],
        currentChapterIndex: 0,
        createdAt,
        coverStyle: 'linear-gradient(135deg, #166534 0%, #0f766e 100%)',
        totalProgress: 0,
    };
};

/** 普通课程保持原来的平均切片 + 2000 字重叠；知识卡始终返回完整 Markdown。 */
export const getStudySourceText = (course: StudyCourse, chapterIndex: number): string => {
    if (isKnowledgeCourse(course)) return course.rawText;
    const chunkSize = Math.floor(course.rawText.length / course.chapters.length);
    const start = chapterIndex * chunkSize;
    return course.rawText.substring(start, start + chunkSize + 2000);
};

export const getKnowledgeParents = (courses: StudyCourse[], course: StudyCourse): StudyCourse[] => {
    const ids = new Set(course.knowledgeParentIds || []);
    return courses.filter(candidate => isKnowledgeCourse(candidate) && ids.has(candidate.id));
};

export const getKnowledgeChildren = (courses: StudyCourse[], course: StudyCourse): StudyCourse[] =>
    courses.filter(candidate => isKnowledgeCourse(candidate) && (candidate.knowledgeParentIds || []).includes(course.id));

export const wouldCreateKnowledgeCycle = (courses: StudyCourse[], parentId: string, childId: string): boolean => {
    const childrenByParent = new Map<string, string[]>();
    courses.filter(isKnowledgeCourse).forEach(course => {
        (course.knowledgeParentIds || []).forEach(parent => {
            childrenByParent.set(parent, [...(childrenByParent.get(parent) || []), course.id]);
        });
    });

    const pending = [childId];
    const visited = new Set<string>();
    while (pending.length > 0) {
        const id = pending.pop()!;
        if (id === parentId) return true;
        if (visited.has(id)) continue;
        visited.add(id);
        pending.push(...(childrenByParent.get(id) || []));
    }
    return false;
};

export const hasKnowledgeCycle = (courses: StudyCourse[]): boolean => {
    const parents = new Map(courses.filter(isKnowledgeCourse).map(course => [course.id, course.knowledgeParentIds || []]));
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (id: string): boolean => {
        if (visiting.has(id)) return true;
        if (visited.has(id)) return false;
        visiting.add(id);
        if ((parents.get(id) || []).some(parentId => parents.has(parentId) && visit(parentId))) return true;
        visiting.delete(id);
        visited.add(id);
        return false;
    };
    return [...parents.keys()].some(visit);
};

export const validateKnowledgeRelation = (
    courses: StudyCourse[],
    parentId: string,
    childId: string,
): string | null => {
    if (parentId === childId) return '知识节点不能关联到自己';
    const parent = courses.find(course => course.id === parentId);
    const child = courses.find(course => course.id === childId);
    if (!parent || !child) return '关系引用的知识节点不存在';
    if (!isKnowledgeCourse(parent) || !isKnowledgeCourse(child)) return '普通课程不能参与知识关系';
    if ((child.knowledgeParentIds || []).includes(parentId)) return '该关系已经存在';
    if (wouldCreateKnowledgeCycle(courses, parentId, childId)) return '该关系会形成循环';
    return null;
};

export const addKnowledgeRelation = (courses: StudyCourse[], parentId: string, childId: string): StudyCourse[] => {
    const error = validateKnowledgeRelation(courses, parentId, childId);
    if (error) throw new Error(error);
    return courses.map(course => course.id === childId
        ? { ...course, knowledgeParentIds: uniqueIds([...(course.knowledgeParentIds || []), parentId]) }
        : course);
};

export const removeKnowledgeRelation = (courses: StudyCourse[], parentId: string, childId: string): StudyCourse[] =>
    courses.map(course => course.id === childId
        ? { ...course, knowledgeParentIds: (course.knowledgeParentIds || []).filter(id => id !== parentId) }
        : course);

export const removeKnowledgeNodeRelations = (courses: StudyCourse[], nodeId: string): StudyCourse[] =>
    courses.map(course => !isKnowledgeCourse(course) || !(course.knowledgeParentIds || []).includes(nodeId)
        ? course
        : { ...course, knowledgeParentIds: (course.knowledgeParentIds || []).filter(id => id !== nodeId) });

const normalizeProposal = (value: Partial<KnowledgeOrganizerProposal>): KnowledgeOrganizerProposal => ({
    createNodes: Array.isArray(value.createNodes) ? value.createNodes : [],
    addRelations: Array.isArray(value.addRelations) ? value.addRelations : [],
    removeRelations: Array.isArray(value.removeRelations) ? value.removeRelations : [],
});

export const validateOrganizerProposal = (
    allCourses: StudyCourse[],
    input: Partial<KnowledgeOrganizerProposal>,
    fixedNodeIds: Record<string, string> = {},
): ValidatedKnowledgeOrganizerProposal => {
    const proposal = normalizeProposal(input);
    const errors: string[] = [];
    const resolvedNodeIds = { ...fixedNodeIds };
    const existingIds = new Set(allCourses.map(course => course.id));
    const existingTitles = new Set(allCourses.filter(isKnowledgeCourse).map(course => course.title.trim().toLocaleLowerCase()));
    const tempIds = new Set<string>();

    proposal.createNodes.forEach((node, index) => {
        const tempId = typeof node.tempId === 'string' ? node.tempId.trim() : '';
        const title = typeof node.title === 'string' ? node.title.trim() : '';
        if (!tempId || tempIds.has(tempId) || existingIds.has(tempId)) errors.push(`新节点 ${index + 1} 的 tempId 无效或重复`);
        if (!title) errors.push(`新节点 ${tempId || index + 1} 缺少标题`);
        if (title && existingTitles.has(title.toLocaleLowerCase())) errors.push(`已存在同名知识节点“${title}”`);
        tempIds.add(tempId);
        existingTitles.add(title.toLocaleLowerCase());
        resolvedNodeIds[tempId] ||= `knowledge-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`;
    });

    if (errors.length > 0) return { proposal, resolvedNodeIds, courses: allCourses, errors };

    let working: StudyCourse[] = allCourses.map(course => ({
        ...course,
        knowledgeParentIds: course.knowledgeParentIds ? [...course.knowledgeParentIds] : course.knowledgeParentIds,
    }));
    const resolveId = (id: string) => resolvedNodeIds[id] || id;

    proposal.removeRelations.forEach(relation => {
        const parentId = resolveId(relation.parentId);
        const childId = resolveId(relation.childId);
        const parent = working.find(course => course.id === parentId);
        const child = working.find(course => course.id === childId);
        if (!parent || !child) errors.push(`解除关系引用了不存在的节点 ${relation.parentId} → ${relation.childId}`);
        else if (!isKnowledgeCourse(parent) || !isKnowledgeCourse(child)) errors.push('AI 整理不能作用于普通课程');
        else if (!(child.knowledgeParentIds || []).includes(parentId)) errors.push(`要解除的关系不存在：${parent.title} → ${child.title}`);
        else working = removeKnowledgeRelation(working, parentId, childId);
    });

    proposal.createNodes.forEach(node => {
        working.push(createKnowledgeCourse({ title: node.title, markdown: '', id: resolvedNodeIds[node.tempId] }));
    });

    proposal.addRelations.forEach(relation => {
        const parentId = resolveId(relation.parentId);
        const childId = resolveId(relation.childId);
        const error = validateKnowledgeRelation(working, parentId, childId);
        if (error) errors.push(`${relation.parentId} → ${relation.childId}：${error}`);
        else working = addKnowledgeRelation(working, parentId, childId);
    });

    if (errors.length === 0 && hasKnowledgeCycle(working)) errors.push('整理后的知识图谱存在循环');

    return { proposal, resolvedNodeIds, courses: errors.length > 0 ? allCourses : working, errors };
};
