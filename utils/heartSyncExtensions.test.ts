import { describe, expect, it } from 'vitest';
import type { HeartSyncPsychQuestion, HeartSyncQuestionnaire, HeartSyncQuestionnaireSession } from '../types';
import {
  buildPsychContextText,
  buildPsychDisplayPayload,
  buildPsychDiscussionPrompt,
  buildPsychInitialPrompt,
  createPsychSession,
  getPsychDefaultDraft,
  nextPsychOptionKey,
  parsePsychInitialAnswer,
  setPsychDefaultAnswer,
  updatePsychQuestionOptions,
} from './heartSyncPsych';
import {
  buildQuestionnaireAnswerPrompt,
  buildQuestionnaireContextText,
  buildQuestionnaireEvaluationPrompt,
  canEvaluateQuestionnaire,
  createQuestionnaireSession,
  getMissingQuestionnaireQuestions,
  mergeQuestionnaireAnswerResponse,
  parseQuestionnaireImport,
  parseQuestionnaireResult,
} from './heartSyncQuestionnaire';

const psychQuestion: HeartSyncPsychQuestion = {
  id: 'psych-1', kind: 'psych_question', questionType: 'choice', text: '发生分歧时，你会怎么做？',
  options: [
    { key: 'A', label: '马上聊', interpretation: 'SECRET_A' },
    { key: 'B', label: '冷静一下', interpretation: 'SECRET_B' },
  ],
  defaultAnswer: { optionKey: 'B', text: 'SECRET_DEFAULT' },
  createdAt: 1, updatedAt: 1,
};

const questionnaire: HeartSyncQuestionnaire = {
  id: 'naire-1', kind: 'questionnaire', formatVersion: 1, title: '关系问卷',
  description: '按真实感受选择', instructions: '每题选一项',
  questions: [
    { id: 'q1', text: 'QUESTION_ONE', options: [{ key: 'A', label: '是' }, { key: 'B', label: '否' }] },
    { id: 'q2', text: 'QUESTION_TWO', options: [{ key: 'A', label: '高' }, { key: 'B', label: '低' }] },
    { id: 'q3', text: 'QUESTION_THREE', options: [{ key: 'A', label: '会' }, { key: 'B', label: '不会' }] },
  ],
  scoringRules: 'SECRET_SCORING_RULES', resultGuide: 'SECRET_RESULT_GUIDE', createdAt: 1, updatedAt: 1,
};

describe('心理测试纯逻辑', () => {
  it('盲答 prompt 从数据层移除默认答案与全部参考解释', () => {
    const prompt = buildPsychInitialPrompt(psychQuestion);
    expect(prompt).toContain('发生分歧时');
    expect(prompt).not.toContain('SECRET_DEFAULT');
    expect(prompt).not.toContain('SECRET_A');
    expect(prompt).not.toContain('SECRET_B');
    expect(prompt).not.toContain('defaultAnswer');
    expect(prompt).not.toContain('interpretation');
    expect(JSON.stringify(buildPsychDisplayPayload(createPsychSession(psychQuestion, 'char', 1)))).not.toContain('SECRET_DEFAULT');
  });

  it('默认答案只填入草稿，可修改并覆盖保存，不会推进 session', () => {
    const session = createPsychSession(psychQuestion, 'char', 10);
    expect(session.phase).toBe('partner');
    expect(getPsychDefaultDraft(psychQuestion)).toEqual({ optionKey: 'B', text: 'SECRET_DEFAULT' });
    const saved = setPsychDefaultAnswer(psychQuestion, { optionKey: 'A', text: '修改后的说明' }, 20);
    expect(saved.defaultAnswer).toEqual({ optionKey: 'A', text: '修改后的说明' });
    expect(session.phase).toBe('partner');
  });

  it('删除默认选项会清除悬空 key，历史 session 仍保留创建时快照', () => {
    const session = createPsychSession(psychQuestion, 'char', 10);
    const edited = updatePsychQuestionOptions(psychQuestion, [psychQuestion.options![0]]);
    expect(edited.defaultAnswer).toEqual({ text: 'SECRET_DEFAULT' });
    expect(session.questionSnapshot.options).toHaveLength(2);
    expect(nextPsychOptionKey([{ key: 'A', label: '甲', interpretation: '' }, { key: 'C', label: '丙', interpretation: '' }])).toBe('B');
  });

  it('同角色可重复创建独立 session，选择题非法 key 不保存，开放题不要求 key', () => {
    expect(createPsychSession(psychQuestion, 'char', 1).id).not.toBe(createPsychSession(psychQuestion, 'char', 2).id);
    expect(() => parsePsychInitialAnswer('{"optionKey":"Z","answer":"理由"}', psychQuestion)).toThrow('不存在');
    expect(parsePsychInitialAnswer('{"answer":"我的回答"}', { ...psychQuestion, questionType: 'open', options: undefined }))
      .toEqual({ text: '我的回答' });
  });

  it('讨论 prompt 和聊天 context 保留不限轮数原文及双方实际解释', () => {
    const session = {
      ...createPsychSession(psychQuestion, 'char', 1), phase: 'discussion' as const,
      partnerAnswer: { optionKey: 'B', text: '我想先缓缓' },
      userAnswer: { optionKey: 'A', text: '我想马上谈' },
      turns: Array.from({ length: 12 }, (_, index) => ({
        id: String(index), role: index % 2 ? 'assistant' as const : 'user' as const,
        content: `第${index + 1}轮原文`, createdAt: index,
      })),
    };
    expect(buildPsychDiscussionPrompt(session)).toContain('第12轮原文');
    const context = buildPsychContextText(session, '林某', '我');
    expect(context).toContain('SECRET_A');
    expect(context).toContain('SECRET_B');
    expect(context).toContain('第12轮原文');
  });
});

