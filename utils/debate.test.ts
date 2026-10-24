import { describe, expect, it } from 'vitest';
import {
    calculateDebateReport,
    canStartTeamDebate,
    createDebateSession,
    getDebateTurns,
    parseDebateJudgement,
    parseDebateRecall,
    teamDebateLineup, teamDebateShareText,
} from './debate';

describe('debate rules', () => {
    it('uses exactly the eight assigned character seats and keeps the user outside every outcome', () => {
        const session = createDebateSession({ mode: 'team', topic: '辩题', proPosition: '正', conPosition: '反' });
        session.team!.proCharIds = ['p1', 'p2', 'p3', 'p4'];
        session.team!.conCharIds = ['c1', 'c2', 'c3', 'c4'];
        session.team!.recalls = [{ charId: 'candidate', side: 'pro', reason: '', charName: '候选' } as any];
        const chars = [...session.team!.proCharIds, ...session.team!.conCharIds].map(id => ({ id, name: `名字${id}` } as any));
        const lineup = teamDebateLineup(session, chars)!;
        expect([...lineup.pro, ...lineup.con].map(row => row.id)).toEqual([...session.team!.proCharIds, ...session.team!.conCharIds]);
        expect(JSON.stringify(lineup)).not.toContain('candidate');
        for (const [proScore, conScore, outcome] of [[320, 300, '正方获胜'], [300, 320, '反方获胜'], [300, 300, '平局']] as const) {
            session.report = { proScore, conScore, winner: proScore === conScore ? 'draw' : proScore > conScore ? 'pro' : 'con', summary: '公开总结', generatedAt: 1 };
            const p = teamDebateShareText(session, lineup, 'p2');
            const c = teamDebateShareText(session, lineup, 'c4');
            expect(p).toContain('名字p2担任正方2辩');
            expect(c).toContain('名字c4担任反方4辩');
            expect(p).toContain(outcome);
            expect(p).toContain('用户只是观众和组织者，没有发言，也不属于正方或反方');
            expect(p).not.toContain('候选');
        }
    });
    it('builds a six-speech solo schedule that strictly alternates from the user', () => {
        const session = createDebateSession({ mode: 'solo', topic: '测试', proPosition: '应该', conPosition: '不应该', charId: 'char', userSide: 'pro', now: 1 });
        expect(getDebateTurns(session).map(turn => `${turn.speakerType}:${turn.side}:${turn.phase}`)).toEqual([
            'user:pro:opening', 'character:con:opening',
            'user:pro:rebuttal', 'character:con:rebuttal',
            'user:pro:closing', 'character:con:closing',
        ]);
    });

    it('keeps strict alternation when the user chooses the con side', () => {
        const session = createDebateSession({ mode: 'solo', topic: '测试', proPosition: '应该', conPosition: '不应该', charId: 'char', userSide: 'con', now: 1 });
        expect(getDebateTurns(session).map(turn => `${turn.speakerType}:${turn.side}`)).toEqual([
            'user:con', 'character:pro', 'user:con', 'character:pro', 'user:con', 'character:pro',
        ]);
    });

    it('builds the standard pro/con 1-4 speaker order', () => {
        const session = createDebateSession({ mode: 'team', topic: '测试', proPosition: '应该', conPosition: '不应该', now: 1 });
        session.team!.proCharIds = ['p1', 'p2', 'p3', 'p4'];
        session.team!.conCharIds = ['c1', 'c2', 'c3', 'c4'];
        expect(getDebateTurns(session).map(turn => `${turn.side}${turn.role}:${turn.charId}`)).toEqual([
            'pro1:p1', 'con1:c1', 'pro2:p2', 'con2:c2', 'pro3:p3', 'con3:c3', 'pro4:p4', 'con4:c4',
        ]);
        expect(canStartTeamDebate(session)).toBe(true);
    });

    it('parses tolerant recall and judging responses', () => {
        expect(parseDebateRecall('```json\n{"side":"反方","reason":"风险更重要"}\n```')).toEqual({ side: 'con', reason: '风险更重要' });
        expect(parseDebateJudgement('评分：140 逻辑完整')).toEqual({ score: 100, comment: '逻辑完整' });
        expect(() => parseDebateRecall('我暂时不想选择')).toThrow('可识别');
        expect(() => parseDebateJudgement('这段发言挺有意思')).toThrow('可识别');
    });

    it('totals locally and determines the winner', () => {
        const report = calculateDebateReport([
            { id: '1', speakerType: 'user', speakerName: '你', side: 'pro', round: 1, phase: 'opening', content: 'a', score: 78, createdAt: 1 },
            { id: '2', speakerType: 'character', speakerName: '角色', side: 'con', round: 1, phase: 'opening', content: 'b', score: 82, createdAt: 2 },
        ], '反方略胜', 3);
        expect(report).toMatchObject({ proScore: 78, conScore: 82, winner: 'con', summary: '反方略胜' });
    });
});
