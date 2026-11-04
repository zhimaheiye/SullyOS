/** 公开版. An immutable local outbox; no vault scans or existing-note updates. */
import { DB, openDB } from './db';
import { loadMcpServers, getEnabledMcpServers, callPrivateMcpTool, type McpServerConfig } from './mcpClient';
import { loadObsidianDiary, diaryDirectory, OBSIDIAN_DIARY_CHANGED, OBSIDIAN_DIARY_EPOCH, type DiaryToolBinding, type ObsidianDiaryConfig } from './obsidianDiaryConfig';
import { resolveObsidianDiaryAdapter, reconcileObsidianDiaryFile, diaryConnectionError, diaryProblem as problem } from './obsidianDiaryAdapter';
const PREFIX = 'obsidian-diary:', CHANGED = 'obsidian-diary-records-changed';
export type DiaryState = 'queued' | 'writing' | 'written' | 'blocked' | 'failed' | 'uncertain' | 'conflict' | 'cancelled';
export interface ObsidianDiaryRecord {
    kind: 'obsidian-diary';
    id: string;
    charId: string;
    charName: string;
    title: string;
    content: string;
    mood: string;
    date: string;
    createdAt: number;
    updatedAt: number;
    status: DiaryState;
    message?: string;
    path: string;
    markdown: string;
    target: ObsidianDiaryConfig;
    serverIdentity: string;
    writeAttempted: boolean;
    operation?: string;
    leaseUntil?: number;
    verifiedAt?: number;
    incomplete?: boolean;
}
export interface ObsidianDiaryTargetSnapshot {
    config: ObsidianDiaryConfig;
    serverIdentity: string;
    runtimeEpoch: string;
}
const active = new Map<string, {
    controller: AbortController;
    promise: Promise<void>;
}>();
const emit = () => { if (typeof window !== 'undefined')
    window.dispatchEvent(new Event(CHANGED)); };
export function subscribeObsidianDiaries(listener: () => void) { window.addEventListener(CHANGED, listener); return () => window.removeEventListener(CHANGED, listener); }
export const diaryStateLabel: Record<DiaryState, string> = { queued: '待写入', writing: '写入中，结果尚未确认', written: '已保存到 Obsidian', blocked: '尚未保存', failed: '写入失败', uncertain: '保存结果待核对', conflict: '文件已有不同内容', cancelled: '已停止，草稿保留' };
const hash = async (text: string) => { if (!crypto.subtle)
    throw Error('日记需在 localhost 或 HTTPS 中保存'); return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map(x => x.toString(16).padStart(2, '0')).join(''); };
