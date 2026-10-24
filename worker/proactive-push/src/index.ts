/**
 * Proactive Push Accelerator — Cloudflare Worker (v2: 24/7 server-side AI)
 *
 * v2 变更：
 *   1. 移除心跳机制 —— 不再要求浏览器在线。
 *   2. Cron 自己调 LLM 生成消息，直接塞进 Web Push 通知正文。
 *   3. 新增 character_configs 表，保存角色 systemPrompt。
 *
 * 流程：
 *   Cron（每分钟）→ 扫描到期 schedule → 读角色人设 → 调 LLM → 发推送
 *   电脑关机也能正常发，推送队列在 FCM/autopush 里等浏览器上线。
 */

import { prepareVapid, sendPush, type VapidContext } from './webpush';

interface Env {
  DB: D1Database;
  VAPID_PUBLIC_KEY: string;
  VAPID_PRIVATE_KEY: string;
  VAPID_SUBJECT: string;
  CLIENT_TOKEN: string;
  LLM_API_URL: string;
  LLM_API_KEY: string;
  LLM_MODEL: string;
}

// 最小 Worker 运行时类型（跟 post-office 一样，只声明本文件真正用到的
// 那几个成员，不引 @cloudflare/workers-types）。
interface D1Database {
  prepare(query: string): D1PreparedStatement;
}
interface D1PreparedStatement {
  bind(...values: unknown[]): D1PreparedStatement;
  run(): Promise<unknown>;
  first<T = unknown>(): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
}
/** cron 触发时 CF 传进来的事件；本 Worker 不读它的字段，只按签名占位。 */
interface ScheduledEvent {
  scheduledTime: number;
  cron: string;
}
interface ExecutionContext {
  waitUntil(promise: Promise<unknown>): void;
}

interface ScheduleRow {
  endpoint: string;
  char_id: string;
  p256dh: string;
  auth: string;
  interval_ms: number;
  next_fire_at: number;
  created_at: number;
}

interface CharConfigRow {
  char_id: string;
  system_prompt: string;
  updated_at: number;
}

// ── helpers ──
function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type, X-Client-Token',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    },
  });
}

function checkToken(req: Request, env: Env): Response | null {
  if (!env.CLIENT_TOKEN) return null;
  const got = req.headers.get('X-Client-Token');
  if (got !== env.CLIENT_TOKEN) return json({ error: 'unauthorized' }, 401);
  return null;
}

async function readJson<T = unknown>(req: Request): Promise<T | null> {
  try { return await req.json() as T; } catch { return null; }
}

let cachedVapid: VapidContext | null = null;
async function getVapid(env: Env): Promise<VapidContext> {
  if (cachedVapid) return cachedVapid;
  cachedVapid = await prepareVapid(env.VAPID_PUBLIC_KEY, env.VAPID_PRIVATE_KEY, env.VAPID_SUBJECT);
  return cachedVapid;
}

// ── LLM call ──
async function callLLM(env: Env, systemPrompt: string): Promise<string | null> {
  const apiUrl = env.LLM_API_URL;
  const apiKey = env.LLM_API_KEY;
  const model = env.LLM_MODEL || 'deepseek-ai/DeepSeek-V3';

  if (!apiUrl) { console.error('[llm] LLM_API_URL not configured'); return null; }
  if (!apiKey) { console.error('[llm] LLM_API_KEY not configured'); return null; }

  const userPrompt = `现在请你主动给用户发一条消息。
要求：
- 完全贴合你的人设和性格
- 像你突然想到用户、想跟他们说句话一样自然
- 不要用"嘿"、"嗨"、"我来找你聊天了"这类机械开场
- 不要复读你的人设描述
- 一句话到三句话，简洁自然
- 直接输出消息内容，不要加任何前缀、引号或说明`;

  try {
    const resp = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: 200,
        temperature: 0.9,
      }),
    });

    if (!resp.ok) {
      const body = await resp.text();
      console.error(`[llm] API error ${resp.status}: ${body.slice(0, 300)}`);
      return null;
    }

    const data = await resp.json() as { choices?: { message?: { content?: string } }[] };
    return data.choices?.[0]?.message?.content?.trim() || null;
  } catch (e) {
    console.error('[llm] fetch error:', (e as Error)?.message);
    return null;
  }
}

