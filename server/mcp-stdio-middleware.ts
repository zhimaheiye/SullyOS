import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname } from 'node:path';

type StdioConfig = {
  command: string;
  args: string[];
  env: Record<string, string>;
};

type PendingRequest = {
  originalId: string | number;
  resolve: (value: any) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
};

type Runtime = {
  child: ChildProcessWithoutNullStreams;
  stdout: string;
  stderr: string;
  nextId: number;
  pending: Map<number, PendingRequest>;
};

type ServerEntry = {
  config: StdioConfig;
  signature: string;
  runtime?: Runtime;
};

const MAX_BODY_BYTES = 1024 * 1024;
const MAX_STDOUT_BUFFER = 2 * 1024 * 1024;
const REQUEST_TIMEOUT_MS = 60_000;
const entries = new Map<string, ServerEntry>();

export const shouldUseShellForMcpCommand = (command: string, platform = process.platform): boolean => {
  if (platform !== 'win32') return false;
  const extension = extname(command).toLowerCase();
  return extension === '' || extension === '.cmd' || extension === '.bat';
};

const json = (res: ServerResponse, status: number, data: unknown) => {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
};

const readBody = async (req: IncomingMessage): Promise<string> => {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buffer = Buffer.from(chunk);
    total += buffer.length;
    if (total > MAX_BODY_BYTES) throw new Error('请求体过大');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
};

const isLoopback = (address = ''): boolean =>
  address === '127.0.0.1' || address === '::1' || address.startsWith('::ffff:127.');

const parseConfig = (value: any): StdioConfig => {
  const command = typeof value?.command === 'string' ? value.command.trim() : '';
  if (!command || command.length > 4096) throw new Error('缺少有效的 stdio 启动命令');
  const args = Array.isArray(value?.args)
    ? value.args.filter((item: unknown) => typeof item === 'string').map((item: string) => item.trim()).filter(Boolean)
    : [];
  if (args.length > 100 || args.some((item: string) => item.length > 4096)) throw new Error('stdio 参数过多或过长');
  const env: Record<string, string> = {};
  if (value?.env && typeof value.env === 'object' && !Array.isArray(value.env)) {
    for (const [name, raw] of Object.entries(value.env)) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) throw new Error(`无效的环境变量名：${name}`);
      if (typeof raw !== 'string' || raw.length > 32_768) throw new Error(`环境变量 ${name} 的值无效或过长`);
      env[name] = raw;
    }
  }
  return { command, args, env };
};

const rejectPending = (runtime: Runtime, message: string) => {
  for (const pending of runtime.pending.values()) {
    clearTimeout(pending.timeout);
    pending.reject(new Error(message));
  }
  runtime.pending.clear();
};

const terminateChild = (child: ChildProcessWithoutNullStreams) => {
  if (process.platform === 'win32' && child.pid) {
    const killer = spawn('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], {
      stdio: 'ignore', windowsHide: true,
    });
    killer.once('error', () => { try { child.kill(); } catch { /* process already exited */ } });
    killer.unref();
    return;
  }
  try { child.kill(); } catch { /* process already exited */ }
};

const stopRuntime = (entry: ServerEntry, message = 'stdio MCP 进程已停止') => {
  const runtime = entry.runtime;
  if (!runtime) return;
  entry.runtime = undefined;
  rejectPending(runtime, message);
  terminateChild(runtime.child);
};

const writeMessage = (runtime: Runtime, message: unknown) => {
  runtime.child.stdin.write(`${JSON.stringify(message)}\n`);
};

const handleStdoutLine = (entry: ServerEntry, runtime: Runtime, line: string) => {
  if (!line.trim()) return;
  let message: any;
  try { message = JSON.parse(line); } catch { return; }
  if (message?.id != null && ('result' in message || 'error' in message)) {
    const pending = runtime.pending.get(Number(message.id));
    if (!pending) return;
    runtime.pending.delete(Number(message.id));
    clearTimeout(pending.timeout);
    pending.resolve({ ...message, id: pending.originalId });
    return;
  }
  if (message?.id != null && typeof message?.method === 'string') {
    writeMessage(runtime, {
      jsonrpc: '2.0', id: message.id,
      error: { code: -32601, message: `SullyOS stdio bridge 不支持服务端请求：${message.method}` },
    });
  }
};

