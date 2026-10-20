import React, { useCallback, useEffect, useMemo, useState } from 'react';
import dagre from '@dagrejs/dagre';
import {
    Background,
    Controls,
    Edge,
    MiniMap,
    Node as FlowNode,
    NodeMouseHandler,
    ReactFlow,
    ReactFlowProvider,
    useReactFlow,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
    ArrowLeft,
    Crosshair,
    GitBranch,
    PencilSimple,
    SpinnerGap,
    Trash,
    TreeStructure,
    X,
} from '@phosphor-icons/react';
import type { Message, StoryTheaterArchive, StoryTheaterBranch, StoryTheaterEntry } from '../../../types';
import { useOS } from '../../../context/OSContext';
import {
    activeStoryPath,
    makeStoryBranch,
    renameStoryBranch,
    storyMessageBranchId,
    storyMessageParentId,
    storyPathToMessage,
    storyTimelineChildren,
    switchStoryTimelineTo,
} from '../../../utils/storyTheaterTimeline';
import {
    deleteStoryTimelineBranch,
    deleteStoryTimelineSubtree,
    ensureStoryTimeline,
} from '../../../utils/storyTheaterTimelineStorage';
import { deleteStoryVectorMemory, listStoryVectorMemories } from '../../../utils/storyTheaterVectorMemory';

interface Props {
    entry: StoryTheaterEntry;
    onBack: () => void;
    onOpenSession: () => void;
    onEntryChange: (entry: StoryTheaterEntry) => Promise<void> | void;
}

type GraphData = {
    kind: 'message' | 'root' | 'empty' | 'fold';
    messageId?: number;
    branchId?: string;
    label: React.ReactNode;
};

const NODE_WIDTH = 220;
const NODE_HEIGHT = 112;
const cleanExcerpt = (content: string, limit = 82): string => {
    const value = content.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return value.length > limit ? `${value.slice(0, limit)}…` : value || '（空白楼层）';
};

const GraphCard: React.FC<{
    message?: Message;
    branch?: StoryTheaterBranch;
    active?: boolean;
    selected?: boolean;
    empty?: boolean;
    root?: boolean;
    foldedCount?: number;
}> = ({ message, branch, active, selected, empty, root, foldedCount }) => {
    if (root) return <div className={`w-[180px] rounded-full border px-4 py-3 text-center shadow-lg ${selected ? 'border-violet-300 ring-2 ring-violet-400/50' : 'border-slate-600'} bg-[#161B22] text-slate-200`}><div className='text-[9px] uppercase tracking-[.22em] text-violet-300'>Story root</div><div className='mt-1 text-xs font-bold'>剧情起点</div></div>;
    if (empty) return <div className={`w-[210px] rounded-2xl border border-dashed px-4 py-4 text-center ${selected ? 'border-violet-300 ring-2 ring-violet-400/50' : 'border-violet-500/60'} bg-violet-950/30 text-violet-200`}><GitBranch size={18} className='mx-auto' /><div className='mt-2 text-[10px] font-bold'>{branch?.name || '空分支'}</div><div className='mt-1 text-[9px] text-violet-300/70'>尚未写下新的楼层</div></div>;
    if (foldedCount) return <div className='w-[210px] rounded-2xl border border-slate-700 bg-[#141922] px-4 py-4 text-center text-slate-300 shadow-lg'><div className='text-[9px] font-bold uppercase tracking-[.18em] text-slate-500'>History chain</div><div className='mt-2 text-xs font-bold'>折叠 {foldedCount} 条消息</div><div className='mt-1 text-[9px] text-violet-300'>点击临时展开</div></div>;
    const isUser = message?.role === 'user';
    return <div className={`w-[220px] rounded-[18px] border p-3 text-left shadow-xl transition-opacity ${selected ? 'ring-2 ring-violet-400/70' : ''} ${active ? 'border-violet-400 bg-[#211B31]' : 'border-slate-700 bg-[#171C24] opacity-65'}`}>
        <div className='flex items-center gap-2'><span className={`rounded-full px-2 py-1 text-[8px] font-bold ${isUser ? 'bg-violet-500 text-white' : 'bg-slate-700 text-slate-200'}`}>{isUser ? '你的推进' : '剧情正文'}</span>{active && <span className='text-[8px] font-bold text-violet-300'>当前路线</span>}<span className='ml-auto text-[8px] text-slate-500'>#{message?.id}</span></div>
        <p className='mt-2 line-clamp-3 text-[10px] leading-5 text-slate-200'>{cleanExcerpt(message?.content || '')}</p>
        <div className='mt-2 truncate text-[8px] text-slate-500'>{branch?.name || '原始路线'}</div>
    </div>;
};