// ── HTTP ──
async function handleSubscribe(req: Request, env: Env): Promise<Response> {
  const body = await readJson<{
    subscription?: { endpoint?: string; keys?: { p256dh?: string; auth?: string } };
    charId?: string;
    intervalMs?: number;
    systemPrompt?: string;
  }>(req);
  if (!body) return json({ error: 'invalid json' }, 400);

  const endpoint = body.subscription?.endpoint;
  const p256dh = body.subscription?.keys?.p256dh;
  const auth = body.subscription?.keys?.auth;
  const charId = body.charId;
  const intervalMs = body.intervalMs;
  const systemPrompt = body.systemPrompt;

  if (!endpoint || !p256dh || !auth || !charId || !intervalMs || intervalMs < 60_000) {
    return json({ error: 'missing or invalid fields' }, 400);
  }

  const now = Date.now();
  const nextFireAt = now + intervalMs;

  await env.DB.prepare(`
    INSERT INTO schedules (endpoint, char_id, p256dh, auth, interval_ms, next_fire_at, created_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
    ON CONFLICT(endpoint, char_id) DO UPDATE SET
      p256dh = excluded.p256dh,
      auth = excluded.auth,
      interval_ms = excluded.interval_ms,
      next_fire_at = excluded.next_fire_at
  `).bind(endpoint, charId, p256dh, auth, intervalMs, nextFireAt, now).run();

  // 保存 / 更新角色人设
  if (systemPrompt) {
    await env.DB.prepare(`
      INSERT INTO character_configs (char_id, system_prompt, updated_at)
      VALUES (?1, ?2, ?3)
      ON CONFLICT(char_id) DO UPDATE SET
        system_prompt = excluded.system_prompt,
        updated_at = excluded.updated_at
    `).bind(charId, systemPrompt, now).run();
  }

  return json({ ok: true, nextFireAt });
}

async function handleUnsubscribe(req: Request, env: Env): Promise<Response> {
  const body = await readJson<{ endpoint?: string; charId?: string }>(req);
  if (!body?.endpoint) return json({ error: 'endpoint required' }, 400);

  if (body.charId) {
    await env.DB.prepare(`DELETE FROM schedules WHERE endpoint = ?1 AND char_id = ?2`)
      .bind(body.endpoint, body.charId).run();
  } else {
    await env.DB.prepare(`DELETE FROM schedules WHERE endpoint = ?1`).bind(body.endpoint).run();
  }
  return json({ ok: true });
}

async function handleStatus(req: Request, env: Env): Promise<Response> {
  const endpoint = new URL(req.url).searchParams.get('endpoint');
  if (!endpoint) return json({ error: 'endpoint required' }, 400);
  const res = await env.DB.prepare(
    `SELECT char_id, interval_ms, next_fire_at FROM schedules WHERE endpoint = ?1`
  ).bind(endpoint).all<ScheduleRow>();
  return json({ ok: true, schedules: res.results });
}

async function handleTest(req: Request, env: Env): Promise<Response> {
  const body = await readJson<{ endpoint?: string }>(req);
  if (!body?.endpoint) return json({ error: 'endpoint required' }, 400);

  const row = await env.DB.prepare(
    `SELECT endpoint, p256dh, auth FROM schedules WHERE endpoint = ?1 LIMIT 1`
  ).bind(body.endpoint).first<{ endpoint: string; p256dh: string; auth: string }>();
  if (!row) return json({ error: 'subscription not found' }, 404);

  const vapid = await getVapid(env);
  const payload = JSON.stringify({ type: 'proactive-test', t: Date.now() });
  try {
    const result = await sendPush(vapid, row, payload);
    if (result.gone) {
      await env.DB.prepare(`DELETE FROM schedules WHERE endpoint = ?1`).bind(row.endpoint).run();
      return json({ ok: false, status: result.status, reason: 'subscription expired' }, 410);
    }
    return json({ ok: result.ok, status: result.status });
  } catch (e) {
    return json({ ok: false, error: String((e as Error)?.message || e) }, 500);
  }
}