const startRuntime = (entry: ServerEntry): Runtime => {
  const child = spawn(entry.config.command, entry.config.args, {
    env: { ...process.env, ...entry.config.env },
    // Windows 的 npx/npm/pnpm 通常是 CMD shim，Node 直接 spawn 会 ENOENT/EINVAL。
    shell: shouldUseShellForMcpCommand(entry.config.command),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  const runtime: Runtime = { child, stdout: '', stderr: '', nextId: 0, pending: new Map() };
  entry.runtime = runtime;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    runtime.stdout += chunk;
    if (runtime.stdout.length > MAX_STDOUT_BUFFER) {
      stopRuntime(entry, 'stdio MCP 输出超过安全上限');
      return;
    }
    const lines = runtime.stdout.split(/\r?\n/);
    runtime.stdout = lines.pop() || '';
    for (const line of lines) handleStdoutLine(entry, runtime, line);
  });
  child.stderr.setEncoding('utf8');
  child.stderr.on('data', (chunk: string) => {
    runtime.stderr = `${runtime.stderr}${chunk}`.slice(-4000);
  });
  child.stdin.on('error', error => {
    if (entry.runtime === runtime) entry.runtime = undefined;
    rejectPending(runtime, `stdio MCP 输入通道失败：${error.message}`);
    terminateChild(child);
  });
  child.once('error', error => {
    if (entry.runtime === runtime) entry.runtime = undefined;
    rejectPending(runtime, `无法启动 stdio MCP：${error.message}`);
  });
  child.once('exit', code => {
    if (entry.runtime === runtime) entry.runtime = undefined;
    const detail = runtime.stderr.trim();
    rejectPending(runtime, `stdio MCP 进程已退出（code ${code ?? 'unknown'}）${detail ? `：${detail}` : ''}`);
  });
  return runtime;
};

const sendRequest = (entry: ServerEntry, request: any): Promise<any> => {
  if (request?.method === 'initialize' && entry.runtime) stopRuntime(entry, 'stdio MCP 正在重新握手');
  const runtime = entry.runtime || startRuntime(entry);
  if (request?.id == null) {
    writeMessage(runtime, request);
    return Promise.resolve(null);
  }
  const bridgeId = ++runtime.nextId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      runtime.pending.delete(bridgeId);
      reject(new Error(`stdio MCP 请求超时（${Math.round(REQUEST_TIMEOUT_MS / 1000)} 秒）`));
    }, REQUEST_TIMEOUT_MS);
    runtime.pending.set(bridgeId, { originalId: request.id, resolve, reject, timeout });
    try { writeMessage(runtime, { ...request, id: bridgeId }); }
    catch (error: any) {
      clearTimeout(timeout);
      runtime.pending.delete(bridgeId);
      reject(error);
    }
  });
};

export function closeAllMcpStdioServers(): void {
  for (const entry of entries.values()) stopRuntime(entry);
  entries.clear();
}

/**
 * Vite-only localhost bridge. The browser supplies command/args/env, while this Node process owns
 * the child process and translates the existing Streamable-HTTP-shaped calls to newline JSON-RPC.
 */
export async function mcpStdioMiddleware(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (!isLoopback(req.socket.remoteAddress)) {
    return json(res, 403, { error: 'stdio MCP 只允许当前电脑访问，局域网设备不能启动本机进程' });
  }
  const url = new URL(req.url || '/', 'http://localhost');
  if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true });
  const match = /^\/([^/]+)(?:\/(config|mcp))?$/.exec(url.pathname);
  if (!match) return json(res, 404, { error: 'Not found' });
  const id = decodeURIComponent(match[1]);
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) return json(res, 400, { error: '无效的 MCP 服务器 ID' });

  try {
    if (req.method === 'POST' && match[2] === 'config') {
      const config = parseConfig(JSON.parse(await readBody(req)));
      const signature = JSON.stringify(config);
      const current = entries.get(id);
      if (current?.signature === signature) return json(res, 200, { ok: true });
      if (current) stopRuntime(current, 'stdio MCP 配置已变化');
      entries.set(id, { config, signature });
      return json(res, 200, { ok: true });
    }
    if (req.method === 'DELETE' && !match[2]) {
      const current = entries.get(id);
      if (current) stopRuntime(current);
      entries.delete(id);
      return json(res, 200, { ok: true });
    }
    if (req.method === 'POST' && match[2] === 'mcp') {
      const entry = entries.get(id);
      if (!entry) return json(res, 409, { error: '请先提交 stdio MCP 配置' });
      const request = JSON.parse(await readBody(req));
      const response = await sendRequest(entry, request);
      if (response === null) {
        res.statusCode = 202;
        res.end();
        return;
      }
      res.setHeader('Mcp-Session-Id', `stdio-${id}`);
      return json(res, 200, response);
    }
    return json(res, 405, { error: 'Method Not Allowed' });
  } catch (error: any) {
    return json(res, 500, { error: error?.message || 'stdio MCP bridge failed' });
  }
}