function layoutTimeline(nodes: FlowNode<GraphData>[], edges: Edge[]): FlowNode<GraphData>[] {
    const graph = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}));
    graph.setGraph({ rankdir: 'TB', nodesep: 54, ranksep: 74, marginx: 40, marginy: 40 });
    for (const node of nodes) graph.setNode(node.id, { width: NODE_WIDTH, height: NODE_HEIGHT });
    for (const edge of edges) graph.setEdge(edge.source, edge.target);
    dagre.layout(graph);
    return nodes.map(node => {
        const point = graph.node(node.id);
        return { ...node, position: { x: point.x - NODE_WIDTH / 2, y: point.y - NODE_HEIGHT / 2 } };
    });
}

const StoryTimelineCanvas: React.FC<Props> = ({ entry, onBack, onOpenSession, onEntryChange }) => {
    const { addToast, remoteVectorConfig } = useOS();
    const flow = useReactFlow<FlowNode<GraphData>>();
    const [currentEntry, setCurrentEntry] = useState(entry);
    const [messages, setMessages] = useState<Message[]>([]);
    const [loading, setLoading] = useState(true);
    const [onlyCurrent, setOnlyCurrent] = useState(false);
    const [expandedBranches, setExpandedBranches] = useState<Set<string>>(() => new Set());
    const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
    const [renaming, setRenaming] = useState(false);
    const [renameDraft, setRenameDraft] = useState('');
    const [mutating, setMutating] = useState(false);
    const [deleteMode, setDeleteMode] = useState<'subtree' | 'branch' | null>(null);

    const reload = useCallback(async () => {
        setLoading(true);
        try {
            const result = await ensureStoryTimeline(entry);
            setCurrentEntry(result.entry);
            setMessages(result.messages);
            if (result.migrated) await onEntryChange(result.entry);
        } finally {
            setLoading(false);
        }
    }, [entry, onEntryChange]);

    useEffect(() => { void reload(); }, [reload]);
    useEffect(() => { setCurrentEntry(entry); }, [entry]);

    const timeline = currentEntry.timeline;
    const path = useMemo(() => activeStoryPath(currentEntry, messages), [currentEntry, messages]);
    const pathIds = useMemo(() => new Set(path.map(message => message.id)), [path]);
    const branchById = useMemo(() => new Map((timeline?.branches || []).map(branch => [branch.id, branch])), [timeline?.branches]);
    const children = useMemo(() => storyTimelineChildren(messages), [messages]);
    const selectedMessageId = selectedNodeId?.startsWith('m-') ? Number(selectedNodeId.slice(2)) : undefined;
    const selectedMessage = messages.find(message => message.id === selectedMessageId);
    const selectedBranchId = selectedNodeId?.startsWith('b-')
        ? selectedNodeId.slice(2)
        : selectedMessage ? (storyMessageBranchId(selectedMessage) || timeline?.rootBranchId) : undefined;
    const selectedBranch = selectedBranchId ? branchById.get(selectedBranchId) : undefined;
    const selectedPath = selectedMessage ? storyPathToMessage(messages, selectedMessage.id) : [];

    const graph = useMemo(() => {
        if (!timeline) return { nodes: [] as FlowNode<GraphData>[], edges: [] as Edge[] };
        const collapsedBranches = new Map<string, Message[]>();
        if (!onlyCurrent) {
            for (const branch of timeline.branches) {
                if (expandedBranches.has(branch.id)) continue;
                const branchRows = messages.filter(message => storyMessageBranchId(message) === branch.id).sort((a, b) => a.id - b.id);
                if (branchRows.length < 5 || branchRows.some(message => pathIds.has(message.id))) continue;
                const isSimpleChain = branchRows.every((message, index) => {
                    if (index > 0 && storyMessageParentId(message) !== branchRows[index - 1].id) return false;
                    const expectedChildId = branchRows[index + 1]?.id;
                    const actualChildren = children.get(message.id) || [];
                    return expectedChildId ? actualChildren.length === 1 && actualChildren[0].id === expectedChildId : actualChildren.length === 0;
                });
                if (isSimpleChain) collapsedBranches.set(branch.id, branchRows);
            }
        }
        const collapsedMessageIds = new Set([...collapsedBranches.values()].flat().map(message => message.id));
        const source = (onlyCurrent ? path : messages).filter(message => !collapsedMessageIds.has(message.id));
        const visibleIds = new Set(source.map(message => message.id));
        const nodes: FlowNode<GraphData>[] = [{
            id: 'root', type: 'default', position: { x: 0, y: 0 }, selectable: true,
            data: { kind: 'root', label: <GraphCard root selected={selectedNodeId === 'root'} /> },
            style: { width: NODE_WIDTH, border: 'none', background: 'transparent', padding: 0 },
        }];
        for (const message of source) {
            const branchId = storyMessageBranchId(message) || timeline.rootBranchId;
            nodes.push({
                id: `m-${message.id}`, type: 'default', position: { x: 0, y: 0 }, selectable: true,
                data: { kind: 'message', messageId: message.id, branchId, label: <GraphCard message={message} branch={branchById.get(branchId)} active={pathIds.has(message.id)} selected={selectedNodeId === `m-${message.id}`} /> },
                style: { width: NODE_WIDTH, border: 'none', background: 'transparent', padding: 0 },
            });
        }
        if (!onlyCurrent) {
            for (const branch of timeline.branches) {
                if (messages.some(message => storyMessageBranchId(message) === branch.id)) continue;
                if (branch.forkMessageId !== null && !visibleIds.has(branch.forkMessageId)) continue;
                nodes.push({
                    id: `b-${branch.id}`, type: 'default', position: { x: 0, y: 0 }, selectable: true,
                    data: { kind: 'empty', branchId: branch.id, label: <GraphCard branch={branch} empty selected={selectedNodeId === `b-${branch.id}`} /> },
                    style: { width: NODE_WIDTH, border: 'none', background: 'transparent', padding: 0 },
                });
            }
            for (const [branchId, branchRows] of collapsedBranches) {
                nodes.push({
                    id: `f-${branchId}`, type: 'default', position: { x: 0, y: 0 }, selectable: true,
                    data: { kind: 'fold', branchId, label: <GraphCard branch={branchById.get(branchId)} foldedCount={branchRows.length} /> },
                    style: { width: NODE_WIDTH, border: 'none', background: 'transparent', padding: 0 },
                });
            }
        }
        const edges: Edge[] = [];
        for (const message of source) {
            const parentId = storyMessageParentId(message);
            const sourceId = typeof parentId === 'number' && visibleIds.has(parentId) ? `m-${parentId}` : 'root';
            const branchId = storyMessageBranchId(message) || timeline.rootBranchId;
            const parentMessage = typeof parentId === 'number' ? messages.find(item => item.id === parentId) : undefined;
            const parentBranchId = parentMessage ? storyMessageBranchId(parentMessage) : undefined;
            const startsBranch = branchId !== (parentBranchId || timeline.rootBranchId);
            const active = pathIds.has(message.id) && (typeof parentId !== 'number' || pathIds.has(parentId));
            edges.push({
                id: `${sourceId}->m-${message.id}`,
                source: sourceId,
                target: `m-${message.id}`,
                label: startsBranch ? branchById.get(branchId)?.name : undefined,
                labelStyle: { fill: '#C4B5FD', fontSize: 9, fontWeight: 700 },
                labelBgStyle: { fill: '#11151B', fillOpacity: 0.92 },
                style: { stroke: active ? '#AD8BFF' : '#475569', strokeWidth: active ? 2.4 : 1.3 },
                animated: active && message.id === timeline.activeCursorMessageId,
            });
        }
        if (!onlyCurrent) for (const branch of timeline.branches) {
            if (messages.some(message => storyMessageBranchId(message) === branch.id)) continue;
            const sourceId = branch.forkMessageId === null ? 'root' : `m-${branch.forkMessageId}`;
            if (!nodes.some(node => node.id === sourceId)) continue;
            edges.push({ id: `${sourceId}->b-${branch.id}`, source: sourceId, target: `b-${branch.id}`, label: branch.name, labelStyle: { fill: '#C4B5FD', fontSize: 9 }, style: { stroke: '#7C3AED', strokeDasharray: '5 5' } });
        }
        for (const [branchId, branchRows] of collapsedBranches) {
            const parentId = storyMessageParentId(branchRows[0]);
            const sourceId = typeof parentId === 'number' && visibleIds.has(parentId) ? `m-${parentId}` : 'root';
            edges.push({ id: `${sourceId}->f-${branchId}`, source: sourceId, target: `f-${branchId}`, label: branchById.get(branchId)?.name, labelStyle: { fill: '#94A3B8', fontSize: 9 }, style: { stroke: '#475569', strokeDasharray: '4 4' } });
        }
        return { nodes: layoutTimeline(nodes, edges), edges };
    }, [branchById, children, expandedBranches, messages, onlyCurrent, path, pathIds, selectedNodeId, timeline]);

    const persist = useCallback(async (next: StoryTheaterEntry) => {
        await onEntryChange(next);
        setCurrentEntry(next);
    }, [onEntryChange]);

    const switchHere = useCallback(async () => {
        if (!selectedMessage) return;
        const next = switchStoryTimelineTo(currentEntry, selectedMessage);
        await persist(next);
        addToast('当前路线已切换到所选节点', 'success');
    }, [addToast, currentEntry, persist, selectedMessage]);

    const createBranch = useCallback(async () => {
        if (!selectedMessage) return;
        const next = makeStoryBranch(currentEntry, selectedMessage);
        await persist(next);
        setSelectedNodeId(`b-${next.timeline!.activeBranchId}`);
        addToast('空分支已创建；进入剧情后再写下第一层', 'success');
    }, [addToast, currentEntry, persist, selectedMessage]);

    const saveRename = useCallback(async () => {
        if (!selectedBranch || !renameDraft.trim()) return;
        await persist(renameStoryBranch(currentEntry, selectedBranch.id, renameDraft));
        setRenaming(false);
        addToast('分支名称已更新', 'success');
    }, [addToast, currentEntry, persist, renameDraft, selectedBranch]);

    const cleanupArchives = useCallback(async (archives: StoryTheaterArchive[]) => {
        if (archives.length === 0) return;
        const archiveIds = new Set(archives.map(archive => archive.id));
        const nodes = await listStoryVectorMemories(currentEntry);
        for (const node of nodes) {
            if (node.storyTimelineScope?.archiveId && archiveIds.has(node.storyTimelineScope.archiveId)) {
                await deleteStoryVectorMemory(currentEntry.id, node.id, remoteVectorConfig);
            }
        }
    }, [currentEntry, remoteVectorConfig]);

    const confirmDelete = useCallback(async () => {
        if (!deleteMode || mutating || !timeline) return;
        setMutating(true);
        try {
            const result = deleteMode === 'subtree' && selectedMessage
                ? await deleteStoryTimelineSubtree(currentEntry, messages, selectedMessage.id)
                : deleteMode === 'branch' && selectedBranch
                    ? await deleteStoryTimelineBranch(currentEntry, messages, selectedBranch.id)
                    : null;
            if (!result) return;
            await cleanupArchives(result.invalidatedArchives);
            setCurrentEntry(result.entry);
            setMessages(current => current.filter(message => !result.deletedMessageIds.includes(message.id)));
            setSelectedNodeId(null);
            setDeleteMode(null);
            await onEntryChange(result.entry);
            addToast(deleteMode === 'subtree' ? '所选节点与全部后续已删除' : '所选分支已删除；共同祖先已保留', 'success');
        } catch (error: any) {
            addToast(error?.message || '删除剧情树内容失败', 'error');
        } finally {
            setMutating(false);
        }
    }, [addToast, cleanupArchives, currentEntry, deleteMode, messages, mutating, onEntryChange, selectedBranch, selectedMessage, timeline]);

    const onNodeClick: NodeMouseHandler<FlowNode<GraphData>> = useCallback((_, node) => {
        if (node.data.kind === 'fold' && node.data.branchId) {
            setExpandedBranches(current => new Set(current).add(node.data.branchId!));
            return;
        }
        setSelectedNodeId(node.id);
    }, []);
    const focusCurrent = useCallback(() => {
        const id = timeline?.activeCursorMessageId ? `m-${timeline.activeCursorMessageId}` : 'root';
        setSelectedNodeId(id);
        void flow.fitView({ nodes: [{ id }], padding: 0.8, duration: 300, maxZoom: 1.2 });
    }, [flow, timeline?.activeCursorMessageId]);

    const siblingCount = selectedMessage ? (children.get(storyMessageParentId(selectedMessage) ?? null)?.length || 0) : 0;
    const branchCanDelete = selectedBranch && selectedBranch.id !== timeline?.rootBranchId;

    return <div className='relative h-full w-full overflow-hidden bg-[#0B0E13] text-slate-100'>
        <header className='absolute inset-x-0 top-0 z-20 border-b border-slate-800 bg-[#11151B]/95 backdrop-blur'>
            <div className='story-safe-header flex min-h-[72px] flex-wrap items-center gap-3 px-4 py-3'>
                <button onClick={onBack} className='grid h-10 w-10 place-items-center rounded-full border border-slate-700 bg-slate-900'><ArrowLeft size={19} /></button>
                <div className='min-w-0'><div className='text-[9px] font-bold uppercase tracking-[.24em] text-violet-400'>Story timeline</div><h1 className='truncate font-serif text-lg font-semibold'>剧情树</h1></div>
                <div className='hidden min-w-0 flex-1 sm:block'><div className='truncate text-xs font-semibold text-slate-300'>{currentEntry.title}</div><div className='mt-0.5 text-[9px] text-slate-500'>{messages.length} 个节点 · {timeline?.branches.length || 0} 条路线</div></div>
                <button onClick={() => setOnlyCurrent(value => !value)} className={`ml-auto rounded-full border px-3 py-2 text-[10px] font-bold ${onlyCurrent ? 'border-violet-400 bg-violet-500/20 text-violet-200' : 'border-slate-700 bg-slate-900 text-slate-400'}`}>只看当前路线</button>
                <button onClick={focusCurrent} className='inline-flex items-center gap-2 rounded-full bg-violet-500 px-3 py-2 text-[10px] font-bold text-white'><Crosshair size={14} />回到当前节点</button>
                <button onClick={onOpenSession} className='rounded-full border border-slate-700 bg-slate-900 px-3 py-2 text-[10px] font-bold text-slate-200'>返回剧情</button>
            </div>
        </header>

        <div className='absolute inset-0 pt-[124px] sm:pt-[72px]'>
            {loading ? <div className='grid h-full place-items-center text-violet-300'><SpinnerGap size={28} className='animate-spin' /></div> : <ReactFlow
                nodes={graph.nodes}
                edges={graph.edges}
                onNodeClick={onNodeClick}
                nodesDraggable={false}
                nodesConnectable={false}
                fitView
                fitViewOptions={{ padding: 0.2 }}
                minZoom={0.18}
                maxZoom={1.7}
                colorMode='dark'
            >
                <Background gap={24} size={1} color='#27303B' />
                <MiniMap pannable zoomable nodeColor={node => node.id === `m-${timeline?.activeCursorMessageId}` ? '#AD8BFF' : node.id.startsWith('m-') ? '#475569' : '#7C3AED'} maskColor='rgba(4,7,11,.72)' />
                <Controls showInteractive={false} />
            </ReactFlow>}
        </div>

        {selectedNodeId && <aside className='story-safe-sheet absolute inset-x-0 bottom-0 z-30 max-h-[70%] overflow-y-auto rounded-t-[28px] border-t border-slate-700 bg-[#121720]/98 p-5 shadow-2xl sm:inset-y-[72px] sm:left-auto sm:right-0 sm:max-h-none sm:w-[388px] sm:rounded-none sm:border-l sm:border-t-0'>
            <div className='flex items-start gap-3'><div className='min-w-0 flex-1'><div className='text-[9px] font-bold uppercase tracking-[.22em] text-violet-400'>Node inspector</div><h2 className='mt-1 font-serif text-lg font-semibold'>{selectedMessage ? (selectedMessage.role === 'user' ? '你的推进' : '剧情正文') : selectedBranch?.name || '剧情起点'}</h2></div><button onClick={() => setSelectedNodeId(null)} className='grid h-9 w-9 place-items-center rounded-full border border-slate-700'><X size={16} /></button></div>
            {selectedMessage ? <>
                <p className='mt-5 whitespace-pre-wrap rounded-2xl border border-slate-700 bg-slate-950/50 p-4 text-[11px] leading-6 text-slate-300'>{selectedMessage.content}</p>
                <div className='mt-4 grid grid-cols-2 gap-3 text-[9px] text-slate-400'><span>角色：{selectedMessage.role === 'user' ? '用户' : 'AI'}</span><span>时间：{new Date(selectedMessage.timestamp).toLocaleString()}</span><span>分支：{selectedBranch?.name || '原始路线'}</span><span>同级：{Math.max(0, siblingCount - 1)} 个</span></div>
                <div className='mt-5 border-l border-violet-500/50 pl-4'><div className='text-[9px] font-bold text-violet-300'>路径面包屑</div><div className='mt-2 space-y-2'>{selectedPath.map((message, index) => <div key={message.id} className='truncate text-[9px] text-slate-500'>{index + 1}. {cleanExcerpt(message.content, 42)}</div>)}</div></div>
                <div className='mt-6 grid gap-2'>
                    <button disabled={selectedMessage.id === timeline?.activeCursorMessageId} onClick={() => void switchHere()} className='h-11 rounded-xl bg-violet-500 text-xs font-bold text-white disabled:opacity-30'>切换到这里</button>
                    <button onClick={() => void createBranch()} className='flex h-11 items-center justify-center gap-2 rounded-xl border border-violet-500/60 bg-violet-500/10 text-xs font-bold text-violet-200'><GitBranch size={16} />从这里新建分支</button>
                </div>
            </> : <p className='mt-5 text-[11px] leading-6 text-slate-400'>{selectedBranch ? '这是一条还没有新楼层的空分支。返回剧情后写下推进，第一条新消息才会落在这里。' : '所有路线都从这里开始。选择一个楼层只会查看，不会自动切换当前路线。'}</p>}

            {selectedBranch && <section className='mt-6 border-t border-slate-800 pt-5'>
                <div className='flex items-center justify-between'><div><div className='text-[9px] font-bold text-slate-500'>分支名称</div><div className='mt-1 text-xs text-slate-200'>{selectedBranch.name}</div></div><button onClick={() => { setRenameDraft(selectedBranch.name); setRenaming(true); }} className='grid h-9 w-9 place-items-center rounded-full border border-slate-700 text-violet-300'><PencilSimple size={15} /></button></div>
            </section>}
            {(selectedMessage || branchCanDelete) && <section className='mt-6 border-t border-rose-950/70 pt-5'><div className='text-[9px] font-bold uppercase tracking-[.2em] text-rose-400'>危险操作</div>{selectedMessage && <button onClick={() => setDeleteMode('subtree')} className='mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-rose-900/70 text-xs font-bold text-rose-400'><Trash size={15} />删除此节点及全部后续</button>}{branchCanDelete && <button onClick={() => setDeleteMode('branch')} className='mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-rose-900/70 text-xs font-bold text-rose-400'><TreeStructure size={15} />删除整条分支</button>}</section>}
        </aside>}

        {renaming && selectedBranch && <div className='absolute inset-0 z-40 grid place-items-center bg-slate-950/70 p-5'><div className='w-full max-w-sm rounded-3xl border border-slate-700 bg-[#151A22] p-5'><h3 className='font-semibold'>重命名分支</h3><input autoFocus maxLength={40} value={renameDraft} onChange={event => setRenameDraft(event.target.value)} className='mt-4 h-11 w-full rounded-xl border border-slate-700 bg-slate-950 px-3 text-sm outline-none focus:border-violet-400' /><div className='mt-4 grid grid-cols-2 gap-3'><button onClick={() => setRenaming(false)} className='h-11 rounded-xl border border-slate-700 text-xs font-bold'>取消</button><button onClick={() => void saveRename()} disabled={!renameDraft.trim()} className='h-11 rounded-xl bg-violet-500 text-xs font-bold disabled:opacity-30'>保存</button></div></div></div>}
        {deleteMode && <div className='absolute inset-0 z-40 grid place-items-center bg-slate-950/75 p-5'><div className='w-full max-w-sm rounded-3xl border border-rose-950 bg-[#151A22] p-5'><div className='text-[9px] font-bold uppercase tracking-[.2em] text-rose-400'>Delete timeline</div><h3 className='mt-1 text-lg font-semibold'>{deleteMode === 'subtree' ? '删除节点与全部后续？' : '删除整条分支？'}</h3><p className='mt-3 text-[11px] leading-6 text-slate-400'>{deleteMode === 'subtree' ? '只保留所选节点之前仍被其它路线使用的共同祖先。受影响的事件盒与独立向量归档会一起清理。' : '共同祖先会保留；这条分支和它派生出的子分支、归档与独立向量都会删除。'}</p><div className='mt-5 grid grid-cols-2 gap-3'><button disabled={mutating} onClick={() => setDeleteMode(null)} className='h-11 rounded-xl border border-slate-700 text-xs font-bold'>取消</button><button disabled={mutating} onClick={() => void confirmDelete()} className='h-11 rounded-xl bg-rose-600 text-xs font-bold text-white'>{mutating ? <SpinnerGap size={17} className='mx-auto animate-spin' /> : '确认删除'}</button></div></div></div>}
    </div>;
};

const StoryTimelineGraph: React.FC<Props> = props => <ReactFlowProvider><StoryTimelineCanvas {...props} /></ReactFlowProvider>;

export default StoryTimelineGraph;
