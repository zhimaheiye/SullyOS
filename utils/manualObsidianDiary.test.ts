import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { DB } from './db';
import { createMcpServer, saveMcpServers, callPrivateMcpTool } from './mcpClient';
import { blankObsidianDiary, saveObsidianDiary as saveTarget } from './obsidianDiaryConfig';
import { OBSIDIAN_DIARY_EPOCH } from './obsidianDiaryConfig';
import { listObsidianDiaries } from './obsidianDiary';
import { completeMainChat } from './mainChatCompletion';
import { parseManualObsidianDiary, runManualObsidianDiary } from './manualObsidianDiary';

vi.mock('./mainChatCompletion', () => ({ completeMainChat: vi.fn() }));
vi.mock('./mcpClient', async original => ({ ...await original<typeof import('./mcpClient')>(), callPrivateMcpTool: vi.fn() }));
vi.mock('./chatPrompts', () => ({ ChatPrompts: { buildMessageHistory: vi.fn(() => ({ apiMessages: [], sourceMessages: [] })) } }));
vi.mock('./context', () => ({ ContextBuilder: { buildCharacterRequest: vi.fn(async (_input, messages) => [{ role: 'system', content: '合成人设与世界书' }, ...messages]) } }));
vi.mock('./memoryPalace/db', () => ({ MemoryNodeDB: { getByCharId: vi.fn(async () => []) } }));

const completion = vi.mocked(completeMainChat);
const mcp = vi.mocked(callPrivateMcpTool);
const char = { id: 'diary-char-a', name: '同名角色', description: '合成人设', memories: [], contextLimit: 20 } as any;
const api = { baseUrl: 'https://synthetic.invalid/v1', apiKey: 'synthetic', model: 'synthetic-model' } as any;
const target = () => ({ ...blankObsidianDiary(), enabled: true, autonomous: true, serverId: 'diary-server', directory: '角色日记', charIds: [char.id] });
const body = '[[OBS_DIARY_START: 雨后的灯 | 安静]]\n# 雨后的灯\n\n今天记得很清楚。\n[[OBS_DIARY_END]]';
const response = (content = body, finish_reason = 'stop') => ({ choices: [{ message: { role: 'assistant', content }, finish_reason }] });
let vault: Map<string, string>;

beforeEach(async () => {
    vi.stubGlobal('window', new EventTarget());
    vi.stubGlobal('document', { visibilityState: 'visible' });
    await DB.deleteDB();
    localStorage.clear();
    vault = new Map();
    await DB.saveCharacter(char);
    saveTarget(target());
    saveMcpServers([{ ...createMcpServer('合成 Obsidian', 'http://localhost:0/mcp'), id: 'diary-server', enabled: true, charIds: [char.id], tools: [
        { name: 'get_vault_file', annotations: { readOnlyHint: true }, inputSchema: { type: 'object', properties: { path: { type: 'string' }, format: { anyOf: [{ const: 'json' }, { const: 'text' }] } }, required: ['path'] } },
        { name: 'append_to_vault_file', description: 'Appends content to a vault file. Creates the file (and any missing parent directories) if it does not exist.', annotations: { readOnlyHint: false, destructiveHint: false }, inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
    ] }]);
    completion.mockReset().mockResolvedValue(response());
    mcp.mockReset().mockImplementation(async (_server, name, args = {}) => {
        if (name === 'get_vault_file') {
            const content = vault.get(String(args.path));
            return content === undefined
                ? { success: false, error: `File not found: ${args.path}`, rawText: `File not found: ${args.path}` }
                : { success: true, data: { path: args.path, content, truncated: false, stat: { size: new TextEncoder().encode(content).byteLength } } };
        }
        vault.set(String(args.path), String(args.content));
        return { success: true, data: 'OK', rawText: 'OK' };
    });
});

afterEach(() => vi.unstubAllGlobals());

describe('one-click private Obsidian diary', () => {
    const run = (isCurrent = () => true) => runManualObsidianDiary({
        char, user: { name: '合成用户' } as any, api, groups: [], realtimeConfig: undefined,
        sourceId: `click-${crypto.randomUUID()}`, signal: new AbortController().signal, isCurrent,
    });

    it('makes one read-only generation, persists one draft, writes once and requires readback', async () => {
        const before = await DB.peekMessagesByCharId(char.id);
        const record = await run();
        expect(completion).toHaveBeenCalledTimes(1);
        expect(completion.mock.calls[0][0]).toMatchObject({ scope: 'private' });
        expect(record.status).toBe('written');
        expect(vault.get(record.path)).toBe(record.markdown);
        const operations = mcp.mock.calls.map(call => call[1]);
        expect(operations.filter(name => name === 'append_to_vault_file')).toHaveLength(1);
        expect(operations[0]).toBe('get_vault_file');
        expect(operations.at(-1)).toBe('get_vault_file');
        expect(await DB.peekMessagesByCharId(char.id)).toEqual(before);
        expect(await listObsidianDiaries()).toHaveLength(1);
    });

    it('blocks missing role/target configuration before the model request', async () => {
        saveTarget({ ...target(), enabled: false });
        await expect(run()).rejects.toThrow(/设置.*Obsidian 日记/);
        expect(completion).not.toHaveBeenCalled();
        expect(await listObsidianDiaries()).toHaveLength(0);
    });

    it('rejects malformed/refusal output and retains truncated content without MCP', async () => {
        completion.mockResolvedValueOnce(response('我今天不想写。'));
        await expect(run()).rejects.toThrow(/唯一且完整/);
        expect(await listObsidianDiaries()).toHaveLength(0);
        completion.mockResolvedValueOnce(response(body.replace('[[OBS_DIARY_END]]', ''), 'length'));
        const record = await run();
        expect(record.status).toBe('blocked');
        expect(record.incomplete).toBe(true);
        expect(record.content).toContain('今天记得很清楚');
        expect(mcp).not.toHaveBeenCalled();
    });

    it('keeps a valid late draft local when the character/page changed and never misroutes it', async () => {
        let current = true;
        completion.mockImplementationOnce(async () => { current = false; return response(); });
        const record = await run(() => current);
        expect(record.status).toBe('blocked');
        expect(record.message).toContain('聊天对象或页面已改变');
        expect(record.charId).toBe(char.id);
        expect(mcp).not.toHaveBeenCalled();
    });

    it('freezes the original target before generation', async () => {
        completion.mockImplementationOnce(async () => {
            saveTarget({ ...target(), directory: '新的目标' });
            return response();
        });
        const record = await run();
        expect(record.status).toBe('blocked');
        expect(record.path.startsWith('角色日记/')).toBe(true);
        expect(record.message).toMatch(/目标|设置|配置/);
        expect(mcp).not.toHaveBeenCalled();
    });

    it('keeps the late draft local after a backup restore even when the target still looks identical', async () => {
        completion.mockImplementationOnce(async () => {
            await DB.saveAsset(OBSIDIAN_DIARY_EPOCH, 'restored-diary-epoch');
            return response();
        });
        const record = await run();
        expect(record.status).toBe('blocked');
        expect(record.message).toMatch(/存档.*恢复|恢复.*存档/);
        expect(record.path.startsWith('角色日记/')).toBe(true);
        expect(mcp).not.toHaveBeenCalled();
    });

    it('parses exactly one titled diary and rejects extra text or multiple blocks', () => {
        expect(parseManualObsidianDiary(body)).toMatchObject({ title: '雨后的灯', mood: '安静', incomplete: false });
        expect(() => parseManualObsidianDiary(`说明\n${body}`)).toThrow();
        expect(() => parseManualObsidianDiary(body + body)).toThrow();
    });
});
