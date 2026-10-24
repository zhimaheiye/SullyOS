import schema from '../../skills/murder-mystery-preprocess/schema.json';

export interface SourcePointer { document: string; excerpt: string; location?: string }
export interface ScriptFact { id: string; text: string; source?: SourcePointer }
export interface ScriptGrant { kind: 'initial' | 'phase' | 'event' | 'manual'; phaseId?: string; eventId?: string; note?: string }
export interface ScriptSeat { id: string; name: string; title?: string; personalScript: string; beliefs: ScriptFact[]; privateKnowledge: ScriptFact[]; objectives?: string[]; source?: SourcePointer }
export interface ScriptInvestigator { id: string; name: string; openingStatements?: Array<{ seatId: string; text: string; source?: SourcePointer }> }
export interface ScriptClue { id: string; text: string; audience: string[]; grant: ScriptGrant; initiallyPublic?: boolean; source?: SourcePointer }
export interface ScriptPhase { id: string; title: string; publicRules?: string[]; yesNoSeatIds?: string[]; fourChoiceSeatIds?: string[]; completionHint?: string; completion?: { action: 'accusation'; acceptedSeatIds: string[] }; revealObjectiveFacts?: boolean; source?: SourcePointer }
export const MYSTERY_YES_NO_OPTIONS = ['是', '不是'] as const;
export const MYSTERY_FOUR_CHOICE_OPTIONS = ['是', '不是', '不知道', '是也不是'] as const;
export function getMysteryAnswerOptions(phase: ScriptPhase | undefined, seatId: string): readonly string[] | undefined {
  if (phase?.fourChoiceSeatIds?.includes(seatId)) return MYSTERY_FOUR_CHOICE_OPTIONS;
  if (phase?.yesNoSeatIds?.includes(seatId)) return MYSTERY_YES_NO_OPTIONS;
  return undefined;
}
export interface ScriptDeliverable { id: string; title: string; text: string; audience: string[]; grant: ScriptGrant; source?: SourcePointer }
export interface ScriptAbility { id: string; name: string; holderSeatIds: string[]; grant: ScriptGrant; uses: number; durationRounds?: number; effect: string; outcomes?: Array<{ targetSeatId: string; label: string; blocksPublicSpeech?: boolean }>; conditions?: string[]; source?: SourcePointer }
export interface MurderMysteryScript {
  schemaVersion: 1; id: string; title: string; author?: string; description?: string;
  publicBackground: string; publicRules: string[]; seats: ScriptSeat[]; investigator?: ScriptInvestigator; humanSeatIds?: string[]; objectiveFacts: ScriptFact[];
  clues: ScriptClue[]; phases: ScriptPhase[]; deliverables: ScriptDeliverable[]; abilities: ScriptAbility[];
  communicationRules: { publicTable: boolean; hostPlayerOoc: boolean; hostPlayerGame: boolean; playerPrivate: boolean; privateConditions?: string[] };
  victoryConditions: Array<{ id: string; description: string; beneficiarySeatIds?: string[]; source?: SourcePointer }>;
  endings: Array<{ id: string; title: string; description: string; source?: SourcePointer }>;
  sourceNotes?: string[]; extensions?: Record<string, unknown>;
}
export interface ScriptDiagnostic { severity: 'error' | 'review'; path: string; message: string }
type SchemaNode = Record<string, any>;
const root = schema as SchemaNode;
const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

function walk(value: unknown, rule: SchemaNode, path: string, out: ScriptDiagnostic[]): void {
  if (rule.$ref) { walk(value, root.$defs[String(rule.$ref).split('/').pop()!], path, out); return; }
  const fail = (message: string) => out.push({ severity: 'error', path, message });
  if (rule.const !== undefined && value !== rule.const) fail(`必须为 ${JSON.stringify(rule.const)}`);
  if (rule.enum && !rule.enum.includes(value)) fail(`必须为 ${rule.enum.join(' / ')}`);
  if (rule.type === 'object') {
    if (!isRecord(value)) { fail('必须为对象'); return; }
    for (const key of rule.required || []) if (!(key in value)) out.push({ severity: 'error', path: `${path}.${key}`, message: '缺少必填字段' });
    for (const [key, item] of Object.entries(value)) {
      const child = rule.properties?.[key];
      if (child) walk(item, child, `${path}.${key}`, out);
      else if (rule.additionalProperties === false) out.push({ severity: 'error', path: `${path}.${key}`, message: '未知字段；扩展内容请放入 extensions' });
    }
  } else if (rule.type === 'array') {
    if (!Array.isArray(value)) { fail('必须为数组'); return; }
    if (rule.minItems !== undefined && value.length < rule.minItems) fail(`至少 ${rule.minItems} 项`);
    value.forEach((item, index) => walk(item, rule.items, `${path}[${index}]`, out));
  } else if (rule.type === 'string') {
    if (typeof value !== 'string') fail('必须为文本');
    else if (rule.minLength && !value.trim()) fail('不能为空');
  } else if (rule.type === 'boolean' && typeof value !== 'boolean') fail('必须为布尔值');
  else if (rule.type === 'integer' && !Number.isInteger(value)) fail('必须为整数');
  else if (rule.type === 'integer' && rule.minimum !== undefined && (value as number) < rule.minimum) fail(`不得小于 ${rule.minimum}`);
}

