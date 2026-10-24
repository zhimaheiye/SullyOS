import type {
  LifeReplayBlueprint, LifeReplayCharacterBeat, LifeReplayNpc, LifeReplayOutcome,
  LifeReplayPreset, LifeReplaySession, LifeReplayTurn, LifeReplayWorldBeat,
} from '../types';
import { extractJson } from './safeApi';

const id = (prefix: string) => globalThis.crypto?.randomUUID?.() || `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const text = (value: unknown, fallback = '') => typeof value === 'string' && value.trim() ? value.trim() : fallback;
const list = (value: unknown) => Array.isArray(value) ? value.map(item => text(item)).filter(Boolean) : [];

export const emptyLifeReplayBlueprint = (): LifeReplayBlueprint => ({
  title: '', period: '', location: '', background: '', trigger: '', chronology: [],
  pastSelf: { label: '过去的我', ageStage: '', emotionalState: '', beliefs: '', needs: '', fears: '', behavior: '' },
  npcs: [], openingScene: '', scenePrompt: '', desiredChange: '', boundaries: '',
});

const normalizeNpc = (value: unknown, index: number): LifeReplayNpc => {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  return {
    id: text(raw.id, id('npc')),
    name: text(raw.name, `人物 ${index + 1}`),
    role: text(raw.role, '事件相关人物'),
    persona: text(raw.persona),
    knowledge: text(raw.knowledge, '只知道当时亲历或被告知的事情'),
  };
};

export function parseLifeReplayBlueprint(raw: string, fallback?: Partial<LifeReplayBlueprint>): LifeReplayBlueprint {
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== 'object') throw new Error('AI 没有返回可用的场景解析，请重试。');
  const source = parsed as Record<string, unknown>;
  const past = source.pastSelf && typeof source.pastSelf === 'object' ? source.pastSelf as Record<string, unknown> : {};
  const base = { ...emptyLifeReplayBlueprint(), ...fallback };
  return {
    title: text(source.title, base.title || '未命名的过去'),
    period: text(source.period, base.period),
    location: text(source.location, base.location),
    background: text(source.background, base.background),
    trigger: text(source.trigger, base.trigger),
    chronology: list(source.chronology).length ? list(source.chronology) : base.chronology,
    pastSelf: {
      label: text(past.label, base.pastSelf.label),
      ageStage: text(past.ageStage, base.pastSelf.ageStage),
      emotionalState: text(past.emotionalState, base.pastSelf.emotionalState),
      beliefs: text(past.beliefs, base.pastSelf.beliefs),
      needs: text(past.needs, base.pastSelf.needs),
      fears: text(past.fears, base.pastSelf.fears),
      behavior: text(past.behavior, base.pastSelf.behavior),
    },
    npcs: Array.isArray(source.npcs) ? source.npcs.slice(0, 20).map(normalizeNpc) : base.npcs,
    openingScene: text(source.openingScene, base.openingScene),
    scenePrompt: text(source.scenePrompt, base.scenePrompt),
    desiredChange: text(source.desiredChange, base.desiredChange),
    boundaries: text(source.boundaries, base.boundaries),
  };
}

export function parseLifeReplayCharacterBeat(raw: string): LifeReplayCharacterBeat {
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== 'object') throw new Error('角色的回应格式不完整，请重试本轮。');
  const value = parsed as Record<string, unknown>;
  const beat = { perception: text(value.perception), action: text(value.action), speech: text(value.speech) };
  if (!beat.action && !beat.speech) throw new Error('角色没有给出可见行动或台词，请重试本轮。');
  return beat;
}

export function parseLifeReplayWorldBeat(raw: string, fallbackState = ''): LifeReplayWorldBeat {
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== 'object') throw new Error('场景导演没有返回可用结果，请重试本轮。');
  const value = parsed as Record<string, unknown>;
  const npcBeats = Array.isArray(value.npcBeats) ? value.npcBeats.slice(0, 20).map((item, index) => {
    const npc = item && typeof item === 'object' ? item as Record<string, unknown> : {};
    return { npcId: text(npc.npcId), name: text(npc.name, `人物 ${index + 1}`), action: text(npc.action), speech: text(npc.speech) || undefined };
  }) : [];
  const result: LifeReplayWorldBeat = {
    narrative: text(value.narrative),
    pastSelfReaction: text(value.pastSelfReaction),
    pastSelfSpeech: text(value.pastSelfSpeech) || undefined,
    npcBeats,
    directionChange: text(value.directionChange),
    sceneState: text(value.sceneState, fallbackState),
    suggestedActions: list(value.suggestedActions).slice(0, 3),
  };
  if (!result.narrative && !result.pastSelfReaction && !result.npcBeats.length) throw new Error('场景导演没有生成可见变化，请重试本轮。');
  return result;
}

export function parseLifeReplayOutcome(raw: string): LifeReplayOutcome {
  const parsed = extractJson(raw);
  if (!parsed || typeof parsed !== 'object') throw new Error('结局整理失败，请重试。');
  const value = parsed as Record<string, unknown>;
  return {
    summary: text(value.summary, '这段重映暂时停在了这里。'),
    changedTrajectory: text(value.changedTrajectory),
    closingImage: text(value.closingImage),
    generatedAt: Date.now(),
  };
}

export function createLifeReplayPreset(sourceText: string, blueprint: LifeReplayBlueprint): LifeReplayPreset {
  const now = Date.now();
  return { id: id('life-replay-preset'), kind: 'preset', sourceText: sourceText.trim(), blueprint, createdAt: now, updatedAt: now };
}

export function createLifeReplaySession(preset: LifeReplayPreset, charId: string): LifeReplaySession {
  const now = Date.now();
  return {
    id: id('life-replay-session'), kind: 'session', presetId: preset.id,
    presetTitle: preset.blueprint.title, blueprint: structuredClone(preset.blueprint), charId,
    status: 'active', turns: [], sceneState: '', createdAt: now, updatedAt: now,
  };
}

export function makeLifeReplayTurn(input: Omit<LifeReplayTurn, 'id' | 'createdAt'>): LifeReplayTurn {
  return { ...input, id: id('life-replay-turn'), createdAt: Date.now() };
}

export function buildLifeReplayTranscript(turns: LifeReplayTurn[], charName: string, userName: string, limit = 8): string {
  return turns.slice(-limit).map((turn, index) => {
    const lines = [`第 ${Math.max(1, turns.length - limit + index + 1)} 幕`];
    if (turn.kind === 'interaction' && turn.userAction) lines.push(`${userName || '现在的我'}：${turn.userAction}`);
    if (turn.character.perception) lines.push(`${charName}的感知：${turn.character.perception}`);
    if (turn.character.action) lines.push(`${charName}：${turn.character.action}`);
    if (turn.character.speech) lines.push(`${charName}说：${turn.character.speech}`);
    if (turn.world.narrative) lines.push(`场景：${turn.world.narrative}`);
    if (turn.world.pastSelfReaction) lines.push(`过去的我：${turn.world.pastSelfReaction}`);
    if (turn.world.pastSelfSpeech) lines.push(`过去的我说：${turn.world.pastSelfSpeech}`);
    for (const npc of turn.world.npcBeats) lines.push(`${npc.name}：${[npc.action, npc.speech].filter(Boolean).join('；')}`);
    return lines.join('\n');
  }).join('\n\n');
}

export const newestLifeReplayFirst = <T extends { updatedAt: number }>(items: T[]): T[] => [...items].sort((a, b) => b.updatedAt - a.updatedAt);
