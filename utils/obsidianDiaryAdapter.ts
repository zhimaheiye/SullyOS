/** 公开版. Contract verified against Obsidian MCP Connector 1.0.1.
 * append_to_vault_file is NOT an atomic create-only API. Never replay a send.
 */
import type { McpServerConfig, McpToolDef, McpToolResult } from './mcpClient';

export const OBSIDIAN_READ_TOOL = 'get_vault_file';
export const OBSIDIAN_WRITE_TOOL = 'append_to_vault_file';
export const diaryProblem = (message: string) => Object.assign(Error(message), { diarySafe: true });

function toolMatches(tool: McpToolDef | undefined, fields: string[], writing: boolean) {
    const schema = tool?.inputSchema;
    return !!tool && schema?.type === 'object'
        && tool.annotations?.destructiveHint !== true
        && (writing ? tool.annotations?.readOnlyHint === false : tool.annotations?.readOnlyHint === true)
        && fields.every(key => schema.properties?.[key]?.type === 'string')
        && (schema.required || []).every((key: string) => fields.includes(key) || !writing && key === 'format');
}

/** Match the observed contract, not the server's display name or a substring tool search. */
export function resolveObsidianDiaryAdapter(server: McpServerConfig) {
    const read = server.tools?.find(t => t.name === OBSIDIAN_READ_TOOL);
    const write = server.tools?.find(t => t.name === OBSIDIAN_WRITE_TOOL);
    if (!toolMatches(read, ['path'], false) || !toolMatches(write, ['path', 'content'], true))
        throw diaryProblem('此连接未提供已适配的 Obsidian 文件读取／创建工具，请重新检查连接');
    const format = read!.inputSchema.properties.format;
    const hasJson = format?.enum?.includes('json') || format?.anyOf?.some((s: any) => s.const === 'json');
    if (!hasJson || !/creates the file/i.test(write!.description || '') || !/if it does not exist/i.test(write!.description || ''))
        throw diaryProblem('工具契约与已验证版本不一致：需要完整 JSON 读取及缺失文件创建能力');
    return {
        id: 'obsidian-connector-v1' as const,
        read: { name: OBSIDIAN_READ_TOOL, pathKey: 'path', fixed: { format: 'json' } },
        write: { name: OBSIDIAN_WRITE_TOOL, pathKey: 'path', contentKey: 'content', fixed: {} },
        readContentKey: 'content',
        // Kept only for legacy backups. This server has no such parameter or guarantee.
        createOnly: false,
    };
}

/** Never surface an arbitrary service response: it can contain credentials or note bodies. */
export function diaryConnectionError(error: unknown): string {
    const text = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
    const status = text.match(/\bHTTP\s+(\d{3})\b/i)?.[1];
    if (status === '401' || /unauthorized|authentication|invalid token/i.test(text)) return '连接鉴权失效（401），请在已有 MCP 管理中检查凭据后重试';
    if (status === '403' || /forbidden|permission denied|access denied/i.test(text)) return '连接拒绝访问（403），请检查该连接的笔记权限后重试';
    if (status === '404' || /session.*(?:expired|invalid|not found)/i.test(text)) return 'MCP 会话或端点已失效，请重新检查连接后重试';
    if (status === '429') return 'MCP 请求限流（429），请稍后重试';
    if (status) return `MCP 返回 HTTP ${status}，请在服务恢复后重试`;
    if (/timeout|timed out|超时|abort/i.test(text)) return 'MCP 连接超时或已中止，请确认 Obsidian 和连接插件仍在运行后重试';
    if (/fetch|network|ECONN|连接|网络/i.test(text)) return '无法连接 MCP，请确认 Obsidian、插件和原代理可达后重试';
    if (/protocol|协议/i.test(text)) return 'MCP 协议协商失败，请检查连接插件版本';
    return 'MCP 未返回可用结果，请重新检查已有连接；正文已保留';
}

export type DiaryFileRead = { exists: false } | { exists: true; content: string };
export function readObsidianDiaryFile(result: McpToolResult, path: string): DiaryFileRead {
    // Only this exact, path-bound failure was verified. HTTP/session 404 is not file absence.
    if (!result.success) {
        if (result.rawText === `File not found: ${path}`) return { exists: false };
        throw diaryProblem(diaryConnectionError(result.error));
    }
    const data = result.data;
    if (!data || typeof data !== 'object' || data.path !== path)
        throw diaryProblem('读取回执缺少正确路径，未执行写入');
    if (data.truncated !== false || typeof data.content !== 'string')
        throw diaryProblem('读取正文被截断或格式不完整，未执行写入；请检查 MCP Connector 的文本读取上限');
    if (!Number.isSafeInteger(data.stat?.size) || data.stat.size !== new TextEncoder().encode(data.content).byteLength)
        throw diaryProblem('读取内容与文件字节数不一致，未执行写入；正文保留待核对');
    return { exists: true, content: data.content };
}

export const sameDiaryMarkdown = (a: string, b: string) => a.replace(/\r\n/g, '\n') === b.replace(/\r\n/g, '\n');
type FileOutcome = { status: 'written' | 'conflict' | 'uncertain'; message: string };
function existingFile(content: string, markdown: string): FileOutcome {
    return sameDiaryMarkdown(content, markdown)
        ? { status: 'written', message: '已读取并核对完整文件' }
        : { status: 'conflict', message: '文件包含不同内容，已保留本机正文，未覆盖或追加现有文件' };
}

/** Owner supplies durable reservation and scope/epoch/abort checks before every call. */
export async function reconcileObsidianDiaryFile(input: {
    path: string;
    markdown: string;
    writeAttempted: boolean;
    read: () => Promise<McpToolResult>;
    reserveWrite: () => Promise<void>;
    write: () => Promise<McpToolResult>;
}): Promise<FileOutcome> {
    const found = readObsidianDiaryFile(await input.read(), input.path);
    if (found.exists) return existingFile(found.content, input.markdown);
    if (input.writeAttempted) return { status: 'uncertain', message: '该条目已发起过写入，但当前文件不存在。为避免重复追加，不再次发送；本机正文保留' };
    // Recheck immediately before reservation; never treat append as create-only.
    const latest = readObsidianDiaryFile(await input.read(), input.path);
    if (latest.exists) return existingFile(latest.content, input.markdown);
    await input.reserveWrite();
    const result = await input.write();
    if (!result.success) throw diaryProblem(`写入结果待核对：${diaryConnectionError(result.error)}`);
    const verified = readObsidianDiaryFile(await input.read(), input.path);
    if (!verified.exists) throw diaryProblem('写入回执后未找到完整文件，结果待核对，不再次追加');
    return existingFile(verified.content, input.markdown);
}
