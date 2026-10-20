import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    safeFetchJson: vi.fn(),
    getMessagesByCharId: vi.fn(),
    injectMemoryPalace: vi.fn(),
    buildCharacterRequest: vi.fn(),
}));

vi.mock('./safeApi', () => ({ safeFetchJson: mocks.safeFetchJson }));
vi.mock('./db', () => ({ DB: { getMessagesByCharId: mocks.getMessagesByCharId } }));
vi.mock('./memoryPalace/pipeline', () => ({ injectMemoryPalace: mocks.injectMemoryPalace }));
vi.mock('./context', () => ({ ContextBuilder: { buildCharacterRequest: mocks.buildCharacterRequest } }));

import {
    prepareQixiMemoryBundle,
    QIXI_PART1_FIRST_SCENE_IDS,
    QIXI_PART1_SECOND_SCENE_IDS,
    QIXI_PART1_THIRD_SCENE_IDS,
} from './qixiMemoryBundle';

const makeScene = (sceneId: string) => ({
    sharedObject: `${sceneId} shared object`,
    memoryLine: `${sceneId} memory`,
    options: sceneId === 'wordCloud' ? [] : [{
        id: `${sceneId}-1`,
        label: `${sceneId} option`,
        result: `${sceneId} result`,
        ...(sceneId === 'lostLayer' ? { charReply: 'reply' } : {}),
        evidenceIds: ['e1'],
    }],
    charAction: `${sceneId} action`,
    reveal: `${sceneId} reveal`,
    artifactIds: ['a1'],
    charSelectionIds: sceneId === 'wordCloud' ? ['a1'] : [],
});

const firstChunk = {
    openingChat: ['hello', 'world'],
    charLayerColor: '#82D5B8',
    charPerformance: { tempo: 'brisk', markStyle: 'precise', presence: 'direct' },
    evidence: [{ id: 'e1', fact: 'a real memory', object: 'a note', tags: ['daily'] }],
    artifacts: [{ id: 'a1', label: 'careful', kind: 'trait', evidenceIds: ['e1'] }],
    scenes: Object.fromEntries(QIXI_PART1_FIRST_SCENE_IDS.map(id => [id, makeScene(id)])),
};

const secondChunk = {
    scenes: Object.fromEntries(QIXI_PART1_SECOND_SCENE_IDS.map(id => [id, makeScene(id)])),
};

const thirdChunk = {
    scenes: Object.fromEntries(QIXI_PART1_THIRD_SCENE_IDS.map(id => [id, makeScene(id)])),
    bridge: {
        userMagpies: [{ evidenceId: 'e1', name: 'note', memory: 'a real memory', visualHint: 'light' }],
        charMagpies: [{ evidenceId: 'e1', name: 'reply', memory: 'the same memory', visualHint: 'thread' }],
        finalMagpie: { name: 'User', line: 'Is it you?', visualHint: 'a glowing name' },
    },
};

const completion = (content: string) => ({
    choices: [{ message: { content }, finish_reason: 'stop' }],
});

const char = { id: 'char-qixi-api', name: 'Char' } as any;
const user = { name: 'User' } as any;
const apiConfig = {
    baseUrl: 'https://example.test/v1',
    apiKey: 'secret',
    model: 'thinking-model',
    stream: false,
} as any;

const queueRemainingPhases = () => {
    mocks.safeFetchJson
        .mockResolvedValueOnce(completion(JSON.stringify(secondChunk)))
        .mockResolvedValueOnce(completion(JSON.stringify(thirdChunk)));
};

const incompleteScenes = (ids: readonly string[]) => Object.fromEntries(ids.map(id => [id, {
    sharedObject: `${id} incomplete`,
}]));

