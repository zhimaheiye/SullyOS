import type {
  CommunityCommitteeOpeningAnalysis,
  CommunityCommitteeOpeningSegment,
  CommunityCommitteeOpeningSide,
  CommunityCommitteeSession,
  CommunityCommitteeTurn,
} from '../types';

const createId = (prefix: string) => globalThis.crypto?.randomUUID?.()
  || `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const COMMUNITY_PEELING_LAYERS = [
  { label: '听见两股力量', guidance: '用户已经完整说过开题，不要让用户重述。先接住两边反复压过彼此的拉扯，确认能理解别人并不等于用户就不该痛苦。' },
  { label: '看看痛落在哪里', guidance: '帮助区分发生了什么、用户替别人解释了什么，以及真正刺痛用户的具体部分。' },
  { label: '再往里面问一层', guidance: '试着看见痛苦下面可能被威胁的需要、期待、关系位置或恐惧，但不得替用户下结论。' },
  { label: '辨认边界与承担', guidance: '帮助用户分开自己的责任、别人的责任、可以协商的部分与不必继续吞下的部分。' },
  { label: '把手伸向下一步', guidance: '在充分理解后，陪用户寻找一个低压力、可撤回、由用户自己选择的下一步；也允许暂时不行动。' },
] as const;

export function splitCommunityCommitteeOpening(openingText: string): string[] {
  return openingText.trim().split(/\r?\n+/).map(part => part.trim()).filter(Boolean);
}

const normalizeOpeningSide = (value: unknown): CommunityCommitteeOpeningSide => {
  const side = String(value || '').trim().toLowerCase();
  return side === 'a' || side === 'b' ? side : 'both';
};

export function normalizeCommunityCommitteeOpeningAnalysis(
  openingText: string,
  parsed: unknown,
): CommunityCommitteeOpeningAnalysis {
  const text = openingText.trim();
  const paragraphs = splitCommunityCommitteeOpening(text);
  if (!paragraphs.length) throw new Error('先把这件事一口气写下来。');
  const data = parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  const topic = String(data.topic || '').trim().slice(0, 80) || paragraphs[0].slice(0, 80);
  const sideA = String(data.sideA || '').trim().slice(0, 1600);
  const sideB = String(data.sideB || '').trim().slice(0, 1600);
  if (!sideA || !sideB) throw new Error('AI 没有完整梳理出两股力量，请重试一次。');
  const segmentSides = Array.isArray(data.segmentSides) ? data.segmentSides : [];
  return {
    openingText: text,
    topic,
    sideA,
    sideB,
    segments: paragraphs.map((content, index): CommunityCommitteeOpeningSegment => ({
      id: `opening-segment-${index + 1}`,
      content,
      side: normalizeOpeningSide(segmentSides[index]),
    })),
  };
}

export function createCommunityCommitteeSession(input: {
  topic: string;
  sideA: string;
  sideB: string;
  openingText?: string;
  openingSegments?: CommunityCommitteeOpeningSegment[];
  speakerName?: string;
  charIds: string[];
  now?: number;
}): CommunityCommitteeSession {
  const topic = input.topic.trim();
  const sideA = input.sideA.trim();
  const sideB = input.sideB.trim();
  const charIds = [...new Set(input.charIds.filter(Boolean))].slice(0, 3);
  if (!topic || !sideA || !sideB) throw new Error('请完整写下困境和两边各自有道理的地方。');
  if (charIds.length < 1) throw new Error('请选择至少一位愿意听你说的角色。');
  const now = input.now ?? Date.now();
  const openingText = input.openingText?.trim();
  const openingSegments = input.openingSegments?.filter(segment => segment.content.trim()).map(segment => ({
    ...segment,
    content: segment.content.trim(),
  }));
  return {
    id: createId('community-committee'),
    topic,
    sideA,
    sideB,
    ...(openingText ? { openingText } : {}),
    ...(openingSegments?.length ? { openingSegments } : {}),
    charIds,
    stage: 'peeling',
    turns: openingText ? [makeCommunityCommitteeTurn({
      speakerType: 'user', speakerName: input.speakerName?.trim() || '我', content: openingText, createdAt: now,
    })] : [],
    createdAt: now,
    updatedAt: now,
  };
}

export function makeCommunityCommitteeTurn(
  input: Omit<CommunityCommitteeTurn, 'id' | 'createdAt'> & { createdAt?: number },
): CommunityCommitteeTurn {
  return {
    ...input,
    content: input.content.trim(),
    id: createId('committee-turn'),
    createdAt: input.createdAt ?? Date.now(),
  };
}

export function getCommunityCommitteeRound(turns: CommunityCommitteeTurn[]): number {
  return turns.filter(turn => turn.speakerType === 'user').length;
}

export function getCommunityCommitteeLayer(turns: CommunityCommitteeTurn[]) {
  const round = Math.max(1, getCommunityCommitteeRound(turns));
  return COMMUNITY_PEELING_LAYERS[Math.min(round - 1, COMMUNITY_PEELING_LAYERS.length - 1)];
}

export function getPendingCommitteeCharIds(session: CommunityCommitteeSession): string[] {
  let latestUserIndex = -1;
  for (let index = session.turns.length - 1; index >= 0; index -= 1) {
    if (session.turns[index].speakerType === 'user') {
      latestUserIndex = index;
      break;
    }
  }
  if (latestUserIndex < 0) return [];
  const replied = new Set(session.turns.slice(latestUserIndex + 1)
    .filter(turn => turn.speakerType === 'character' && turn.charId)
    .map(turn => turn.charId as string));
  return session.charIds.filter(charId => !replied.has(charId));
}

export function buildCommunityCommitteeTranscript(
  turns: CommunityCommitteeTurn[],
  limit = 30,
): string {
  if (!turns.length) return '（还没有人开口）';
  const startIndex = Math.max(0, turns.length - limit);
  return turns.slice(startIndex).map((turn, index) => {
    const absoluteIndex = startIndex + index + 1;
    return `${absoluteIndex}. ${turn.speakerName}：${turn.content}`;
  }).join('\n\n');
}

export const newestCommunityCommitteeFirst = (sessions: CommunityCommitteeSession[]) =>
  [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
