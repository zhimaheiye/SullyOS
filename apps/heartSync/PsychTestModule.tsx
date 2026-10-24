import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft, ArrowRight, Check, ClockCounterClockwise, FloppyDisk, Plus, SpinnerGap, Trash, X,
} from '@phosphor-icons/react';
import { useOS } from '../../context/OSContext';
import type { HeartSyncEventCard, HeartSyncPsychOption, HeartSyncPsychQuestion, HeartSyncPsychSession } from '../../types';
import { AppID } from '../../types';
import { DB } from '../../utils/db';
import {
  buildPsychContextText,
  buildPsychDisplayPayload,
  createPsychSession,
  getPsychDefaultDraft,
  getPsychInterpretation,
  nextPsychOptionKey,
  parsePsychInitialAnswer,
  setPsychDefaultAnswer,
  updatePsychQuestionOptions,
  validatePsychQuestion,
} from '../../utils/heartSyncPsych';
import {
  persistHeartSyncEvent,
  requestPsychDiscussionReply,
  requestPsychInitialAnswer,
} from '../../utils/heartSyncService';

type View = 'list' | 'editor' | 'session' | 'history';

const sortNewest = <T extends { updatedAt: number }>(items: T[]) => [...items].sort((a, b) => b.updatedAt - a.updatedAt);
const optionLabel = (question: HeartSyncPsychQuestion, key?: string) => {
  const option = question.options?.find(item => item.key === key);
  return option ? `${option.key} · ${option.label}` : '';
};