const filePart = (value: string, max: number) => Array.from(String(value).normalize('NFKC').replace(/[\u0000-\u001f\\/:%*?"<>|]/g, '-').replace(/^[. ]+|[. ]+$/g, '')).slice(0, max).join('') || '日记';
// Tool fields in old backups are no longer execution authority. Keep the original destination.
const bindingKey = (c: ObsidianDiaryConfig) => JSON.stringify([c.serverId, c.directory]);
const serverKey = (s: McpServerConfig) => hash(JSON.stringify([s.id, s.transport, s.url, s.command, s.args, s.env, s.token, s.customHeaders, s.proxyUrl, s.proxyKey]));
export function validateDiaryTools(server: McpServerConfig, _c?: ObsidianDiaryConfig) { return resolveObsidianDiaryAdapter(server); }
export async function prepareObsidianDiaryTarget(charId: string): Promise<ObsidianDiaryTargetSnapshot> {
    const config = structuredClone(loadObsidianDiary());
    if (!config.enabled || !config.autonomous)
        throw problem('请先到设置 → 实时感知 → 配置 → Obsidian 日记，启用独立日记与自主新建');
    if (!Array.isArray(config.charIds) || !config.charIds.includes(charId))
        throw problem('当前角色未加入 Obsidian 日记适用角色；请到设置 → 实时感知 → 配置 → Obsidian 日记调整');
    diaryDirectory(config.directory);
    const server = getEnabledMcpServers(charId).find(item => item.id === config.serverId);
    if (!server)
        throw problem('当前角色没有可用的日记 MCP 服务；请核对服务启用状态与角色范围');
    validateDiaryTools(server, config);
    if (!await DB.getCharacter(charId)) throw problem('当前角色已不存在，请重新选择聊天对象');
    return { config, serverIdentity: await serverKey(server), runtimeEpoch: await epoch() };
}
export async function obsidianDiaryTargetIssue(snapshot: ObsidianDiaryTargetSnapshot, charId: string): Promise<string | null> {
    try {
        if (await epoch() !== snapshot.runtimeEpoch)
            return '日记存档已恢复或切换；原稿已保留，未继续写入';
        const currentConfig = loadObsidianDiary();
        const server = getEnabledMcpServers(charId).find(item => item.id === snapshot.config.serverId);
        if (!currentConfig.enabled || !currentConfig.autonomous || !currentConfig.charIds.includes(charId) || !server)
            return '目标或 MCP 已停用，或当前角色不再授权；原稿已保留';
        diaryDirectory(currentConfig.directory);
        validateDiaryTools(server, currentConfig);
        if (bindingKey(currentConfig) !== bindingKey(snapshot.config) || await serverKey(server) !== snapshot.serverIdentity)
            return '保存目标或连接已改变；原稿已保留，请核对后处理';
        if (!await DB.getCharacter(charId)) return '来源角色已不存在；原稿已保留';
        return null;
    } catch (error) {
        return (error as Error)?.message || '日记保存目标当前不可用；原稿已保留';
    }
}
export function diaryPrompt(charId: string) { try {
    const c = loadObsidianDiary(), s = getEnabledMcpServers(charId).find(s => s.id === c.serverId);
    if (!c.enabled || !c.autonomous || !Array.isArray(c.charIds) || !c.charIds.includes(charId) || !s)
        return '';
    diaryDirectory(c.directory);
    validateDiaryTools(s, c);
    return '\n你有一个独立的 Obsidian 私人日记保存目标。可按自己的意愿写日记，不要求用户先写，也不每轮必写。沿已有身份、记忆与故事时点，只写自己的叙述，不编造用户现实经历。用 [[OBS_DIARY_START: 标题 | 心情]]\nMarkdown正文\n[[OBS_DIARY_END]] 提交写入意图；正文可保留 Markdown 和换行。应用在本机保存与核对；在收到真实回执前不能声称文件已经写入。服务本机暂不可达时正文保留待写。不要调用通用工具扫描笔记库。\n';
}
catch {
    return '';
} }
async function epoch() { const db = await openDB(); return new Promise<string>((resolve, reject) => { const tx = db.transaction('assets', 'readwrite'), s = tx.objectStore('assets'), r = s.get(OBSIDIAN_DIARY_EPOCH); let value = ''; r.onsuccess = () => { value = r.result?.data || crypto.randomUUID(); if (!r.result)
    s.put({ id: OBSIDIAN_DIARY_EPOCH, data: value }); }; tx.oncomplete = () => resolve(value); tx.onabort = tx.onerror = () => reject(tx.error || problem('日记存档不可用')); }); }
function parse(value: any): ObsidianDiaryRecord | null { try {
    const row = JSON.parse(value?.data);
    return row?.kind === 'obsidian-diary' && typeof row.id === 'string' && typeof row.content === 'string' && typeof row.charId === 'string' ? row : null;
}
catch {
    return null;
} }
async function change(id: string, fn: (old: ObsidianDiaryRecord | null) => ObsidianDiaryRecord, gate?: {
    epoch: string;
    operation?: string;
    signal?: AbortSignal;
}) { const db = await openDB(); return new Promise<ObsidianDiaryRecord>((resolve, reject) => { const tx = db.transaction('assets', 'readwrite'), s = tx.objectStore('assets'); let result: ObsidianDiaryRecord; tx.oncomplete = () => { emit(); resolve(result); }; tx.onabort = tx.onerror = () => reject(tx.error || problem('日记状态已变化，请重新查看')); const proceed = () => { const r = s.get(id); r.onsuccess = () => { try {
    const old = parse(r.result);
    if (gate?.signal?.aborted || gate?.operation && old?.operation !== gate.operation) {
        tx.abort();
        return;
    }
    result = fn(old);
    s.put({ id, data: JSON.stringify(result) });
}
catch {
    tx.abort();
} }; }; if (gate) {
    const g = s.get(OBSIDIAN_DIARY_EPOCH);
    g.onsuccess = () => { if (g.result?.data !== gate.epoch) {
        tx.abort();
        return;
    } proceed(); };
}
else
    proceed(); }); }
export async function listObsidianDiaries() { const db = await openDB(); return new Promise<ObsidianDiaryRecord[]>((resolve, reject) => { const r = db.transaction('assets', 'readonly').objectStore('assets').openCursor(IDBKeyRange.bound(PREFIX, PREFIX + '\uffff')), rows: ObsidianDiaryRecord[] = []; r.onsuccess = () => { const cursor = r.result; if (!cursor) {
    resolve(rows.sort((a, b) => b.createdAt - a.createdAt));
    return;
} const row = parse(cursor.value); if (row)
    rows.push(row); cursor.continue(); }; r.onerror = () => reject(r.error); }); }
export async function enqueueObsidianDiary(input: {
    charId: string;
    charName: string;
    title: string;
    content: string;
    mood?: string;
    sourceId: string;
    index?: number;
    createdAt?: number;
    incomplete?: boolean;
}, signal?: AbortSignal, options?: {
    target?: ObsidianDiaryTargetSnapshot;
    initialBlockedMessage?: string;
}) {
    signal?.throwIfAborted();
    const e = await epoch();
    if (!input.content.trim() || input.content.length > 200000)
        throw problem('日记正文为空或过长');
    const c = options?.target ? structuredClone(options.target.config) : structuredClone(loadObsidianDiary()), server = loadMcpServers().find(s => s.id === c.serverId), identity = options?.target?.serverIdentity || (server ? await serverKey(server) : ''), digest = await hash(JSON.stringify([input.charId, input.sourceId, input.index || 0])), id = PREFIX + digest, createdAt = input.createdAt || Date.now(), date = new Date(createdAt).toLocaleDateString('sv-SE'), charKey = (await hash(input.charId)).slice(0, 10), title = input.title.trim() || '日记';
    let directory = '';
    try {
        directory = diaryDirectory(c.directory);
    }
    catch { }
    const path = directory ? `${directory}/${filePart(input.charName, 16)}-${charKey}__${date}__${filePart(title, 24)}__${digest.slice(0, 32)}.md` : '';
    const markdown = `---\nsullyos_diary_id: ${JSON.stringify(id)}\ncharacter_id: ${JSON.stringify(input.charId)}\ncharacter: ${JSON.stringify(input.charName)}\nrecorded_date: ${JSON.stringify(date)}\n${input.mood ? `mood: ${JSON.stringify(input.mood)}\n` : ''}---\n\n# ${title.replace(/[\r\n]/g, ' ')}\n\n${input.content}\n`;
    const blockedMessage = input.incomplete ? '生成被截断，已保留收到的正文，不自动写入' : options?.initialBlockedMessage;
    return change(id, old => old || { kind: 'obsidian-diary', id, charId: input.charId, charName: input.charName, title, content: input.content, mood: input.mood || '', date, createdAt, updatedAt: Date.now(), status: blockedMessage ? 'blocked' : 'queued', message: blockedMessage, incomplete: input.incomplete, path, markdown, target: c, serverIdentity: identity, writeAttempted: false }, { epoch: e, signal });
}
async function current(row: ObsidianDiaryRecord) { if(row.incomplete)throw problem("生成被截断，正文保留，不自动写入"); const c = loadObsidianDiary(), server = getEnabledMcpServers(row.charId).find(s => s.id === row.target.serverId); if (!c.enabled || !c.autonomous || !Array.isArray(c.charIds) || !c.charIds.includes(row.charId) || !server)
    throw problem('目标或 MCP 未启用，或此角色未获授权；正文已保留'); if (bindingKey(c) !== bindingKey(row.target) || (diaryDirectory(row.path, 512) !== row.path || !row.path.startsWith(diaryDirectory(c.directory) + '/')) || await serverKey(server) !== row.serverIdentity)
    throw problem('保存目标或连接已改变；保留原草稿，请核对后处理'); if (!await DB.getCharacter(row.charId))
    throw problem('来源角色已不存在；草稿保留'); validateDiaryTools(server, c); return server; }
export function cancelObsidianDiary(id: string) { active.get(id)?.controller.abort(); }
export async function saveObsidianDiary(id: string, signal?: AbortSignal, guard?: () => Promise<void>) {
    if (active.has(id))
        return active.get(id)!.promise;
    const controller = new AbortController(), abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted)
        abort();
    const work = async () => {
        const e = await epoch(), operation = crypto.randomUUID();
        let row: ObsidianDiaryRecord | undefined;
        try {
            row = await change(id, old => { if (!old)
                throw Error(); if (old.status === 'written')
                return old; if (old.status === 'writing' && (old.leaseUntil || 0) > Date.now())
                throw Error(); return { ...old, status: 'writing', operation, leaseUntil: Date.now() + 120000, updatedAt: Date.now(), message: undefined }; }, { epoch: e, signal: controller.signal });
            if (row.status === 'written')
                return;
            const update = (patch: Partial<ObsidianDiaryRecord>, checkSignal = true) => change(id, old => ({ ...old!, ...patch, updatedAt: Date.now() }), { epoch: e, operation, ...(checkSignal ? { signal: controller.signal } : {}) });
            const check = async () => { controller.signal.throwIfAborted(); await guard?.(); await update({}); return current(row!); };
            const call = async (binding: DiaryToolBinding, body?: string) => {
                const server = await check();
                try { return await callPrivateMcpTool(server, binding.name, { ...binding.fixed, [binding.pathKey]: row!.path, ...(binding.contentKey && body !== undefined ? { [binding.contentKey]: body } : {}) }, controller.signal); }
                catch (error) { throw problem(diaryConnectionError(error)); }
            };
            const adapter = resolveObsidianDiaryAdapter(await check());
            const outcome = await reconcileObsidianDiaryFile({
                path: row.path, markdown: row.markdown, writeAttempted: row.writeAttempted,
                read: () => call(adapter.read),
                reserveWrite: async () => { row = await change(id, old => {
                    if (old!.writeAttempted) throw problem('该条目已发起写入，请只核对原文件');
                    return { ...old!, writeAttempted: true, updatedAt: Date.now() };
                }, { epoch: e, operation, signal: controller.signal }); },
                write: () => call(adapter.write, row!.markdown),
            });
            await update({ ...outcome, ...(outcome.status === 'written' ? { verifiedAt: Date.now() } : {}), operation: undefined, leaseUntil: undefined });
        }
        catch (error) {
            if (row?.operation === operation)
                await change(id, old => ({ ...old!, status: controller.signal.aborted ? 'cancelled' : old!.writeAttempted ? 'uncertain' : (error as any)?.diarySafe ? 'blocked' : 'failed', message: controller.signal.aborted ? (old!.writeAttempted ? '已停止；远端可能已处理，请再次核对同一文件' : '已停止，正文保留，尚未发起新建') : (error as any)?.diarySafe ? (error as Error).message : '本机日记处理失败，正文保留', operation: undefined, leaseUntil: undefined, updatedAt: Date.now() }), { epoch: e, operation }).catch(() => { });
        }
    };
    const promise = (async () => { const locks = typeof navigator !== 'undefined' ? (navigator as any).locks : undefined; if (locks)
        await locks.request('sully-obsidian-diary:' + id, { ifAvailable: true }, async (lock: any) => { if (lock)
            await work(); });
    else
        await work(); })().finally(() => { active.delete(id); signal?.removeEventListener('abort', abort); emit(); });
    active.set(id, { controller, promise });
    return promise;
}
export async function drainObsidianDiaries() { if (typeof document !== 'undefined' && document.visibilityState !== 'visible')
    return; for (const row of await listObsidianDiaries())
    if (row.status === 'queued')
        await saveObsidianDiary(row.id); }
if (typeof window !== 'undefined') {
    const stop = () => active.forEach(value => value.controller.abort());
    window.addEventListener(OBSIDIAN_DIARY_CHANGED, stop);
    window.addEventListener('mcp-servers-changed', stop);
    window.addEventListener('personal-memory-reset', stop);
}
