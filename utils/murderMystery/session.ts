import type { MurderMysteryScript } from './script';
import { buildInitialSeatPacket, validateMurderMysteryScript } from './script';

export type MysteryChannel = 'public_table' | 'host_player_ooc' | 'host_player_game' | 'player_private' | 'host_system';
export type MysterySpeechMode = 'in_character' | 'out_of_character' | 'system';

export interface MurderMysterySession {
  id: string;
  scriptId: string;
  scriptSnapshot: MurderMysteryScript;
  seats: Record<string, string>; // seat id -> original character id
  participation?: { investigatorCharId: string; humanSeatIds: string[] };
  dialogueApiPresetId?: string;
  createdAt: number;
  updatedAt: number;
  revision: number;
  status: 'preparation' | 'playing' | 'ended';
  phaseId: string | null;
  strategyNotes: Record<string, string>; // original character id -> editable private note
  grantedClueIds: string[];
  grantedDeliverableIds: string[];
  grantedAbilityIds: string[];
  roundNumber: number;
  abilityUses: Record<string, number>; // `${abilityId}:${holderSeatId}` -> used count
  activeEffects: Array<{ id: string; abilityId: string; targetSeatId: string; label: string; remainingRounds: number; blocksPublicSpeech: boolean }>;
  privateThreads: Array<{ id: string; participantCharIds: [string, string]; active: boolean; openedAt: number; sourceRequestId?: string }>;
  investigatorNote?: string;
  pendingQuestion?: { targetSeatId: string; content: string; askedAtRevision: number };
  pendingAbility?: { abilityId: string; targetSeatId: string };
  pendingDecision?: { kind: 'phase' | 'victory'; targetId: string; reason: string; source: 'rule' | 'ai' | 'host' };
  outcome?: { endingId?: string; winnerSeatIds: string[]; verdict: string };
  realityWritebackCharIds?: string[];
}

export interface MurderMysteryEvent {
  id: string;
  sessionId: string;
  revision: number;
  timestamp: number;
  channel: MysteryChannel;
  audienceIds: string[]; // frozen original character ids; GM can always inspect
  speakerCharId?: string;
  speakerActorId?: string; // stable seat or investigator actor; human seats have no charId
  seatId?: string;
  speechMode: MysterySpeechMode;
  content: string;
  action?: string;
  grantId?: string;
  threadId?: string;
  targetSeatId?: string;
  correctsEventId?: string;
}

export function normalizeMurderMysterySession(session: MurderMysterySession): MurderMysterySession {
  return { ...session, roundNumber: session.roundNumber || 0, abilityUses: session.abilityUses || {},
    activeEffects: session.activeEffects || [], privateThreads: session.privateThreads || [],
    realityWritebackCharIds: session.realityWritebackCharIds || [] };
}

export const humanActorId = (seatId: string) => `human:${seatId}`;
export function publicAudience(session: MurderMysterySession): string[] {
  return [...Object.values(session.seats), ...(session.participation?.investigatorCharId ? [session.participation.investigatorCharId] : []),
    ...(session.participation?.humanSeatIds || []).map(humanActorId)];
}
export function seatAudience(session: MurderMysterySession, seatId: string): string {
  if (seatId === session.scriptSnapshot.investigator?.id) return session.participation?.investigatorCharId || '';
  return session.participation?.humanSeatIds.includes(seatId) ? humanActorId(seatId) : session.seats[seatId];
}

export function createMurderMysterySession(script: MurderMysteryScript, seats: Record<string, string>, investigatorCharId?: string, dialogueApiPresetId?: string): MurderMysterySession {
  if (!validateMurderMysteryScript(script).script) throw new Error('剧本结构未通过校验');
  const seatIds = script.seats.map(seat => seat.id);
  const humanSeatIds = investigatorCharId ? script.humanSeatIds || [] : [];
  if (seatIds.some(id => !humanSeatIds.includes(id) && !seats[id]) || Object.keys(seats).some(id => !seatIds.includes(id) || humanSeatIds.includes(id))) throw new Error('请给每个 AI 席位分配现有角色，真人席位不能绑定角色');
  if (new Set(Object.values(seats)).size !== Object.keys(seats).length || (investigatorCharId && Object.values(seats).includes(investigatorCharId))) throw new Error('同一角色不能占多个 AI 身份');
  if (script.investigator && !investigatorCharId) throw new Error('请选择已有神经链接角色担任调查者');
  if (!script.investigator && investigatorCharId) throw new Error('剧本没有独立调查者');
  const now = Date.now();
  return {
    id: crypto.randomUUID(), scriptId: script.id, scriptSnapshot: structuredClone(script), seats: { ...seats },
    ...(investigatorCharId ? { participation: { investigatorCharId, humanSeatIds: [...humanSeatIds] } } : {}),
    ...(dialogueApiPresetId ? { dialogueApiPresetId } : {}),
    createdAt: now, updatedAt: now, revision: 0, status: 'preparation', phaseId: script.phases[0]?.id || null,
    strategyNotes: {}, grantedClueIds: [], grantedDeliverableIds: [], grantedAbilityIds: [],
    roundNumber: 0, abilityUses: {}, activeEffects: [], privateThreads: [], realityWritebackCharIds: [],
  };
}

export function seatForChar(session: MurderMysterySession, charId: string): string {
  const seat = Object.entries(session.seats).find(([, id]) => id === charId)?.[0];
  if (!seat) throw new Error('角色没有参与本局');
  return seat;
}