const PsychTestModule: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const {
    characters, userProfile, groups, apiConfig, realtimeConfig, addToast,
    setActiveCharacterId, openApp,
  } = useOS();
  const [view, setView] = useState<View>('list');
  const [sessionReturnView, setSessionReturnView] = useState<'list' | 'history'>('list');
  const [questions, setQuestions] = useState<HeartSyncPsychQuestion[]>([]);
  const [sessions, setSessions] = useState<HeartSyncPsychSession[]>([]);
  const [charId, setCharId] = useState(characters[0]?.id || '');
  const [activeSessionId, setActiveSessionId] = useState('');
  const [draft, setDraft] = useState<HeartSyncPsychQuestion | null>(null);
  const [answerKey, setAnswerKey] = useState('');
  const [answerText, setAnswerText] = useState('');
  const [chatText, setChatText] = useState('');
  const [busy, setBusy] = useState(false);
  const [replying, setReplying] = useState(false);
  const [error, setError] = useState('');

  const activeSession = sessions.find(item => item.id === activeSessionId) || null;
  const activeChar = characters.find(item => item.id === (activeSession?.charId || charId)) || null;
  const selectedChar = characters.find(item => item.id === charId) || null;

  useEffect(() => {
    void Promise.all([DB.getHeartSyncPsychQuestions(), DB.getHeartSyncPsychSessions()]).then(([savedQuestions, savedSessions]) => {
      setQuestions(sortNewest(savedQuestions));
      setSessions(sortNewest(savedSessions));
    }).catch(() => addToast('心理测试记录读取失败', 'error'));
  }, [addToast]);

  useEffect(() => {
    if (!charId && characters[0]) setCharId(characters[0].id);
  }, [charId, characters]);

  useEffect(() => {
    if (!activeSession) return;
    setAnswerKey(activeSession.userAnswer?.optionKey || '');
    setAnswerText(activeSession.userAnswer?.text || '');
    setError('');
  }, [activeSession?.id, activeSession?.phase]);

  const saveSession = async (session: HeartSyncPsychSession) => {
    const next = { ...session, updatedAt: Date.now() };
    setSessions(prev => sortNewest([next, ...prev.filter(item => item.id !== next.id)]));
    await DB.saveHeartSyncRecord(next);
    return next;
  };

  const saveQuestion = async () => {
    if (!draft) return;
    let normalized: HeartSyncPsychQuestion = {
      ...draft,
      text: draft.text.trim(),
      options: draft.questionType === 'choice'
        ? (draft.options || []).map(option => ({ ...option, label: option.label.trim(), interpretation: option.interpretation.trim() }))
        : undefined,
      updatedAt: Date.now(),
    };
    normalized = setPsychDefaultAnswer(normalized, normalized.defaultAnswer || { text: '' }, normalized.updatedAt);
    const validation = validatePsychQuestion(normalized);
    if (validation) { setError(validation); return; }
    await DB.saveHeartSyncRecord(normalized);
    setQuestions(prev => sortNewest([normalized, ...prev.filter(item => item.id !== normalized.id)]));
    setDraft(null); setError(''); setView('list');
    addToast('心理测试题已保存', 'success');
  };

  const openNewQuestion = () => {
    const now = Date.now();
    setDraft({
      id: `heart-sync-psych-question-${now}`, kind: 'psych_question', questionType: 'choice', text: '',
      options: [
        { key: 'A', label: '', interpretation: '' },
        { key: 'B', label: '', interpretation: '' },
      ],
      createdAt: now, updatedAt: now,
    });
    setError(''); setView('editor');
  };

  const removeQuestion = async (question: HeartSyncPsychQuestion) => {
    if (!window.confirm(`删除“${question.text}”？历史测试仍会保留当时题面。`)) return;
    await DB.deleteHeartSyncRecord(question.id);
    setQuestions(prev => prev.filter(item => item.id !== question.id));
    addToast('题目已删除', 'success');
  };

  const openSession = async (question: HeartSyncPsychQuestion) => {
    if (!selectedChar) { addToast('请先选择角色', 'error'); return; }
    const unfinished = sortNewest(sessions.filter(item =>
      item.charId === selectedChar.id && item.questionId === question.id && item.phase !== 'complete'))[0];
    const session = unfinished || createPsychSession(question, selectedChar.id);
    if (!unfinished) await saveSession(session);
    setActiveSessionId(session.id); setSessionReturnView('list'); setView('session');
  };

  const modelBase = activeChar ? { char: activeChar, userProfile, groups, apiConfig, realtimeConfig } : null;

  const askPartner = async () => {
    if (!activeSession || !modelBase) return;
    setBusy(true); setError('');
    try {
      let response = await requestPsychInitialAnswer({ ...modelBase, question: activeSession.questionSnapshot });
      let parsed;
      try {
        parsed = parsePsychInitialAnswer(response.content, activeSession.questionSnapshot);
      } catch (firstError: any) {
        response = await requestPsychInitialAnswer({
          ...modelBase,
          question: activeSession.questionSnapshot,
          repairNote: firstError?.message || '请选择有效选项并返回规定 JSON',
        });
        parsed = parsePsychInitialAnswer(response.content, activeSession.questionSnapshot);
      }
      await saveSession({ ...activeSession, partnerAnswer: parsed, phase: 'user' });
    } catch (e: any) { setError(e?.message || '角色回答失败，请重试'); }
    finally { setBusy(false); }
  };

  const useDefaultAnswer = () => {
    if (!activeSession) return;
    const value = getPsychDefaultDraft(activeSession.questionSnapshot);
    setAnswerKey(value.optionKey || '');
    setAnswerText(value.text);
  };

  const saveCurrentDefault = async () => {
    if (!activeSession) return;
    const original = questions.find(item => item.id === activeSession.questionId);
    if (!original) { addToast('原题已删除，不能再修改默认答案', 'error'); return; }
    const next = setPsychDefaultAnswer(original, { optionKey: answerKey || undefined, text: answerText });
    await DB.saveHeartSyncRecord(next);
    setQuestions(prev => prev.map(item => item.id === next.id ? next : item));
    addToast('已保存为这道题的默认答案', 'success');
  };

  const askDiscussion = async (session: HeartSyncPsychSession) => {
    if (!modelBase) return;
    setBusy(true); setReplying(true); setError('');
    try {
      const response = await requestPsychDiscussionReply({ ...modelBase, session });
      await saveSession({
        ...session,
        turns: [...session.turns, { id: `psych-turn-${Date.now()}`, role: 'assistant', content: response.content, createdAt: Date.now() }],
      });
    } catch (e: any) { setError(e?.message || '回应生成失败，请重试'); }
    finally { setBusy(false); setReplying(false); }
  };

  const submitMyAnswer = async () => {
    if (!activeSession) return;
    const question = activeSession.questionSnapshot;
    if (question.questionType === 'choice' && !question.options?.some(option => option.key === answerKey)) {
      setError('请先选择一个答案'); return;
    }
    if (question.questionType === 'open' && !answerText.trim()) { setError('请先填写你的回答'); return; }
    const staged = await saveSession({
      ...activeSession,
      userAnswer: { optionKey: question.questionType === 'choice' ? answerKey : undefined, text: answerText.trim() },
      phase: 'discussion',
    });
    await askDiscussion(staged);
  };

  const sendDiscussion = async () => {
    if (!activeSession || !chatText.trim() || busy) return;
    const now = Date.now();
    const staged = await saveSession({
      ...activeSession,
      turns: [...activeSession.turns, { id: `psych-turn-${now}`, role: 'user', content: chatText.trim(), createdAt: now }],
    });
    setChatText('');
    await askDiscussion(staged);
  };

  const finishSession = async () => {
    if (!activeSession || !activeChar) return;
    setBusy(true); setError('');
    try {
      let messageId = activeSession.sharedMessageId;
      const completedAt = activeSession.completedAt || Date.now();
      const completed = { ...activeSession, phase: 'complete' as const, completedAt };
      if (!messageId) {
        const contextText = buildPsychContextText(completed, activeChar.name, userProfile.name || '我');
        const card: HeartSyncEventCard = {
          type: 'heart_sync_event_card', mode: 'psych', sessionId: completed.id,
          title: completed.questionSnapshot.text, charName: activeChar.name,
          displayPayload: buildPsychDisplayPayload(completed), contextText,
        };
        messageId = await persistHeartSyncEvent(activeChar.id, card);
      }
      await saveSession({ ...completed, sharedMessageId: messageId });
      setActiveCharacterId(activeChar.id);
      openApp(AppID.Chat);
      addToast('完整测试已发送到聊天', 'success');
    } catch (e: any) { setError(e?.message || '发送到聊天失败，请重试'); }
    finally { setBusy(false); }
  };

  const header = (title: string, back: () => void, right?: React.ReactNode) => (
    <div className="shrink-0 border-b border-rose-100 bg-white" style={{ paddingTop: 'var(--safe-top)' }}>
      <div className="flex h-16 items-center justify-between px-3">
        <button onClick={back} className="rounded-full p-2 text-slate-700" aria-label="返回"><ArrowLeft size={22} /></button>
        <b className="text-slate-800">{title}</b><div className="min-w-10 text-right">{right}</div>
      </div>
    </div>
  );

  const characterSelect = (
    <label className="flex items-center rounded-2xl bg-rose-50 px-4 py-3 text-sm text-slate-500">
      与&nbsp;<select value={charId} onChange={event => setCharId(event.target.value)} className="min-w-0 flex-1 bg-transparent font-bold text-slate-800 outline-none">
        {characters.map(char => <option key={char.id} value={char.id}>{char.name}</option>)}
      </select>&nbsp;一起测试
    </label>
  );

  const renderList = () => <div className="flex h-full flex-col bg-white">
    {header('心理测试', onBack, <div className="flex"><button onClick={() => setView('history')} className="p-2 text-rose-500" aria-label="心理测试记录"><ClockCounterClockwise size={20} /></button><button onClick={openNewQuestion} className="p-2 text-slate-700" aria-label="新增题目"><Plus size={22} /></button></div>)}
    <div className="flex-1 overflow-y-auto p-4 pb-[calc(24px+var(--safe-bottom))]">
      {characterSelect}
      <div className="mt-4 space-y-3">{questions.map(question => {
        const historyCount = sessions.filter(item => item.charId === charId && item.questionId === question.id && item.phase === 'complete').length;
        const unfinished = sessions.some(item => item.charId === charId && item.questionId === question.id && item.phase !== 'complete');
        return <section key={question.id} className="rounded-[22px] border border-rose-100 bg-white p-4 shadow-sm">
          <div className="flex items-start justify-between gap-3"><div className="min-w-0"><span className={`rounded-full px-2 py-1 text-[10px] font-bold ${question.questionType === 'choice' ? 'bg-rose-50 text-rose-600' : 'bg-orange-50 text-orange-700'}`}>{question.questionType === 'choice' ? '选择题' : '开放题'}</span><h2 className="mt-3 text-base font-bold leading-6 text-slate-800">{question.text}</h2><p className="mt-2 text-xs text-slate-400">{question.defaultAnswer ? '已设置我的默认答案' : '未设置默认答案'} · 与当前角色做过 {historyCount} 次</p></div><div className="flex shrink-0"><button onClick={() => { setDraft(JSON.parse(JSON.stringify(question))); setError(''); setView('editor'); }} className="p-2 text-slate-400">编辑</button><button onClick={() => void removeQuestion(question)} className="p-2 text-slate-300" aria-label="删除"><Trash size={17} /></button></div></div>
          <button onClick={() => void openSession(question)} className="mt-4 ml-auto flex h-10 items-center gap-1 rounded-2xl bg-rose-50 px-4 text-sm font-bold text-rose-500">{unfinished ? '继续' : '开始测试'}<ArrowRight size={16} /></button>
        </section>;
      })}</div>
      {!questions.length && <div className="flex min-h-96 flex-col items-center justify-center text-center"><div className="flex h-28 w-28 items-center justify-center rounded-[28px] bg-slate-100 text-slate-400">空题库</div><b className="mt-5 text-slate-800">还没有心理测试题</b><p className="mt-2 text-sm text-slate-400">把那些你真正想和 TA 讨论的问题放进来吧</p><button onClick={openNewQuestion} className="mt-5 h-12 w-full rounded-full bg-rose-500 font-bold text-white">＋ 创建第一道题</button></div>}
    </div>
  </div>;

  const renderEditor = () => {
    if (!draft) return renderList();
    const options = draft.options || [];
    return <div className="flex h-full flex-col bg-white">
      {header(draft.createdAt === draft.updatedAt && !questions.some(item => item.id === draft.id) ? '新增心理测试题' : '编辑心理测试题', () => { setDraft(null); setView('list'); })}
      <div className="flex-1 space-y-5 overflow-y-auto p-4 pb-[calc(24px+var(--safe-bottom))]">
        <div><p className="mb-2 text-xs font-semibold text-slate-400">题目类型</p><div className="grid grid-cols-2 rounded-2xl bg-rose-50 p-1"><button onClick={() => setDraft({ ...draft, questionType: 'choice', options: options.length >= 2 ? options : [{ key: 'A', label: '', interpretation: '' }, { key: 'B', label: '', interpretation: '' }] })} className={`h-11 rounded-xl font-bold ${draft.questionType === 'choice' ? 'bg-white text-rose-500 shadow-sm' : 'text-slate-400'}`}>选择题</button><button onClick={() => setDraft({ ...draft, questionType: 'open', options: undefined, defaultAnswer: draft.defaultAnswer ? { text: draft.defaultAnswer.text } : undefined })} className={`h-11 rounded-xl font-bold ${draft.questionType === 'open' ? 'bg-white text-rose-500 shadow-sm' : 'text-slate-400'}`}>开放题</button></div></div>
        <div><p className="mb-2 text-xs font-semibold text-slate-400">题目正文</p><textarea value={draft.text} onChange={event => setDraft({ ...draft, text: event.target.value })} rows={4} maxLength={500} placeholder="输入你想和 TA 讨论的问题……" className="w-full resize-none rounded-2xl border border-rose-100 p-3 text-sm outline-none focus:border-rose-300" /></div>
        {draft.questionType === 'choice' && <div><p className="mb-2 text-xs font-semibold text-slate-400">选项编辑</p><div className="space-y-3">{options.map((option, index) => <div key={option.key} className="rounded-2xl border border-rose-100 p-3"><div className="flex items-center gap-2"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-rose-50 text-xs font-bold text-rose-500">{option.key}</span><input value={option.label} onChange={event => setDraft(updatePsychQuestionOptions(draft, options.map((item, i) => i === index ? { ...item, label: event.target.value } : item)))} placeholder="选项文字" className="min-w-0 flex-1 bg-transparent text-sm outline-none" /><button disabled={options.length <= 2} onClick={() => setDraft(updatePsychQuestionOptions(draft, options.filter((_, i) => i !== index)))} className="p-2 text-slate-300 disabled:opacity-30"><X size={17} /></button></div><textarea value={option.interpretation} onChange={event => setDraft(updatePsychQuestionOptions(draft, options.map((item, i) => i === index ? { ...item, interpretation: event.target.value } : item)))} rows={2} placeholder="参考解释（可选）" className="mt-2 w-full resize-none bg-transparent text-xs text-slate-500 outline-none" /></div>)}</div><button onClick={() => { const key = nextPsychOptionKey(options); setDraft(updatePsychQuestionOptions(draft, [...options, { key, label: '', interpretation: '' }])); }} className="mt-3 h-11 w-full rounded-2xl bg-rose-50 text-sm font-bold text-rose-500">＋ 添加选项</button></div>}
        <div className="rounded-2xl bg-amber-50 p-4"><p className="mb-3 text-xs font-semibold text-slate-500">我的默认答案</p>{draft.questionType === 'choice' && <select value={draft.defaultAnswer?.optionKey || ''} onChange={event => setDraft({ ...draft, defaultAnswer: { optionKey: event.target.value || undefined, text: draft.defaultAnswer?.text || '' } })} className="h-11 w-full rounded-xl bg-white px-3 text-sm outline-none"><option value="">未设置</option>{options.map(option => <option key={option.key} value={option.key}>{option.key} · {option.label || '未填写'}</option>)}</select>}<textarea value={draft.defaultAnswer?.text || ''} onChange={event => setDraft({ ...draft, defaultAnswer: { optionKey: draft.defaultAnswer?.optionKey, text: event.target.value } })} rows={3} placeholder={draft.questionType === 'open' ? '写下你最想让 TA 听到的回答……' : '默认说明（可选）'} className="mt-2 w-full resize-none rounded-xl bg-white p-3 text-sm outline-none" /></div>
        {error && <p className="rounded-xl bg-red-50 p-3 text-sm text-red-500">{error}</p>}
        <button onClick={() => void saveQuestion()} className="flex h-13 w-full items-center justify-center gap-2 rounded-full bg-rose-500 py-3.5 font-bold text-white"><FloppyDisk size={19} />保存题目</button>
      </div>
    </div>;
  };

  const answerCard = (label: string, answer: HeartSyncPsychSession['partnerAnswer'], color: 'rose' | 'amber') => {
    if (!activeSession || !answer) return null;
    const interpretation = getPsychInterpretation(activeSession.questionSnapshot, answer.optionKey);
    return <div className={`rounded-2xl p-4 ${color === 'rose' ? 'bg-rose-50' : 'bg-amber-50'}`}><b className={color === 'rose' ? 'text-rose-600' : 'text-amber-700'}>{label}{answer.optionKey ? ` · ${optionLabel(activeSession.questionSnapshot, answer.optionKey)}` : ''}</b><p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-700">{answer.text}</p>{interpretation && <p className="mt-2 text-xs leading-5 text-slate-400">参考解释：{interpretation}</p>}</div>;
  };

  const renderSession = () => {
    if (!activeSession || !activeChar) return renderList();
    const question = activeSession.questionSnapshot;
    const complete = activeSession.phase === 'complete';
    const waitingText = activeSession.turns.length === 0
      ? `${activeChar.name} 正在阅读你的答案并准备回应……`
      : `${activeChar.name} 正在输入……`;
    return <div className="flex h-full flex-col bg-white">
      {header(complete ? '测试记录' : '心理测试', () => { setView(sessionReturnView); setActiveSessionId(''); })}
      <div className="flex-1 overflow-y-auto p-4 pb-[calc(24px+var(--safe-bottom))]">
        <p className="mb-3 text-xs text-slate-400">和 {activeChar.name} 一起</p>
        <section className="rounded-[22px] border border-rose-100 p-5"><h1 className="text-lg font-black leading-7 text-slate-800">{question.text}</h1>{question.questionType === 'choice' && <div className="mt-4 space-y-2">{question.options?.map(option => <div key={option.key} className="rounded-xl bg-slate-50 px-3 py-3 text-sm text-slate-500"><b className="mr-3 text-slate-400">{option.key}</b>{option.label}</div>)}</div>}</section>
        {activeSession.phase === 'partner' && <><div className="mt-4 rounded-2xl bg-orange-50 p-4 text-sm leading-6 text-orange-700">TA 会先独立回答。此时 TA 看不到你的默认答案和参考解释。</div><button disabled={busy} onClick={() => void askPartner()} className="mt-4 h-13 w-full rounded-full bg-rose-500 py-3.5 font-bold text-white disabled:opacity-50">{busy ? `${activeChar.name} 正在想……` : `听听 ${activeChar.name} 的答案`}</button></>}
        {(activeSession.phase === 'user' || activeSession.phase === 'discussion' || complete) && <div className="mt-4">{answerCard(`${activeChar.name} 的回答`, activeSession.partnerAnswer, 'rose')}</div>}
        {activeSession.phase === 'user' && <div className="mt-5"><p className="mb-3 text-sm font-bold text-slate-500">我的答案</p>{question.questionType === 'choice' && <div className="space-y-2">{question.options?.map(option => <button key={option.key} onClick={() => setAnswerKey(option.key)} className={`flex w-full items-center rounded-2xl border p-3 text-left text-sm ${answerKey === option.key ? 'border-rose-500 bg-rose-50 font-bold text-rose-600' : 'border-rose-100'}`}><span className="mr-3 flex h-7 w-7 items-center justify-center rounded-full bg-rose-100">{option.key}</span>{option.label}{answerKey === option.key && <Check className="ml-auto" />}</button>)}</div>} {question.defaultAnswer && <button onClick={useDefaultAnswer} className="mt-3 h-11 w-full rounded-full bg-rose-100 text-sm font-bold text-rose-600">使用默认答案</button>}<button onClick={() => void saveCurrentDefault()} className="mt-2 h-10 w-full text-sm font-semibold text-slate-400">保存为默认答案</button><textarea value={answerText} onChange={event => setAnswerText(event.target.value)} rows={4} maxLength={1000} placeholder="补充说明（可选）" className="mt-3 w-full resize-none rounded-2xl border border-rose-100 p-3 text-sm outline-none focus:border-rose-300" /><button disabled={busy} onClick={() => void submitMyAnswer()} className="mt-3 h-13 w-full rounded-full bg-rose-500 py-3.5 font-bold text-white disabled:opacity-50">提交我的答案</button></div>}
        {(activeSession.phase === 'discussion' || complete) && <div className="mt-4 space-y-4"><h2 className="font-black text-slate-800">答案揭晓</h2>{answerCard('我', activeSession.userAnswer, 'amber')}<h2 className="pt-2 font-black text-slate-800">继续聊聊</h2><div className="space-y-3">{activeSession.turns.map(turn => <div key={turn.id} className={`flex ${turn.role === 'user' ? 'justify-end' : 'justify-start'}`}><div className={`max-w-[85%] rounded-2xl px-4 py-3 text-sm leading-6 ${turn.role === 'user' ? 'bg-rose-500 text-white' : 'bg-slate-100 text-slate-700'}`}>{turn.content}</div></div>)}{replying && <div className="flex items-end gap-2" role="status" aria-live="polite"><img src={activeChar.avatar || ''} alt="" className="h-8 w-8 rounded-full object-cover" /><div className="max-w-[85%] rounded-2xl bg-slate-100 px-4 py-3 text-sm text-slate-500"><b className="block text-xs text-slate-600">{waitingText}</b><span className="mt-2 flex gap-1" aria-hidden="true"><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-rose-400" /><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-rose-400 [animation-delay:120ms]" /><i className="h-1.5 w-1.5 animate-bounce rounded-full bg-rose-400 [animation-delay:240ms]" /></span></div></div>}</div>{!complete && <><div className="flex gap-2"><input value={chatText} onChange={event => setChatText(event.target.value)} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void sendDiscussion(); } }} placeholder="说点什么……" className="h-11 min-w-0 flex-1 rounded-full border border-rose-100 px-4 text-sm outline-none" /><button disabled={!chatText.trim() || busy} onClick={() => void sendDiscussion()} className="grid h-11 w-11 place-items-center rounded-full bg-rose-500 text-white disabled:opacity-40">{replying ? <SpinnerGap size={18} className="animate-spin" /> : '↑'}</button></div>{activeSession.turns.length === 0 && (replying ? <div className="flex h-11 items-center justify-center gap-2 rounded-full bg-rose-50 text-sm font-bold text-rose-500"><SpinnerGap size={17} className="animate-spin" />正在准备回应…</div> : <button disabled={busy} onClick={() => void askDiscussion(activeSession)} className="h-11 w-full rounded-full bg-rose-100 text-sm font-bold text-rose-600 disabled:opacity-50">让 TA 开始回应</button>)}<button disabled={busy} onClick={() => void finishSession()} className="h-13 w-full rounded-full bg-rose-500 py-3.5 font-bold text-white disabled:opacity-50">结束测试并发送到聊天</button></>}{complete && <div className="rounded-2xl bg-emerald-50 p-4 text-sm font-bold text-emerald-600">已发送到聊天</div>}</div>}
        {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-500">{error}</p>}
      </div>
    </div>;
  };

  const renderHistory = () => <div className="flex h-full flex-col bg-slate-50">
    {header('心理测试记录', () => setView('list'))}<div className="flex-1 space-y-3 overflow-y-auto p-4 pb-[calc(24px+var(--safe-bottom))]">{sortNewest(sessions).map(session => {
      const char = characters.find(item => item.id === session.charId);
      return <button key={session.id} onClick={() => { setActiveSessionId(session.id); setSessionReturnView('history'); setView('session'); }} className="w-full rounded-2xl bg-white p-4 text-left shadow-sm"><div className="flex items-start justify-between gap-3"><b className="line-clamp-2 text-slate-800">{session.questionSnapshot.text}</b><span className={`shrink-0 rounded-full px-2 py-1 text-[10px] font-bold ${session.phase === 'complete' ? 'bg-emerald-50 text-emerald-600' : 'bg-amber-50 text-amber-600'}`}>{session.phase === 'complete' ? '已完成' : '进行中'}</span></div><p className="mt-2 text-xs text-slate-400">{char?.name || '已删除角色'} · {new Date(session.updatedAt).toLocaleString('zh-CN')} {session.sharedMessageId ? '· 已发送' : ''}</p></button>;
    })}{!sessions.length && <div className="flex h-72 items-center justify-center text-sm text-slate-400">还没有心理测试记录</div>}</div>
  </div>;

  return <div className="relative h-full w-full overflow-hidden font-sans">{view === 'list' && renderList()}{view === 'editor' && renderEditor()}{view === 'session' && renderSession()}{view === 'history' && renderHistory()}</div>;
};

export default PsychTestModule;
