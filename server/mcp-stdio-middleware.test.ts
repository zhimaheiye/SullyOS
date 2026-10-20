import { createServer, type Server } from 'node:http';
import { afterEach, describe, expect, it } from 'vitest';
import { closeAllMcpStdioServers, mcpStdioMiddleware, shouldUseShellForMcpCommand } from './mcp-stdio-middleware';

let httpServer: Server | undefined;

afterEach(async () => {
  closeAllMcpStdioServers();
  if (httpServer) await new Promise<void>(resolve => httpServer!.close(() => resolve()));
  httpServer = undefined;
});

const startBridge = async (): Promise<string> => {
  httpServer = createServer((req, res) => {
    req.url = (req.url || '/').replace(/^\/api\/mcp-stdio/, '') || '/';
    void mcpStdioMiddleware(req, res);
  });
  await new Promise<void>(resolve => httpServer!.listen(0, '127.0.0.1', resolve));
  const address = httpServer.address();
  if (!address || typeof address === 'string') throw new Error('test bridge did not bind');
  return `http://127.0.0.1:${address.port}/api/mcp-stdio/test-server`;
};

const FAKE_STDIO_SERVER = `
const readline = require('node:readline');
readline.createInterface({ input: process.stdin }).on('line', line => {
  const request = JSON.parse(line);
  if (request.id == null) return;
  const result = request.method === 'initialize'
    ? { protocolVersion: '2025-11-25', capabilities: { tools: {} }, serverInfo: { name: 'fake-stdio', version: '1' } }
    : request.method === 'tools/list'
      ? { tools: [{ name: 'echo', description: 'echo', inputSchema: { type: 'object', properties: { value: { type: 'string' } } } }] }
      : { content: [{ type: 'text', text: JSON.stringify(request.params.arguments) }] };
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\\n');
});
`;

describe('mcp stdio Vite middleware', () => {
  it('只让 Windows CMD shim 走 shell，普通可执行文件仍直接 spawn', () => {
    expect(shouldUseShellForMcpCommand('npx', 'win32')).toBe(true);
    expect(shouldUseShellForMcpCommand('C:\\Program Files\\nodejs\\npx.cmd', 'win32')).toBe(true);
    expect(shouldUseShellForMcpCommand('C:\\Program Files\\nodejs\\node.exe', 'win32')).toBe(false);
    expect(shouldUseShellForMcpCommand('npx', 'linux')).toBe(false);
  });

  it('启动本机进程并完成 initialize、tools/list、tools/call', async () => {
    const base = await startBridge();
    const configure = await fetch(`${base}/config`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: process.execPath, args: ['-e', FAKE_STDIO_SERVER], env: {} }),
    });
    expect(configure.status).toBe(200);

    const rpc = async (body: any) => fetch(`${base}/mcp`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const initialized = await rpc({ jsonrpc: '2.0', id: 41, method: 'initialize', params: {} });
    expect(initialized.headers.get('Mcp-Session-Id')).toBe('stdio-test-server');
    await expect(initialized.json()).resolves.toMatchObject({ id: 41, result: { serverInfo: { name: 'fake-stdio' } } });
    expect((await rpc({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })).status).toBe(202);
    await expect((await rpc({ jsonrpc: '2.0', id: 42, method: 'tools/list' })).json())
      .resolves.toMatchObject({ id: 42, result: { tools: [{ name: 'echo' }] } });
    await expect((await rpc({ jsonrpc: '2.0', id: 43, method: 'tools/call', params: { name: 'echo', arguments: { value: '你好' } } })).json())
      .resolves.toMatchObject({ id: 43, result: { content: [{ text: '{"value":"你好"}' }] } });
  });
});
