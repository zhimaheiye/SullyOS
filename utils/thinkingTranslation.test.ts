import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../types';
import { ThinkingChainBlock } from '../components/chat/MessageItem';
import { DB } from './db';
import { FEATURE_API_STORAGE_KEY, saveFeatureApiSetting } from './featureApi';
import {
    freshForeignThinkingMessages, readThinkingTranslation, requestThinkingTranslation, selectThinkingTranslationApi,
    shouldTranslateThinking, thinkingSourceFingerprint,
} from './thinkingTranslation';

const memory = { lightLLM: { baseUrl: 'https://light.example/v1/', apiKey: 'light-key', model: 'light-model' } };
const character = { emotionConfig: { enabled: false, api: { baseUrl: 'https://emotion.example/v1', apiKey: 'emotion-key', model: 'emotion-model' } } };
const source = 'I need to slow down. She sounded tired, so I should answer gently.';
const newMessage = async (chain = source): Promise<Message> => {
    const charId = `thinking-translation-${Math.random()}`;
    const id = await DB.saveMessage({ charId, role: 'assistant', type: 'text', content: '我在。', metadata: { thinkingChain: chain, untouched: true } });
    return (await DB.getMessageById(id))!;
};

afterEach(() => vi.restoreAllMocks());

describe('thinking translation', () => {
    it('keeps Chinese prose with English terms, and translates foreign prose', () => {
        expect(shouldTranslateThinking('我先确认一下 API 的返回，再慢慢回答她。')).toBe(false);
        expect(shouldTranslateThinking('```const foo = 42```\n这段代码没问题，我先解释原因。')).toBe(false);
        expect(shouldTranslateThinking(source)).toBe(true);
        expect(shouldTranslateThinking('彼女は少し疲れている。まず落ち着いて返事をしよう。')).toBe(true);
        expect(shouldTranslateThinking('ok')).toBe(false);
    });

    it('uses the fully configured light API first, then the character emotion API', () => {
        expect(selectThinkingTranslationApi(memory, character)).toEqual({ baseUrl: 'https://light.example/v1', apiKey: 'light-key', model: 'light-model' });
        expect(selectThinkingTranslationApi({ lightLLM: { ...memory.lightLLM, model: '' } }, character)?.model).toBe('emotion-model');
        expect(selectThinkingTranslationApi({ lightLLM: { ...memory.lightLLM, model: '' } }, null)).toBeNull();
    });

    it('uses the selected translation feature API and keeps it after HTTP 429', async () => {
        saveFeatureApiSetting('thinkingTranslation', { mode: 'independent', api: {
            baseUrl: 'https://translation.example/v1', apiKey: 'translation-key', model: 'translation-model',
        } });
        try {
            const message = await newMessage();
            const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('rate limited', { status: 429 }));
            await expect(requestThinkingTranslation(message, memory, character)).rejects.toThrow('429');
            expect(fetchMock).toHaveBeenCalledTimes(1);
            expect(fetchMock.mock.calls[0][0]).toBe('https://translation.example/v1/chat/completions');
            expect(JSON.parse(String(fetchMock.mock.calls[0][1]?.body)).model).toBe('translation-model');
            expect(selectThinkingTranslationApi(memory, character)?.model).toBe('translation-model');
        } finally { localStorage.removeItem(FEATURE_API_STORAGE_KEY); }
    });

    it('only selects newly saved foreign assistant thinking, never loaded history or Chinese thoughts', () => {
        const make = (id: number, chain: string): Message => ({ id, charId: 'c1', role: 'assistant', type: 'text', content: '正文', timestamp: 200, metadata: { thinkingChain: chain } });
        const history = make(10, source);
        const chinese = make(11, '我先听懂她的意思，然后轻轻回应她。');
        const fresh = make(12, source);
        const cached = make(13, source);
        cached.metadata.thinkingTranslation = { version: 1, source: thinkingSourceFingerprint(source), text: '我先听懂。' };
        const other = { ...make(14, source), charId: 'c2' };
        expect(freshForeignThinkingMessages([history, chinese, fresh, cached, other], 10, 'c1')).toEqual([fresh]);
        expect(freshForeignThinkingMessages([fresh], 10, 'c1', 201)).toEqual([]);
    });

    it('persists once, preserves original and other metadata, and invalidates on source changes', async () => {
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '我该慢下来，温柔地回应她。' } }] }), { status: 200, headers: { 'content-type': 'application/json' } }));
        const message = await newMessage();
        const [one, two] = await Promise.all([
            requestThinkingTranslation(message, memory, character),
            requestThinkingTranslation(message, memory, character),
        ]);
        expect(one).toEqual(two);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0][0]).toBe('https://light.example/v1/chat/completions');
        const saved = (await DB.getMessageById(message.id))!;
        expect(saved.content).toBe(message.content);
        expect(saved.timestamp).toBe(message.timestamp);
        expect(saved.metadata.thinkingChain).toBe(source);
        expect(saved.metadata.untouched).toBe(true);
        expect(readThinkingTranslation(saved)?.text).toBe('我该慢下来，温柔地回应她。');
        await requestThinkingTranslation(saved, memory, character);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await DB.updateMessageMetadata(message.id, previous => ({ ...previous, thinkingChain: 'A changed thought.' }));
        expect(readThinkingTranslation((await DB.getMessageById(message.id))!)).toBeNull();
        expect(thinkingSourceFingerprint(source)).not.toBe(thinkingSourceFingerprint('A changed thought.'));
    });

    it('keeps the source readable after failures and allows manual retry', async () => {
        const message = await newMessage();
        const fetchMock = vi.spyOn(globalThis, 'fetch')
            .mockResolvedValueOnce(new Response('failure', { status: 401 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '' } }] }), { status: 200 }))
            .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '我先慢下来。' } }] }), { status: 200 }));
        await expect(requestThinkingTranslation(message, memory, character)).rejects.toThrow();
        await expect(requestThinkingTranslation(message, memory, character)).rejects.toThrow('没有返回译文');
        expect(readThinkingTranslation((await DB.getMessageById(message.id))!)).toBeNull();
        await requestThinkingTranslation(message, memory, character);
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect((await DB.getMessageById(message.id))?.metadata?.thinkingChain).toBe(source);
    });

    it('does not request the main API or save a translation after the source changes', async () => {
        const message = await newMessage();
        const fetchMock = vi.spyOn(globalThis, 'fetch');
        await expect(requestThinkingTranslation(message, { lightLLM: { baseUrl: '', apiKey: '', model: '' } }, null))
            .rejects.toThrow('请先配置');
        expect(fetchMock).not.toHaveBeenCalled();
        let release!: (response: Response) => void;
        fetchMock.mockImplementation(() => new Promise(resolve => { release = resolve; }));
        const pending = requestThinkingTranslation(message, memory, character);
        await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
        await DB.updateMessageMetadata(message.id, previous => ({ ...previous, thinkingChain: 'The thought was replaced.' }));
        release(new Response(JSON.stringify({ choices: [{ message: { content: '旧译文' } }] }), { status: 200 }));
        await expect(pending).rejects.toThrow('已经更改');
        const saved = (await DB.getMessageById(message.id))!;
        expect(saved.metadata.thinkingTranslation).toBeUndefined();
        expect(saved.metadata.thinkingChain).toBe('The thought was replaced.');
    });

    it('renders a separate accessible toggle for cached text without changing the source', () => {
        const markup = renderToStaticMarkup(React.createElement(ThinkingChainBlock, {
            chain: source, translation: '我先慢下来。', onTranslate: async () => '我先慢下来。',
        }));
        expect(markup).toContain('aria-label="查看原文"');
        expect(markup).toContain('我先慢下来。');
        expect(markup).not.toContain(source);
    });
});
