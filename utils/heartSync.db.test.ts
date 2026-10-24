import { afterEach, describe, expect, it } from 'vitest';
import type { FullBackupData, HeartSyncPsychQuestion, HeartSyncQuestionnaire } from '../types';
import { createPsychSession } from './heartSyncPsych';
import { createQuestionnaireSession } from './heartSyncQuestionnaire';
import { DB } from './db';

const psychQuestion: HeartSyncPsychQuestion = {
  id: 'heart-sync-db-psych-question', kind: 'psych_question', questionType: 'open', text: '此刻最在意什么？',
  createdAt: 1, updatedAt: 1,
};
const questionnaire: HeartSyncQuestionnaire = {
  id: 'heart-sync-db-questionnaire', kind: 'questionnaire', formatVersion: 1, title: '测试问卷',
  questions: [{ id: 'q1', text: '第一题', options: [{ key: 'A', label: '是' }, { key: 'B', label: '否' }] }],
  scoringRules: 'A 计 1 分', createdAt: 1, updatedAt: 1,
};
const ids = [
  psychQuestion.id,
  'heart-sync-psych-2-dbtest',
  questionnaire.id,
  'heart-sync-questionnaire-session-2-dbtest',
];

describe('heart_sync 扩展记录与完整备份', () => {
  afterEach(async () => { await Promise.all(ids.map(id => DB.deleteHeartSyncRecord(id))); });

  it('心理题/session 与问卷/session 均通过原 heart_sync 整仓备份往返', async () => {
    const psychSession = { ...createPsychSession(psychQuestion, 'char', 2), id: ids[1] };
    const questionnaireSession = { ...createQuestionnaireSession(questionnaire, 'char', 2), id: ids[3] };
    await Promise.all([
      DB.saveHeartSyncRecord(psychQuestion), DB.saveHeartSyncRecord(psychSession),
      DB.saveHeartSyncRecord(questionnaire), DB.saveHeartSyncRecord(questionnaireSession),
    ]);
    const exported = await DB.exportFullData();
    expect(exported.heartSyncRecords).toEqual(expect.arrayContaining([psychQuestion, psychSession, questionnaire, questionnaireSession]));

    await Promise.all(ids.map(id => DB.deleteHeartSyncRecord(id)));
    await DB.importFullData({ timestamp: 1, version: 1, heartSyncRecords: [psychQuestion, psychSession, questionnaire, questionnaireSession] } as FullBackupData);
    expect(await DB.getHeartSyncPsychQuestions()).toContainEqual(psychQuestion);
    expect(await DB.getHeartSyncPsychSessions()).toContainEqual(psychSession);
    expect(await DB.getHeartSyncQuestionnaires()).toContainEqual(questionnaire);
    expect(await DB.getHeartSyncQuestionnaireSessions()).toContainEqual(questionnaireSession);
  });
});