export function initialGrantEvents(session: MurderMysterySession): Array<Pick<MurderMysteryEvent, 'channel' | 'audienceIds' | 'speechMode' | 'content' | 'action' | 'grantId'>> {
  const script = session.scriptSnapshot;
  return [
    ...script.seats.map(seat => ({
      channel: 'host_player_game' as const, audienceIds: [seatAudience(session, seat.id)], speechMode: 'system' as const,
      content: `初始个人本：${seat.name}\n${seat.personalScript}`, action: 'grant_personal', grantId: seat.id,
    })),
    ...script.clues.filter(clue => clue.grant.kind === 'initial').map(clue => ({
      channel: 'host_player_game' as const, audienceIds: clue.initiallyPublic ? publicAudience(session) : clue.audience.map(id => seatAudience(session, id)),
      speechMode: 'system' as const, content: clue.text, action: 'grant_clue', grantId: clue.id,
    })),
    ...script.deliverables.filter(item => item.grant.kind === 'initial').map(item => ({
      channel: 'host_player_game' as const, audienceIds: item.audience.map(id => seatAudience(session, id)),
      speechMode: 'system' as const, content: `${item.title}\n${item.text}`, action: 'grant_deliverable', grantId: item.id,
    })),
    ...script.abilities.filter(item => item.grant.kind === 'initial').map(item => ({
      channel: 'host_player_game' as const, audienceIds: item.holderSeatIds.map(id => seatAudience(session, id)),
      speechMode: 'system' as const, content: `获得能力：${item.name}。${item.effect}`, action: 'grant_ability', grantId: item.id,
    })),
  ];
}

export function projectEventForPlayer(event: MurderMysteryEvent, charId: string): MurderMysteryEvent | null {
  return event.audienceIds.includes(charId) ? event : null;
}

export function effectiveSpeechMode(event: MurderMysteryEvent, events: MurderMysteryEvent[]): MysterySpeechMode {
  return [...events].reverse().find(item => item.action === 'speech_mode_correction' && item.correctsEventId === event.id)?.speechMode || event.speechMode;
}

export function buildPlayerView(session: MurderMysterySession, events: MurderMysteryEvent[], charId: string) {
  const seatId = seatForChar(session, charId);
  const script = session.scriptSnapshot;
  const packet = buildInitialSeatPacket(script, seatId);
  // Runtime grants are read from committed events, never from the script's future or GM-only fields.
  const visibleEvents = events.filter(event => projectEventForPlayer(event, charId)).sort((a, b) => a.revision - b.revision);
  const grantedIds = new Set(visibleEvents.filter(event => event.action?.startsWith('grant_')).map(event => event.grantId));
  return {
    ...packet,
    clues: script.clues.filter(item => grantedIds.has(item.id)).map(({ id, text }) => ({ id, text })),
    deliverables: script.deliverables.filter(item => grantedIds.has(item.id)).map(({ id, title, text }) => ({ id, title, text })),
    abilities: script.abilities.filter(item => grantedIds.has(item.id) && item.holderSeatIds.includes(seatId))
      .map(({ id, name, effect, uses, durationRounds }) => ({ id, name, effect, uses, durationRounds })),
    activeEffects: normalizeMurderMysterySession(session).activeEffects.filter(effect => effect.targetSeatId === seatId)
      .map(({ label, remainingRounds, blocksPublicSpeech }) => ({ label, remainingRounds, blocksPublicSpeech })),
    phase: script.phases.find(item => item.id === session.phaseId)?.title || '',
    phaseRules: script.phases.find(item => item.id === session.phaseId)?.publicRules || [],
    strategyNote: session.strategyNotes[charId] || '',
    events: visibleEvents.map(({ id, revision, timestamp, channel, speakerCharId, seatId: eventSeatId, content, action, threadId, targetSeatId, correctsEventId }) =>
      ({ id, revision, timestamp, channel, speakerCharId, seatId: eventSeatId, speechMode: effectiveSpeechMode(visibleEvents.find(item => item.id === id)!, visibleEvents), content, action, threadId, targetSeatId, correctsEventId })),
  };
}

export function buildInvestigatorView(session: MurderMysterySession, events: MurderMysteryEvent[], charId: string) {
  if (!session.participation || session.participation.investigatorCharId !== charId) throw new Error('不是本局调查者');
  const script = session.scriptSnapshot;
  const visible = events.filter(event => event.audienceIds.includes(charId) &&
    (event.channel === 'public_table' || event.action === 'grant_clue' || event.action === 'grant_deliverable' || event.action === 'grant_ability'))
    .sort((a, b) => a.revision - b.revision);
  const granted = new Set(visible.filter(event => event.action?.startsWith('grant_')).map(event => event.grantId));
  return {
    title: script.title, publicBackground: script.publicBackground, publicRules: script.publicRules,
    openingStatements: script.investigator?.openingStatements?.map(({ seatId, text }) => ({ seatId, text })) || [],
    phase: script.phases.find(phase => phase.id === session.phaseId)?.title || '',
    phaseRules: script.phases.find(phase => phase.id === session.phaseId)?.publicRules || [],
    suspects: script.seats.map(({ id, name, title }) => ({ id, name, title })),
    clues: script.clues.filter(item => granted.has(item.id)).map(({ id, text }) => ({ id, text })),
    deliverables: script.deliverables.filter(item => granted.has(item.id)).map(({ id, title, text }) => ({ id, title, text })),
    abilities: script.abilities.filter(item => granted.has(item.id) && item.holderSeatIds.includes(script.investigator!.id))
      .map(({ id, name, effect, uses, durationRounds }) => ({ id, name, effect, uses, durationRounds })),
    note: session.investigatorNote || '',
    events: visible.map(({ id, revision, timestamp, channel, speakerCharId, speakerActorId, seatId, speechMode, content, action, targetSeatId }) =>
      ({ id, revision, timestamp, channel, speakerCharId, speakerActorId, seatId, speechMode, content, action, targetSeatId })),
  };
}
