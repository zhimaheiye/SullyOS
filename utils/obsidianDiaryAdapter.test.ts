import { describe, expect, it, vi } from 'vitest';
import { diaryConnectionError, readObsidianDiaryFile, reconcileObsidianDiaryFile, resolveObsidianDiaryAdapter } from './obsidianDiaryAdapter';
import type { McpServerConfig, McpToolResult } from './mcpClient';

const path = '合成/角色 🧪.md', markdown = '# 合成\n\n中文 café 🧪\n';
const missing = (): McpToolResult => ({ success: false, rawText: `File not found: ${path}` });
const found = (content = markdown): McpToolResult => ({ success: true, data: { path, content, truncated: false, stat: { size: new TextEncoder().encode(content).byteLength } } });
const server = (): McpServerConfig => ({ id: 'test', name: '名称不参与选择', url: '', enabled: true, updatedAt: 0, tools: [
    { name: 'get_vault_file', annotations: { readOnlyHint: true }, inputSchema: { type: 'object', properties: { path: { type: 'string' }, format: { anyOf: [{ const: 'json' }, { const: 'text' }] } }, required: ['path'] } },
    { name: 'append_to_vault_file', description: 'Appends content to a vault file. Creates the file (and any missing parent directories) if it does not exist.', annotations: { readOnlyHint: false, destructiveHint: false }, inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] } },
] });
const operation = (read: () => Promise<McpToolResult>, writeAttempted = false) => ({
    path, markdown, writeAttempted, read, reserveWrite: vi.fn(async () => {}), write: vi.fn(async () => ({ success: true, data: 'OK' })),
});

describe('observed Obsidian Connector contract', () => {
    it('matches schema and creation description, supplies only actual supported arguments', () => {
        const adapter = resolveObsidianDiaryAdapter(server());
        expect(adapter.read).toEqual({ name: 'get_vault_file', pathKey: 'path', fixed: { format: 'json' } });
        expect(adapter.write).toEqual({ name: 'append_to_vault_file', pathKey: 'path', contentKey: 'content', fixed: {} });
        expect(adapter.createOnly).toBe(false);
    });
    it.each(['overwrite', 'extra-required', 'no-json', 'name-only', 'active-file', 'directory'])('rejects incompatible contract: %s', mode => {
        const value = server(), [read, write] = value.tools!;
        if (mode === 'overwrite') write.annotations!.destructiveHint = true;
        if (mode === 'extra-required') write.inputSchema.required.push('mode');
        if (mode === 'no-json') delete read.inputSchema.properties.format;
        if (mode === 'name-only') write.description = 'Appends to an existing file.';
        if (mode === 'active-file') write.name = 'append_to_active_file';
        if (mode === 'directory') write.name = 'create_vault_directory';
        expect(() => resolveObsidianDiaryAdapter(value)).toThrow();
    });
    it('recognizes only exact path-bound absence, never a transport 404 or arbitrary error', () => {
        expect(readObsidianDiaryFile(missing(), path)).toEqual({ exists: false });
        for (const result of [
            { success: false, error: 'HTTP 404' },
            { success: false, rawText: 'File not found: other.md' },
            { success: false, rawText: `File not found: ${path}\nextra` },
            { success: true, data: { exists: false } },
        ]) expect(() => readObsidianDiaryFile(result, path)).toThrow();
    });
    it('verifies UTF-8 byte length and rejects truncated or wrongly addressed content', () => {
        expect(readObsidianDiaryFile(found(), path)).toEqual({ exists: true, content: markdown });
        for (const patch of [{ truncated: true }, { truncated: undefined }, { path: 'other.md' }, { stat: { size: markdown.length } }, { content: null }]) {
            const value = found(); Object.assign(value.data, patch);
            expect(() => readObsidianDiaryFile(value, path)).toThrow();
        }
    });
    it('durably reserves before its sole send and verifies the complete readback', async () => {
        const events: string[] = [];
        const input = operation(vi.fn().mockResolvedValueOnce(missing()).mockResolvedValueOnce(missing()).mockResolvedValueOnce(found()));
        input.reserveWrite.mockImplementation(async () => { events.push('reserved'); });
        input.write.mockImplementation(async () => { events.push('sent'); return { success: true, data: 'OK' }; });
        expect((await reconcileObsidianDiaryFile(input)).status).toBe('written');
        expect(events).toEqual(['reserved', 'sent']);
    });
    it.each([false, true])('preserves manual edits with prior-attempt=%s', async attempted => {
        const input = operation(async () => found(markdown + '\n人工修改\n'), attempted);
        expect((await reconcileObsidianDiaryFile(input)).status).toBe('conflict');
        expect(input.reserveWrite).not.toHaveBeenCalled(); expect(input.write).not.toHaveBeenCalled();
    });
    it('stops if the file appears on the final preflight read', async () => {
        const input = operation(vi.fn().mockResolvedValueOnce(missing()).mockResolvedValueOnce(found('人工先创建')));
        expect((await reconcileObsidianDiaryFile(input)).status).toBe('conflict');
        expect(input.write).not.toHaveBeenCalled();
    });
    it('never sends again after an uncertain attempt, including when the file is absent', async () => {
        for (const result of [missing(), found()]) {
            const input = operation(async () => result, true);
            expect((await reconcileObsidianDiaryFile(input)).status).toBe(result.success ? 'written' : 'uncertain');
            expect(input.write).not.toHaveBeenCalled();
        }
    });
    it('accepts CRLF without changing trailing spaces or Markdown', async () => {
        const input = operation(async () => found(markdown.replace(/\n/g, '\r\n')));
        expect((await reconcileObsidianDiaryFile(input)).status).toBe('written');
        expect((await reconcileObsidianDiaryFile(operation(async () => found(markdown + ' ')))).status).toBe('conflict');
    });
    it('does not send if durable reservation fails', async () => {
        const input = operation(async () => missing()); input.reserveWrite.mockRejectedValue(Error('storage unavailable'));
        await expect(reconcileObsidianDiaryFile(input)).rejects.toThrow(); expect(input.write).not.toHaveBeenCalled();
    });
    it('reports actionable failure classes without echoing private response text', () => {
        for (const [message, expected] of [['HTTP 401 secret', '鉴权'], ['HTTP 403 secret', '拒绝'], ['HTTP 503 secret', '503'], ['Failed to fetch secret', '无法连接'], ['timeout secret', '超时']]) {
            expect(diaryConnectionError(message)).toContain(expected); expect(diaryConnectionError(message)).not.toContain('secret');
        }
    });
});
