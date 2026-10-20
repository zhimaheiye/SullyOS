import { afterEach, describe, expect, it } from 'vitest';
import type { CharacterStudySession, FullBackupData } from '../types';
import { DB } from './db';

const session: CharacterStudySession = {
  id: 'character-study-db-test',
  charId: 'char',
  topic: '测试主题',
  rationale: '想学',
  opening: '请开始吧',
  notesMarkdown: '# 测试主题',
  turns: [],
  status: 'active',
  createdAt: 1,
  updatedAt: 1,
};

describe('character study IndexedDB and full backup', () => {
  afterEach(async () => { await DB.deleteCharacterStudySession(session.id); });

  it('round-trips private study sessions through the full backup contract', async () => {
    await DB.saveCharacterStudySession(session);
    expect((await DB.exportFullData()).characterStudySessions).toContainEqual(session);

    await DB.deleteCharacterStudySession(session.id);
    expect(await DB.getCharacterStudySessions()).not.toContainEqual(session);

    await DB.importFullData({ timestamp: 1, version: 1, characterStudySessions: [session] } as FullBackupData);
    expect(await DB.getCharacterStudySessions()).toContainEqual(session);
  });
});