// ── cron ──
async function runScheduledSweep(env: Env): Promise<{ fired: number; dropped: number }> {
  const now = Date.now();

  // v2: 不再检查 heartbeat —— 所有到期 schedule 一律触发
  const due = await env.DB.prepare(`
    SELECT endpoint, char_id, p256dh, auth, interval_ms, next_fire_at, created_at
    FROM schedules
    WHERE next_fire_at <= ?1
    ORDER BY next_fire_at ASC
    LIMIT 500
  `).bind(now).all<ScheduleRow>();

  if (!due.results || due.results.length === 0) {
    return { fired: 0, dropped: 0 };
  }

  const vapid = await getVapid(env);
  let fired = 0;
  let dropped = 0;

  for (const row of due.results) {
    // 读角色人设
    const charConfig = await env.DB.prepare(
      `SELECT system_prompt FROM character_configs WHERE char_id = ?1`
    ).bind(row.char_id).first<CharConfigRow>();

    let content: string | null = null;
    if (charConfig?.system_prompt && env.LLM_API_KEY) {
      content = await callLLM(env, charConfig.system_prompt);
    }

    // 如果 LLM 没配或调用失败，fallback 到旧格式（浏览器端 AI）
    const payload = content
      ? JSON.stringify({ type: 'proactive-message', charId: row.char_id, content, t: now })
      : JSON.stringify({ type: 'proactive-wake', charId: row.char_id, t: now });

    try {
      const result = await sendPush(
        vapid,
        { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth },
        payload,
      );

      if (result.gone) {
        await env.DB.prepare(`DELETE FROM schedules WHERE endpoint = ?1`).bind(row.endpoint).run();
        dropped++;
        continue;
      }
      if (!result.ok) {
        console.warn(`[cron] push failed status=${result.status} char=${row.char_id}`);
      }

      // 推进下次触发时间
      let next = row.next_fire_at + row.interval_ms;
      if (next <= now) next = now + row.interval_ms;
      await env.DB.prepare(`UPDATE schedules SET next_fire_at = ?1 WHERE endpoint = ?2 AND char_id = ?3`)
        .bind(next, row.endpoint, row.char_id).run();
      fired++;
    } catch (e) {
      console.error('[cron] push error', e, row.char_id);
    }
  }

  return { fired, dropped };
}

// ── main ──
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method === 'OPTIONS') {
      return new Response(null, {
        headers: {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Headers': 'Content-Type, X-Client-Token',
          'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
          'Access-Control-Max-Age': '86400',
        },
      });
    }

    const url = new URL(req.url);

    if (url.pathname === '/vapid-public-key' && req.method === 'GET') {
      return json({ publicKey: env.VAPID_PUBLIC_KEY || '' });
    }

    if (url.pathname === '/health' && req.method === 'GET') {
      return json({ ok: true });
    }

    const tokenErr = checkToken(req, env);
    if (tokenErr) return tokenErr;

    if (url.pathname === '/subscribe' && req.method === 'POST') return handleSubscribe(req, env);
    if (url.pathname === '/unsubscribe' && req.method === 'POST') return handleUnsubscribe(req, env);
    if (url.pathname === '/status' && req.method === 'GET') return handleStatus(req, env);
    if (url.pathname === '/test' && req.method === 'POST') return handleTest(req, env);

    return json({ error: 'not found' }, 404);
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil((async () => {
      const result = await runScheduledSweep(env);
      if (result.fired || result.dropped) {
        console.log(`[cron] fired=${result.fired} dropped=${result.dropped}`);
      }
    })());
  },
};