describe('问卷冻结、补答与结算', () => {
  const makeSession = (): HeartSyncQuestionnaireSession => createQuestionnaireSession(questionnaire, 'char', 1);

  it('盲答 prompt 只含缺题，不含计分规则或结果解释', () => {
    const session = { ...makeSession(), answers: [{ questionId: 'q1', optionKey: 'A' }] };
    const prompt = buildQuestionnaireAnswerPrompt(session);
    expect(prompt).not.toContain('QUESTION_ONE');
    expect(prompt).toContain('QUESTION_TWO');
    expect(prompt).toContain('QUESTION_THREE');
    expect(prompt).not.toContain('SECRET_SCORING_RULES');
    expect(prompt).not.toContain('SECRET_RESULT_GUIDE');
  });

  it('合法部分答案立即冻结，后续 missing 只剩未完成题', () => {
    const merged = mergeQuestionnaireAnswerResponse(makeSession(), '{"answers":[{"questionId":"q1","optionKey":"A"},{"questionId":"q2","optionKey":"B"}]}');
    const session = { ...makeSession(), answers: merged.answers };
    expect(merged.addedCount).toBe(2);
    expect(getMissingQuestionnaireQuestions(session).map(item => item.id)).toEqual(['q3']);
    expect(buildQuestionnaireAnswerPrompt(session)).not.toContain('QUESTION_ONE');
  });

  it('冻结答案不可覆盖；同值重复去重，冲突与非法 key 保持 missing', () => {
    const session = { ...makeSession(), answers: [{ questionId: 'q1', optionKey: 'A' }] };
    const merged = mergeQuestionnaireAnswerResponse(session, JSON.stringify({ answers: [
      { questionId: 'q1', optionKey: 'B' },
      { questionId: 'q2', optionKey: 'A' }, { questionId: 'q2', optionKey: 'A' },
      { questionId: 'q3', optionKey: 'A' }, { questionId: 'q3', optionKey: 'B' },
    ] }));
    expect(merged.answers).toEqual([{ questionId: 'q1', optionKey: 'A' }, { questionId: 'q2', optionKey: 'A' }]);
    expect(getMissingQuestionnaireQuestions({ ...session, answers: merged.answers }).map(item => item.id)).toEqual(['q3']);

    const invalid = mergeQuestionnaireAnswerResponse(session, '{"answers":[{"questionId":"q2","optionKey":"Z"}]}');
    expect(invalid.addedCount).toBe(0);
  });

  it('只有完整答案可结算，第二阶段才包含规则且忽略返回中的 answers', () => {
    const partial = makeSession();
    expect(canEvaluateQuestionnaire(partial)).toBe(false);
    expect(() => buildQuestionnaireEvaluationPrompt(partial)).toThrow('不能结算');
    const complete = {
      ...partial,
      answers: questionnaire.questions.map(question => ({ questionId: question.id, optionKey: question.options[0].key })),
    };
    expect(buildQuestionnaireEvaluationPrompt(complete)).toContain('SECRET_SCORING_RULES');
    expect(parseQuestionnaireResult('{"answers":[{"questionId":"q1","optionKey":"B"}],"resultLabel":"较稳定","scoreSummary":"82分"}'))
      .toEqual({ resultLabel: '较稳定', scoreSummary: '82分', calculationSummary: undefined, reaction: undefined });
  });

  it('聊天 context 使用压缩答案，不包含题目正文、选项和规则', () => {
    const complete = {
      ...makeSession(),
      answers: [{ questionId: 'q1', optionKey: 'A' }, { questionId: 'q2', optionKey: 'B' }, { questionId: 'q3', optionKey: 'A' }],
      result: { resultLabel: '较稳定', scoreSummary: '82 分', reaction: '挺符合我的感受。' },
    };
    const context = buildQuestionnaireContextText(complete, '林某');
    expect(context).toContain('1A, 2B, 3A');
    expect(context).not.toContain('QUESTION_ONE');
    expect(context).not.toContain('SECRET_SCORING_RULES');
  });

  it('导入校验唯一题目 id、选项 key 与必填计分规则', () => {
    const imported = parseQuestionnaireImport(JSON.stringify({ ...questionnaire, id: 'settings' }), 99);
    expect(imported.id).toBe('heart-sync-questionnaire-99');
    expect(() => parseQuestionnaireImport(JSON.stringify({ ...questionnaire, scoringRules: '' }))).toThrow('计分规则');
    expect(() => parseQuestionnaireImport(JSON.stringify({
      ...questionnaire,
      questions: [questionnaire.questions[0], { ...questionnaire.questions[0] }],
    }))).toThrow('唯一 id');
  });
});
