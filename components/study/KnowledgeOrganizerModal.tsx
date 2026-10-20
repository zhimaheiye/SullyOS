import React from 'react';
import { StudyCourse } from '../../types';
import { KnowledgeOrganizerProposal } from '../../utils/studyKnowledge';
import Modal from '../os/Modal';

interface Props {
    open: boolean;
    loading: boolean;
    courses: StudyCourse[];
    proposal: KnowledgeOrganizerProposal | null;
    errors: string[];
    onClose: () => void;
    onConfirm: () => Promise<void>;
}

const KnowledgeOrganizerModal: React.FC<Props> = ({ open, loading, courses, proposal, errors, onClose, onConfirm }) => {
    const title = (id: string) => proposal?.createNodes.find(node => node.tempId === id)?.title
        || courses.find(course => course.id === id)?.title
        || id;
    const section = (heading: string, items: Array<{ label: string; reason?: string }>) => (
        <div>
            <div className="mb-2 text-[10px] font-bold uppercase tracking-widest text-slate-400">{heading}</div>
            <div className="space-y-2">
                {items.length === 0 && <div className="rounded-xl bg-slate-50 p-3 text-xs text-slate-400">无</div>}
                {items.map((item, index) => <div key={`${heading}-${index}`} className="rounded-xl bg-slate-50 p-3">
                    <div className="text-sm font-bold text-slate-700">{item.label}</div>
                    {item.reason && <div className="mt-1 text-xs leading-relaxed text-slate-500">{item.reason}</div>}
                </div>)}
            </div>
        </div>
    );

    return (
        <Modal isOpen={open} title="AI 整理建议" onClose={onClose} footer={
            proposal && !loading ? <div className="flex w-full gap-2">
                <button onClick={onClose} className="flex-1 rounded-2xl bg-slate-100 py-3 font-bold text-slate-500">取消</button>
                <button onClick={() => void onConfirm()} disabled={errors.length > 0} className="flex-1 rounded-2xl bg-violet-600 py-3 font-bold text-white disabled:opacity-40">确认应用</button>
            </div> : undefined
        }>
            {loading ? <div className="py-12 text-center text-sm text-slate-500">AI 正在分析知识关系…</div> : proposal ? <div className="space-y-5">
                {errors.length > 0 && <div className="rounded-xl bg-red-50 p-3 text-xs leading-relaxed text-red-600">{errors.join('\n')}</div>}
                {section('新建概念节点', proposal.createNodes.map(node => ({ label: node.title, reason: node.reason })))}
                {section('新增关系', proposal.addRelations.map(item => ({ label: `${title(item.parentId)} → ${title(item.childId)}`, reason: item.reason })))}
                {section('解除关系', proposal.removeRelations.map(item => ({ label: `${title(item.parentId)} → ${title(item.childId)}`, reason: item.reason })))}
            </div> : errors.length > 0 ? <div className="rounded-xl bg-red-50 p-3 text-xs leading-relaxed text-red-600">{errors.join('\n')}</div> : null}
        </Modal>
    );
};

export default KnowledgeOrganizerModal;
