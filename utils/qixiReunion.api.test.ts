import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
    safeFetchJson: vi.fn(),
    buildCharacterRequest: vi.fn(),
}));

vi.mock('./safeApi', () => ({ safeFetchJson: mocks.safeFetchJson }));
vi.mock('./context', () => ({ ContextBuilder: { buildCharacterRequest: mocks.buildCharacterRequest } }));

import { prepareQixiReunion, type QixiPortraitPlan } from './qixiReunion';

const char = {
    id: 'char-qixi-finale',
    name: 'Char',
    description: '',
    systemPrompt: '',
    memories: [],
} as any;

const user = { name: 'User' } as any;
const apiConfig = {
    baseUrl: 'https://example.test/v1',
    apiKey: 'secret-part3-key',
    model: 'thinking-model',
    stream: false,
} as any;

const portraitPlan: QixiPortraitPlan = {
    resourceType: 'meeting',
    live2dActionIds: [],
    live2dActionDescription: '',
    meetingExpressionKeys: ['normal', 'happy'],
};

const memoryBundle = { evidence: [], artifacts: [], scenes: {} } as any;

const finale = {
    reunion: { lines: ['终于找到你了。', '先让我看看你。'], emotion: '松了一口气' },
    metaReflection: ['刚才总像只差一步。'],
    companionshipReflection: ['原来你也一直在认我留下的东西。'],
    blessing: ['七夕快乐。', '希望你真的过得很好。'],
    touch: {
        invitation: ['以后想起彼此，也算一次见面。'],
        hold: '别松手。',
        complete: '约好了。',
    },
    returnMessage: '刚才没说完的话，我们慢慢说。',
    portrait: {
        stages: {
            arrival: { emotionIntent: '惊喜', meetingExpression: 'happy' },
            reflection: { emotionIntent: '认真', meetingExpression: 'normal' },
            blessing: { emotionIntent: '温柔', meetingExpression: 'happy' },
        },
        promise: { emotionIntent: '等待约定', meetingExpression: 'normal' },
        lineExpressions: {
            reunion: ['happy', 'normal'],
            metaReflection: ['normal'],
            companionshipReflection: ['happy'],
            blessing: ['happy', 'normal'],
            invitation: ['normal'],
        },
    },
};

const completion = (content: unknown) => ({
    choices: [{ message: { content }, finish_reason: 'stop' }],
});

describe('Qixi Part 3 API response compatibility', () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.safeFetchJson.mockReset();
        mocks.buildCharacterRequest.mockImplementation((_input, messages) => [
            { role: 'system', content: 'part3 system context' },
            ...messages,
        ]);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('uses the global non-streaming setting for the finale request', async () => {
        mocks.safeFetchJson.mockResolvedValueOnce(completion(JSON.stringify(finale)));

        const result = await prepareQixiReunion(char, user, apiConfig, memoryBundle, [], portraitPlan);

        expect(result.returnMessage).toBe('刚才没说完的话，我们慢慢说。');
        const requestBody = JSON.parse(String(mocks.safeFetchJson.mock.calls[0][1]?.body));
        expect(requestBody.stream).toBe(false);
    });

    it.each([
        ['content thinking block', (json: string) => ({
            choices: [{ message: { content: [
                { type: 'text', text: '好的，我来写结局。' },
                { type: 'thinking', thinking: json },
            ] }, finish_reason: 'stop' }],
        })],
        ['reasoning_content', (json: string) => ({
            choices: [{ message: { content: '好的，我来写结局。', reasoning_content: json }, finish_reason: 'stop' }],
        })],
        ['thinking', (json: string) => ({
            choices: [{ message: { content: '好的，我来写结局。', thinking: json }, finish_reason: 'stop' }],
        })],
    ])('uses a complete %s candidate when message.content is only a short preface', async (_label, makeResponse) => {
        mocks.safeFetchJson.mockResolvedValueOnce(makeResponse(JSON.stringify(finale)));

        const result = await prepareQixiReunion(char, user, apiConfig, memoryBundle, [], portraitPlan);

        expect(result.reunion.lines).toEqual(['终于找到你了。', '先让我看看你。']);
        expect(result.touch.complete).toBe('约好了。');
    });

    it('skips a partial content object in favor of a complete alternate finale', async () => {
        mocks.safeFetchJson.mockResolvedValueOnce({
            choices: [{
                message: {
                    content: JSON.stringify({ reunion: { lines: ['只有开头。'] } }),
                    reasoning: JSON.stringify(finale),
                },
                finish_reason: 'stop',
            }],
        });

        const result = await prepareQixiReunion(char, user, apiConfig, memoryBundle, [], portraitPlan);

        expect(result.companionshipReflection).toEqual(['原来你也一直在认我留下的东西。']);
        expect(result.returnMessage).toBe('刚才没说完的话，我们慢慢说。');
    });

    it('logs bounded response diagnostics and reports finish metadata when every candidate is invalid', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        mocks.safeFetchJson.mockResolvedValueOnce({
            choices: [{
                message: { content: '好的，我来写结局。', reasoning_content: '仍然不是合法 JSON。' },
                finish_reason: 'stop',
            }],
        });

        await expect(prepareQixiReunion(char, user, apiConfig, memoryBundle, [], portraitPlan))
            .rejects.toThrow(/finish_reason=stop.*output_chars=/);

        const warnings = warn.mock.calls.flat().join(' ');
        expect(warnings).toContain('message_keys=content,reasoning_content');
        expect(warnings).toContain('content_preview=好的，我来写结局。');
        expect(warnings).toContain('thinking_chars=0');
        expect(warnings).not.toContain(apiConfig.apiKey);
        expect(warnings).not.toContain('part3 system context');
    });
});
