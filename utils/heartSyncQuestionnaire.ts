import type {
  HeartSyncQuestionnaire,
  HeartSyncQuestionnaireAnswer,
  HeartSyncQuestionnaireQuestion,
  HeartSyncQuestionnaireResult,
  HeartSyncQuestionnaireSession,
} from '../types';

export const MAX_AUTO_ANSWER_ROUNDS = 3;

const extractJson = (raw: string): Record<string, unknown> | null => {
  const match = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]) as Record<string, unknown>; } catch { return null; }
};

export const QUESTIONNAIRE_AI_ORGANIZER_PROMPT = `请把我提供的网上问卷文本整理成指定 JSON。

要求：
1. 不要回答问卷。
2. 不要分析用户或角色。
3. 不修改原题含义。
4. 不擅自删除题目。
5. 保持题目原顺序。
6. 保持所有选项。
7. 为每题生成唯一 id。
8. 为每个选项生成稳定 key。
9. 完整保留原始计分规则。
10. 完整保留结果解释。
11. 只输出符合 schema 的 JSON。

Schema：
{
  "formatVersion": 1,
  "title": "问卷名称",
  "description": "可选说明",
  "instructions": "可选填写说明",
  "questions": [{
    "id": "q1",
    "text": "题目正文",
    "options": [{ "key": "A", "label": "选项文字" }]
  }],
  "scoringRules": "完整计分规则",
  "resultGuide": "可选的完整结果解释"
}`;

export function parseQuestionnaireImport(raw: string, now = Date.now()): HeartSyncQuestionnaire {
  let value: any;
  try { value = JSON.parse(raw); } catch { throw new Error('文件不是合法 JSON'); }
  if (value?.formatVersion !== 1) throw new Error('只支持 formatVersion 1');
  const title = String(value.title || '').trim();
  if (!title) throw new Error('问卷名称不能为空');
  if (!Array.isArray(value.questions) || !value.questions.length) throw new Error('问卷至少需要一道题');
  const questionIds = value.questions.map((item: any) => String(item?.id || '').trim());
  if (questionIds.some((id: string) => !id) || new Set(questionIds).size !== questionIds.length) {
    throw new Error('每道题必须有唯一 id');
  }
  const questions: HeartSyncQuestionnaireQuestion[] = value.questions.map((item: any, index: number) => {
    const text = String(item?.text || '').trim();
    if (!text) throw new Error(`第 ${index + 1} 题正文为空`);
    if (!Array.isArray(item.options) || item.options.length < 2) throw new Error(`第 ${index + 1} 题至少需要两个选项`);
    const options = item.options.map((option: any) => ({
      key: String(option?.key || '').trim(),
      label: String(option?.label || '').trim(),
    }));
    if (options.some((option: any) => !option.key || !option.label)) throw new Error(`第 ${index + 1} 题选项不完整`);
    if (new Set(options.map((option: any) => option.key)).size !== options.length) throw new Error(`第 ${index + 1} 题选项 key 重复`);
    return { id: questionIds[index], text, options };
  });
  const scoringRules = String(value.scoringRules || '').trim();
  if (!scoringRules) throw new Error('计分规则不能为空');
  return {
    // Import files are untrusted and share the same id-keyed store with settings/sessions.
    id: `heart-sync-questionnaire-${now}`,
    kind: 'questionnaire',
    formatVersion: 1,
    title,
    description: String(value.description || '').trim() || undefined,
    instructions: String(value.instructions || '').trim() || undefined,
    questions,
    scoringRules,
    resultGuide: String(value.resultGuide || '').trim() || undefined,
    createdAt: Number(value.createdAt) || now,
    updatedAt: now,
  };
}

export function createQuestionnaireSession(
  questionnaire: HeartSyncQuestionnaire,
  charId: string,
  now = Date.now(),
): HeartSyncQuestionnaireSession {
  return {
    id: `heart-sync-questionnaire-session-${now}-${Math.random().toString(36).slice(2, 8)}`,
    kind: 'questionnaire_session',
    questionnaireId: questionnaire.id,
    questionnaireSnapshot: JSON.parse(JSON.stringify(questionnaire)),
    charId,
    phase: 'answering',
    answers: [],
    answerRound: 0,
    createdAt: now,
    updatedAt: now,
  };
}

export function getMissingQuestionnaireQuestions(session: HeartSyncQuestionnaireSession): HeartSyncQuestionnaireQuestion[] {
  const frozen = new Set(session.answers.map(answer => answer.questionId));
  return session.questionnaireSnapshot.questions.filter(question => !frozen.has(question.id));
}

export function buildQuestionnaireAnswerPrompt(session: HeartSyncQuestionnaireSession): string {
  const questionnaire = session.questionnaireSnapshot;
  const questions = getMissingQuestionnaireQuestions(session);
  const blindPayload = {
    title: questionnaire.title,
    description: questionnaire.description,
    instructions: questionnaire.instructions,
    questions,
  };
  return [
    '请以你自己的真实视角完成下面这些选择题。不要分析结果，不要解释答案，不要替用户回答。',
    `本轮只回答尚未锁定的 ${questions.length} 道题：\n${JSON.stringify(blindPayload, null, 2)}`,
    '只返回 JSON：{"answers":[{"questionId":"q1","optionKey":"A"}]}。不要遗漏，不要返回其它字段。',
  ].join('\n\n');
}

