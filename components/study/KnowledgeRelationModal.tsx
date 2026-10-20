import React, { useEffect, useMemo, useState } from 'react';
import { StudyCourse } from '../../types';
import { getKnowledgeChildren, getKnowledgeParents, isKnowledgeCourse } from '../../utils/studyKnowledge';
import Modal from '../os/Modal';

interface Props {
    course: StudyCourse | null;
    courses: StudyCourse[];
    onClose: () => void;
    onAdd: (parentId: string, childId: string) => Promise<void>;
    onRemove: (parentId: string, childId: string) => Promise<void>;
    onDelete: (course: StudyCourse) => void;
}

const KnowledgeRelationModal: React.FC<Props> = ({ course, courses, onClose, onAdd, onRemove, onDelete }) => {
    const [parentId, setParentId] = useState('');
    const [childId, setChildId] = useState('');
    const [busy, setBusy] = useState(false);
    const knowledge = useMemo(() => courses.filter(isKnowledgeCourse), [courses]);
    const parents = course ? getKnowledgeParents(courses, course) : [];
    const children = course ? getKnowledgeChildren(courses, course) : [];

    useEffect(() => { setParentId(''); setChildId(''); }, [course?.id]);

    const apply = async (parent: string, child: string, remove = false) => {
        setBusy(true);
        try { await (remove ? onRemove(parent, child) : onAdd(parent, child)); }
        finally { setBusy(false); }
    };

    const relationList = (title: string, nodes: StudyCourse[], removeParent: boolean) => (
        <div>
            <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">{title}</div>
            <div className="space-y-2">
                {nodes.length === 0 && <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-400">暂无</div>}
                {nodes.map(node => <div key={node.id} className="flex items-center gap-2 rounded-xl bg-slate-50 p-3">
                    <span className="min-w-0 flex-1 truncate text-sm font-bold text-slate-700">{node.title}</span>
                    <button disabled={busy} onClick={() => course && void apply(removeParent ? node.id : course.id, removeParent ? course.id : node.id, true)} className="text-xs font-bold text-red-500">解除</button>
                </div>)}
            </div>
        </div>
    );

    return (
        <Modal isOpen={!!course} title={course ? `整理关系 · ${course.title}` : '整理关系'} onClose={onClose}>
            {course && <div className="space-y-5">
                {relationList('当前上位知识', parents, true)}
                {relationList('当前下位知识', children, false)}
                <div className="border-t border-slate-100 pt-4">
                    <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">添加上位知识</div>
                    <div className="flex gap-2">
                        <select value={parentId} onChange={event => setParentId(event.target.value)} className="min-w-0 flex-1 rounded-xl bg-slate-100 p-3 text-sm">
                            <option value="">选择已有节点</option>
                            {knowledge.filter(node => node.id !== course.id).map(node => <option key={node.id} value={node.id}>{node.title}</option>)}
                        </select>
                        <button disabled={!parentId || busy} onClick={() => void apply(parentId, course.id)} className="rounded-xl bg-emerald-600 px-4 text-xs font-bold text-white disabled:opacity-40">添加</button>
                    </div>
                </div>
                <div>
                    <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">添加下位知识</div>
                    <div className="flex gap-2">
                        <select value={childId} onChange={event => setChildId(event.target.value)} className="min-w-0 flex-1 rounded-xl bg-slate-100 p-3 text-sm">
                            <option value="">选择已有节点</option>
                            {knowledge.filter(node => node.id !== course.id).map(node => <option key={node.id} value={node.id}>{node.title}</option>)}
                        </select>
                        <button disabled={!childId || busy} onClick={() => void apply(course.id, childId)} className="rounded-xl bg-emerald-600 px-4 text-xs font-bold text-white disabled:opacity-40">添加</button>
                    </div>
                </div>
                <button onClick={() => { onClose(); onDelete(course); }} className="w-full rounded-xl bg-red-50 py-3 text-xs font-bold text-red-600">删除这个知识节点</button>
            </div>}
        </Modal>
    );
};

export default KnowledgeRelationModal;
