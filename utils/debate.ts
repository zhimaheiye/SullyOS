import {
    DebateMode,
    DebateReport,
    DebateRole,
    DebateSession,
    DebateSide,
    DebateSpeech,
} from '../types';
import type { CharacterProfile } from '../types';

export const DEBATE_SIDE_LABELS: Record<DebateSide, string> = {
    pro: '正方',
    con: '反方',
};

export const DEBATE_ROLE_LABELS: Record<DebateRole, string> = {
    1: '一辩 · 建基者',
    2: '二辩 · 连接者',
    3: '三辩 · 进攻者',
    4: '四辩 · 收尾者',
};

export const DEBATE_ROLE_INSTRUCTIONS: Record<DebateRole, string> = {
    1: '完成开篇立论：用你最自然的方式说清核心概念，提出 2—3 个彼此独立的论点并讲明为什么成立；此时不必反驳对方。',
    2: '先破后立：具体回应并拆解对方已有论点，再用你自己的思路补强己方一辩；可以犀利，也可以幽默。',
    3: '以进攻为主：抓住对方前提、因果或边界上的漏洞，用追问、反例或归谬把交锋往前推，不要只复述己方观点。',
    4: '完成总结陈词：用自己的语言收拢关键交锋，说明己方在哪些判断标准上更站得住；不得引入此前从未出现的新证据。',
};

/** A team result is derived only from the eight assigned seats, never recall candidates. */
export function teamDebateLineup(session: DebateSession, characters: ReadonlyArray<CharacterProfile>) {
    if (session.mode !== 'team' || !session.team) return null;
    const name = (id: string) => characters.find(char => char.id === id)?.name
        || session.speeches.find(speech => speech.charId === id)?.speakerName
        || `已删除角色（${id}）`;
    return {
        pro: session.team.proCharIds.map((id, index) => ({ id, name: name(id), role: index + 1 })),
        con: session.team.conCharIds.map((id, index) => ({ id, name: name(id), role: index + 1 })),
    };
}

export function teamDebateShareText(session: DebateSession, lineup: NonNullable<ReturnType<typeof teamDebateLineup>>, charId: string): string {
    const report = session.report!;
    const seat = lineup.pro.find(row => row.id === charId) || lineup.con.find(row => row.id === charId);
    const side = lineup.pro.some(row => row.id === charId) ? '正方' : '反方';
    const outcome = report.winner === 'draw' ? '平局' : `${DEBATE_SIDE_LABELS[report.winner]}获胜`;
    return `本场「${session.topic}」是八位指定角色之间的正式辩论。用户只是观众和组织者，没有发言，也不属于正方或反方。正方四名：${lineup.pro.map(row => `${row.role}辩${row.name}`).join('、')}；反方四名：${lineup.con.map(row => `${row.role}辩${row.name}`).join('、')}。${seat?.name || '该角色'}担任${side}${seat?.role || '?'}辩。结果：${outcome}，正方 ${report.proScore} 分，反方 ${report.conScore} 分。`;
}

export interface DebateTurn {
    index: number;
    speakerType: 'user' | 'character';
    charId?: string;
    side: DebateSide;
    round: number;
    phase: DebateSpeech['phase'];
    role?: DebateRole;
}