export function mergeQuestionnaireAnswerResponse(
  session: HeartSyncQuestionnaireSession,
  raw: string,
): { answers: HeartSyncQuestionnaireAnswer[]; addedCount: number } {
  const json = extractJson(raw);
  if (!json || !Array.isArray(json.answers)) throw new Error('角色没有返回有效答案 JSON');
  const frozen = new Set(session.answers.map(answer => answer.questionId));
  const missingById = new Map(getMissingQuestionnaireQuestions(session).map(question => [question.id, question]));
  const returned = new Map<string, string[]>();
  for (const item of json.answers as any[]) {
    const questionId = String(item?.questionId || '').trim();
    if (!questionId || frozen.has(questionId) || !missingById.has(questionId)) continue;
    const optionKey = String(item?.optionKey || '').trim();
    returned.set(questionId, [...(returned.get(questionId) || []), optionKey]);
  }
  const accepted: HeartSyncQuestionnaireAnswer[] = [];
  for (const [questionId, keys] of returned) {
    const question = missingById.get(questionId)!;
    const uniqueKeys = [...new Set(keys)];
    if (uniqueKeys.length !== 1) continue;
    const optionKey = uniqueKeys[0];
    if (!question.options.some(option => option.key === optionKey)) continue;
    accepted.push({ questionId, optionKey });
  }
  return { answers: [...session.answers, ...accepted], addedCount: accepted.length };
}

export function canEvaluateQuestionnaire(session: HeartSyncQuestionnaireSession): boolean {
  return getMissingQuestionnaireQuestions(session).length === 0;
}

export function buildQuestionnaireEvaluationPrompt(session: HeartSyncQuestionnaireSession): string {
  if (!canEvaluateQuestionnaire(session)) throw new Error('答案未完整，不能结算');
  const questionnaire = session.questionnaireSnapshot;
  const answerMap = new Map(session.answers.map(answer => [answer.questionId, answer.optionKey]));
  const frozenAnswers = questionnaire.questions.map(question => {
    const optionKey = answerMap.get(question.id)!;
    const option = question.options.find(item => item.key === optionKey)!;
    return { questionId: question.id, question: question.text, optionKey, optionLabel: option.label };
  });
  return [
    '角色已经独立完成整份问卷，以下答案已经冻结，不允许修改。现在只按照原问卷规则计算结果。',
    `问卷：${questionnaire.title}`,
    `冻结答案：\n${JSON.stringify(frozenAnswers, null, 2)}`,
    `计分规则：\n${questionnaire.scoringRules}`,
    questionnaire.resultGuide ? `结果解释：\n${questionnaire.resultGuide}` : '',
    '只返回 JSON：{"resultLabel":"结果名称","scoreSummary":"可选分数或类型","calculationSummary":"可核对的计分摘要","reaction":"你对结果的自然反应"}',
  ].filter(Boolean).join('\n\n');
}

export function parseQuestionnaireResult(raw: string): HeartSyncQuestionnaireResult {
  const json = extractJson(raw);
  if (!json) throw new Error('角色没有返回有效结算 JSON');
  const resultLabel = String(json.resultLabel || '').trim();
  if (!resultLabel) throw new Error('结算结果缺少 resultLabel');
  return {
    resultLabel,
    scoreSummary: String(json.scoreSummary || '').trim() || undefined,
    calculationSummary: String(json.calculationSummary || '').trim() || undefined,
    reaction: String(json.reaction || '').trim() || undefined,
  };
}

export function buildQuestionnaireContextText(
  session: HeartSyncQuestionnaireSession,
  charName: string,
): string {
  const questionnaire = session.questionnaireSnapshot;
  const order = new Map(questionnaire.questions.map((question, index) => [question.id, index + 1]));
  const frozen = session.answers
    .slice()
    .sort((a, b) => (order.get(a.questionId) || 0) - (order.get(b.questionId) || 0))
    .map(answer => `${order.get(answer.questionId) || answer.questionId}${answer.optionKey}`)
    .join(', ');
  return [
    '[心心相印·问卷填写]',
    `${charName}完成了《${questionnaire.title}》。`,
    `结果：${[session.result?.scoreSummary, session.result?.resultLabel].filter(Boolean).join('，') || '未记录' }。`,
    `角色完成问卷时的冻结选择：\n${frozen}`,
    session.result?.reaction ? `TA 对结果的反应：\n“${session.result.reaction}”` : '',
  ].filter(Boolean).join('\n\n');
}

export function buildQuestionnaireDisplayPayload(session: HeartSyncQuestionnaireSession): Record<string, unknown> {
  return {
    questionnaire: session.questionnaireSnapshot,
    answers: session.answers,
    result: session.result,
    completedAt: session.completedAt,
  };
}
