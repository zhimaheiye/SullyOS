// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { APIConfig, CharacterProfile, UserProfile } from '../types';
import { buildSideStoryMessages, countSideStoryCharacters, generateSideStory, sideStoryContinuationContext } from './sideStoryCreation';
import { buildReadOnlyCreationMessages } from './cardCreation';
import { DB } from './db';

vi.mock('./cardCreation', async original => ({ ...await original<typeof import('./cardCreation')>(), buildReadOnlyCreationMessages: vi.fn(async (_char, _user, request: string, rules: string) => [
    { role: 'system', content: rules }, { role: 'user', content: request },
]) }));

const char = { id: 'side-story', name: '小雨', dialogueApi: { baseUrl: 'https://role.example/v1', apiKey: 'role-key', model: 'role-model' } } as CharacterProfile;
const user = { name: '阿岚' } as UserProfile;
const api = { baseUrl: 'https://global.example/v1', apiKey: 'global-key', model: 'global-model' } as APIConfig;
const completion = (content: string, finish_reason: string | null = 'stop') => ({ choices: [{ message: { content }, finish_reason }] });
const sse = (...events: object[]) => new Response(events.map(item => `data: ${JSON.stringify(item)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('temporary side story completion', () => {
    it('expands names only in outgoing prompt and preserves arbitrary long input and continuation', async () => {
        const request = ` $ {{char}}对{{user}}说：\n${'长'.repeat(30_000)}\n附言 `;
        const messages = await buildSideStoryMessages(char, user, request, '第一章\n结尾');
        expect(request).toContain('{{char}}');
        expect(messages[1].content).toBe(request.replace('{{char}}', '小雨').replace('{{user}}', '阿岚'));
        expect(messages.at(-2)?.content).toBe('第一章\n结尾');
        expect(messages.at(-1)?.content).toContain('不重写开头');
        expect(vi.mocked(buildReadOnlyCreationMessages)).toHaveBeenCalledWith(char, user, messages[1].content, expect.stringContaining('非正史'), undefined);
        expect(sideStoryContinuationContext('甲'.repeat(35_000))).toContain('中段已省略');
        expect(countSideStoryCharacters(' 祝 愿\n🌙 ')).toBe(2);
    });

    it('streams split SSE once, keeps Markdown, extra dialogue and literal HTML, and sends no tools or content logging flag', async () => {
        const save = vi.spyOn(DB, 'saveMessage');
        const fetch = vi.fn(async (_url: string, options: RequestInit & { __sullyPrivateTransient?: boolean }) => {
            expect(options.__sullyPrivateTransient).toBe(true);
            const body = JSON.parse(options.body as string);
            expect(body).toMatchObject({ model: 'role-model', stream: true, max_tokens: 16_000 });
            expect(body.tools).toBeUndefined();
            return sse(
                { choices: [{ delta: { content: '# 第一章\n' } }] },
                { choices: [{ delta: { content: '<script>alert(1)</script>\n小雨：还有附言' } }] },
                { choices: [{ delta: {}, finish_reason: 'stop' }] },
            );
        });
        vi.stubGlobal('fetch', fetch);
        const updates: string[] = [];
        const result = await generateSideStory({ char, user, api, request: ' 写一篇自由番外 ', signal: new AbortController().signal, onText: text => updates.push(text) });
        expect(result).toEqual({ text: '# 第一章\n<script>alert(1)</script>\n小雨：还有附言', complete: true, finishReason: 'stop' });
        expect(updates.at(-1)).toBe(result.text);
        expect(result.text.match(/第一章/g)).toHaveLength(1);
        expect(fetch).toHaveBeenCalledTimes(1);
        expect(save).not.toHaveBeenCalled();
    });

    it('accepts a non-stream JSON response once, retains leading/trailing whitespace and reports length finish', async () => {
        const fetch = vi.fn(async () => new Response(JSON.stringify(completion('  正文\n附言  ', 'length')), { headers: { 'content-type': 'application/json' } }));
        vi.stubGlobal('fetch', fetch);
        const result = await generateSideStory({ char, user, api, request: '写长篇', signal: new AbortController().signal });
        expect(result).toEqual({ text: '  正文\n附言  ', complete: false, finishReason: 'length' });
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('assembles SSE split across byte chunks and flags a missing terminal chunk', async () => {
        const encoder = new TextEncoder();
        const pieces = ['da', 'ta: {"choices":[{"delta":{"content":"上"}}]}\n\n', 'data: {"choices":[{"delta":{"content":"下"}}]}\n\n'];
        vi.stubGlobal('fetch', vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
            start(controller) { pieces.forEach(piece => controller.enqueue(encoder.encode(piece))); controller.close(); },
        }), { headers: { 'content-type': 'text/event-stream' } })));
        const updates: string[] = [];
        const result = await generateSideStory({ char, user, api, request: '写', signal: new AbortController().signal, onText: text => updates.push(text) });
        expect(result).toEqual({ text: '上下', complete: false, finishReason: null });
        expect(updates).toContain('上');
        expect(updates.at(-1)).toBe('上下');
    });

    it('stops a stalled request without retrying and ignores its late content', async () => {
        const controller = new AbortController();
        const fetch = vi.fn(async () => new Promise<Response>(() => {}));
        vi.stubGlobal('fetch', fetch);
        const updates = vi.fn();
        const pending = generateSideStory({ char, user, api, request: '写', signal: controller.signal, onText: updates });
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));
        controller.abort();
        await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
        expect(updates).not.toHaveBeenCalled();
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('retains streamed partial text on a failed response without retrying', async () => {
        const encoder = new TextEncoder();
        const stream = new ReadableStream<Uint8Array>({ start(controller) {
            controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"已写的一段"}}]}\n\n'));
            controller.error(new Error('network broke'));
        } });
        const fetch = vi.fn(async () => new Response(stream, { headers: { 'content-type': 'text/event-stream' } }));
        vi.stubGlobal('fetch', fetch);
        const updates: string[] = [];
        await expect(generateSideStory({ char, user, api, request: '写长篇', signal: new AbortController().signal, onText: text => updates.push(text) })).rejects.toThrow();
        expect(fetch).toHaveBeenCalledTimes(1);
        // Browser streams may error before or after delivering the queued first chunk.
        expect(updates.every(text => text === '已写的一段')).toBe(true);
    });


    it.each([429, 500])('does not automatically retry HTTP %i', async status => {
        const fetch = vi.fn(async () => new Response(JSON.stringify({ error: { message: 'temporary failure' } }), { status, headers: { 'content-type': 'application/json' } }));
        vi.stubGlobal('fetch', fetch);
        await expect(generateSideStory({ char, user, api, request: '番外', signal: new AbortController().signal })).rejects.toThrow(`API Error ${status}`);
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});
