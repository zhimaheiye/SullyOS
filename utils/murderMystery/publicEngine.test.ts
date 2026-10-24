import { afterEach, beforeEach, expect, it } from 'vitest';
import { DB, DB_VERSION, openDB } from '../db';
import { validateMurderMysteryScript, type MurderMysteryScript } from './script';
import { buildPlayerView, createMurderMysterySession, initialGrantEvents } from './session';

// Independently invented contract data; no third-party story is bundled.
const script: MurderMysteryScript = {
  schemaVersion: 1, id: 'synthetic-lamp', title: '合成灯光谜题',
  publicBackground: '桌上的灯熄灭了。', publicRules: [],
  seats: [{ id: 'witness', name: '见证者', personalScript: '我只看到了开关。', beliefs: [], privateKnowledge: [] }],
  investigator: { id: 'observer', name: '调查者' },
  objectiveFacts: [{ id: 'truth', text: '仅主持人知道：定时器关闭了灯。' }],
  clues: [{ id: 'later', text: '第二幕公开的定时器', audience: ['witness'], grant: { kind: 'phase', phaseId: 'second' } }],
  phases: [{ id: 'first', title: '询问', fourChoiceSeatIds: ['witness'] }, { id: 'second', title: '检查' }],
  deliverables: [], abilities: [],
  communicationRules: { publicTable: true, hostPlayerOoc: true, hostPlayerGame: true, playerPrivate: false },
  victoryConditions: [], endings: [],
};
beforeEach(async () => { await DB.deleteDB(); });
afterEach(async () => { await DB.deleteDB(); });

it('validates generic imports, migrates stores, freezes identity and separates hidden facts', async () => {
  expect(validateMurderMysteryScript(script).script).toBeDefined();
  expect((await openDB()).version).toBe(DB_VERSION);
  await DB.saveMurderMysteryScript(script);
  const frozen = createMurderMysterySession(script, { witness: 'npc' }, 'detective');
  let session = await DB.createMurderMysterySession(frozen, initialGrantEvents(frozen));
  const visible = JSON.stringify(buildPlayerView(session, await DB.getMurderMysteryEvents(session.id), 'npc'));
  expect(visible).toContain('我只看到了开关');
  expect(visible).not.toContain('定时器');
  await expect(DB.appendMurderMysteryEvent(session.id, session.revision, {
    channel: 'public_table', audienceIds: ['npc'], speechMode: 'in_character', content: '未开场',
  })).rejects.toThrow();
  const staleRevision = session.revision;
  session = await DB.applyMurderMysteryCommand(session.id, session.revision, { type: 'game_start' });
  await expect(DB.applyMurderMysteryCommand(session.id, staleRevision, { type: 'advance_round' })).rejects.toThrow();
  session = await DB.applyMurderMysteryCommand(session.id, session.revision, { type: 'investigator_question', targetSeatId: 'witness', content: '灯是否亮着？' });
  await expect(DB.applyMurderMysteryCommand(session.id, session.revision, { type: 'answer_question', speakerCharId: 'npc', answer: '任意说明' })).rejects.toThrow();
  session = await DB.applyMurderMysteryCommand(session.id, session.revision, { type: 'answer_question', speakerCharId: 'npc', answer: '不知道' });
  session = await DB.applyMurderMysteryCommand(session.id, session.revision, { type: 'confirm_phase', phaseId: 'second' });
  expect(JSON.stringify(buildPlayerView(session, await DB.getMurderMysteryEvents(session.id), 'npc'))).toContain('第二幕公开的定时器');
  const backup = await DB.exportFullData();
  expect(backup.murderMysteryScripts?.[0].id).toBe(script.id);
  expect(backup.murderMysterySessions?.[0].id).toBe(session.id);
  await DB.deleteDB();
  await DB.importFullData({ timestamp: 1, version: 1, murderMysteryScripts: backup.murderMysteryScripts,
    murderMysterySessions: backup.murderMysterySessions, murderMysteryEvents: backup.murderMysteryEvents } as any);
  expect((await DB.getMurderMysterySession(session.id))?.revision).toBe(session.revision);
  expect(await DB.getMurderMysteryEvents(session.id)).toHaveLength(backup.murderMysteryEvents!.length);
});
