import type {
  HeartSyncPsychAnswer,
  HeartSyncPsychDefaultAnswer,
  HeartSyncPsychOption,
  HeartSyncPsychQuestion,
  HeartSyncPsychSession,
} from '../types';

const extractJson = (raw: string): Record<string, unknown> | null => {
  const match = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]) as Record<string, unknown>; } catch { return null; }
};

export function validatePsychQuestion(question: HeartSyncPsychQuestion): string | null {
  if (!question.text.trim()) return '请填写题目正文';
  if (question.questionType === 'open') return null;
  const options = question.options || [];
  if (options.length < 2) return '选择题至少需要两个选项';
  if (options.some(option => !option.key.trim() || !option.label.trim())) return '请填写完整的选项文字';
  if (new Set(options.map(option => option.key)).size !== options.length) return '选项 key 不能重复';
  return null;
}

export function updatePsychQuestionOptions(
  question: HeartSyncPsychQuestion,
  options: HeartSyncPsychOption[],
): HeartSyncPsychQuestion {
  const validDefault = options.some(option => option.key === question.defaultAnswer?.optionKey);
  return {
    ...question,
    options,
    defaultAnswer: validDefault
      ? question.defaultAnswer
      : question.defaultAnswer ? { text: question.defaultAnswer.text } : undefined,
  };
}

export function nextPsychOptionKey(options: HeartSyncPsychOption[]): string {
  return 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').find(key => !options.some(option => option.key === key))
    || `O${options.length + 1}`;
}

export function setPsychDefaultAnswer(
  question: HeartSyncPsychQuestion,
  answer: HeartSyncPsychDefaultAnswer,
  now = Date.now(),
): HeartSyncPsychQuestion {
  const text = answer.text.trim();
  if (question.questionType === 'open') {
    return { ...question, defaultAnswer: text ? { text } : undefined, updatedAt: now };
  }
  const optionKey = question.options?.some(option => option.key === answer.optionKey) ? answer.optionKey : undefined;
  return {
    ...question,
    defaultAnswer: optionKey || text ? { optionKey, text } : undefined,
    updatedAt: now,
  };
}

export function getPsychDefaultDraft(question: HeartSyncPsychQuestion): HeartSyncPsychAnswer {
  return {
    optionKey: question.questionType === 'choice' ? question.defaultAnswer?.optionKey : undefined,
    text: question.defaultAnswer?.text || '',
  };
}

export function createPsychSession(
  question: HeartSyncPsychQuestion,
  charId: string,
  now = Date.now(),
): HeartSyncPsychSession {
  return {
    id: `heart-sync-psych-${now}-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'psych_session',
    charId,
    questionId: question.id,
    questionSnapshot: JSON.parse(JSON.stringify(question)),
    phase: 'partner',
    turns: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function buildPsychInitialPrompt(question: HeartSyncPsychQuestion, repairNote?: string): string {
  const safeQuestion = {
    questionType: question.questionType,
    text: question.text,
    ...(question.questionType === 'choice'
      ? { options: (question.options || []).map(({ key, label }) => ({ key, label })) }
      : {}),
  };
  return [
    '请先独立回答这道心理测试题。不要替用户作答，也不要猜测用户会选什么。',
    `题目：${JSON.stringify(safeQuestion, null, 2)}`,
    question.questionType === 'choice'
      ? '只返回 JSON：{"optionKey":"存在的选项 key","answer":"你的真实理由"}'
      : '只返回 JSON：{"answer":"你的真实回答"}',
    repairNote ? `上次返回无效，请修正：${repairNote}` : '',
  ].filter(Boolean).join('\n\n');
}

export function parsePsychInitialAnswer(raw: string, question: HeartSyncPsychQuestion): HeartSyncPsychAnswer {
  const json = extractJson(raw);
  if (!json) throw new Error('角色没有返回有效 JSON');
  const text = String(json.answer ?? '').trim();
  if (!text) throw new Error('角色没有给出回答说明');
  if (question.questionType === 'open') return { text };
  const optionKey = String(json.optionKey ?? '').trim();
  if (!question.options?.some(option => option.key === optionKey)) throw new Error('角色选择了不存在的选项');
  return { optionKey, text };
}

export function getPsychInterpretation(question: HeartSyncPsychQuestion, optionKey?: string): string {
  if (!optionKey) return '';
  return question.options?.find(option => option.key === optionKey)?.interpretation || '';
}

const answerBlock = (label: string, answer: HeartSyncPsychAnswer | undefined, question: HeartSyncPsychQuestion) => {
  if (!answer) return `${label}：尚未回答`;
  const option = answer.optionKey ? question.options?.find(item => item.key === answer.optionKey) : undefined;
  const interpretation = getPsychInterpretation(question, answer.optionKey);
  return [
    `${label}${option ? `：选择 ${option.key} · ${option.label}` : '：'}`,
    answer.text,
    interpretation ? `对应参考解释：${interpretation}` : '',
  ].filter(Boolean).join('\n');
};

export function buildPsychDiscussionPrompt(session: HeartSyncPsychSession, latestUserMessage?: string): string {
  const question = session.questionSnapshot;
  const transcript = session.turns.map(turn => `${turn.role === 'user' ? '用户' : '你'}：${turn.content}`).join('\n');
  return [
    '这是一次双向心理测试讨论。请回应双方答案的相似或差异，也可以追问用户；不要把它写成单方面诊断。',
    `原题：${question.text}`,
    answerBlock('你的初始答案', session.partnerAnswer, question),
    answerBlock('用户的最终答案', session.userAnswer, question),
    transcript ? `此前讨论：\n${transcript}` : '这是答案揭晓后的第一次回应。',
    latestUserMessage ? `用户刚刚说：${latestUserMessage}` : '',
    '直接用你的口吻回复，不要输出 JSON 或角色名标签。',
  ].filter(Boolean).join('\n\n');
}

export function buildPsychContextText(
  session: HeartSyncPsychSession,
  charName: string,
  userName: string,
): string {
  const question = session.questionSnapshot;
  const transcript = session.turns.map(turn => `${turn.role === 'user' ? userName : charName}：${turn.content}`).join('\n');
  return [
    '[心心相印·心理测试]',
    `${charName}和${userName}完成了心理测试「${question.text}」。`,
    answerBlock(`${charName}的初始答案`, session.partnerAnswer, question),
    answerBlock(`${userName}的最终答案`, session.userAnswer, question),
    transcript ? `后续讨论：\n${transcript}` : '后续没有追加讨论。',
  ].join('\n\n');
}

export function buildPsychDisplayPayload(session: HeartSyncPsychSession): Record<string, unknown> {
  const question = session.questionSnapshot;
  const { defaultAnswer: _defaultAnswer, ...displayQuestion } = question;
  return {
    question: displayQuestion,
    partnerAnswer: session.partnerAnswer,
    partnerInterpretation: getPsychInterpretation(question, session.partnerAnswer?.optionKey),
    userAnswer: session.userAnswer,
    userInterpretation: getPsychInterpretation(question, session.userAnswer?.optionKey),
    turns: session.turns,
    completedAt: session.completedAt,
  };
}
