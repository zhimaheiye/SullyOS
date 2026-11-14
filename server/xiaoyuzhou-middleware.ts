import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { createReadStream } from 'node:fs';
import { mkdir, readdir, readFile, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { dirname, extname, resolve } from 'node:path';
import { createInterface } from 'node:readline';
import { parseByteRange } from './podcast-range';

const actions = new Set(['status', 'episode', 'transcript', 'loginStart', 'loginPoll', 'logout']);
const episodeId = /^[a-f0-9]{24}$/;
const formats = new Map([['.m4a', 'audio/mp4'], ['.mp4', 'audio/mp4'], ['.mp3', 'audio/mpeg'], ['.aac', 'audio/aac'], ['.ogg', 'audio/ogg'], ['.wav', 'audio/wav'], ['.flac', 'audio/flac']]);
const json = (res: ServerResponse, code: number, data: unknown) => {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
};

async function localExport(root: string, eid: string, kind: 'audio' | 'transcript') {
  try {
    const directory = await realpath(root);
    const match = (await readdir(directory, { withFileTypes: true })).find(entry => {
      const extension = extname(entry.name).toLowerCase();
      return entry.isFile() && entry.name.slice(0, -extension.length).endsWith(`_${eid}`)
        && (kind === 'transcript' ? extension === '.json' : formats.has(extension));
    });
    if (!match) return null;
    const file = await realpath(resolve(directory, match.name));
    return dirname(file) === directory ? file : null;
  } catch { return null; }
}

export function createXiaoyuzhouMiddleware() {
  const toolDir = resolve(process.env.SULLY_XIAOYUZHOU_DIR || 'podcast-data/tool');
  const exportDir = resolve(process.env.SULLY_XIAOYUZHOU_EXPORT_DIR || resolve(toolDir, '导出'));
  const mediaDir = resolve(process.env.SULLY_XIAOYUZHOU_MEDIA_DIR || 'podcast-data/media');
  const importing = new Set<string>();
  const adapter = resolve('server/xiaoyuzhou_bridge.py');
  let child: ChildProcessWithoutNullStreams | undefined;
  let nextId = 0;
  async function managedAudio(eid: string) {
    try {
      const value = JSON.parse(await readFile(resolve(mediaDir, eid + '.json'), 'utf8'));
      if (typeof value.file !== 'string' || !new RegExp('^' + eid + '_[a-f0-9-]{36}\\.(mp3|m4a|mp4|aac|ogg|wav|flac)$').test(value.file)) return null;
      const directory = await realpath(mediaDir);
      const file = await realpath(resolve(directory, value.file));
      return dirname(file) === directory ? file : null;
    } catch { return null; }
  }
  const audioFile = async (eid: string) => await managedAudio(eid) || await localExport(exportDir, eid, 'audio');
  const pending = new Map<number, { finish: (error: string | undefined, data?: unknown) => void }>();

  function close() {
    const current = child;
    child = undefined;
    current?.kill();
    for (const item of pending.values()) item.finish('本机小宇宙连接已断开，请重试。');
  }

  function call(action: string, eid?: string) {
    if (pending.size >= 4) throw new Error('小宇宙正在处理其它请求，请稍后再试。');
    if (!child) {
      const current = spawn(process.env.SULLY_XIAOYUZHOU_PYTHON || 'python', ['-u', '-B', adapter, toolDir], {
        windowsHide: true, env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
      });
      child = current;
      current.stderr.resume();
      current.stdin.on('error', () => { if (child === current) close(); });
      current.on('error', () => { if (child === current) close(); });
      current.on('exit', () => { if (child === current) close(); });
      createInterface({ input: current.stdout }).on('line', line => {
        if (child !== current) return;
        try {
          const reply = JSON.parse(line);
          pending.get(reply.id)?.finish(reply.error, reply.data);
        } catch { close(); }
      });
    }
    const current = child;
    const id = ++nextId;
    return new Promise<unknown>((resolveResult, reject) => {
      const timer = setTimeout(close, 95_000);
      pending.set(id, { finish: (error, data) => {
        clearTimeout(timer);
        pending.delete(id);
        if (error) reject(new Error(error));
        else resolveResult(data);
      } });
      current.stdin.write(JSON.stringify({ id, action, eid }) + '\n');
    });
  }

  async function handler(req: IncomingMessage, res: ServerResponse) {
    const host = req.headers.host || '';
    const origin = req.headers.origin;
    const site = req.headers['sec-fetch-site'];
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '')
        || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/.test(host)
        || (site && site !== 'same-origin' && site !== 'none')
        || (origin && origin !== 'http://' + host && origin !== 'https://' + host)) {
      json(res, 403, { error: '小宇宙只允许当前电脑上的 SullyOS 访问。' });
      return;
    }
    const [, action, eid, extra] = (req.url || '/').split('?')[0].split('/');
    if (extra !== undefined) { json(res, 404, { error: '未知小宇宙操作。' }); return; }
    try {
      if (action === 'importAudio' && episodeId.test(eid || '')) {
        if (req.method !== 'POST' || !origin || req.headers['x-sully-podcast'] !== '1') {
          json(res, 403, { error: '需要从小宇宙 App 选择音频。' }); return;
        }
        const extension = '.' + new URL(req.url || '/', 'http://localhost').searchParams.get('format');
        if (!formats.has(extension)) { json(res, 400, { error: '不支持这个音频格式。' }); return; }
        if (importing.has(eid)) { json(res, 409, { error: '这集音频正在导入。' }); return; }
        importing.add(eid);
        const fileName = eid + '_' + randomUUID() + extension;
        const file = resolve(mediaDir, fileName);
        const marker = resolve(mediaDir, fileName + '.json.part');
        let committed = false;
        try {
          await mkdir(mediaDir, { recursive: true });
          const previous = await managedAudio(eid);
          let bytes = 0;
          const bound = new Transform({ transform(chunk, _encoding, callback) {
            bytes += chunk.length;
            callback(bytes > 1024 * 1024 * 1024 ? new Error('音频超过 1 GB。') : null, chunk);
          } });
          await pipeline(req, bound, createWriteStream(file, { flags: 'wx' }));
          if (!bytes) throw new Error('音频文件为空。');
          await writeFile(marker, JSON.stringify({ file: fileName }), { flag: 'wx' });
          await rename(marker, resolve(mediaDir, eid + '.json'));
          committed = true;
          if (previous) await rm(previous, { force: true }).catch(() => {});
          json(res, 200, { localAudio: true });
        } finally {
          importing.delete(eid);
          await rm(marker, { force: true }).catch(() => {});
          if (!committed) await rm(file, { force: true }).catch(() => {});
        }
        return;
      }
      if (action === 'audio' && (req.method === 'GET' || req.method === 'HEAD') && episodeId.test(eid || '')) {
        const file = await audioFile(eid);
        if (!file) { json(res, 404, { error: '未找到这期节目的本机音频。' }); return; }
        const { size } = await stat(file);
        const headers = { 'Content-Type': formats.get(extname(file).toLowerCase())!, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
        let range;
        try { range = parseByteRange(req.headers.range, size); }
        catch { res.writeHead(416, { ...headers, 'Content-Range': 'bytes */' + size }).end(); return; }
        res.writeHead(range ? 206 : 200, { ...headers, 'Content-Length': range?.length ?? size,
          ...(range ? { 'Content-Range': 'bytes ' + range.start + '-' + range.end + '/' + size } : {}) });
        if (req.method === 'HEAD') { res.end(); return; }
        const stream = createReadStream(file, range || undefined);
        res.once('close', () => stream.destroy());
        stream.on('error', () => res.destroy());
        stream.pipe(res);
        return;
      }
      if (!actions.has(action) || ((action === 'episode' || action === 'transcript') ? !episodeId.test(eid || '') : eid !== undefined)) {
        json(res, 404, { error: '未知小宇宙操作。' }); return;
      }
      if (req.method !== 'POST' || !origin || req.headers['x-sully-podcast'] !== '1') {
        json(res, 403, { error: '需要从小宇宙 App 发起操作。' }); return;
      }
      if (action === 'transcript') {
        const file = await localExport(exportDir, eid, 'transcript');
        if (file && (await stat(file)).size <= 5_000_000) {
          try {
            const segments = JSON.parse(await readFile(file, 'utf8'));
            if (Array.isArray(segments) && segments.length) { json(res, 200, { segments, source: 'local' }); return; }
          } catch { /* Invalid export can be refreshed from the online source. */ }
        }
        json(res, 200, { segments: await call(action, eid), source: 'online' });
        return;
      }
      const data = await call(action, eid);
      const result = action === 'episode'
        ? { ...(data as object), localAudio: !!(await audioFile(eid)) }
        : data;
      json(res, 200, result);
    } catch (error) {
      if (!res.headersSent) json(res, 502, { error: error instanceof Error && !('code' in error) ? error.message : '本机小宇宙请求失败。' });
      else res.destroy();
    }
  }
  return { handler, close };
}
