import React from 'react';
import { Handle, Node, NodeProps, Position } from '@xyflow/react';
import { StudyCourse } from '../../types';
import { hasKnowledgeContent } from '../../utils/studyKnowledge';

export type KnowledgeGraphNodeData = {
    course: StudyCourse;
    onManage: (course: StudyCourse) => void;
};

export type KnowledgeGraphNodeType = Node<KnowledgeGraphNodeData, 'knowledge'>;

const KnowledgeGraphNode: React.FC<NodeProps<KnowledgeGraphNodeType>> = ({ data }) => {
    const hasContent = hasKnowledgeContent(data.course);
    const completed = hasContent && data.course.chapters[0]?.isCompleted;
    return (
        <div className={`relative w-[190px] rounded-2xl border px-4 py-3 shadow-lg ${hasContent ? 'border-emerald-200 bg-white' : 'border-dashed border-amber-300 bg-amber-50'}`}>
            <Handle type="target" position={Position.Top} className="!h-2 !w-2 !border-0 !bg-emerald-500" />
            <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                    <div className="line-clamp-2 text-sm font-bold text-slate-800">{data.course.title}</div>
                    <div className={`mt-1 text-[10px] font-bold ${completed ? 'text-emerald-600' : hasContent ? 'text-slate-400' : 'text-amber-600'}`}>
                        {completed ? '✓ 已学习' : hasContent ? '知识卡' : '概念节点'}
                    </div>
                </div>
                <button
                    aria-label={`管理 ${data.course.title} 的关系`}
                    onClick={event => { event.stopPropagation(); data.onManage(data.course); }}
                    className="nodrag nopan rounded-full px-2 py-0.5 text-lg leading-none text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                >…</button>
            </div>
            <Handle type="source" position={Position.Bottom} className="!h-2 !w-2 !border-0 !bg-emerald-500" />
        </div>
    );
};

export default KnowledgeGraphNode;