describe('Qixi Part 1 API response compatibility', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.safeFetchJson.mockReset();
        vi.stubGlobal('localStorage', {
            getItem: vi.fn(() => null),
            setItem: vi.fn(),
        });
        mocks.getMessagesByCharId.mockResolvedValue([]);
        mocks.injectMemoryPalace.mockResolvedValue(undefined);
        mocks.buildCharacterRequest.mockImplementation((_input, messages) => [
            { role: 'system', content: 'system context' },
            ...messages,
        ]);
    });

    it('uses the global non-streaming setting for all Part 1 phase requests', async () => {
        mocks.safeFetchJson
            .mockResolvedValueOnce(completion(JSON.stringify(firstChunk)))
            .mockResolvedValueOnce(completion(JSON.stringify(secondChunk)))
            .mockResolvedValueOnce(completion(JSON.stringify(thirdChunk)));

        await prepareQixiMemoryBundle(char, user, apiConfig, { forceRegenerate: true });

        expect(mocks.safeFetchJson).toHaveBeenCalledTimes(3);
        for (const call of mocks.safeFetchJson.mock.calls) {
            const requestBody = JSON.parse(String(call[1]?.body));
            expect(requestBody.stream).toBe(false);
        }
    });

    it.each([
        ['content blocks', (json: string) => ({ choices: [{ message: { content: [{ type: 'text', text: json }] }, finish_reason: 'stop' }] })],
        ['reasoning_content', (json: string) => ({ choices: [{ message: { content: '好的，我来生成。', reasoning_content: json }, finish_reason: 'stop' }] })],
        ['reasoning', (json: string) => ({ choices: [{ message: { content: '好的，我来生成。', reasoning: json }, finish_reason: 'stop' }] })],
        ['thinking', (json: string) => ({ choices: [{ message: { content: '好的，我来生成。', thinking: json }, finish_reason: 'stop' }] })],
        ['choice text', (json: string) => ({ choices: [{ message: { content: '好的，我来生成。' }, text: json, finish_reason: 'stop' }] })],
        ['output_text', (json: string) => ({ choices: [{ message: { content: '好的，我来生成。' }, finish_reason: 'stop' }], output_text: json })],
        ['nested data content', (json: string) => ({
            choices: [{ message: { content: '好的，我来生成。' }, finish_reason: 'stop' }],
            data: { choices: [{ message: { content: json } }] },
        })],
    ])('uses a valid %s JSON candidate even when message.content is a short preface', async (_label, makeFirstResponse) => {
        mocks.safeFetchJson.mockResolvedValueOnce(makeFirstResponse(JSON.stringify(firstChunk)));
        queueRemainingPhases();

        const result = await prepareQixiMemoryBundle(char, user, apiConfig, { forceRegenerate: true });

        expect(result.bundle.scenes.lostLayer.sharedObject).toBe('lostLayer shared object');
        expect(result.usedFallback).toBe(false);
    });

    it('skips an incomplete content object in favor of a complete alternate-channel script', async () => {
        mocks.safeFetchJson.mockResolvedValueOnce({
            choices: [{
                message: {
                    content: JSON.stringify({ ...firstChunk, scenes: incompleteScenes(QIXI_PART1_FIRST_SCENE_IDS) }),
                    reasoning_content: JSON.stringify(firstChunk),
                },
                finish_reason: 'stop',
            }],
        });
        queueRemainingPhases();

        const result = await prepareQixiMemoryBundle(char, user, apiConfig, { forceRegenerate: true });

        expect(result.bundle.scenes.lostLayer.memoryLine).toBe('lostLayer memory');
        expect(result.bundle.scenes.doubleWish.charAction).toBe('doubleWish action');
    });

    it('skips an incomplete phase-three script and bridge in favor of a complete alternate candidate', async () => {
        mocks.safeFetchJson
            .mockResolvedValueOnce(completion(JSON.stringify(firstChunk)))
            .mockResolvedValueOnce(completion(JSON.stringify(secondChunk)))
            .mockResolvedValueOnce({
                choices: [{
                    message: {
                        content: JSON.stringify({
                            scenes: incompleteScenes(QIXI_PART1_THIRD_SCENE_IDS),
                            bridge: { userMagpies: [{}], charMagpies: [{}], finalMagpie: {} },
                        }),
                        thinking: JSON.stringify(thirdChunk),
                    },
                    finish_reason: 'stop',
                }],
            });

        const result = await prepareQixiMemoryBundle(char, user, apiConfig, { forceRegenerate: true });

        expect(result.bundle.scenes.nightMarket.memoryLine).toBe('nightMarket memory');
        expect(result.bundle.bridge?.finalMagpie.line).toBe('Is it you?');
    });

    it('logs response shape, channel lengths, and a bounded preview when no candidate is playable', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        mocks.safeFetchJson.mockResolvedValueOnce({
            choices: [{
                message: { content: '好的，我来生成。', reasoning_content: '也没有合法 JSON。' },
                finish_reason: 'stop',
            }],
        });

        await expect(prepareQixiMemoryBundle(char, user, apiConfig, { forceRegenerate: true }))
            .rejects.toThrow('Part 1 前两站正文无法读取');

        const warnings = warn.mock.calls.flat().join(' ');
        expect(warnings).toContain('message_keys=content,reasoning_content');
        expect(warnings).toContain('content_chars=');
        expect(warnings).toContain('reasoning_content_chars=');
        expect(warnings).toContain('thinking_chars=0');
        expect(warnings).toContain('content_preview=好的，我来生成。');
        expect(warnings).not.toContain(apiConfig.apiKey);
        expect(warnings).not.toContain('system context');
        warn.mockRestore();
    });

    it.each([
        [true, true],
        [undefined, false],
    ])('coerces the global stream setting %s to %s', async (stream, expected) => {
        mocks.safeFetchJson
            .mockResolvedValueOnce(completion(JSON.stringify(firstChunk)))
            .mockResolvedValueOnce(completion(JSON.stringify(secondChunk)))
            .mockResolvedValueOnce(completion(JSON.stringify(thirdChunk)));

        await prepareQixiMemoryBundle(char, user, { ...apiConfig, stream } as any, { forceRegenerate: true });

        const requestBody = JSON.parse(String(mocks.safeFetchJson.mock.calls[0][1]?.body));
        expect(requestBody.stream).toBe(expected);
    });
});
