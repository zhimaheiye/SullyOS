import React, { useEffect, useState } from 'react';
import {
  ArrowLeft, ArrowRight, CheckCircle, Copy, DownloadSimple, FileArrowUp, PencilSimple, Trash,
} from '@phosphor-icons/react';
import { useOS } from '../../context/OSContext';
import type { HeartSyncEventCard, HeartSyncQuestionnaire, HeartSyncQuestionnaireSession } from '../../types';
import { AppID } from '../../types';
import { DB } from '../../utils/db';
import { shareOrDownloadFile } from '../../utils/shareExport';
import {
  MAX_AUTO_ANSWER_ROUNDS,
  QUESTIONNAIRE_AI_ORGANIZER_PROMPT,
  buildQuestionnaireContextText,
  buildQuestionnaireDisplayPayload,
  canEvaluateQuestionnaire,
  createQuestionnaireSession,
  getMissingQuestionnaireQuestions,
  mergeQuestionnaireAnswerResponse,
  parseQuestionnaireImport,
  parseQuestionnaireResult,
} from '../../utils/heartSyncQuestionnaire';
import {
  persistHeartSyncEvent,
  requestQuestionnaireAnswers,
  requestQuestionnaireEvaluation,
} from '../../utils/heartSyncService';

type View = 'list' | 'detail' | 'runner';
const newest = <T extends { updatedAt: number }>(items: T[]) => [...items].sort((a, b) => b.updatedAt - a.updatedAt);