const createId = () => globalThis.crypto?.randomUUID?.() || `debate-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function oppositeDebateSide(side: DebateSide): DebateSide {
    return side === 'pro' ? 'con' : 'pro';
}

export function createDebateSession(input: {
    mode: DebateMode;
    topic: string;
    proPosition: string;
    conPosition: string;
    charId?: string;
    userSide?: DebateSide;
    now?: number;
}): DebateSession {
    const now = input.now ?? Date.now();
    const base: DebateSession = {
        id: createId(),
        mode: input.mode,
        topic: input.topic.trim(),
        proPosition: input.proPosition.trim(),
        conPosition: input.conPosition.trim(),
        status: 'in_progress',
        stage: input.mode === 'solo' ? 'debate' : 'recall',
        speeches: [],
        createdAt: now,
        updatedAt: now,
    };

    if (input.mode === 'solo') {
        if (!input.charId || !input.userSide) throw new Error('单人辩论需要角色和用户立场');
        return { ...base, solo: { charId: input.charId, userSide: input.userSide, turnIndex: 0 } };
    }
    return { ...base, team: { recalls: [], proCharIds: [], conCharIds: [], turnIndex: 0 } };
}

export function getDebateTurns(session: DebateSession): DebateTurn[] {
    if (session.mode === 'solo' && session.solo) {
        const userSide = session.solo.userSide;
        const charSide = oppositeDebateSide(userSide);
        return [
            { index: 0, speakerType: 'user', side: userSide, round: 1, phase: 'opening' },
            { index: 1, speakerType: 'character', charId: session.solo.charId, side: charSide, round: 1, phase: 'opening' },
            { index: 2, speakerType: 'user', side: userSide, round: 2, phase: 'rebuttal' },
            { index: 3, speakerType: 'character', charId: session.solo.charId, side: charSide, round: 2, phase: 'rebuttal' },
            { index: 4, speakerType: 'user', side: userSide, round: 3, phase: 'closing' },
            { index: 5, speakerType: 'character', charId: session.solo.charId, side: charSide, round: 3, phase: 'closing' },
        ];
    }

    if (session.mode === 'team' && session.team) {
        const turns: DebateTurn[] = [];
        for (let role = 1; role <= 4; role += 1) {
            turns.push({ index: turns.length, speakerType: 'character', charId: session.team.proCharIds[role - 1], side: 'pro', round: role, phase: 'formal', role: role as DebateRole });
            turns.push({ index: turns.length, speakerType: 'character', charId: session.team.conCharIds[role - 1], side: 'con', round: role, phase: 'formal', role: role as DebateRole });
        }
        return turns;
    }
    return [];
}

export function getCurrentDebateTurn(session: DebateSession): DebateTurn | null {
    const index = session.mode === 'solo' ? session.solo?.turnIndex : session.team?.turnIndex;
    if (index === undefined) return null;
    return getDebateTurns(session)[index] || null;
}

export function buildDebateTranscript(speeches: DebateSpeech[]): string {
    if (!speeches.length) return '（尚未开始发言）';
    return speeches.map((speech, index) => {
        const role = speech.role ? ` · ${DEBATE_ROLE_LABELS[speech.role]}` : ` · 第${speech.round}轮`;
        return `${index + 1}. [${DEBATE_SIDE_LABELS[speech.side]}${role}] ${speech.speakerName}：\n${speech.content}`;
    }).join('\n\n');
}

const extractJson = (raw: string): Record<string, unknown> | null => {
    const cleaned = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try { return JSON.parse(match[0]) as Record<string, unknown>; } catch { return null; }
};

export function parseDebateRecall(raw: string): { side: DebateSide; reason: string } {
    const json = extractJson(raw);
    const sideText = String(json?.side ?? json?.stance ?? raw).trim();
    const isCon = /(?:\bcon\b|反方|选择反方)/i.test(sideText);
    const isPro = /(?:\bpro\b|正方|选择正方)/i.test(sideText);
    if (isCon === isPro) throw new Error('角色没有给出可识别的正方或反方立场，请重试');
    const side: DebateSide = isCon ? 'con' : 'pro';
    const fallback = raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').trim();
    const reason = String(json?.reason ?? json?.comment ?? '').trim() || fallback || '这是我更愿意捍卫的立场。';
    return { side, reason };
}

export function parseDebateJudgement(raw: string): { score: number; comment: string } {
    const json = extractJson(raw);
    const numberSource = json?.score ?? raw.match(/(?:score|得分|评分)\s*[:：]?\s*(\d{1,3})/i)?.[1];
    const parsed = Number(numberSource);
    if (!Number.isFinite(parsed)) throw new Error('主持人没有返回可识别的评分，请重试');
    const score = Math.max(0, Math.min(100, Math.round(parsed)));
    const comment = String(json?.comment ?? json?.reason ?? '').trim()
        || raw.replace(/```(?:json)?/gi, '').replace(/```/g, '').replace(/(?:score|得分|评分)\s*[:：]?\s*\d{1,3}/i, '').trim()
        || '论点已记录。';
    return { score, comment };
}

export function calculateDebateReport(speeches: DebateSpeech[], summary: string, now = Date.now()): DebateReport {
    const total = (side: DebateSide) => speeches
        .filter(speech => speech.side === side)
        .reduce((sum, speech) => sum + (speech.score ?? 0), 0);
    const proScore = total('pro');
    const conScore = total('con');
    return {
        proScore,
        conScore,
        winner: proScore === conScore ? 'draw' : proScore > conScore ? 'pro' : 'con',
        summary: summary.trim(),
        generatedAt: now,
    };
}

export function canStartTeamDebate(session: DebateSession): boolean {
    return session.mode === 'team'
        && session.team?.proCharIds.length === 4
        && session.team?.conCharIds.length === 4
        && new Set([...session.team.proCharIds, ...session.team.conCharIds]).size === 8;
}

export function getDebateParticipantIds(session: DebateSession): string[] {
    return session.mode === 'solo' ? [session.solo!.charId] : [...session.team!.proCharIds, ...session.team!.conCharIds];
}
