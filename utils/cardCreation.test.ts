// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { APIConfig, CharacterProfile, Message, UserProfile } from '../types';
import { DB } from './db';
import { buildCardCreationMessages, cardCreationErrorMessage, generateCardDraft, parseCreatedCard, publishCardDraft } from './cardCreation';
import { normalizeMessageContent } from './messageFormat';
import { MemoryNodeDB } from './memoryPalace/db';

const char = { id: 'card-creation-test', name: '小雨', htmlModeEnabled: false,
    htmlModeCustomPrompt: '偏爱海蓝色和手写风格', memories: [], mountedWorldbooks: [],
    dialogueApi: { baseUrl: 'https://role.example/v1', apiKey: 'role-key', model: 'role-model' },
} as unknown as CharacterProfile;
const user = { name: '用户' } as UserProfile;
const api = { baseUrl: 'https://global.example/v1', apiKey: 'global-key', model: 'global-model' } as APIConfig;

afterEach(() => vi.restoreAllMocks());

describe('private card creation', () => {
    it('keeps 500 visible turns and their semantics while stripping all historical media from the outgoing request', async () => {
        const id = 'card-media-only-text';
        const role = { ...char, id, contextLimit: 500, mountedWorldbooks: [{ id: 'book', title: '剧场', content: '世界书暗号：海边钟楼', constant: true }] } as CharacterProfile;
        const make = (index: number, type: Message['type'], content: string, metadata?: Message['metadata']): Message => ({
            id: index + 1, charId: id, role: index % 2 ? 'assistant' : 'user', type, content,
            timestamp: Date.now() - (501 - index) * 1000, metadata,
        });
        const history = Array.from({ length: 500 }, (_, index) => make(index, 'text', `对话第${index + 1}条`));
        history[4] = make(4, 'image', 'data:image/png;base64,PNGSECRET', { visionDescription: '窗边一只白猫' });
        history[5] = make(5, 'image', 'data:image/jpeg;base64,JPEGSECRET');
        history[6] = make(6, 'image', 'data:image/gif;base64,GIFSECRET');
        history[7] = make(7, 'emoji', 'data:image/gif;base64,EMOJISECRET', { stickerVision: { eligible: true, name: '摇头猫' } });
        history[8] = make(8, 'emoji', 'blobref:sticker123', { stickerVision: { eligible: true, name: '拥抱', description: '小熊张开双臂' } });
        history[9] = make(9, 'chat_forward', JSON.stringify({ fromCharName: '乙', messages: [
            { role: 'user', type: 'emoji', content: 'data:image/gif;base64,FWDSECRET', stickerName: '跳舞', stickerVision: { eligible: true } },
            { role: 'assistant', type: 'emoji', content: 'blobref:fwd123', stickerName: '挥手', stickerVision: { eligible: true, description: '人物挥手' } },
        ] }));
        history[10] = make(10, 'image', 'blobref:oldimage123');
        history[11] = { ...make(11, 'text', '这张真的好看'), replyTo: { id: 11, name: '我', content: 'blobref:oldimage123' } };
        history[12] = make(12, 'text', '旧图片令牌 blobref:legacy123 后面还有正文');
        history[13] = make(13, 'html_card', '[HTML卡片] 周末电影邀请函');
        const unchanged = structuredClone(history);
        vi.spyOn(DB, 'peekMessagesByCharId').mockResolvedValue(history);
        const messages = await buildCardCreationMessages(role, user, '请做一张静态卡片');
        const outgoing = JSON.stringify(messages);
        expect(outgoing).not.toMatch(/image_url|data:image|blobref:|PNGSECRET|JPEGSECRET|GIFSECRET|EMOJISECRET|FWDSECRET/);
        for (const text of ['对话第1条', '对话第500条', '窗边一只白猫', '摇头猫', '小熊张开双臂', '跳舞', '人物挥手', '这张真的好看', '周末电影邀请函', '世界书暗号：海边钟楼', '偏爱海蓝色和手写风格']) {
            expect(outgoing).toContain(text);
        }
        expect(messages.at(-1)).toMatchObject({ role: 'user', content: '请做一张静态卡片' });
        expect(history).toEqual(unchanged);
    });

    it('keeps provider status and known causes without showing private URLs or credentials', () => {
        expect(cardCreationErrorMessage(new Error('API Error 429: server busy: global concurrency limit reached'))).toContain('全局并发');
        expect(cardCreationErrorMessage(new Error("API Error 500: mime type is not supported by Gemini: 'image/gif'"))).toContain('image/gif');
        expect(cardCreationErrorMessage(new Error('API Error 503: https://private.example/path sk-secretsecretsecret'))).not.toMatch(/private\.example|sk-secret/);
    });

    it('bounds even a stalled history read and allows the caller to end its wait', async () => {
        vi.useFakeTimers();
        vi.spyOn(DB, 'peekMessagesByCharId').mockReturnValue(new Promise(() => {}));
        const stages: string[] = [];
        try {
            const pending = generateCardDraft({ char, user, api, request: '做卡片', signal: new AbortController().signal,
                traceId: 'timeout-preparation', onStage: stage => stages.push(stage) });
            const result = expect(pending).rejects.toThrow('CARD_CREATION_TIMEOUT');
            await vi.advanceTimersByTimeAsync(180_000);
            await result;
            expect(stages).toEqual(['history']);
        } finally {
            vi.useRealTimers();
        }
    });

    it('ends a pending HTTP wait after 180 seconds without submitting again', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        let markFetchStarted!: () => void;
        const fetchStarted = new Promise<void>(resolve => { markFetchStarted = resolve; });
        const fetch = vi.fn(() => { markFetchStarted(); return new Promise<Response>(() => {}); });
        vi.stubGlobal('fetch', fetch);
        try {
            const pending = generateCardDraft({ char, user, api, request: '做卡片', signal: new AbortController().signal });
            const result = expect(pending).rejects.toThrow('CARD_CREATION_TIMEOUT');
            await fetchStarted;
            await vi.advanceTimersByTimeAsync(180_000);
            await result;
            expect(fetch).toHaveBeenCalledTimes(1);
        } finally {
            vi.unstubAllGlobals();
            vi.useRealTimers();
        }
    });

    it.each([
        [429, 'server busy: global concurrency limit reached'],
        [500, "convert_request_failed: mime type is not supported by Gemini: 'image/gif'"],
    ])('reports HTTP %i once with its cause and no automatic retry', async (status, message) => {
        const fetch = vi.fn(async (_url: string, _options: RequestInit) => new Response(JSON.stringify({ error: { message } }), {
            status, headers: { 'content-type': 'application/json' },
        }));
        vi.stubGlobal('fetch', fetch);
        try {
            const stages: string[] = [];
            await expect(generateCardDraft({ char, user, api, request: '做卡片', signal: new AbortController().signal,
                traceId: `card-http-${status}`, onStage: stage => stages.push(stage) }))
                .rejects.toThrow(`API Error ${status}: ${message}`);
            expect(fetch).toHaveBeenCalledTimes(1);
            expect((fetch.mock.calls[0][1] as RequestInit & { __sullyApiCallId?: string }).__sullyApiCallId).toBe(`card-http-${status}`);
            expect(stages).toEqual(['history', 'context', 'http', 'headers', 'body']);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('requires one complete wrapped div with readable text', () => {
        expect(parseCreatedCard('[html]<div style="width:270px"><style>.x{color:red}</style><p>电影之夜</p></div>[/html]'))
            .toEqual({ html: '<div style="width:270px"><style>.x{color:red}</style><p>电影之夜</p></div>', textPreview: '电影之夜' });
        for (const source of [
            '电影之夜', '[html]<div>一</div>[/html][html]<div>二</div>[/html]',
            '[html]<div>不完整</html]', '[html]<div><p>截断</div>[/html]',
            '解释：[html]<div>卡</div>[/html]', '[html]<div><style>.x{}</style></div>[/html]',
        ]) expect(() => parseCreatedCard(source), source).toThrow();
    });

    it('uses the saved HTML prompt while the normal mode is off, without changing the character', async () => {
        const before = structuredClone(char);
        const messages = await buildCardCreationMessages(char, user, '做一张电影票');
        const serialized = JSON.stringify(messages);
        expect(serialized).toContain('偏爱海蓝色和手写风格');
        expect(serialized).toContain('只输出一张完整卡片');
        expect(messages.at(-1)).toMatchObject({ role: 'user', content: '做一张电影票' });
        expect(char).toEqual(before);
    });

    it('passes a long request with surrounding whitespace and code exactly to the model context', async () => {
        const request = ` \n${'中文<>&\n```html\n<div>内容</div>\n```\n'.repeat(1100)}\n `;
        const messages = await buildCardCreationMessages(char, user, request);
        expect(messages.at(-1)).toMatchObject({ role: 'user', content: request });
    });

    it('honors the private-chat breakpoint and never reads another character\'s messages', async () => {
        const id = `card-scope-${Date.now()}`;
        const otherId = `${id}-other`;
        await DB.saveMessage({ charId: id, role: 'user', type: 'text', content: '旧断点秘密' });
        const keepId = await DB.saveMessage({ charId: id, role: 'user', type: 'text', content: '当前现场' });
        await DB.saveMessage({ charId: otherId, role: 'user', type: 'text', content: '别人的秘密' });
        const scoped = { ...char, id, contextUserStartMessageId: keepId } as CharacterProfile;
        const messages = await buildCardCreationMessages(scoped, user, '做卡片');
        const source = JSON.stringify(messages);
        expect(source).toContain('当前现场');
        expect(source).not.toContain('旧断点秘密');
        expect(source).not.toContain('别人的秘密');
    });

    it('makes one tool-free request to the character API and persists only after explicit publish', async () => {
        const id = `card-creation-${Date.now()}`;
        const role = { ...char, id };
        const beforeMessages = await DB.getMessagesByCharId(id, true);
        const beforeMemories = await MemoryNodeDB.getByCharId(id);
        const beforeSchedules = await DB.getMyScheduleRecords();
        const beforeRole = structuredClone(role);
        const requests: Array<{ url: string; body: any; authorization: string }> = [];
        vi.stubGlobal('fetch', vi.fn(async (url: string, options: RequestInit) => {
            requests.push({ url, body: JSON.parse(String(options.body)), authorization: String((options.headers as Record<string, string>).Authorization) });
            return new Response(JSON.stringify({ choices: [{ message: { content: '[html]<div style="width:270px">今晚见</div>[/html]' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
        }));
        try {
            const draft = await generateCardDraft({ char: role, user, api, request: '邀请我', signal: new AbortController().signal });
            expect(requests).toHaveLength(1);
            expect(requests[0]).toMatchObject({ url: 'https://role.example/v1/chat/completions', authorization: 'Bearer role-key' });
            expect(requests[0].body.model).toBe('role-model');
            expect(requests[0].body.tools).toBeUndefined();
            expect(requests[0].body.tool_choice).toBeUndefined();
            expect(await DB.getMessagesByCharId(id, true)).toEqual(beforeMessages);
            expect(await MemoryNodeDB.getByCharId(id)).toEqual(beforeMemories);
            expect(await DB.getMyScheduleRecords()).toEqual(beforeSchedules);
            expect(role).toEqual(beforeRole);
            const saved = await publishCardDraft(id, draft);
            const message = (await DB.getMessageById(saved))!;
            expect(message).toMatchObject({ charId: id, role: 'assistant', type: 'html_card', content: '[HTML卡片] 今晚见' });
            expect(message.metadata).toMatchObject({ htmlSource: draft.html, htmlTextPreview: '今晚见' });
            expect(normalizeMessageContent(message, role.name, user.name)).toBe('[HTML卡片] 今晚见');
            expect(normalizeMessageContent(message, role.name, user.name)).not.toContain('<div');
            expect((await DB.getMessagesByCharId(id, true)).length).toBe(beforeMessages.length + 1);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it('leaves formal state unchanged when the API fails or the request is cancelled', async () => {
        const id = `card-failed-${Date.now()}`;
        const role = { ...char, id, activeBuffs: [{ name: '保留' }], homeSecrets: [{ text: '保留' }], activeMsg2Config: { enabled: true, tasks: [{ id: 'keep' }] } } as unknown as CharacterProfile;
        const beforeRole = structuredClone(role);
        const beforeMessages = await DB.getMessagesByCharId(id, true);
        const beforeMemories = await MemoryNodeDB.getByCharId(id);
        vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('网络断开'); }));
        try {
            await expect(generateCardDraft({ char: role, user, api, request: '做卡片', signal: new AbortController().signal })).rejects.toThrow();
            const aborted = new AbortController();
            aborted.abort();
            await expect(generateCardDraft({ char: role, user, api, request: '做卡片', signal: aborted.signal })).rejects.toThrow();
            expect(role).toEqual(beforeRole);
            expect(await DB.getMessagesByCharId(id, true)).toEqual(beforeMessages);
            expect(await MemoryNodeDB.getByCharId(id)).toEqual(beforeMemories);
        } finally {
            vi.unstubAllGlobals();
        }
    });
});
