import { ContextBuilder } from '../../utils/context';

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { NovelBook, NovelSegment, CharacterProfile, UserProfile } from '../../types';
import {
    NOVEL_THEMES, GenerationOptions, extractWritingTags,
    analyzeWriterPersonaSimple, generateWriterPersonaDeep,
    buildNovelInteractionContext, buildPrompt, countManuscriptCharacters, createUserNovelSegment,
    hasSelectedGenerationTask, parsePersonaMarkdown
} from '../../utils/novelUtils';
import Modal from '../os/Modal';
import ChapterEditor from './ChapterEditor';
import AnnotatedPassage, { locateMarginQuote } from './AnnotatedPassage';
import { formatNovelChapterTitle } from '../../utils/novelChapterTitle';
import ConfirmDialog from '../os/ConfirmDialog';
import { useOS } from '../../context/OSContext';
import { safeResponseJson } from '../../utils/safeApi';
import { DB } from '../../utils/db';
import { CharacterGroupFilterBar, filterCharactersByGroup, GROUP_FILTER_ALL } from '../character/CharacterGroupFilter';
import { getLocalDateKey } from '../../utils/localDate';
import TokenImg from '../os/TokenImg';

const novelArchiveCharacter = (char: CharacterProfile): CharacterProfile => ({
    ...char,
    memories: [],
    refinedMemories: {},
    activeMemoryMonths: [],
    impression: undefined,
    guidebookInsights: [],
    selfInsights: [],
    activeBuffs: [],
    buffInjection: '',
    memoryPalaceEnabled: false,
    memoryPalaceInjection: '',
    roomPlatesInjection: '',
    lifeConfig: char.lifeConfig && { ...char.lifeConfig, enabled: false },
    emotionConfig: char.emotionConfig && { ...char.emotionConfig, enabled: false },
});

interface NovelWriterProps {
    activeBook: NovelBook;
    updateNovel: (id: string, updates: Partial<NovelBook>) => Promise<void>;
    characters: CharacterProfile[];
    userProfile: UserProfile;
    apiConfig: any;
    onBack: () => void;
    updateCharacter: (id: string, updates: Partial<CharacterProfile>) => void;
    collaborators: CharacterProfile[];
    setTargetCharId: (id: string) => void;
    targetCharId: string | null;
    onOpenSettings: () => void;
}

// Extracted Component: PersonaPanel
// Moving this outside ensures React doesn't re-mount it on every render of parent, preserving scroll state.
interface PersonaPanelProps {
    char: CharacterProfile;
    targetCharId: string | null;
    isTyping: boolean;
    setIsTyping: (v: boolean) => void;
    setConfirmDialog: (v: any) => void;
    addToast: (msg: string, type: 'success' | 'error' | 'info') => void;
    apiConfig: any;
    updateCharacter: (id: string, updates: Partial<CharacterProfile>) => void;
}

const PersonaPanel: React.FC<PersonaPanelProps> = ({
    char, targetCharId, isTyping, setIsTyping, setConfirmDialog, addToast, apiConfig, updateCharacter
}) => {
    const rawPersona = char.writerPersona || analyzeWriterPersonaSimple(char);
    const sections = parsePersonaMarkdown(rawPersona);
    const [isEditing, setIsEditing] = useState(false);
    const [draft, setDraft] = useState('');

    // 切换共创者时退出编辑，避免草稿写进另一个角色
    useEffect(() => { setIsEditing(false); }, [char.id]);

    const saveDraft = () => {
        if (!draft.trim()) { addToast('档案内容不能为空', 'error'); return; }
        updateCharacter(char.id, { writerPersona: draft.trim(), writerPersonaGeneratedAt: Date.now() });
        setIsEditing(false);
        addToast('创作档案已保存', 'success');
    };

    if (isEditing) {
        return (
            <div className="bg-gradient-to-b from-slate-50 to-white border-b border-black/5 overflow-hidden">
                <div className="max-h-[45vh] overflow-y-auto p-4 overscroll-contain">
                    <textarea value={draft} onChange={e => setDraft(e.target.value)} className="w-full h-56 bg-white border border-slate-200 rounded-2xl p-3 text-sm leading-relaxed resize-none outline-none focus:border-slate-400" />
                    <button onClick={() => setDraft(analyzeWriterPersonaSimple(char))} className="text-xs text-slate-400 underline mt-1">重置为自动分析</button>
                </div>
                <div className="px-4 py-3 border-t border-slate-100 bg-white/80 flex gap-2">
                    <button onClick={() => setIsEditing(false)} className="flex-1 bg-slate-100 text-slate-500 py-2.5 rounded-xl text-sm font-bold active:scale-95 transition-transform">取消</button>
                    <button onClick={saveDraft} className="flex-1 bg-slate-800 text-white py-2.5 rounded-xl text-sm font-bold active:scale-95 transition-transform">保存</button>
                </div>
            </div>
        );
    }

    return (
        <div className="bg-gradient-to-b from-slate-50 to-white border-b border-black/5 overflow-hidden">
            <div className="max-h-[45vh] overflow-y-auto p-4 space-y-3 overscroll-contain">
                {sections.length === 0 ? <div className="text-center py-8 text-slate-400 text-sm">暂无详细风格数据<br/><span className="text-xs">点击下方按钮生成</span></div> :
                    sections.map((sec, idx) => (
                        <div key={idx} className="bg-white p-4 rounded-2xl border border-slate-100 shadow-sm">
                            <div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-100"><span className="text-base">{sec.icon}</span><h4 className="text-sm font-bold text-slate-800">{sec.title}</h4></div>
                            <div className="space-y-1.5">{sec.content.map((line, lIdx) => <p key={lIdx} className="text-sm text-slate-600 leading-relaxed">{line}</p>)}</div>
                        </div>
                    ))
                }
            </div>
            <div className="px-4 py-3 border-t border-slate-100 bg-white/80 flex gap-2">
                <button onClick={() => { setDraft(rawPersona); setIsEditing(true); }} disabled={isTyping} className="flex-1 bg-white border border-slate-200 text-slate-600 py-2.5 rounded-xl text-sm font-bold transition-all active:scale-95 hover:bg-slate-50 disabled:opacity-50">手动编辑</button>
                <button onClick={async () => {
                    if(!targetCharId) return; 
                    setConfirmDialog({ 
                        isOpen: true, 
                        title: '重新生成风格', 
                        message: '确定要重新分析该角色的写作人格吗？这将消耗一定量的 Token。', 
                        variant: 'info', 
                        confirmText: '重新生成', 
                        onConfirm: async () => { 
                            setConfirmDialog(null); 
                            addToast('正在分析...', 'info'); 
                            setIsTyping(true); 
                            try { 
                                await generateWriterPersonaDeep(char, apiConfig, updateCharacter, true);
                                addToast('风格已更新', 'success'); 
                            } catch (e) { 
                                addToast(e instanceof Error ? e.message : '分析失败，请重试', 'error');
                            } finally { 
                                setIsTyping(false); 
                            } 
                        } 
                    }); 
                }} disabled={isTyping} className="flex-1 bg-gradient-to-r from-indigo-500 to-purple-500 hover:from-indigo-600 hover:to-purple-600 text-white py-2.5 rounded-xl text-sm font-bold transition-all flex items-center justify-center gap-2 shadow-sm disabled:opacity-50">
                    {isTyping ? <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div> : <>深度分析写作风格</>}
                </button>
            </div>
        </div>
    );
};

