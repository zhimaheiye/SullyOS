import { afterEach, describe, expect, it, vi } from 'vitest';
import { armManualRelay, assertManualRelayLocalRoute, cancelManualRelay, disarmManualRelay, getManualRelayState,
    cancelManualRelayForApp, invalidateManualRelayContext, isManualRelayCompletionUrl, manualRelayReplyError, maybeInterceptTextCompletion, maybeInterceptTextResponse, noteManualRelayUserAction, submitManualRelay, syncManualRelayPreference } from './manualModelRelay';
import { safeFetchJson } from './safeApi';
import { completeMainChat } from './mainChatCompletion';
import { completeTextTaskResponse } from './textTaskCompletion';

const body = { model: 'paid-model', messages: [
    { role: 'system', content: '角色设定' }, { role: 'developer', content: '保留格式' },
    { role: 'user', content: '上文' }, { role: 'assistant', content: '旧回复' }, { role: 'user', content: '继续' },
] };
const api = { baseUrl: 'https://paid.example/v1', apiKey: 'secret', model: 'paid-model' };
afterEach(() => { disarmManualRelay(); vi.restoreAllMocks(); });

describe('persistent manual model relay', () => {
    it('leaves ordinary requests untouched and requires a fresh user action', () => {
        expect(isManualRelayCompletionUrl('https://example.invalid/v1/chat/completions')).toBe(true);
        expect(isManualRelayCompletionUrl('https://example.invalid/v1/chat/completions/models')).toBe(false);
        expect(isManualRelayCompletionUrl('https://example.invalid/worker/instant-chat')).toBe(false);
        expect(maybeInterceptTextCompletion({ body })).toBeNull();
        armManualRelay();
        expect(() => maybeInterceptTextCompletion({ body })).toThrow('有效生成操作');
        noteManualRelayUserAction();
        expect(() => maybeInterceptTextCompletion({ body: { ...body, tools: [{ type: 'function' }] } })).toThrow('不支持外部模型接力');
        expect(() => maybeInterceptTextCompletion({ body: { ...body, messages: [{ role: 'user', content: 'blobref:secret' }] } })).toThrow('不受支持');
        expect(maybeInterceptTextCompletion({ body, priority: 'background' })).toBeNull();
        expect(maybeInterceptTextCompletion({ body, meta: { featureId: 'emotion' } })).toBeNull();
        expect(maybeInterceptTextCompletion({ body, meta: { featureId: 'worldHomeText' } })).toBeNull();
        expect(maybeInterceptTextCompletion({ body, meta: { featureId: 'forumDecision' } })).toBeNull();
        expect(getManualRelayState().status).toBe('armed');
    });

    it('fails closed when prompt preparation outlasts the action window', () => {
        armManualRelay(); noteManualRelayUserAction();
        const started = Date.now();
        vi.spyOn(Date, 'now').mockReturnValue(started + 121_000);
        expect(() => maybeInterceptTextCompletion({ body })).toThrow('已阻止真实模型请求');
        expect(getManualRelayState().status).toBe('armed');
    });

    it('freezes ordered messages, consumes only one concurrent request and returns raw text without usage', async () => {
        armManualRelay(); noteManualRelayUserAction();
        const first = maybeInterceptTextCompletion({ body, meta: { appName: '消息', charName: '合成角色' } });
        expect(first).not.toBeNull();
        expect(() => maybeInterceptTextCompletion({ body })).toThrow('当前有接力任务');
        const state = getManualRelayState();
        expect(state.request?.messages.slice(0, -1)).toEqual(body.messages);
        expect(state.request?.messages.at(-1)?.content).toContain('无工具，单次完整返回');
        expect(JSON.stringify(state.request)).not.toContain('secret');
        const id = state.request!.id;
        expect(submitManualRelay('stale-id', '迟到')).toBe(false);
        expect(submitManualRelay(id, '[html]<div>原样</div>[/html]')).toBe(true);
        const result = await first;
        expect(result.choices[0].message.content).toBe('[html]<div>原样</div>[/html]');
        expect(result.usage).toBeUndefined();
        expect(submitManualRelay(id, '重复')).toBe(false);
        expect(getManualRelayState().status).toBe('armed');
        expect(() => maybeInterceptTextCompletion({ body, meta: { appName: '消息' } })).toThrow('自动后续模型请求已停止');
        expect(maybeInterceptTextCompletion({ body, meta: { appName: '消息' }, priority: 'background' })).toBeNull();
    });

    it('cancels the original promise on Abort and rejects stale submissions', async () => {
        const abort = new AbortController();
        armManualRelay(); noteManualRelayUserAction();
        const result = maybeInterceptTextCompletion({ body, signal: abort.signal })!;
        const id = getManualRelayState().request!.id;
        abort.abort();
        await expect(result).rejects.toMatchObject({ name: 'AbortError' });
        expect(submitManualRelay(id, 'late')).toBe(false);
        expect(cancelManualRelay()).toBe(false);
    });

    it('invalidates the pending reply when its App changes', async () => {
        armManualRelay(); noteManualRelayUserAction();
        const result = maybeInterceptTextCompletion({ body, meta: { appId: 'messages', appName: '消息' } })!;
        const id = getManualRelayState().request!.id;
        invalidateManualRelayContext({ appId: 'vr-world' });
        await expect(result).rejects.toMatchObject({ name: 'AbortError' });
        expect(submitManualRelay(id, 'old')).toBe(false);
    });

    it('invalidates a pending group reply on group navigation', async () => {
        armManualRelay(); noteManualRelayUserAction();
        const task = maybeInterceptTextCompletion({ body, meta: { appId: 'group_chat', appName: '群聊' } })!;
        const id = getManualRelayState().request!.id;
        cancelManualRelayForApp('vrworld');
        expect(getManualRelayState().status).toBe('waiting');
        cancelManualRelayForApp('group_chat');
        await expect(task).rejects.toMatchObject({ name: 'AbortError' });
        expect(submitManualRelay(id, 'late')).toBe(false);
    });

    it('keeps a pending request open when pasted text contains an executable control tag', async () => {
        armManualRelay(); noteManualRelayUserAction();
        const task = maybeInterceptTextCompletion({ body })!;
        const id = getManualRelayState().request!.id;
        expect(manualRelayReplyError('[[ACTION:TRANSFER:100]]')).toContain('控制标签');
        expect(submitManualRelay(id, '[[GENERATE_IMAGE]]')).toBe(false);
        expect(getManualRelayState().status).toBe('waiting');
        expect(submitManualRelay(id, '[html]<div>这是普通卡片</div>[/html]')).toBe(true);
        await expect(task).resolves.toMatchObject({ choices: [{ message: { content: '[html]<div>这是普通卡片</div>[/html]' } }] });
    });

    it('intercepts registered feature, legacy Response and main-chat AGY before any provider call', async () => {
        const paidFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('must not send'));
        armManualRelay(); noteManualRelayUserAction();
        const task = completeTextTaskResponse('boardGame', api, { method: 'POST', body: JSON.stringify(body) });
        await Promise.resolve();
        expect(getManualRelayState().status).toBe('waiting');
        submitManualRelay(getManualRelayState().request!.id, '{"action":"pass"}');
        expect((await task).status).toBe(200);
        expect(paidFetch).not.toHaveBeenCalled();

        noteManualRelayUserAction();
        const main = completeMainChat({ body, url: 'https://paid.example/v1/chat/completions', headers: {},
            scope: 'private' });
        const mainId = getManualRelayState().request!.id;
        submitManualRelay(mainId, '人工正文');
        expect((await main).choices[0].message.content).toBe('人工正文');
        expect(paidFetch).not.toHaveBeenCalled();

        noteManualRelayUserAction();
        const legacy = maybeInterceptTextResponse({ body, meta: { appName: '群聊', purpose: '导演' } })!;
        submitManualRelay(getManualRelayState().request!.id, '{"actions":[]}');
        expect((await legacy).headers.get('content-type')).toContain('json');
        expect(paidFetch).not.toHaveBeenCalled();

        noteManualRelayUserAction();
        const streaming = maybeInterceptTextResponse({ body: { ...body, stream: true }, meta: { appName: '群聊', purpose: '成员回复' } })!;
        submitManualRelay(getManualRelayState().request!.id, '完整人工正文');
        const streamResponse = await streaming;
        expect(streamResponse.headers.get('content-type')).toContain('text/event-stream');
        expect(await streamResponse.text()).toContain('完整人工正文');
    });

    it('delivers one final stream delta after submission, while normal unarmed fetch keeps its route', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ choices: [] }),
            { status: 200, headers: { 'content-type': 'application/json' } }));
        await safeFetchJson('https://paid.example/chat/completions', { method: 'POST', body: JSON.stringify(body) }, 0);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        fetchMock.mockClear();
        const onDelta = vi.fn();
        armManualRelay(); noteManualRelayUserAction();
        const result = safeFetchJson('https://paid.example/chat/completions', { method: 'POST', body: JSON.stringify(body) }, 0, 0,
            { appName: '消息', purpose: '主回复' }, { onDelta });
        submitManualRelay(getManualRelayState().request!.id, '长文本'.repeat(1000));
        expect((await result).choices[0].message.content).toHaveLength(3000);
        expect(onDelta).toHaveBeenCalledTimes(1);
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it('handles three fresh foreground turns without rearming, and never calls a paid provider', async () => {
        const paidFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('must not send'));
        const ids: string[] = [];
        for (let turn = 1; turn <= 3; turn++) {
            if (turn === 1) armManualRelay();
            noteManualRelayUserAction();
            const task = completeMainChat({ body: { ...body, messages: [...body.messages, { role: 'user', content: `第 ${turn} 轮` }] },
                url: 'https://paid.example/v1/chat/completions', headers: {}, scope: 'private' });
            const request = getManualRelayState().request!;
            ids.push(request.id);
            expect(request.messages.at(-2)?.content).toBe(`第 ${turn} 轮`);
            expect(submitManualRelay(request.id, `人工回复 ${turn}`)).toBe(true);
            expect((await task).choices[0].message.content).toBe(`人工回复 ${turn}`);
            expect(getManualRelayState().status).toBe('armed');
        }
        expect(new Set(ids).size).toBe(3);
        expect(paidFetch).not.toHaveBeenCalled();
    });

    it('keeps the mode after cancellation and timeout, and closes a waiting turn explicitly', async () => {
        vi.useFakeTimers();
        try {
            armManualRelay(); noteManualRelayUserAction();
            const first = maybeInterceptTextCompletion({ body })!;
            const firstRejected = expect(first).rejects.toMatchObject({ name: 'AbortError' });
            const firstId = getManualRelayState().request!.id;
            cancelManualRelay(firstId);
            await firstRejected;
            expect(getManualRelayState().status).toBe('armed');
            noteManualRelayUserAction();
            const second = maybeInterceptTextCompletion({ body })!;
            const secondRejected = expect(second).rejects.toMatchObject({ name: 'AbortError' });
            const secondId = getManualRelayState().request!.id;
            await vi.advanceTimersByTimeAsync(30 * 60_000);
            await secondRejected;
            expect(submitManualRelay(secondId, '过期回复')).toBe(false);
            expect(getManualRelayState().status).toBe('armed');
            noteManualRelayUserAction();
            const third = maybeInterceptTextCompletion({ body })!;
            const thirdRejected = expect(third).rejects.toMatchObject({ name: 'AbortError' });
            disarmManualRelay();
            await thirdRejected;
            expect(getManualRelayState().status).toBe('off');
            noteManualRelayUserAction();
            expect(maybeInterceptTextCompletion({ body })).toBeNull();
        } finally { vi.useRealTimers(); }
    });

    it('stores only the enabled preference and follows another tab closing it', async () => {
        armManualRelay(); noteManualRelayUserAction();
        const task = maybeInterceptTextCompletion({ body })!;
        const rejected = expect(task).rejects.toMatchObject({ name: 'AbortError' });
        expect(localStorage.getItem('sully.manualModelRelay.enabled.v1')).toBe('true');
        expect(localStorage.getItem('sully.manualModelRelay.enabled.v1')).not.toContain('角色设定');
        syncManualRelayPreference(false);
        await rejected;
        expect(getManualRelayState().status).toBe('off');
        syncManualRelayPreference(true);
        expect(getManualRelayState().status).toBe('armed');
        expect(getManualRelayState().request).toBeNull();
    });

    it('rejects a cloud instant-chat turn before it can reach the Worker', () => {
        armManualRelay();
        expect(() => assertManualRelayLocalRoute(true)).toThrow('云端即时聊天');
        expect(() => assertManualRelayLocalRoute(false)).not.toThrow();
        expect(getManualRelayState().status).toBe('armed');
    });
});
