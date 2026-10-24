import React, { useMemo } from 'react';
import dagre from '@dagrejs/dagre';
import {
    Background,
    Controls,
    Edge,
    NodeMouseHandler,
    ReactFlow,
    ReactFlowProvider,
    useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { StudyCourse } from '../../types';
import { isKnowledgeCourse } from '../../utils/studyKnowledge';
import KnowledgeGraphNode, { KnowledgeGraphNodeType } from './KnowledgeGraphNode';

const nodeTypes = { knowledge: KnowledgeGraphNode };
const NODE_WIDTH = 190;
const NODE_HEIGHT = 78;

interface Props {
    courses: StudyCourse[];
    onCreate: () => void;
    onOrganize: () => void;
    onOpen: (course: StudyCourse) => void;
    onManage: (course: StudyCourse) => void;
}

const layoutGraph = (courses: StudyCourse[], onManage: Props['onManage']) => {
    const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
    graph.setGraph({ rankdir: 'TB', nodesep: 36, ranksep: 60, marginx: 24, marginy: 24 });
    courses.forEach(course => graph.setNode(course.id, { width: NODE_WIDTH, height: NODE_HEIGHT }));
    courses.forEach(course => (course.knowledgeParentIds || []).forEach(parentId => {
        if (courses.some(candidate => candidate.id === parentId)) graph.setEdge(parentId, course.id);
    }));
    dagre.layout(graph);
    const nodes: KnowledgeGraphNodeType[] = courses.map(course => {
        const point = graph.node(course.id);
        return {
            id: course.id,
            type: 'knowledge',
            position: { x: point.x - NODE_WIDTH / 2, y: point.y - NODE_HEIGHT / 2 },
            data: { course, onManage },
        };
    });
    const edges: Edge[] = courses.flatMap(course => (course.knowledgeParentIds || [])
        .filter(parentId => courses.some(candidate => candidate.id === parentId))
        .map(parentId => ({ id: `${parentId}->${course.id}`, source: parentId, target: course.id, animated: false })));
    return { nodes, edges };
};

const KnowledgeGraphCanvas: React.FC<Props> = props => {
    const knowledge = useMemo(() => props.courses.filter(isKnowledgeCourse), [props.courses]);
    const { nodes, edges } = useMemo(() => layoutGraph(knowledge, props.onManage), [knowledge, props.onManage]);
    const flow = useReactFlow<KnowledgeGraphNodeType>();
    const onNodeClick: NodeMouseHandler<KnowledgeGraphNodeType> = (_, node) => props.onOpen(node.data.course);

    return (
        <div className="flex h-full min-h-[440px] flex-col overflow-hidden rounded-[24px] border border-slate-200 bg-slate-50">
            <div className="flex flex-wrap gap-2 border-b border-slate-200 bg-white p-3">
                <button onClick={props.onCreate} className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-bold text-white">+ 新建知识卡</button>
                <button onClick={props.onOrganize} disabled={knowledge.length === 0} className="rounded-xl bg-violet-100 px-3 py-2 text-xs font-bold text-violet-700 disabled:opacity-40">AI 整理</button>
                <button onClick={() => void flow.fitView({ padding: 0.2, duration: 250 })} disabled={knowledge.length === 0} className="rounded-xl bg-slate-100 px-3 py-2 text-xs font-bold text-slate-600 disabled:opacity-40">适应视图</button>
            </div>
            <div className="relative flex-1">
                {knowledge.length === 0 ? (
                    <div className="absolute inset-0 flex flex-col items-center justify-center px-8 text-center text-slate-400">
                        <div className="text-3xl">◇</div>
                        <div className="mt-2 text-sm font-bold text-slate-600">还没有知识节点</div>
                        <div className="mt-1 text-xs">新建一张 Markdown 知识卡，或先保存一个空概念节点。</div>
                    </div>
                ) : (
                    <ReactFlow
                        nodes={nodes}
                        edges={edges}
                        nodeTypes={nodeTypes}
                        onNodeClick={onNodeClick}
                        nodesDraggable={false}
                        nodesConnectable={false}
                        fitView
                        fitViewOptions={{ padding: 0.2 }}
                        minZoom={0.25}
                        maxZoom={1.8}
                    >
                        <Background gap={20} size={1} color="#cbd5e1" />
                        <Controls showInteractive={false} />
                    </ReactFlow>
                )}
            </div>
        </div>
    );
};

const KnowledgeGraphView: React.FC<Props> = props => (
    <ReactFlowProvider>
        <KnowledgeGraphCanvas {...props} />
    </ReactFlowProvider>
);

export default KnowledgeGraphView;
