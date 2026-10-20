import { APIConfig, StudyCourse } from '../types';
import { extractJson, safeResponseJson } from './safeApi';
import { hasKnowledgeContent, isKnowledgeCourse, KnowledgeOrganizerProposal } from './studyKnowledge';

const preview = (text: string) => text.trim().slice(0, 1200);

export const buildKnowledgeOrganizerPrompt = (courses: StudyCourse[]): string => {
    const nodes = courses.filter(isKnowledgeCourse).map(course => ({
        id: course.id,
        title: course.title,
        hasContent: hasKnowledgeContent(course),
        contentPreview: hasKnowledgeContent(course) ? preview(course.rawText) : '',
        parentIds: course.knowledgeParentIds || [],
    }));
    return `你是资料整理助手。请只整理下面知识节点的上位知识 → 下位知识关系，不进行角色扮演。

允许的操作只有：createNodes、addRelations、removeRelations。
- createNodes 只能创建只有标题、没有正文的概念节点。
- 禁止修改已有标题或正文，禁止删除、合并、复制节点，禁止修改学习状态。
- 新关系必须是有向无环图；不要创建 self edge 或重复 edge。
- addRelations 可用 createNodes 中的 tempId。
- 没有必要调整时返回三个空数组。

知识节点：
${JSON.stringify(nodes, null, 2)}

只输出严格 JSON：
{"createNodes":[{"tempId":"new-1","title":"概念标题","reason":"原因"}],"addRelations":[{"parentId":"new-1","childId":"已有 id","reason":"原因"}],"removeRelations":[{"parentId":"已有 id","childId":"已有 id","reason":"原因"}]}`;
};

const proposalFromUnknown = (value: unknown): KnowledgeOrganizerProposal => {
    const record = value && typeof value === 'object' ? value as Record<string, unknown> : {};
    const allowedKeys = new Set(['createNodes', 'addRelations', 'removeRelations']);
    if (Object.keys(record).some(key => !allowedKeys.has(key))) throw new Error('模型返回了不允许的整理操作');
    if (!Array.isArray(record.createNodes) || !Array.isArray(record.addRelations) || !Array.isArray(record.removeRelations)) {
        throw new Error('模型返回的整理建议缺少必要数组');
    }
    const nodes = record.createNodes;
    const adds = record.addRelations;
    const removes = record.removeRelations;
    const relation = (item: unknown) => item && typeof item === 'object'
        && typeof (item as any).parentId === 'string'
        && typeof (item as any).childId === 'string';
    const validNodes = nodes.filter(item => item && typeof item === 'object'
        && typeof (item as any).tempId === 'string'
        && typeof (item as any).title === 'string') as KnowledgeOrganizerProposal['createNodes'];
    const validAdds = adds.filter(relation) as KnowledgeOrganizerProposal['addRelations'];
    const validRemoves = removes.filter(relation) as KnowledgeOrganizerProposal['removeRelations'];
    if (validNodes.length !== nodes.length || validAdds.length !== adds.length || validRemoves.length !== removes.length) {
        throw new Error('模型返回的整理建议包含无效操作');
    }
    return { createNodes: validNodes, addRelations: validAdds, removeRelations: validRemoves };
};

export const requestKnowledgeOrganizerProposal = async (
    courses: StudyCourse[],
    api: APIConfig,
): Promise<KnowledgeOrganizerProposal> => {
    if (!api.apiKey) throw new Error('请先配置自习室 API');
    const response = await fetch(`${api.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.apiKey}` },
        body: JSON.stringify({
            model: api.model,
            messages: [{ role: 'user', content: buildKnowledgeOrganizerPrompt(courses) }],
            temperature: 0.2,
            max_tokens: 4000,
        }),
    });
    if (!response.ok) throw new Error(`API Error: ${response.status}`);
    const data = await safeResponseJson(response);
    const raw = data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning_content || '';
    const parsed = extractJson(raw);
    if (!parsed) throw new Error('模型返回的整理建议无法解析');
    return proposalFromUnknown(parsed);
};
