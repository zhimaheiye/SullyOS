import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { APIConfig, CharacterProfile, UserProfile } from '../../types';
import { safeFetchJson } from '../safeApi';
import { MemoryNodeDB } from './db';
import {
    assertMemoryRepairProposalCurrent,
    MemoryRepairProposalConflict,
    normalizeMemoryRepairProposals,
    proposeRecallMemoryRepairs,
    type RecallRepairSnapshot,
} from './memoryRepair';
import type { MemoryNode } from './types';

vi.mock('../safeApi', async importOriginal => {
    const actual = await importOriginal<typeof import('../safeApi')>();
    return { ...actual, safeFetchJson: vi.fn() };
});

const mockedSafeFetchJson = vi.mocked(safeFetchJson);

function makeNode(id: string, content: string, extra: Partial<MemoryNode> = {}): MemoryNode {
    return {
        id,
        charId: 'repair-proposal-char',
        content,
        room: 'user_room',
        tags: [],
        importance: 5,
        mood: 'neutral',
        embedded: true,
        createdAt: 1,
        lastAccessedAt: 1,
        accessCount: 0,
        ...extra,
    };
}

function makeSnapshot(): RecallRepairSnapshot {
    const standalone = makeNode('standalone', '曾经考虑过考公务员。');
    const summary = makeNode('summary', '用户一直把考公务员当作长期目标。', {
        isBoxSummary: true,
    });
    const live = makeNode('live', '用户最近又提到了公务员考试。', {
        eventBoxId: 'career-box',
    });
    return {
        receipt: { ts: 1, ids: [standalone.id, live.id] },
        standalone: [{ node: standalone, kind: 'standalone', recalled: true }],
        boxes: [{
            box: {
                id: 'career-box',
                charId: standalone.charId,
                name: '职业选择',
                tags: [],
                summaryNodeId: summary.id,
                liveMemoryIds: [live.id],
                archivedMemoryIds: [],
                compressionCount: 1,
                createdAt: 1,
                updatedAt: 1,
                lastCompressedAt: 1,
            },
            nodes: [
                { node: summary, kind: 'summary', recalled: false },
                { node: live, kind: 'live', recalled: true },
            ],
            recalledNodeIds: [live.id],
        }],
    };
}

describe('memory repair proposal safety boundary', () => {
    beforeEach(() => {
        mockedSafeFetchJson.mockReset();
    });

    it('trusts snapshot metadata and filters unauthorized, duplicate, blank, and no-op proposals', () => {
        const snapshot = makeSnapshot();
        const result = normalizeMemoryRepairProposals(
            snapshot,
            ['summary', 'standalone'],
            [
                { nodeId: 'summary', proposedContent: '只是曾经考虑过，并非长期目标。', reason: '稳定目标被写得过重' },
                { nodeId: 'summary', proposedContent: '重复提案', reason: '重复' },
                { nodeId: 'standalone', proposedContent: '   ', reason: '空内容' },
                { nodeId: 'standalone', proposedContent: '曾经考虑过考公务员。', reason: '没有变化' },
                { nodeId: 'live', proposedContent: '越权修改', reason: '不在 candidateIds' },
                { nodeId: 'hallucinated', proposedContent: '不存在', reason: '模型幻觉' },
            ],
        );

        expect(result).toEqual([{
            nodeId: 'summary',
            originalContent: '用户一直把考公务员当作长期目标。',
            proposedContent: '只是曾经考虑过，并非长期目标。',
            reason: '稳定目标被写得过重',
            kind: 'summary',
            eventBoxId: 'career-box',
            eventBoxName: '职业选择',
            createdAt: 1,
            room: 'user_room',
        }]);
    });

    it('rejects an expired proposal before any write occurs', async () => {
        const original = makeNode('conflict-node', '提案生成时的内容');
        await MemoryNodeDB.save(original);
        const proposal = normalizeMemoryRepairProposals(
            {
                receipt: { ts: 1, ids: [original.id] },
                standalone: [{ node: original, kind: 'standalone', recalled: true }],
                boxes: [],
            },
            [original.id],
            [{ nodeId: original.id, proposedContent: '建议的新内容', reason: '需要纠正' }],
        )[0];

        await MemoryNodeDB.save({ ...original, content: '用户稍后手动写入的内容' });

        await expect(assertMemoryRepairProposalCurrent(proposal)).rejects.toMatchObject({
            name: 'MemoryRepairProposalConflict',
            code: 'proposal-conflict',
            currentContent: '用户稍后手动写入的内容',
        });
        expect(MemoryRepairProposalConflict).toBeTypeOf('function');
        expect((await MemoryNodeDB.getById(original.id))?.content).toBe('用户稍后手动写入的内容');
    });

    it('generates a dry-run plan from allowed snapshot nodes without changing stored memories', async () => {
        const snapshot = makeSnapshot();
        const summary = snapshot.boxes[0].nodes[0].node;
        await MemoryNodeDB.save(summary);
        mockedSafeFetchJson.mockResolvedValue({
            choices: [{
                message: {
                    content: JSON.stringify({
                        summary: '准备了两处修补',
                        proposals: [
                            { nodeId: 'summary', proposedContent: '用户曾经考虑过考公务员，但没有确定为长期目标。', reason: '纠正长期目标的误读' },
                            { nodeId: 'live', proposedContent: '不应获得权限', reason: '不在本次候选范围' },
                            { nodeId: 'outside-snapshot', proposedContent: '模型越权', reason: '不存在' },
                        ],
                    }),
                },
            }],
        } as any);

        const plan = await proposeRecallMemoryRepairs({
            char: { id: summary.charId, name: '左慈' } as CharacterProfile,
            user: { name: '芝麻' } as UserProfile,
            apiConfig: {
                baseUrl: 'https://api.example/v1',
                apiKey: 'test-key',
                model: 'test-model',
            } as APIConfig,
            snapshot,
            candidateIds: ['summary'],
            instruction: '把长期目标改成曾经考虑过。',
        });

        expect(plan.summary).toBe('准备了两处修补');
        expect(plan.proposals.map(item => item.nodeId)).toEqual(['summary']);
        expect((await MemoryNodeDB.getById(summary.id))?.content).toBe(summary.content);

        const request = mockedSafeFetchJson.mock.calls[0][1] as RequestInit;
        const body = JSON.parse(String(request.body));
        const prompt = body.messages.map((item: { content: string }) => item.content).join('\n');
        expect(prompt).toContain('id=summary');
        expect(prompt).not.toContain('id=live');
        expect(prompt).not.toContain('outside-snapshot');
    });
});