export function validateMurderMysteryScript(value: unknown): { script?: MurderMysteryScript; diagnostics: ScriptDiagnostic[] } {
  const diagnostics: ScriptDiagnostic[] = [];
  walk(value, root, '$', diagnostics);
  if (diagnostics.some(item => item.severity === 'error')) return { diagnostics };
  const script = value as MurderMysteryScript;
  const seatIds = new Set(script.seats.map(seat => seat.id));
  if (script.investigator && seatIds.has(script.investigator.id)) diagnostics.push({ severity: 'error', path: '$.investigator.id', message: '调查者 ID 不能与嫌疑人席位重复' });
  const phaseIds = new Set(script.phases.map(phase => phase.id));
  const checkUnique = (items: Array<{ id: string }>, path: string) => {
    const seen = new Set<string>();
    items.forEach((item, index) => {
      if (seen.has(item.id)) diagnostics.push({ severity: 'error', path: `${path}[${index}].id`, message: `重复 ID：${item.id}` });
      seen.add(item.id);
    });
  };
  checkUnique(script.seats, '$.seats'); checkUnique(script.phases, '$.phases');
  checkUnique(script.objectiveFacts, '$.objectiveFacts'); checkUnique(script.clues, '$.clues');
  checkUnique(script.deliverables, '$.deliverables'); checkUnique(script.abilities, '$.abilities');
  checkUnique(script.victoryConditions, '$.victoryConditions'); checkUnique(script.endings, '$.endings');
  script.seats.forEach((seat, i) => {
    checkUnique(seat.beliefs, `$.seats[${i}].beliefs`);
    checkUnique(seat.privateKnowledge, `$.seats[${i}].privateKnowledge`);
  });
  const checkSeats = (ids: string[], path: string, includeInvestigator = false) => ids.forEach(id => {
    if (includeInvestigator && id === script.investigator?.id) return;
    if (!seatIds.has(id)) diagnostics.push({ severity: 'error', path, message: `未知席位：${id}` });
  });
  const checkGrant = (grant: ScriptGrant, path: string) => {
    if (grant.kind === 'phase' && (!grant.phaseId || !phaseIds.has(grant.phaseId))) diagnostics.push({ severity: 'error', path, message: '阶段发放需引用已有 phaseId' });
    if (grant.kind === 'event' && !grant.eventId) diagnostics.push({ severity: 'error', path, message: '事件发放需填写 eventId' });
    if (grant.kind !== 'phase' && grant.phaseId) diagnostics.push({ severity: 'review', path, message: '非阶段发放同时填写 phaseId，请主持人确认' });
  };
  script.clues.forEach((clue, i) => { checkSeats(clue.audience, `$.clues[${i}].audience`, true); checkGrant(clue.grant, `$.clues[${i}].grant`); });
  script.deliverables.forEach((item, i) => { checkSeats(item.audience, `$.deliverables[${i}].audience`, true); checkGrant(item.grant, `$.deliverables[${i}].grant`); });
  script.abilities.forEach((item, i) => { checkGrant(item.grant, `$.abilities[${i}].grant`); });
  script.humanSeatIds && checkSeats(script.humanSeatIds, '$.humanSeatIds');
  script.investigator?.openingStatements?.forEach((item, i) => checkSeats([item.seatId], `$.investigator.openingStatements[${i}].seatId`));
  script.phases.forEach((item, i) => {
    checkSeats(item.yesNoSeatIds || [], `$.phases[${i}].yesNoSeatIds`);
    checkSeats(item.fourChoiceSeatIds || [], `$.phases[${i}].fourChoiceSeatIds`);
    for (const id of item.fourChoiceSeatIds || []) if (item.yesNoSeatIds?.includes(id)) diagnostics.push({ severity: 'error', path: `$.phases[${i}].fourChoiceSeatIds`, message: `席位不能同时声明二选一和四选项：${id}` });
  });
  script.abilities.forEach((item, i) => item.holderSeatIds.forEach(id => {
    if (id === script.investigator?.id) return;
    checkSeats([id], `$.abilities[${i}].holderSeatIds`);
  }));
  script.abilities.forEach((item, i) => item.outcomes?.forEach(outcome => checkSeats([outcome.targetSeatId], `$.abilities[${i}].outcomes`)));
  script.phases.forEach((item, i) => item.completion && checkSeats(item.completion.acceptedSeatIds, `$.phases[${i}].completion.acceptedSeatIds`));
  script.victoryConditions.forEach((item, i) => checkSeats(item.beneficiarySeatIds || [], `$.victoryConditions[${i}].beneficiarySeatIds`));
  return { script: diagnostics.some(item => item.severity === 'error') ? undefined : script, diagnostics };
}

// This is a pre-game projection. Runtime grants and events must use a separate, state-aware view.
export function buildInitialSeatPacket(script: MurderMysteryScript, seatId: string) {
  const seat = script.seats.find(item => item.id === seatId);
  if (!seat) throw new Error('未知席位');
  return {
    title: script.title, publicBackground: script.publicBackground, publicRules: script.publicRules,
    openingStatements: script.investigator?.openingStatements?.map(({ seatId, text }) => ({ seatId, text })) || [],
    seat: {
      id: seat.id, name: seat.name, title: seat.title, personalScript: seat.personalScript,
      beliefs: seat.beliefs.map(({ id, text }) => ({ id, text })),
      privateKnowledge: seat.privateKnowledge.map(({ id, text }) => ({ id, text })),
      objectives: [...(seat.objectives || [])],
    },
    clues: script.clues.filter(item => item.grant.kind === 'initial' && (item.initiallyPublic || item.audience.includes(seatId))).map(({ id, text }) => ({ id, text })),
    deliverables: script.deliverables.filter(item => item.grant.kind === 'initial' && item.audience.includes(seatId)).map(({ id, title, text }) => ({ id, title, text })),
  };
}