const NovelWriter: React.FC<NovelWriterProps> = ({ 
    activeBook, updateNovel, characters, userProfile, 
    apiConfig, onBack, updateCharacter, collaborators,
    targetCharId, setTargetCharId, onOpenSettings
}) => {
    const { addToast, characterGroups } = useOS();
    const activeTheme = useMemo(() => NOVEL_THEMES.find(t => t.id === activeBook.coverStyle) || NOVEL_THEMES[0], [activeBook.coverStyle]);
    
    // State
    const [genOptions, setGenOptions] = useState<GenerationOptions>({ write: false, comment: false, analyze: false });
    const [inputText, setInputText] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [segments, renderSegments] = useState<NovelSegment[]>(activeBook.segments);
    const latestSegments = useRef(segments);
    const mounted = useRef(true);
    const setSegments = (next: NovelSegment[]) => {
        latestSegments.current = next;
        renderSegments(next);
    };
    useEffect(() => {
        mounted.current = true;
        return () => { mounted.current = false; };
    }, []);
    const [lastTokenUsage, setLastTokenUsage] = useState<number | null>(null);
    const [isStyleExpanded, setIsStyleExpanded] = useState(false);

    // Modals & Dialogs
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [editingSegment, setEditingSegment] = useState<NovelSegment | null>(null);
    const [editSegmentContent, setEditSegmentContent] = useState('');
    const [confirmDialog, setConfirmDialog] = useState<{ isOpen: boolean; title: string; message: string; variant: 'danger' | 'warning' | 'info'; confirmText?: string; onConfirm: () => void; } | null>(null);
    
    // Summary States
    const [showSummaryModal, setShowSummaryModal] = useState(false);
    const [summaryContent, setSummaryContent] = useState('');
    const [chapterTitle, setChapterTitle] = useState('');
    const [editingTitle, setEditingTitle] = useState(false);
    const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [editingChapterId, setEditingChapterId] = useState<string | null>(null);
    const [writingChapterId, setWritingChapterId] = useState<string | null>(null);
    const chapterDrafts = useRef(new Map<string | null, string>());
    const [readingChapterIndex, setReadingChapterIndex] = useState<number | null>(null);
    const [margin, setMargin] = useState<{ id: string; quote: string; start?: number; charId: string; question: string } | null>(null);
    const [marginBusy, setMarginBusy] = useState(false);
    const marginPending = useRef(false);
    const keepScroll = useRef(false);

    // 历史章节多选转发（选中的是章节总结段落的 id）
    const [selectedChapterIds, setSelectedChapterIds] = useState<Set<string>>(new Set());
    const [showForwardModal, setShowForwardModal] = useState(false);
    const [forwardTargets, setForwardTargets] = useState<Set<string>>(new Set());
    const [forwardGroupId, setForwardGroupId] = useState(GROUP_FILTER_ALL);
    const [isForwarding, setIsForwarding] = useState(false);

    const scrollRef = useRef<HTMLDivElement>(null);

    // Sync local segments with book
    useEffect(() => {
        setSegments(activeBook.segments);
    }, [activeBook.segments]);

    useEffect(() => {
        if (keepScroll.current) { keepScroll.current = false; return; }
        if (scrollRef.current && !isEditModalOpen) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
    }, [segments, isTyping, isEditModalOpen, writingChapterId]);

    const { archived, unfinished } = useMemo(() => {
        const archived: NovelSegment[][] = [];
        let start = 0;
        segments.forEach((seg, i) => {
            if (seg.focus === 'chapter_summary') {
                archived.push(segments.slice(start, i + 1));
                start = i + 1;
            }
        });
        return { archived, unfinished: segments.slice(start) };
    }, [segments]);
    const historicalSummaries = useMemo(() => archived.map(chapter => chapter[chapter.length - 1]), [archived]);
    const archiveIndex = historicalSummaries.findIndex(s => s.id === writingChapterId);
    const marker = historicalSummaries[archiveIndex];
    const chapterCount = marker ? archiveIndex + 1 : archived.length + 1;
    const displaySegments = marker ? archived[archiveIndex].slice(0, -1) : unfinished;
    const priorSummaries = marker ? historicalSummaries.slice(0, archiveIndex) : historicalSummaries;
    const writingTitle = marker ? marker.chapterTitle : activeBook.currentChapterTitle;
    const endOfChapter = marker ? segments.indexOf(marker) : segments.length;

    const enterChapter = (id: string | null) => {
        chapterDrafts.current.set(writingChapterId, inputText);
        setInputText(chapterDrafts.current.get(id) || '');
        setWritingChapterId(id);
        setReadingChapterIndex(null);
        setShowHistoryModal(false);
        setSelectedChapterIds(new Set());
        setLastTokenUsage(null);
    };
    const editingIndex = historicalSummaries.findIndex(s => s.id === editingChapterId);
    const targetChar = characters.find(c => c.id === targetCharId);
    const hasGenerationTask = hasSelectedGenerationTask(genOptions);
    const canSend = !isTyping && !isGeneratingSummary && (hasGenerationTask || !!inputText.trim());
    const currentHeading = formatNovelChapterTitle(chapterCount, writingTitle);
    const canReroll = hasGenerationTask && displaySegments.length > 0 && displaySegments[displaySegments.length - 1].authorId !== 'user';

    const chapterContentList = useMemo(() => archived.map((chapter, i) => ({
        title: formatNovelChapterTitle(i + 1, chapter[chapter.length - 1].chapterTitle),
        characterCount: countManuscriptCharacters(chapter),
        segments: chapter.slice(0, -1).filter(s => s.type === 'story'),
        summary: chapter[chapter.length - 1].content,
    })), [archived]);
    const unfinishedCount = useMemo(() => countManuscriptCharacters(unfinished), [unfinished]);
    const bookCount = chapterContentList.reduce((sum, chapter) => sum + chapter.characterCount, unfinishedCount);
    const writingCount = chapterContentList[archiveIndex]?.characterCount ?? unfinishedCount;

    const applyChapter = async (replacement: NovelSegment[] | null, position: number) => {
        if (editingIndex < 0 || isTyping || isGeneratingSummary) return;
        const reordered = archived.slice();
        reordered.splice(editingIndex, 1);
        if (replacement) reordered.splice(position, 0, replacement);
        const next = reordered.flat().concat(unfinished);
        try {
            await updateNovel(activeBook.id, { segments: next });
        } catch {
            addToast('章节保存失败，请重试', 'error');
            return;
        }
        setSegments(next);
        if (!replacement && editingChapterId === writingChapterId) enterChapter(null);
        if (!replacement) setSelectedChapterIds(prev => {
            const ids = new Set(prev);
            ids.delete(historicalSummaries[editingIndex].id);
            return ids;
        });
        setEditingChapterId(null);
        addToast(replacement ? '章节已保存' : '章节已删除', 'success');
    };

    // --- Actions ---

    const openMargin = (segment: NovelSegment, quote: string, charId?: string, start?: number) => {
        setMargin({ id: segment.id, quote, start, charId: charId || targetCharId || collaborators[0]?.id || '', question: '' });
    };
    const marginSource = margin && segments.find(s => s.id === margin.id);
    const marginPosition = margin && marginSource ? locateMarginQuote(marginSource.content, margin) : -1;
    const thread = margin && marginSource ? (marginSource.marginNotes || []).filter(n => {
        if (n.charId !== margin.charId || n.quote !== margin.quote) return false;
        return n.start === margin.start || (marginPosition >= 0 && locateMarginQuote(marginSource.content, n) === marginPosition);
    }) : [];

    const sendMargin = async () => {
        if (!margin || marginPending.current || !margin.question.trim()) return;
        const char = collaborators.find(c => c.id === margin.charId);
        const at = segments.findIndex(s => s.id === margin.id);
        if (!char || at < 0) return;
        const source = segments[at];
        const start = locateMarginQuote(source.content, margin);
        const before = segments.slice(0, at);
        if (start >= 0) before.push({ ...source, content: source.content.slice(0, start + margin.quote.length) });
        const summaries = before.filter(s => s.focus === 'chapter_summary');
        const followingMarker = historicalSummaries[summaries.length];
        const title = followingMarker ? followingMarker.chapterTitle : activeBook.currentChapterTitle;
        const context = buildNovelInteractionContext(before, characters, userProfile);
        const question = margin.question.trim();
        const prompt = [
            `你是${char.name}，正在陪${userProfile.name}读虚构作品《${activeBook.title}》的${formatNovelChapterTitle(summaries.length + 1, title)}。`,
            '像坐在作者身边的读者，用你自己的口吻回答对这段文字的提问。剧情只以提供的前情和原文为准。只写旁批回复，不续写或改写正文。',
            context, `引用原文：\n${margin.quote}`,
            ...thread.map(n => `${userProfile.name}：${n.question}\n${char.name}：${n.reply}`),
            `${userProfile.name}：${question}`,
        ].join('\n\n');
        marginPending.current = true;
        setMarginBusy(true);
        try {
            const messages = await ContextBuilder.buildCharacterRequest({
                char: followingMarker ? novelArchiveCharacter(char) : char, user: userProfile,
                ...(followingMarker ? { includeLifeContext: false } : {}),
            }, [{ role: 'user', content: prompt }]);
            const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({ model: apiConfig.model, messages }),
                __sullyMeta: { appId: 'novel', appName: '一起写小说', charId: char.id, charName: char.name, purpose: '小说段落旁批' },
            } as RequestInit);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await safeResponseJson(response);
            const reply = data.choices?.[0]?.message?.content?.trim();
            if (!reply) throw new Error('没有收到旁批正文');
            if (!mounted.current) return;
            const latest = latestSegments.current;
            const target = latest.find(s => s.id === source.id);
            if (!target || target.content !== source.content) throw new Error('原段落已变更，请重新选择');
            const note = { quote: margin.quote, start: margin.start, question, reply, charId: char.id, charName: char.name };
            const next = latest.map(s => s === target ? { ...s, marginNotes: [...(s.marginNotes || []), note] } : s);
            keepScroll.current = true;
            setSegments(next);
            await updateNovel(activeBook.id, { segments: next });
            setMargin({ ...margin, question: '' });
        } catch (error) {
            addToast(error instanceof Error ? error.message : '旁批请求失败', 'error');
        } finally {
            marginPending.current = false;
            if (mounted.current) setMarginBusy(false);
        }
    };

    const runGeneration = async (char: CharacterProfile, userPrompt: string, contextSegments: NovelSegment[], replaceIds: string[] = []) => {
        if (!hasSelectedGenerationTask(genOptions)) return;
        setIsTyping(true);
        setLastTokenUsage(null);

        try {
            const storyContext = buildNovelInteractionContext(contextSegments, characters, userProfile)
                + `\n\n当前章节：${currentHeading}。作品进度以以上前情和本章已写内容为准。`;

            const writer = marker ? novelArchiveCharacter(char) : char;
            const prompt = await buildPrompt(writer, userProfile, activeBook, userPrompt, storyContext, genOptions, contextSegments, characters);
            const messages = await ContextBuilder.buildCharacterRequest({
                char: writer, user: userProfile,
                ...(marker ? { includeLifeContext: false } : {}),
            }, [{ role: 'user', content: prompt }]);
            // Sampling is a writing-task default, not inferred from the user's personality.
            const temperature = 0.85;

            const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({ model: apiConfig.model, messages, temperature, max_tokens: 8000 }),
                __sullyMeta: {
                    appId: 'novel',
                    appName: '一起写小说',
                    charId: char.id,
                    charName: char.name,
                    purpose: '小说共写生成',
                },
            } as RequestInit);

            if (response.ok) {
                const data = await safeResponseJson(response);
                if (data.usage?.total_tokens) setLastTokenUsage(data.usage.total_tokens);

                let content = data.choices[0].message.content.trim();
                const originalRaw = content; 
                content = content.replace(/```json\n?/g, '').replace(/```\n?/g, '');
                const jsonMatch = content.match(/\{[\s\S]*\}/);
                if (jsonMatch) content = jsonMatch[0];
                
                let res;
                try {
                    res = JSON.parse(content);
                } catch {
                    if (genOptions.write) res = { writer: { content: originalRaw } };
                    else if (genOptions.comment) res = { comment: { content: originalRaw } };
                    else res = { analysis: { critique: originalRaw } };
                }

                const newAiSegments: NovelSegment[] = [];
                const baseTime = Date.now();

                if (res.analysis && (res.analysis.critique || res.analysis.reaction)) {
                    newAiSegments.push({ id: `seg-${baseTime}-a`, role: 'analyst', type: 'analysis', authorId: char.id, content: res.analysis.critique || JSON.stringify(res.analysis), focus: res.analysis.focus, meta: { reaction: res.analysis.reaction }, timestamp: baseTime + 1 });
                }
                if (genOptions.write && res.writer?.content) {
                    newAiSegments.push({ id: `seg-${baseTime}-w`, role: 'commenter', type: 'discussion', focus: 'continuation_preview', authorId: char.id, content: res.writer.content, timestamp: baseTime + 2 });
                }
                if (res.comment && res.comment.content) {
                    newAiSegments.push({ id: `seg-${baseTime}-c`, role: 'commenter', type: 'discussion', authorId: char.id, content: res.comment.content, timestamp: baseTime + 3 });
                }

                if (!mounted.current) return;
                const latest = latestSegments.current;
                const at = marker ? latest.findIndex(s => s.id === marker.id) : latest.length;
                if (at < 0 || !newAiSegments.length) return;
                const start = at - replaceIds.length;
                if (!replaceIds.every((id, offset) => latest[start + offset]?.id === id)) return;
                const next = [...latest.slice(0, start), ...newAiSegments, ...latest.slice(at)];
                setSegments(next);
                await updateNovel(activeBook.id, { segments: next });
            } else { throw new Error(`API Error: ${response.status}`); }
        } catch (e: any) { addToast('请求失败: ' + e.message, 'error'); } finally { setIsTyping(false); }
    };

    const handleSend = async () => {
        if (!canSend) return;
        const selectedChar = characters.find(c => c.id === targetCharId);
        if (hasGenerationTask && !selectedChar) { addToast('请先选择一个角色', 'error'); return; }

        const userSegment = createUserNovelSegment(inputText, genOptions);
        if (userSegment) {
            const currentSegments = [...segments.slice(0, endOfChapter), userSegment, ...segments.slice(endOfChapter)];
            setSegments(currentSegments);
            updateNovel(activeBook.id, { segments: currentSegments });
        }
        const userPrompt = inputText;
        setInputText('');
        if (hasGenerationTask && selectedChar) {
            const context = [...priorSummaries, ...displaySegments];
            if (userSegment) context.push(userSegment);
            await runGeneration(selectedChar, userPrompt, context);
        }
    };

    const handleReroll = async () => {
        if (!targetCharId) return;
        const selectedChar = characters.find(c => c.id === targetCharId);
        if (!selectedChar) return;

        const kept = [...displaySegments];
        let deletedCount = 0;
        while (kept.length > 0) {
            const last = kept[kept.length - 1];
            if (last.authorId === 'user' || last.focus === 'chapter_summary') break;
            kept.pop();
            deletedCount++;
        }
        if (deletedCount === 0) { addToast('没有可重随的 AI 内容', 'info'); return; }
        addToast('正在重随...', 'info');
        await runGeneration(selectedChar, "", [...priorSummaries, ...kept], displaySegments.slice(kept.length).map(s => s.id));
    };

    const handleEditSegment = (seg: NovelSegment) => {
        setEditingSegment(seg);
        setEditSegmentContent(seg.content);
        setIsEditModalOpen(true);
    };

    const saveSegmentEdit = () => {
        if (!editingSegment) return;
        const newSegments = segments.map(s => s.id === editingSegment.id ? { ...s, content: editSegmentContent } : s);
        setSegments(newSegments);
        updateNovel(activeBook.id, { segments: newSegments });
        setIsEditModalOpen(false);
        setEditingSegment(null);
    };

    const handleDeleteSegment = (id: string) => {
        setConfirmDialog({
            isOpen: true,
            title: '删除段落',
            message: '确定要删除这个段落吗？',
            variant: 'danger',
            onConfirm: () => {
                const newSegments = segments.filter(s => s.id !== id);
                setSegments(newSegments);
                updateNovel(activeBook.id, { segments: newSegments });
                setConfirmDialog(null);
            }
        });
    };

    // Chapter Summary Logic
    const handleGenerateChapterSummary = async () => {
        if (isGeneratingSummary || isTyping) return;
        setChapterTitle(writingTitle || '');
        setIsGeneratingSummary(true);
        setShowSummaryModal(true);
        setSummaryContent('正在回顾本章节内容...');
        try {
            const currentChapterSegs = displaySegments.filter(s => s.type === 'story' || s.role === 'writer');
            const chapterText = currentChapterSegs.map(s => s.content).join('\n\n');

            if (!chapterText.trim()) {
                setSummaryContent(marker?.content || '');
                addToast('本章还没有正文，可手填总结', 'info');
                setIsGeneratingSummary(false);
                return;
            }

            const existingSummaries = priorSummaries;
            const prevSummaryContext = existingSummaries.length > 0
                ? `\n### 前章摘要参考（保持一致性）\n${existingSummaries.map((s, i) => `${formatNovelChapterTitle(i + 1, s.chapterTitle)}：${s.content.substring(0, 300)}`).join('\n')}\n`
                : '';

            const prompt = `### 任务：章节归档总结
小说：《${activeBook.title}》
世界观：${activeBook.worldSetting || '未设定'}
${prevSummaryContext}
### 当前章节正文
${chapterText.substring(0, 200000)}

### 总结要求
请为上述章节内容生成一份**高质量归档总结**，满足以下要求：

1. **剧情轨迹**：按时间顺序梳理本章发生的所有关键事件，不遗漏任何主线或支线转折点。
2. **角色动态**：记录每个出场角色的行为、态度变化、关系发展。特别注意角色之间的互动和情感变化。
3. **氛围与基调**：描述本章的整体氛围（例如：紧张、温馨、悬疑），以及氛围的转折点。
4. **重要信息**：标记所有可能影响后续剧情的伏笔、承诺、悬念、新设定等。
5. **场景与环境**：记录关键场景的地点、时间、环境特征。
6. **写作格式**：使用清晰的结构化格式（可以分段或使用标记），让后续章节的AI仅凭此总结就能无缝衔接创作。

请直接输出总结内容，不需要JSON格式。`;
            const summaryChar = targetChar || (collaborators.length === 1 ? collaborators[0] : undefined);
            const response = await fetch(`${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiConfig.apiKey}` },
                body: JSON.stringify({ model: apiConfig.model, messages: [{ role: "user", content: prompt }] }),
                __sullyMeta: {
                    appId: 'novel',
                    appName: '一起写小说',
                    ...(summaryChar ? { charId: summaryChar.id, charName: summaryChar.name } : {}),
                    purpose: '小说章节总结',
                },
            } as RequestInit);

            if (response.ok) {
                const data = await safeResponseJson(response);
                const summary = data.choices?.[0]?.message?.content;
                if (typeof summary !== 'string' || !summary.trim()) throw new Error('没有收到总结正文');
                setSummaryContent(summary);
            } else { throw new Error(`HTTP ${response.status}`); }
        } catch (e: any) {
            setSummaryContent(marker?.content || '');
            addToast(`总结生成失败：${e.message}`, 'error');
        } finally { setIsGeneratingSummary(false); }
    };

    const confirmChapterSummary = async () => {
        if (!summaryContent.trim() || isGeneratingSummary) return;
        if (marker) {
            const next = segments.map(s => s.id === marker.id ? { ...s, content: summaryContent, chapterTitle: chapterTitle.trim() || undefined } : s);
            await updateNovel(activeBook.id, { segments: next });
            setSegments(next);
            setShowSummaryModal(false);
            addToast('本章总结已更新', 'success');
            return;
        }
        const summarySeg: NovelSegment = { id: `seg-summary-${Date.now()}`, role: 'analyst', type: 'analysis', authorId: 'system', content: summaryContent, chapterTitle: chapterTitle.trim() || undefined, focus: 'chapter_summary', timestamp: Date.now(), meta: { reaction: '本章结束', suggestion: '新章节开始' } };
        const newSegments = [...segments, summarySeg];
        setSegments(newSegments);
        await updateNovel(activeBook.id, { segments: newSegments, currentChapterTitle: undefined });
        
        const currentDate = getLocalDateKey();
        const chapterNum = newSegments.filter(s => s.focus === 'chapter_summary').length;
        const collabNames = collaborators.map(c => c.name).join('、');

        for (const cId of activeBook.collaboratorIds) {
            const char = characters.find(c => c.id === cId);
            if (char) {
                const memory = { id: `mem-${Date.now()}-${Math.random()}`, date: currentDate, summary: `与${collabNames}一起为《${activeBook.title}》创作了第${chapterNum}章，已完成归档。`, mood: 'creative' };
                updateCharacter(char.id, { memories: [...(char.memories || []), memory] });
            }
        }
        setShowSummaryModal(false);
        setSummaryContent('');
        setChapterTitle('');
        addToast('章节已归档，记忆已同步', 'success');
    };

    // --- 历史章节多选 → 转发到聊天 ---
    const toggleSelectChapter = (id: string) => {
        setSelectedChapterIds(prev => {
            const n = new Set(prev);
            n.has(id) ? n.delete(id) : n.add(id);
            return n;
        });
    };

    const allChaptersSelected = historicalSummaries.length > 0 && selectedChapterIds.size === historicalSummaries.length;
    const toggleSelectAllChapters = () => {
        setSelectedChapterIds(allChaptersSelected ? new Set() : new Set(historicalSummaries.map(s => s.id)));
    };

    const openForwardModal = () => {
        if (selectedChapterIds.size === 0) { addToast('请先选择要转发的章节', 'error'); return; }
        // 默认勾上共创者——他们是最需要"记得这本书"的人
        setForwardTargets(new Set(activeBook.collaboratorIds.filter(id => characters.some(c => c.id === id))));
        setForwardGroupId(GROUP_FILTER_ALL);
        setShowForwardModal(true);
    };

    // 把选中的章节归档打包成 novel_card，写进每个目标角色的聊天上下文，
    // 让角色在聊天里"读过"这本一起写的书（与 TRPG trpg_card 同一套机制）
    const handleForwardChapters = async () => {
        if (selectedChapterIds.size === 0 || forwardTargets.size === 0) return;
        setIsForwarding(true);
        try {
            const chapters = historicalSummaries
                .map((s, i) => ({ seg: s, index: i + 1 }))
                .filter(c => selectedChapterIds.has(c.seg.id))
                .map(c => ({ index: c.index, title: c.seg.chapterTitle, summary: c.seg.content }));
            const novel = {
                bookTitle: activeBook.title,
                subtitle: activeBook.subtitle || '',
                bookSummary: activeBook.summary || '',
                userName: userProfile.name,
                collaboratorNames: collaborators.map(c => c.name),
                chapters,
                count: chapters.length,
            };
            const targets = characters.filter(c => forwardTargets.has(c.id));
            for (const t of targets) {
                await DB.saveMessage({
                    charId: t.id,
                    role: 'user',
                    type: 'novel_card',
                    content: `[笔友会小说]《${activeBook.title}》${chapters.length > 1 ? `${chapters.length} 章归档` : `${formatNovelChapterTitle(chapters[0].index, chapters[0].title)}归档`}`,
                    metadata: { novel },
                });
            }
            addToast(`已转发到 ${targets.length} 位角色的聊天`, 'success');
            setShowForwardModal(false);
            setSelectedChapterIds(new Set());
        } catch (e: any) {
            addToast(`转发失败: ${e.message}`, 'error');
        } finally {
            setIsForwarding(false);
        }
    };

    return (
        <div className={`h-full w-full flex flex-col font-serif ${activeTheme.bg} transition-colors duration-500 relative`}>
            <ConfirmDialog isOpen={!!confirmDialog} title={confirmDialog?.title || ''} message={confirmDialog?.message || ''} variant={confirmDialog?.variant} confirmText={confirmDialog?.confirmText || (confirmDialog?.onConfirm ? '确认' : 'OK')} onConfirm={confirmDialog?.onConfirm || (() => setConfirmDialog(null))} onCancel={() => setConfirmDialog(null)} />

            {/* Header */}
            {/* Removed 'sticky top-0' to fix layout overlap. It is now a standard flex child. */}
            <div
                className={`flex flex-col border-b border-black/5 shrink-0 z-20 backdrop-blur-md ${activeTheme.bg}/90 transition-all`}
                style={{ paddingTop: 'var(--chrome-top)' }}
            >
                <div className="h-16 flex items-center justify-between px-4 pt-2">
                    <button onClick={onBack} className="p-3 -ml-3 rounded-full hover:bg-black/5 active:scale-90 transition-transform">
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className={`w-6 h-6 ${activeTheme.text}`}><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5 8.25 12l7.5-7.5" /></svg>
                    </button>
                    {/* Title is clickable to open settings */}
                    <div className="flex min-w-0 flex-col items-center">
                        <button onClick={onOpenSettings} className={`font-bold text-base ${activeTheme.text} truncate max-w-[150px]`}>{activeBook.title}</button>
                        <div className="flex items-center gap-2">
                            <button aria-label="编辑当前章标题" onClick={() => { setChapterTitle(writingTitle || ''); setEditingTitle(true); }} className={`max-w-[46vw] truncate rounded px-1 py-0.5 text-xs ${activeTheme.text} hover:bg-black/5`}>{currentHeading} <span aria-hidden="true" className="opacity-60">✎</span></button>
                            {lastTokenUsage && <span className={`text-[9px] px-1.5 py-0.5 rounded opacity-50 font-mono border border-current ${activeTheme.text}`}>{lastTokenUsage}</span>}
                        </div>
                    </div>
                    <div className="flex items-center gap-1">
                        <button onClick={() => setShowHistoryModal(true)} className={`p-2 rounded-full hover:bg-black/5 transition-colors ${activeTheme.text}`} title="历史章节"><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 0 0 6 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 0 1 6 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 0 1 6-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0 0 18 18a8.967 8.967 0 0 0-6 2.292m0-14.25v14.25" /></svg></button>
                        <button onClick={handleGenerateChapterSummary} disabled={isTyping} className={`p-2 rounded-full hover:bg-black/5 transition-colors ${activeTheme.text}`} title={marker ? '更新本章总结' : '结束本章'}><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 0 0 2.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 0 0-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 0 0 .75-.75 2.25 2.25 0 0 0-.1-.664m-5.8 0A2.251 2.251 0 0 1 13.5 2.25H15c1.012 0 1.867.668 2.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25ZM6.75 12h.008v.008H6.75V12Zm0 3h.008v.008H6.75V15Zm0 3h.008v.008H6.75V18Z" /></svg></button>
                    </div>
                </div>
                {marker && <div className="flex justify-center gap-4 pb-2 text-xs">
                    <button disabled={isTyping || isGeneratingSummary} className={activeTheme.text} onClick={handleGenerateChapterSummary}>更新本章总结</button>
                    <button disabled={isTyping || isGeneratingSummary} className={activeTheme.text} onClick={() => enterChapter(null)}>返回第 {archived.length + 1} 章 →</button>
                </div>}
                <div className="px-4 pb-3 flex gap-3 overflow-x-auto no-scrollbar">
                    {collaborators.map(c => (
                        <button key={c.id} onClick={() => setTargetCharId(c.id)} className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all relative ${targetCharId === c.id ? 'bg-slate-800 text-white border-slate-800' : 'bg-white/50 border-black/5 hover:bg-white text-slate-600'}`}>
                            <TokenImg value={c.avatar} className="w-6 h-6 rounded-full object-cover" />
                            <span className="text-xs font-bold whitespace-nowrap">{c.name}</span>
                            {c.writerPersona && <span className="absolute -top-1 -right-1 w-2 h-2 bg-purple-500 rounded-full border border-white"></span>}
                        </button>
                    ))}
                </div>
            </div>

            {/* Style Bar (Non-sticky to prevent overlap) */}
            <div className={`z-10 ${activeTheme.bg}/95 backdrop-blur-md border-b border-black/5 shadow-sm`}>
                <div className="px-4 py-2 flex items-center justify-between">
                    <div className="flex items-center gap-3 overflow-x-auto no-scrollbar flex-1 mr-4">
                        <div className="flex items-center gap-2 shrink-0">
                            {targetChar && <TokenImg value={targetChar.avatar} className="w-6 h-6 rounded-full object-cover" />}
                            <span className="text-xs font-bold text-slate-700">{targetChar?.name ? `${targetChar.name}的风格` : '未选择角色'}</span>
                        </div>
                        <div className="flex-1 flex gap-2 overflow-x-auto no-scrollbar">
                            {targetChar && extractWritingTags(targetChar).slice(0, 3).map((tag, idx) => {
                                let colorClass = "bg-indigo-50 text-indigo-700 border-indigo-100";
                                if (['快节奏','慢节奏','节奏'].some(k => tag.includes(k))) colorClass = "bg-blue-50 text-blue-700 border-blue-100";
                                if (['冷峻','温情','治愈','燃','致郁'].some(k => tag.includes(k))) colorClass = "bg-pink-50 text-pink-700 border-pink-100";
                                if (['对话','心理','白描','意识流'].some(k => tag.includes(k))) colorClass = "bg-amber-50 text-amber-700 border-amber-100";
                                return <span key={idx} className={`px-2 py-0.5 rounded-full text-[10px] font-bold whitespace-nowrap border ${colorClass}`}>{tag}</span>;
                            })}
                        </div>
                    </div>
                    <button onClick={() => setIsStyleExpanded(!isStyleExpanded)} className="shrink-0 text-[10px] bg-white border border-slate-200 px-2 py-1 rounded-full hover:bg-slate-50 text-slate-600 flex items-center gap-1 transition-colors">详情 <span className={`transform transition-transform ${isStyleExpanded ? 'rotate-180' : ''}`}>▼</span></button>
                </div>
                <div className={`transition-all duration-300 ease-out overflow-hidden ${isStyleExpanded ? 'max-h-[60vh] opacity-100' : 'max-h-0 opacity-0'}`}>
                    {targetChar ? <PersonaPanel 
                        char={targetChar} 
                        targetCharId={targetCharId}
                        isTyping={isTyping}
                        setIsTyping={setIsTyping}
                        setConfirmDialog={setConfirmDialog}
                        addToast={addToast}
                        apiConfig={apiConfig}
                        updateCharacter={updateCharacter}
                    /> : <div className="p-4 text-center text-xs text-slate-400">请先选择一个角色</div>}
                </div>
            </div>

            {/* Content Stream */}
            <div className="flex-1 overflow-y-auto p-4 space-y-6 no-scrollbar pb-40" ref={scrollRef}>
                {displaySegments.some(s => s.type === 'story') && <p className={`text-center text-xs opacity-70 ${activeTheme.text}`}>选中正文中的一句或几行，即可写旁批</p>}
                {displaySegments.length === 0 && <div className="text-center py-20 opacity-40"><p className="text-sm italic font-serif">第 {chapterCount} 章<br/>提笔写下新的开始...</p></div>}
                {displaySegments.map(seg => {
                    const isUser = seg.authorId === 'user';
                    const char = !isUser ? characters.find(c => c.id === seg.authorId) : null;
                    const role = seg.role || (seg.type === 'story' ? 'writer' : (seg.type === 'analysis' ? 'analyst' : 'commenter'));
                    const hoverMenu = (
                        <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity flex gap-1 z-10 bg-white/80 backdrop-blur rounded-lg p-1 shadow-sm border border-slate-100">
                            <button onClick={() => handleEditSegment(seg)} className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-indigo-500"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3"><path d="m5.433 13.917 1.262-3.155A4 4 0 0 1 7.58 9.42l6.92-6.918a2.121 2.121 0 0 1 3 3l-6.92 6.918c-.383.383-.84.685-1.343.886l-3.154 1.262a.5.5 0 0 1-.65-.65Z" /></svg></button>
                            <button onClick={() => handleDeleteSegment(seg.id)} className="p-1 hover:bg-slate-100 rounded text-slate-400 hover:text-red-500"><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3"><path fillRule="evenodd" d="M8.75 1A2.75 2.75 0 0 0 6 3.75v.443c-.795.077-1.584.176-2.365.298a.75.75 0 1 0 .23 1.482l.149-.022.841 10.518A2.75 2.75 0 0 0 7.596 19h4.807a2.75 2.75 0 0 0 2.742-2.53l.841-10.52.149.023a.75.75 0 0 0 .23-1.482A41.03 41.03 0 0 0 14 4.193V3.75A2.75 2.75 0 0 0 11.25 1h-2.5ZM10 4c.84 0 1.673.025 2.5.075V3.75c0-.69-.56-1.25-1.25-1.25h-2.5c-.69 0-1.25.56-1.25 1.25v.325C8.327 4.025 9.16 4 10 4ZM8.58 7.72a.75.75 0 0 0-1.5.06l.3 7.5a.75.75 0 1 0 1.5-.06l-.3-7.5Zm4.34.06a.75.75 0 1 0-1.5-.06l-.3 7.5a.75.75 0 1 0 1.5.06l.3-7.5Z" clipRule="evenodd" /></svg></button>
                        </div>
                    );

                    if (role === 'writer') return (
                        <div key={seg.id} className={`p-6 rounded-sm shadow-sm leading-loose text-justify text-[17px] relative group transition-all ${activeTheme.paper} ${activeTheme.text} ${isUser ? 'border-l-4 border-slate-300' : ''}`}>
                            {hoverMenu}
                            <div className="absolute -top-3 left-4 bg-white/90 border border-black/5 px-2 py-0.5 rounded text-[9px] font-sans font-bold uppercase tracking-wider text-slate-500 shadow-sm flex items-center gap-1.5">
                                {isUser ? null : <TokenImg value={char?.avatar} className="w-3 h-3 rounded-full object-cover" />}<span>{isUser ? '我 (User)' : char?.name} 执笔</span>{!isUser && seg.meta?.mood && <span className="bg-slate-100 px-1.5 rounded text-[9px] text-slate-600 normal-case">{seg.meta.mood}</span>}
                            </div>
                            <AnnotatedPassage segment={seg} onDiscuss={openMargin} />
                        </div>
                    );
                    if (role === 'commenter') return (
                        <div key={seg.id} className={`flex gap-3 max-w-[85%] font-sans ml-auto flex-row-reverse animate-slide-up group relative`}>
                            <div className="w-8 h-8 rounded-full overflow-hidden shrink-0 border-2 border-white shadow-sm mt-1"><TokenImg value={isUser ? userProfile.avatar : char?.avatar} className="w-full h-full object-cover" /></div>
                            <div className={`p-3 rounded-xl text-sm shadow-sm relative bg-[#fff9c4] text-slate-700 transform rotate-1 border border-yellow-200/50`}>{hoverMenu}{seg.focus === 'continuation_preview' && <div className="mb-1 text-xs font-bold">续写参考</div>}<span className="whitespace-pre-wrap">{seg.content}</span></div>
                        </div>
                    );
                    if (role === 'analyst') return (
                        <div key={seg.id} className="mx-4 bg-gradient-to-br from-slate-50 to-blue-50/30 rounded-xl border border-slate-200 p-4 text-xs font-sans text-slate-600 shadow-sm group relative">
                            {hoverMenu}<div className="flex items-center gap-2 mb-2 pb-2 border-b border-slate-200"><img src="https://cdnjs.cloudflare.com/ajax/libs/twemoji/14.0.2/72x72/1f9e0.png" alt="" className="w-5 h-5" /><span className="font-bold text-slate-800">{char?.name} 的分析</span>{seg.focus && <span className="bg-blue-100 text-blue-700 px-2 py-0.5 rounded text-[10px] font-bold">{seg.focus}</span>}</div>
                            {seg.meta?.reaction && <div className="mb-2 pb-2 border-b border-dashed border-slate-200"><span className="text-slate-400 text-[10px] uppercase">第一反应</span><p className="text-sm font-bold text-slate-700 mt-0.5">"{seg.meta.reaction}"</p></div>}<p className="leading-relaxed whitespace-pre-wrap">{seg.content}</p>
                        </div>
                    );
                    return null;
                })}
                {isTyping && <div className="flex justify-center py-4"><div className="flex gap-2"><div className={`w-2 h-2 rounded-full ${activeTheme.button} animate-bounce`}></div><div className={`w-2 h-2 rounded-full ${activeTheme.button} animate-bounce delay-75`}></div><div className={`w-2 h-2 rounded-full ${activeTheme.button} animate-bounce delay-150`}></div></div></div>}
            </div>

            {/* Input */}
            <div className={`absolute bottom-0 w-full bg-white/95 backdrop-blur-xl border-t border-slate-200 z-30 transition-transform duration-300 font-sans shadow-[0_-5px_20px_rgba(0,0,0,0.05)] pb-safe`}>
                <div className="flex flex-wrap items-center gap-2 px-4 py-2 text-xs border-b border-slate-100">
                    <button onClick={() => setGenOptions({...genOptions, write: !genOptions.write})} className={`px-3 py-1.5 rounded-full text-xs font-bold border flex items-center gap-1.5 ${genOptions.write ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200'}`}>角色续写</button>
                    <button onClick={() => setGenOptions({...genOptions, comment: !genOptions.comment})} className={`px-3 py-1.5 rounded-full text-xs font-bold border flex items-center gap-1.5 ${genOptions.comment ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200'}`}>角色吐槽</button>
                    <button onClick={() => setGenOptions({...genOptions, analyze: !genOptions.analyze})} className={`px-3 py-1.5 rounded-full text-xs font-bold border flex items-center gap-1.5 ${genOptions.analyze ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-500 border-slate-200'}`}>深度分析</button>
                    <span className="ml-auto text-xs tabular-nums text-slate-500">本章 {writingCount.toLocaleString('zh-CN')} 字 · 全文 {bookCount.toLocaleString('zh-CN')} 字</span>
                </div>
                <div className="p-3 flex gap-2 items-end">
                    <textarea value={inputText} onChange={e => setInputText(e.target.value)} placeholder={genOptions.write ? '输入正文，或留空让角色续写…' : hasGenerationTask ? '输入讨论内容，或留空让角色回应…' : '写下你的正文…'} className="flex-1 bg-slate-100 rounded-2xl px-4 py-3 text-sm text-slate-700 outline-none resize-none max-h-32 placeholder:text-slate-400 focus:bg-white focus:ring-2 focus:ring-slate-200 transition-all" rows={1} style={{ minHeight: '44px' }} />
                    {canReroll && !isTyping && !inputText.trim() && <button onClick={handleReroll} className={`w-11 h-11 rounded-full flex items-center justify-center text-slate-500 bg-slate-100 hover:bg-slate-200 active:scale-95 transition-all shrink-0`}><svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-5 h-5"><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0 3.181 3.183a8.25 8.25 0 0 0 13.803-3.7M4.031 9.865a8.25 8.25 0 0 1 13.803-3.7l3.181 3.182m0-4.991v4.99" /></svg></button>}
                    <button onClick={handleSend} aria-label={hasGenerationTask ? '请求角色回应' : '发表自己的正文'} disabled={!canSend} className={`w-11 h-11 rounded-full flex items-center justify-center text-white shadow-md active:scale-95 transition-all shrink-0 ${canSend ? activeTheme.button : 'bg-slate-300'}`}><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-5 h-5"><path d="M3.478 2.404a.75.75 0 0 0-.926.941l2.432 7.905H13.5a.75.75 0 0 1 0 1.5H4.984l-2.432 7.905a.75.75 0 0 0 .926.94 60.519 60.519 0 0 0 18.445-8.986.75.75 0 0 0 0-1.218A60.517 60.517 0 0 0 3.478 2.404Z" /></svg></button>
                </div>
            </div>

            {/* Modals */}
            <Modal isOpen={editingTitle} title="当前章标题" onClose={() => setEditingTitle(false)} footer={<>
                <button onClick={() => setEditingTitle(false)} className="flex-1 rounded-xl bg-slate-100 py-3 text-sm font-bold text-slate-600">取消</button>
                <button onClick={async () => {
                    const title = chapterTitle.trim() || undefined;
                    if (marker) {
                        const next = segments.map(s => s.id === marker.id ? { ...s, chapterTitle: title } : s);
                        await updateNovel(activeBook.id, { segments: next });
                        setSegments(next);
                    } else await updateNovel(activeBook.id, { currentChapterTitle: title });
                    setEditingTitle(false);
                }} className="flex-1 rounded-xl bg-indigo-500 py-3 text-sm font-bold text-white">保存</button>
            </>}>
                <input aria-label="当前章标题" value={chapterTitle} onChange={e => setChapterTitle(e.target.value)} placeholder="例如：见面" className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm" />
            </Modal>
            <Modal isOpen={isEditModalOpen} title="编辑段落" onClose={() => setIsEditModalOpen(false)} footer={<button onClick={saveSegmentEdit} className="w-full py-3 bg-slate-800 text-white font-bold rounded-2xl">保存</button>}>
                <textarea value={editSegmentContent} onChange={e => setEditSegmentContent(e.target.value)} className="w-full h-48 bg-slate-100 rounded-xl p-3 text-sm resize-none focus:outline-none leading-relaxed" />
            </Modal>
            <Modal isOpen={showSummaryModal} title="章节总结" onClose={() => setShowSummaryModal(false)} footer={isGeneratingSummary ? <div className="w-full py-3 bg-slate-100 text-slate-500 font-bold rounded-2xl text-center">AI生成中...</div> : <button onClick={confirmChapterSummary} className="w-full py-3 bg-indigo-500 text-white font-bold rounded-2xl shadow-lg">{marker ? '保存本章总结' : '确认归档并开启新章'}</button>}>
                <label className="mb-3 block space-y-1 text-xs font-bold text-slate-600"><span>章节标题（选填）</span>
                    <input className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3 text-sm" value={chapterTitle} onChange={e => setChapterTitle(e.target.value)} placeholder="例如：见面" />
                </label>
                <textarea value={summaryContent} onChange={e => setSummaryContent(e.target.value)} className="w-full h-64 bg-slate-50 border border-slate-200 rounded-xl p-3 text-sm resize-none focus:outline-none leading-relaxed" placeholder="总结生成中..." />
            </Modal>
            {editingIndex >= 0 && <ChapterEditor key={editingChapterId} chapter={archived[editingIndex]} index={editingIndex} count={archived.length} onClose={() => setEditingChapterId(null)} onApply={applyChapter} />}
            <Modal isOpen={showHistoryModal && editingIndex < 0} title="历史章节" onClose={() => { setShowHistoryModal(false); setSelectedChapterIds(new Set()); }}>
                <p className="mb-3 text-center text-xs text-slate-500">全文 {bookCount.toLocaleString('zh-CN')} 字</p>
                {historicalSummaries.length > 0 && (
                    <div className="flex items-center justify-between mb-3 px-1">
                        <button onClick={toggleSelectAllChapters} className="text-xs font-bold text-slate-500 hover:text-slate-800 flex items-center gap-1.5 transition-colors">
                            <span className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${allChaptersSelected ? 'bg-indigo-500 border-indigo-500 text-white' : 'border-slate-300 bg-white'}`}>{allChaptersSelected && <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" /></svg>}</span>
                            {allChaptersSelected ? '取消全选' : '全选'}
                        </button>
                        <button onClick={openForwardModal} disabled={selectedChapterIds.size === 0} className="text-[10px] bg-indigo-500 text-white px-3 py-1.5 rounded-lg font-bold shadow-sm hover:bg-indigo-600 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-1">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3"><path d="M3.105 2.288a.75.75 0 0 0-.826.95l1.414 4.926A1.5 1.5 0 0 0 5.135 9.25h6.115a.75.75 0 0 1 0 1.5H5.135a1.5 1.5 0 0 0-1.442 1.086l-1.414 4.926a.75.75 0 0 0 .826.95 28.897 28.897 0 0 0 15.293-7.155.75.75 0 0 0 0-1.114A28.897 28.897 0 0 0 3.105 2.288Z" /></svg>
                            转发到聊天 ({selectedChapterIds.size})
                        </button>
                    </div>
                )}
                <div className="max-h-[55vh] overflow-y-auto space-y-4 p-1">
                    {historicalSummaries.length === 0 && <div className="text-center text-slate-400 py-4 text-xs">暂无历史章节</div>}
                    {historicalSummaries.map((s, i) => {
                        const selected = selectedChapterIds.has(s.id);
                        return (
                            <div key={s.id} onClick={() => toggleSelectChapter(s.id)} className={`p-4 rounded-xl border cursor-pointer transition-colors ${selected ? 'bg-indigo-50/70 border-indigo-200' : 'bg-slate-50 border-slate-100 hover:border-slate-200'}`}>
                                <div className="flex items-center justify-between mb-2">
                                    <div className="flex items-center gap-2">
                                        <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${selected ? 'bg-indigo-500 border-indigo-500 text-white' : 'border-slate-300 bg-white'}`}>{selected && <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" /></svg>}</span>
                                        <div>
                                            <div className="break-all font-bold text-sm text-slate-700">{chapterContentList[i].title}</div>
                                            <div className="mt-0.5 text-xs tabular-nums text-slate-500">{chapterContentList[i].characterCount.toLocaleString('zh-CN')} 字</div>
                                        </div>
                                    </div>
                                    <button onClick={(e) => { e.stopPropagation(); setReadingChapterIndex(i); setShowHistoryModal(false); }} className="text-[10px] bg-indigo-50 text-indigo-600 px-2.5 py-1 rounded-lg font-bold hover:bg-indigo-100 border border-indigo-100 transition-colors">阅读原文</button>
                                </div>
                                <div className="text-xs text-slate-600 leading-relaxed whitespace-pre-wrap line-clamp-4">{s.content}</div>
                                <button disabled={isTyping || isGeneratingSummary} onClick={e => { e.stopPropagation(); enterChapter(s.id); }} className="mr-2 mt-3 rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40">回到本章写作</button>
                                <button disabled={isTyping || isGeneratingSummary} onClick={e => { e.stopPropagation(); setEditingChapterId(s.id); }} className="mt-3 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-indigo-600 disabled:opacity-40">编辑 / 调序</button>
                            </div>
                        );
                    })}
                </div>
            </Modal>

            {/* 转发章节：选择目标角色（默认勾上共创者，也可以分享给圈外角色） */}
            <Modal isOpen={showForwardModal} title="转发章节到聊天" onClose={() => setShowForwardModal(false)} footer={
                <button onClick={handleForwardChapters} disabled={isForwarding || forwardTargets.size === 0} className="w-full py-3 bg-indigo-500 text-white font-bold rounded-2xl shadow-lg disabled:opacity-40 flex items-center justify-center gap-2">
                    {isForwarding ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"></div> 转发中...</> : `转发 ${selectedChapterIds.size} 章给 ${forwardTargets.size} 位角色`}
                </button>
            }>
                <p className="text-xs text-slate-400 mb-3">章节归档会进入所选角色的聊天记录，之后聊天时 Ta 就"读过"这本书了。共创者已默认勾选。</p>
                <CharacterGroupFilterBar characters={characters} groups={characterGroups} value={forwardGroupId} onChange={setForwardGroupId} className="mb-3" />
                <div className="max-h-[45vh] overflow-y-auto space-y-2 p-1">
                    {filterCharactersByGroup(characters, characterGroups, forwardGroupId).map(c => {
                        const checked = forwardTargets.has(c.id);
                        const isCollab = activeBook.collaboratorIds.includes(c.id);
                        return (
                            <button key={c.id} onClick={() => setForwardTargets(prev => { const n = new Set(prev); n.has(c.id) ? n.delete(c.id) : n.add(c.id); return n; })} className={`w-full flex items-center gap-3 p-3 rounded-xl border shadow-sm active:scale-[0.98] transition-all text-left ${checked ? 'bg-indigo-50/70 border-indigo-200' : 'bg-white border-slate-100 hover:border-slate-200'}`}>
                                <TokenImg value={c.avatar} className="w-9 h-9 rounded-full object-cover" />
                                <div className="flex-1 min-w-0">
                                    <div className="font-bold text-sm text-slate-700 flex items-center gap-2">{c.name}{isCollab && <span className="text-[9px] bg-amber-50 text-amber-600 border border-amber-100 px-1.5 py-0.5 rounded-full font-bold">共创者</span>}</div>
                                </div>
                                <span className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-colors ${checked ? 'bg-indigo-500 border-indigo-500 text-white' : 'border-slate-300 bg-white'}`}>{checked && <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 0 1 .143 1.052l-8 10.5a.75.75 0 0 1-1.127.075l-4.5-4.5a.75.75 0 0 1 1.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 0 1 1.05-.143Z" clipRule="evenodd" /></svg>}</span>
                            </button>
                        );
                    })}
                </div>
            </Modal>

            {/* Chapter Reading Mode */}
            <Modal isOpen={readingChapterIndex !== null} title={chapterContentList[readingChapterIndex ?? 0]?.title || ''} onClose={() => setReadingChapterIndex(null)}>
                <div className="max-h-[70vh] overflow-y-auto space-y-4 p-1">
                    {readingChapterIndex !== null && chapterContentList[readingChapterIndex] && (
                        <>
                            <div className="text-center text-xs tabular-nums text-slate-500">本章 {chapterContentList[readingChapterIndex].characterCount.toLocaleString('zh-CN')} 字</div>
                            {chapterContentList[readingChapterIndex].segments.map(seg => {
                                const isUser = seg.authorId === 'user';
                                const char = !isUser ? characters.find(c => c.id === seg.authorId) : null;
                                return (
                                    <div key={seg.id} className={`${activeTheme.paper} p-5 rounded-sm leading-loose text-justify text-[15px] ${activeTheme.text} ${isUser ? 'border-l-4 border-slate-300' : ''}`}>
                                        <div className="text-[9px] font-sans font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
                                            {!isUser && char && <TokenImg value={char.avatar} className="w-3 h-3 rounded-full object-cover" />}
                                            <span>{isUser ? '我' : char?.name} 执笔</span>
                                        </div>
                                        <AnnotatedPassage segment={seg} onDiscuss={openMargin} />
                                    </div>
                                );
                            })}
                            <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-100 mt-4">
                                <div className="text-[10px] font-bold text-indigo-400 uppercase mb-2">章节总结</div>
                                <div className="text-xs text-indigo-700 leading-relaxed whitespace-pre-wrap">{chapterContentList[readingChapterIndex].summary}</div>
                            </div>
                            <div className="flex justify-between pt-2">
                                <button disabled={isTyping || isGeneratingSummary} className="rounded-lg bg-indigo-500 px-3 py-1.5 text-xs font-bold text-white disabled:opacity-40" onClick={() => enterChapter(historicalSummaries[readingChapterIndex].id)}>回到本章写作</button>
                                <button onClick={() => setReadingChapterIndex(Math.max(0, (readingChapterIndex ?? 0) - 1))} disabled={readingChapterIndex === 0} className="text-xs text-slate-400 disabled:opacity-30 px-3 py-1.5 rounded-lg hover:bg-slate-100">← 上一章</button>
                                <button onClick={() => setReadingChapterIndex(Math.min(chapterContentList.length - 1, (readingChapterIndex ?? 0) + 1))} disabled={readingChapterIndex === chapterContentList.length - 1} className="text-xs text-slate-400 disabled:opacity-30 px-3 py-1.5 rounded-lg hover:bg-slate-100">下一章 →</button>
                            </div>
                        </>
                    )}
                </div>
            </Modal>
            {margin && <Modal isOpen title="段落旁批" onClose={() => { if (!marginBusy) setMargin(null); }} footer={<>
                <button disabled={marginBusy} onClick={() => setMargin(null)} className="flex-1 rounded-xl bg-slate-100 py-3 text-sm font-bold">收起</button>
                <button disabled={marginBusy || !collaborators.some(c => c.id === margin.charId) || !margin.question.trim()} onClick={sendMargin} className="flex-1 rounded-xl bg-indigo-500 py-3 text-sm font-bold text-white disabled:opacity-40">{marginBusy ? '角色正在读…' : '发送提问'}</button>
            </>}>
                <div className="space-y-3 text-sm">
                    <blockquote className="max-h-32 overflow-auto whitespace-pre-wrap border-l-2 border-indigo-300 pl-3 text-slate-600">{margin.quote}</blockquote>
                    <label className="flex items-center justify-between">一起读的角色
                        <select disabled={marginBusy} value={margin.charId} onChange={e => setMargin({ ...margin, charId: e.target.value })} className="rounded-lg border border-slate-200 p-2">
                            {!collaborators.some(c => c.id === margin.charId) && <option value={margin.charId}>{collaborators.length ? '请选择共创角色' : '请先在书稿设置添加角色'}</option>}
                            {collaborators.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                    </label>
                    {thread.map((n, i) =>
                        <div key={i} className="space-y-1 rounded-xl bg-indigo-50 p-3 text-sm whitespace-pre-wrap"><p>我：{n.question}</p><p>{n.charName}：{n.reply}</p></div>
                    )}
                    <textarea aria-label="旁批提问" disabled={marginBusy} value={margin.question} onChange={e => setMargin({ ...margin, question: e.target.value })} placeholder="读到这句，你觉得……" rows={3} className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3" />
                </div>
            </Modal>}
        </div>
    );
};

export default NovelWriter;