const QuestionnaireModule: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const {
    characters, userProfile, groups, apiConfig, realtimeConfig, addToast,
    setActiveCharacterId, openApp,
  } = useOS();
  const [view, setView] = useState<View>('list');
  const [questionnaires, setQuestionnaires] = useState<HeartSyncQuestionnaire[]>([]);
  const [sessions, setSessions] = useState<HeartSyncQuestionnaireSession[]>([]);
  const [charId, setCharId] = useState(characters[0]?.id || '');
  const [questionnaireId, setQuestionnaireId] = useState('');
  const [activeSessionId, setActiveSessionId] = useState('');
  const [editingMeta, setEditingMeta] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [descriptionDraft, setDescriptionDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const questionnaire = questionnaires.find(item => item.id === questionnaireId) || null;
  const activeSession = sessions.find(item => item.id === activeSessionId) || null;
  const activeChar = characters.find(item => item.id === (activeSession?.charId || charId)) || null;

  useEffect(() => {
    void Promise.all([DB.getHeartSyncQuestionnaires(), DB.getHeartSyncQuestionnaireSessions()]).then(([saved, savedSessions]) => {
      setQuestionnaires(newest(saved)); setSessions(newest(savedSessions));
    }).catch(() => addToast('问卷记录读取失败', 'error'));
  }, [addToast]);

  useEffect(() => { if (!charId && characters[0]) setCharId(characters[0].id); }, [charId, characters]);

  const saveSession = async (session: HeartSyncQuestionnaireSession) => {
    const next = { ...session, updatedAt: Date.now() };
    setSessions(prev => newest([next, ...prev.filter(item => item.id !== next.id)]));
    await DB.saveHeartSyncRecord(next);
    return next;
  };

  const header = (title: string, back: () => void, right?: React.ReactNode) => <div className="shrink-0 border-b border-rose-100 bg-white" style={{ paddingTop: 'var(--safe-top)' }}><div className="flex h-16 items-center justify-between px-3"><button onClick={back} className="rounded-full p-2 text-slate-700" aria-label="返回"><ArrowLeft size={22} /></button><b className="text-slate-800">{title}</b><div className="min-w-10 text-right">{right}</div></div></div>;
  const characterSelect = <label className="flex items-center rounded-2xl bg-rose-50 px-4 py-3 text-sm text-slate-400">填写角色&nbsp;<select value={charId} onChange={event => setCharId(event.target.value)} className="min-w-0 flex-1 bg-transparent font-bold text-slate-800 outline-none">{characters.map(char => <option key={char.id} value={char.id}>{char.name}</option>)}</select></label>;

  const importFile = async (file?: File) => {
    if (!file) return;
    try {
      const imported = parseQuestionnaireImport(await file.text());
      const unique = questionnaires.some(item => item.id === imported.id)
        ? { ...imported, id: `${imported.id}-${Date.now()}`, createdAt: Date.now(), updatedAt: Date.now() }
        : imported;
      await DB.saveHeartSyncRecord(unique);
      setQuestionnaires(prev => newest([unique, ...prev]));
      addToast('问卷已导入', 'success');
    } catch (e: any) { addToast(e?.message || '问卷导入失败', 'error'); }
  };

  const copyOrganizerPrompt = async () => {
    try { await navigator.clipboard.writeText(QUESTIONNAIRE_AI_ORGANIZER_PROMPT); addToast('AI 整理提示词已复制', 'success'); }
    catch { addToast('复制失败，请检查剪贴板权限', 'error'); }
  };

  const exportQuestionnaire = async (item: HeartSyncQuestionnaire) => {
    try {
      await shareOrDownloadFile({
        content: JSON.stringify(item, null, 2),
        fileName: `${item.title.replace(/[\\/:*?"<>|]/g, '_') || '心心相印问卷'}.json`,
        mimeType: 'application/json',
        shareTitle: `心心相印问卷：${item.title}`,
      });
    } catch (e: any) { addToast(e?.message || '问卷导出失败', 'error'); }
  };

  const removeQuestionnaire = async (item: HeartSyncQuestionnaire) => {
    if (!window.confirm(`删除问卷“${item.title}”？历史填写记录仍会保留。`)) return;
    await DB.deleteHeartSyncRecord(item.id);
    setQuestionnaires(prev => prev.filter(current => current.id !== item.id));
    setQuestionnaireId(''); setView('list'); addToast('问卷已删除', 'success');
  };

  const saveMetadata = async () => {
    if (!questionnaire || !titleDraft.trim()) return;
    const next = { ...questionnaire, title: titleDraft.trim(), description: descriptionDraft.trim() || undefined, updatedAt: Date.now() };
    await DB.saveHeartSyncRecord(next);
    setQuestionnaires(prev => prev.map(item => item.id === next.id ? next : item));
    setEditingMeta(false); addToast('问卷信息已保存', 'success');
  };

  const openDetail = (item: HeartSyncQuestionnaire) => {
    setQuestionnaireId(item.id); setTitleDraft(item.title); setDescriptionDraft(item.description || '');
    setEditingMeta(false); setView('detail');
  };

  const shareResult = async (session: HeartSyncQuestionnaireSession) => {
    const char = characters.find(item => item.id === session.charId);
    if (!char || !session.result) throw new Error('结果不完整，暂时无法发送到聊天');
    if (session.sharedMessageId) return session;
    const contextText = buildQuestionnaireContextText(session, char.name);
    const card: HeartSyncEventCard = {
      type: 'heart_sync_event_card', mode: 'questionnaire', sessionId: session.id,
      title: session.questionnaireSnapshot.title, charName: char.name,
      displayPayload: buildQuestionnaireDisplayPayload(session), contextText,
    };
    const messageId = await persistHeartSyncEvent(char.id, card);
    return saveSession({ ...session, sharedMessageId: messageId });
  };

  const evaluate = async (session: HeartSyncQuestionnaireSession) => {
    const char = characters.find(item => item.id === session.charId);
    if (!char || !canEvaluateQuestionnaire(session)) return;
    setBusy(true); setError('');
    try {
      const evaluating = session.phase === 'evaluating' ? session : await saveSession({ ...session, phase: 'evaluating' });
      const response = await requestQuestionnaireEvaluation({ char, userProfile, groups, apiConfig, realtimeConfig, session: evaluating });
      const result = parseQuestionnaireResult(response.content);
      const completed = await saveSession({ ...evaluating, phase: 'complete', result, completedAt: Date.now() });
      await shareResult(completed);
      addToast('问卷结果已自动发送到聊天', 'success');
    } catch (e: any) { setError(e?.message || '结算失败，请重新计算'); }
    finally { setBusy(false); }
  };

  const answerMissing = async (starting: HeartSyncQuestionnaireSession) => {
    const char = characters.find(item => item.id === starting.charId);
    if (!char) return;
    setBusy(true); setError('');
    let current = starting;
    try {
      for (let attempt = 0; attempt < MAX_AUTO_ANSWER_ROUNDS; attempt += 1) {
        if (canEvaluateQuestionnaire(current)) break;
        const response = await requestQuestionnaireAnswers({ char, userProfile, groups, apiConfig, realtimeConfig, session: current });
        const merged = mergeQuestionnaireAnswerResponse(current, response.content);
        current = await saveSession({ ...current, answers: merged.answers, answerRound: current.answerRound + 1 });
        if (merged.addedCount === 0) break;
      }
      if (canEvaluateQuestionnaire(current)) {
        setBusy(false);
        await evaluate(current);
      } else {
        setError(`还有 ${getMissingQuestionnaireQuestions(current).length} 道题未得到有效答案，请继续补答`);
      }
    } catch (e: any) { setError(e?.message || '答题返回无法解析，已锁定答案不会丢失'); }
    finally { setBusy(false); }
  };

  const startQuestionnaire = async (item: HeartSyncQuestionnaire) => {
    const char = characters.find(value => value.id === charId);
    if (!char) { addToast('请先选择角色', 'error'); return; }
    const unfinished = newest(sessions.filter(session =>
      session.questionnaireId === item.id && session.charId === char.id && session.phase !== 'complete'))[0];
    const session = unfinished || createQuestionnaireSession(item, char.id);
    if (!unfinished) await saveSession(session);
    setActiveSessionId(session.id); setQuestionnaireId(item.id); setView('runner');
    if (session.phase === 'answering') void answerMissing(session);
    else if (session.phase === 'evaluating') void evaluate(session);
  };

  const openLatestResult = (item: HeartSyncQuestionnaire) => {
    const result = newest(sessions.filter(session => session.questionnaireId === item.id && session.charId === charId && session.phase === 'complete'))[0];
    if (!result) return;
    setActiveSessionId(result.id); setQuestionnaireId(item.id); setView('runner');
  };

  const goChat = () => {
    if (!activeChar) return;
    setActiveCharacterId(activeChar.id); openApp(AppID.Chat);
  };

  const renderList = () => <div className="flex h-full flex-col bg-white">
    {header('问卷填写', onBack, <label className="cursor-pointer p-2 font-bold text-slate-700">导入<input type="file" accept="application/json,.json" className="hidden" onChange={event => { void importFile(event.target.files?.[0]); event.currentTarget.value = ''; }} /></label>)}
    <div className="flex-1 overflow-y-auto p-4 pb-[calc(24px+var(--safe-bottom))]">{characterSelect}<div className="mt-4 space-y-3">{questionnaires.map(item => {
      const latest = newest(sessions.filter(session => session.questionnaireId === item.id && session.charId === charId))[0];
      const unfinished = latest && latest.phase !== 'complete';
      return <section key={item.id} className="rounded-[22px] border border-rose-100 p-4"><button onClick={() => openDetail(item)} className="w-full text-left"><h2 className="font-black text-slate-800">{item.title}</h2>{item.description && <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-400">{item.description}</p>}<p className="mt-3 text-xs text-slate-400">{item.questions.length} 题{latest?.result?.scoreSummary ? ` · 最近 ${latest.result.scoreSummary}` : latest?.result?.resultLabel ? ` · ${latest.result.resultLabel}` : ' · 未做过'}</p></button><div className="mt-3 flex items-center justify-end gap-2">{latest?.phase === 'complete' && <button onClick={() => openLatestResult(item)} className="h-10 rounded-2xl px-3 text-xs font-bold text-slate-500">查看结果</button>}<button onClick={() => void startQuestionnaire(item)} className="h-10 rounded-2xl bg-rose-50 px-4 text-sm font-bold text-rose-500">{unfinished ? '继续填写' : '开始填写'}</button></div></section>;
    })}</div>{!questionnaires.length && <div className="flex min-h-96 flex-col items-center justify-center text-center"><div className="flex h-28 w-28 items-center justify-center rounded-[28px] bg-slate-100 text-slate-400">空问卷库</div><b className="mt-5 text-slate-800">还没有问卷</b><p className="mt-2 text-sm text-slate-400">可以从网上找到问卷后，让 AI 整理成导入格式</p><label className="mt-5 flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-full bg-rose-500 font-bold text-white"><FileArrowUp size={19} />导入 JSON<input type="file" accept="application/json,.json" className="hidden" onChange={event => { void importFile(event.target.files?.[0]); event.currentTarget.value = ''; }} /></label></div>}<button onClick={() => void copyOrganizerPrompt()} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full border border-rose-100 font-bold text-rose-500"><Copy size={18} />复制 AI 整理提示词</button></div>
  </div>;

  const renderDetail = () => {
    if (!questionnaire) return renderList();
    return <div className="flex h-full flex-col bg-white">{header('问卷详情', () => setView('list'), <button onClick={() => setEditingMeta(prev => !prev)} className="p-2 text-slate-600"><PencilSimple size={19} /></button>)}<div className="flex-1 overflow-y-auto p-4 pb-[calc(24px+var(--safe-bottom))]">{editingMeta ? <div className="space-y-3"><input value={titleDraft} onChange={event => setTitleDraft(event.target.value)} className="h-12 w-full rounded-2xl border border-rose-100 px-4 font-bold outline-none" /><textarea value={descriptionDraft} onChange={event => setDescriptionDraft(event.target.value)} rows={3} placeholder="问卷说明" className="w-full resize-none rounded-2xl border border-rose-100 p-4 text-sm outline-none" /><button onClick={() => void saveMetadata()} className="h-11 w-full rounded-full bg-rose-500 font-bold text-white">保存名称与说明</button></div> : <><h1 className="text-xl font-black text-slate-800">{questionnaire.title}</h1>{questionnaire.description && <p className="mt-2 text-sm leading-6 text-slate-500">{questionnaire.description}</p>}{questionnaire.instructions && <p className="mt-3 rounded-2xl bg-amber-50 p-3 text-xs leading-5 text-amber-700">{questionnaire.instructions}</p>}</>}<div className="mt-5 space-y-3">{questionnaire.questions.map((question, index) => <details key={question.id} className="rounded-2xl bg-slate-50 p-4"><summary className="cursor-pointer text-sm font-bold text-slate-700">{index + 1}. {question.text}</summary><div className="mt-3 space-y-1 text-xs text-slate-500">{question.options.map(option => <p key={option.key}>{option.key} · {option.label}</p>)}</div></details>)}</div><details className="mt-4 rounded-2xl bg-orange-50 p-4"><summary className="cursor-pointer text-sm font-bold text-orange-700">查看问卷规则</summary><p className="mt-3 whitespace-pre-wrap text-xs leading-5 text-slate-600">{questionnaire.scoringRules}</p>{questionnaire.resultGuide && <p className="mt-3 whitespace-pre-wrap border-t border-orange-100 pt-3 text-xs leading-5 text-slate-600">{questionnaire.resultGuide}</p>}</details><div className="mt-5 grid grid-cols-2 gap-2"><button onClick={() => exportQuestionnaire(questionnaire)} className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-rose-100 text-sm font-bold text-rose-500"><DownloadSimple size={17} />导出 JSON</button><button onClick={() => void removeQuestionnaire(questionnaire)} className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-red-100 text-sm font-bold text-red-400"><Trash size={17} />删除问卷</button></div><button onClick={() => void startQuestionnaire(questionnaire)} className="mt-3 h-13 w-full rounded-full bg-rose-500 py-3.5 font-bold text-white">让 {characters.find(item => item.id === charId)?.name || 'TA'} 填写</button></div></div>;
  };

  const renderRunner = () => {
    if (!activeSession || !activeChar) return renderList();
    const total = activeSession.questionnaireSnapshot.questions.length;
    const done = activeSession.answers.length;
    const missing = total - done;
    if (activeSession.phase === 'answering') return <div className="flex h-full flex-col bg-amber-50">{header('问卷填写', () => setView('list'))}<div className="flex-1 p-4"><h1 className="text-lg font-black text-slate-800">{activeChar.name} 正在填写《{activeSession.questionnaireSnapshot.title}》</h1><div className="mt-4 rounded-2xl bg-orange-50 p-4 text-sm leading-6 text-orange-700">这一步只会让 TA 看到题目和选项。评分规则暂时不会告诉 TA。</div><div className="mt-5 rounded-[22px] border border-rose-100 bg-white p-5">{done === 0 ? <><b className="text-orange-700">正在完成 {total} 道题……</b><div className="mt-4 h-2 overflow-hidden rounded-full bg-orange-100"><div className="h-full w-1/2 animate-pulse rounded-full bg-orange-500" /></div></> : <><b className="text-lg text-slate-800">已锁定 {done} / {total} 道答案</b><p className="mt-2 text-sm text-slate-400">还有 {missing} 道没有得到有效答案</p><div className="mt-4 h-2 overflow-hidden rounded-full bg-orange-100"><div className="h-full rounded-full bg-orange-500" style={{ width: `${(done / total) * 100}%` }} /></div></>}<p className="mt-3 text-xs text-slate-400">已尝试 {activeSession.answerRound} 轮 · 已有答案不会被覆盖</p></div>{error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-500">{error}</p>}<button disabled={busy} onClick={() => void answerMissing(activeSession)} className="mt-5 h-13 w-full rounded-full bg-rose-500 py-3.5 font-bold text-white disabled:opacity-50">{busy ? '正在补答剩余题目……' : done ? `继续补答剩余 ${missing} 题` : '开始填写'}</button></div></div>;
    if (activeSession.phase === 'evaluating') return <div className="flex h-full flex-col bg-amber-50">{header('问卷填写', () => setView('list'))}<div className="flex-1 p-4"><div className="rounded-[22px] border border-rose-100 bg-white p-6"><h1 className="text-2xl font-black text-orange-800">已完成 {done} / {total} 题</h1><span className="mt-3 inline-block rounded-full bg-orange-50 px-3 py-1 text-xs font-bold text-orange-700">TA 的答案已锁定</span><p className="mt-4 text-sm text-slate-400">评分规则即将套用，答案不会重新生成。</p></div>{error ? <><div className="mt-5 rounded-2xl border-2 border-rose-400 bg-white p-5"><b className="text-xl text-rose-600">结算失败了</b><p className="mt-3 text-sm text-slate-500">{error}</p></div><button disabled={busy} onClick={() => void evaluate(activeSession)} className="mt-5 h-13 w-full rounded-full bg-rose-500 py-3.5 font-bold text-white">重新计算</button><button onClick={() => setView('list')} className="mt-3 h-12 w-full rounded-full bg-rose-100 font-bold text-rose-600">返回问卷</button></> : <div className="mt-5 flex items-center gap-3 rounded-2xl bg-orange-50 p-4 text-orange-700"><span className="h-7 w-7 animate-pulse rounded-full bg-orange-500" />正在根据问卷规则计算结果……</div>}</div></div>;
    const result = activeSession.result;
    return <div className="flex h-full flex-col bg-amber-50">{header('问卷填写', () => setView('list'))}<div className="flex-1 overflow-y-auto p-4 pb-[calc(24px+var(--safe-bottom))]"><h1 className="text-xl font-black text-slate-800">{activeSession.questionnaireSnapshot.title}</h1><p className="mt-2 text-sm text-slate-400">{activeChar.name} 的测评结果</p><div className="mt-4 rounded-[22px] border border-rose-100 bg-white p-6"><p className="text-xs font-bold text-slate-400">最终结果</p><h2 className="mt-3 text-2xl font-black text-orange-600">{[result?.scoreSummary, result?.resultLabel].filter(Boolean).join(' · ')}</h2>{result?.calculationSummary && <p className="mt-3 text-sm leading-6 text-slate-500">{result.calculationSummary}</p>}{result?.reaction && <div className="mt-4 rounded-2xl bg-orange-50 p-4"><b className="text-sm text-orange-700">TA 的反应</b><p className="mt-2 text-sm leading-6 text-slate-700">“{result.reaction}”</p></div>}</div><div className="mt-4 grid grid-cols-2 gap-2"><details className="rounded-2xl border border-rose-100 bg-white p-4"><summary className="cursor-pointer text-center text-sm font-bold text-rose-500">查看全部答案</summary><div className="mt-3 space-y-3">{activeSession.questionnaireSnapshot.questions.map((question, index) => { const answer = activeSession.answers.find(item => item.questionId === question.id); const option = question.options.find(item => item.key === answer?.optionKey); return <div key={question.id} className="text-left text-xs leading-5 text-slate-500"><b>{index + 1}. {question.text}</b><p>{answer?.optionKey} · {option?.label}</p></div>; })}</div></details><details className="rounded-2xl border border-rose-100 bg-white p-4"><summary className="cursor-pointer text-center text-sm font-bold text-rose-500">查看问卷规则</summary><p className="mt-3 whitespace-pre-wrap text-left text-xs leading-5 text-slate-500">{activeSession.questionnaireSnapshot.scoringRules}</p>{activeSession.questionnaireSnapshot.resultGuide && <p className="mt-3 whitespace-pre-wrap border-t border-rose-100 pt-3 text-left text-xs leading-5 text-slate-500">{activeSession.questionnaireSnapshot.resultGuide}</p>}</details></div>{activeSession.sharedMessageId ? <div className="mt-4 flex items-center gap-2 rounded-2xl bg-emerald-100 p-4 text-sm font-bold text-emerald-700"><CheckCircle size={19} />已自动发送到聊天</div> : <button disabled={busy} onClick={() => void shareResult(activeSession).catch((e: any) => setError(e?.message || '发送失败'))} className="mt-4 h-12 w-full rounded-full bg-rose-100 font-bold text-rose-600">重试发送到聊天</button>}{error && <p className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-500">{error}</p>}<button onClick={goChat} className="mt-4 flex h-13 w-full items-center justify-center gap-2 rounded-full bg-rose-500 py-3.5 font-bold text-white">回到聊天继续聊<ArrowRight size={18} /></button></div></div>;
  };

  return <div className="relative h-full w-full overflow-hidden font-sans">{view === 'list' && renderList()}{view === 'detail' && renderDetail()}{view === 'runner' && renderRunner()}</div>;
};

export default QuestionnaireModule;
