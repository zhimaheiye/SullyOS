import React, { useEffect, useRef, useState } from 'react';
import { BookBookmark, CheckCircle, CircleNotch, WarningCircle } from '@phosphor-icons/react';
import type { CharacterProfile } from '../../types';
import { loadMcpServers, testMcpConnection, saveMcpServers, type McpServerConfig } from '../../utils/mcpClient';
import { loadObsidianDiary, saveObsidianDiary as saveTarget, diaryDirectory, type ObsidianDiaryConfig } from '../../utils/obsidianDiaryConfig';
import { listObsidianDiaries, subscribeObsidianDiaries, saveObsidianDiary, cancelObsidianDiary, diaryStateLabel, type ObsidianDiaryRecord } from '../../utils/obsidianDiary';
import { resolveObsidianDiaryAdapter, diaryConnectionError } from '../../utils/obsidianDiaryAdapter';

const field = 'mt-1.5 w-full min-w-0 rounded-xl border border-violet-200 bg-white/80 px-3 py-2 text-sm outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100';
const action = 'min-h-11 rounded-xl border border-violet-100 bg-violet-50 px-3 py-2 text-xs font-medium text-violet-700 transition-colors active:bg-violet-100 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-violet-400';
// Compare connection identity privately; never render credentials or retain another copy.
const connectionKey = (server?: McpServerConfig) => {
    if (!server) return '';
    const { tools: _tools, lastConnection: _connection, ...identity } = server;
    return JSON.stringify(identity);
};
function initialTarget() {
    const config = loadObsidianDiary();
    if (!config.serverId) {
        const candidates = loadMcpServers().filter(server => {
            try { resolveObsidianDiaryAdapter(server); return true; } catch { return false; }
        });
        if (candidates.length === 1) config.serverId = candidates[0].id;
    }
    return config;
}

export function ObsidianDiarySettings({ characters, onManageMcp }: {
    characters: CharacterProfile[];
    onManageMcp: () => void;
}) {
    const [draft, setDraft] = useState(initialTarget);
    const [servers, setServers] = useState(loadMcpServers);
    const [rows, setRows] = useState<ObsidianDiaryRecord[]>([]);
    const [notice, setNotice] = useState('');
    const [checking, setChecking] = useState(false);
    const [connection, setConnection] = useState({ ok: false, message: '等待检查连接' });
    const alive = useRef(true), checkId = useRef(0);
    const server = servers.find(s => s.id === draft.serverId);
    const identity = connectionKey(server);
    const patch = (value: Partial<ObsidianDiaryConfig>) => setDraft(old => ({ ...old, ...value }));
    const reload = () => void listObsidianDiaries().then(value => {
        if (alive.current) setRows(value);
    }).catch(() => { if (alive.current) setNotice('本机日记记录读取失败'); });

    useEffect(() => {
        alive.current = true;
        reload();
        const off = subscribeObsidianDiaries(reload);
        const changed = () => setServers(loadMcpServers());
        window.addEventListener('mcp-servers-changed', changed);
        return () => { alive.current = false; checkId.current++; off(); window.removeEventListener('mcp-servers-changed', changed); };
    }, []);

    async function check() {
        const id = ++checkId.current;
        if (!server?.enabled) {
            setChecking(false);
            setConnection({ ok: false, message: server ? '此 MCP 未启用，请在已有 MCP 管理中开启' : '请选择已有 Obsidian 连接' });
            return;
        }
        setChecking(true);
        setConnection({ ok: false, message: '正在检查连接与工具能力…' });
        try {
            const result = await testMcpConnection(server);
            if (!alive.current || id !== checkId.current) return;
            const latest = loadMcpServers();
            if (connectionKey(latest.find(s => s.id === server.id)) !== identity) return;
            if (!result.ok) {
                setConnection({ ok: false, message: diaryConnectionError(result.message) });
                return;
            }
            const updated = { ...server, tools: result.tools, lastConnection: result.connection };
            const refreshed = latest.map(s => s.id === server.id ? { ...s, tools: result.tools, lastConnection: result.connection } : s);
            // Unchanged capability discovery must not dispatch a config-change abort to an in-flight diary.
            if (JSON.stringify(latest.find(s => s.id === server.id)?.tools) !== JSON.stringify(result.tools)) saveMcpServers(refreshed);
            else setServers(refreshed);
            try {
                resolveObsidianDiaryAdapter(updated);
                setConnection({ ok: true, message: '连接正常 · 日记工具已自动适配' });
            } catch (error) {
                setConnection({ ok: false, message: (error as Error).message });
            }
        } catch (error) {
            if (alive.current && id === checkId.current) setConnection({ ok: false, message: diaryConnectionError(error) });
        } finally {
            if (alive.current && id === checkId.current) setChecking(false);
        }
    }
    // Read-only tools/list; opening settings never probes notes or enables a connection.
    useEffect(() => { void check(); return () => { checkId.current++; }; }, [identity]);

    function save() {
        try {
            const value = { ...draft, autonomous: draft.enabled, directory: draft.directory.trim() };
            if (value.enabled) {
                if (!server?.enabled) throw Error('请选择已启用的 Obsidian 连接');
                if (!connection.ok || checking) throw Error('请先完成连接检查，恢复后可重新检查');
                value.directory = diaryDirectory(value.directory);
                Object.assign(value, resolveObsidianDiaryAdapter(server));
                if (!value.charIds.length) throw Error('请在角色范围中选择可以写日记的角色');
                if (value.charIds.some(id => !characters.some(c => c.id === id) || server.charIds?.length && !server.charIds.includes(id)))
                    throw Error('所选角色已不存在或未获此 MCP 授权，请调整角色范围');
            }
            saveTarget(value);
            setDraft(value);
            setNotice(value.enabled ? '日记目标已保存，所选角色可自主写日记' : '日记目标已关闭，原稿与记录保留');
        } catch (error) { setNotice(error instanceof Error ? error.message : '日记目标保存失败'); }
    }

    const pending = rows.filter(row => row.status !== 'written').length;
    return <section aria-label="Obsidian 日记" className="min-w-0 space-y-3 rounded-2xl bg-violet-50/50 p-4">
        <div className="flex items-center justify-between gap-3">
            <h3 className="flex items-center gap-2 text-sm font-bold text-violet-700"><BookBookmark size={20} weight="fill" />Obsidian 日记</h3>
            <label className="relative inline-flex min-h-11 shrink-0 cursor-pointer items-center">
                <input type="checkbox" className="peer sr-only" aria-label="启用 Obsidian 日记" checked={draft.enabled} onChange={e => {
                    patch({ enabled: e.target.checked });
                    if (!e.target.checked) {
                        try { saveTarget({ ...loadObsidianDiary(), enabled: false }); setNotice('日记目标已关闭，原稿保留'); }
                        catch { setNotice('关闭失败，请检查本机存储'); }
                    }
                }} />
                <span className="relative h-6 w-11 rounded-full bg-slate-200 transition-colors after:absolute after:left-1 after:top-1 after:h-4 after:w-4 after:rounded-full after:bg-white after:shadow-sm after:transition-transform peer-checked:bg-violet-500 peer-checked:after:translate-x-5 peer-focus-visible:ring-2 peer-focus-visible:ring-violet-400" />
            </label>
        </div>
        <label className="block text-xs font-medium text-slate-600">已有 Obsidian 连接
            <select aria-label="Obsidian已有服务" className={field} value={draft.serverId} onChange={e => { setNotice(''); patch({ serverId: e.target.value }); }}>
                <option value="">选择已有连接</option>
                {servers.map(s => <option key={s.id} value={s.id}>{s.name}{s.enabled ? '' : '（未启用）'}</option>)}
            </select>
        </label>
        <label className="block text-xs font-medium text-slate-600">日记保存目录
            <input aria-label="Obsidian日记子目录" className={field} value={draft.directory} onChange={e => patch({ directory: e.target.value })} placeholder="例如 SullyOS/角色日记" />
        </label>
        <div className="rounded-xl bg-white/70 px-3 py-2.5">
            <div role="status" className={`flex items-start gap-2 text-xs leading-relaxed ${connection.ok ? 'text-violet-700' : 'text-slate-600'}`}>
                {checking ? <CircleNotch size={16} className="mt-0.5 shrink-0 animate-spin" /> : connection.ok ? <CheckCircle size={16} weight="fill" className="mt-0.5 shrink-0" /> : <WarningCircle size={16} className="mt-0.5 shrink-0" />}
                <span>{connection.message}</span>
            </div>
            <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" disabled={checking || !server} onClick={() => void check()} className={action}>{checking ? '检查中…' : '重新检查'}</button>
                <button type="button" onClick={onManageMcp} className={action}>管理 MCP</button>
            </div>
            {connection.ok && <details className="mt-2 text-[11px] leading-relaxed text-slate-500">
                <summary className="cursor-pointer">适配详情</summary>
                <p className="mt-1 break-all">读取：get_vault_file · 新建：append_to_vault_file</p>
                <p className="mt-1">只检查连接，不读取笔记。写日记时先检查目标文件，已有内容不追加；每条最多发送一次，完整读回才标记成功。服务没有原子只新建接口，无法阻止其它客户端在检查与写入之间创建同名文件。</p>
            </details>}
        </div>
        <details className="rounded-xl bg-white/60 px-3 py-2.5">
            <summary className="cursor-pointer text-xs font-medium text-slate-600">角色范围 · 已选 {draft.charIds.length} 位</summary>
            <p className="mt-2 text-[11px] leading-relaxed text-slate-500">启用后，所选角色可在既有聊天中自主写日记，仅保存到此目录。</p>
            <div className="mt-2 grid grid-cols-2 gap-2">{characters.map(char => {
                const allowed = !server?.charIds?.length || server.charIds.includes(char.id);
                const selected = draft.charIds.includes(char.id);
                return <label key={char.id} className={`flex min-h-11 min-w-0 items-center gap-2 rounded-xl border px-2.5 py-2 text-xs ${selected ? 'border-violet-200 bg-violet-100/70 text-violet-800' : 'border-slate-100 bg-white text-slate-600'} ${!allowed && !selected ? 'opacity-50' : ''}`}>
                    <input type="checkbox" className="h-4 w-4 shrink-0 accent-violet-500" checked={selected} disabled={!allowed && !selected} onChange={e => patch({ charIds: e.target.checked ? [...draft.charIds, char.id] : draft.charIds.filter(id => id !== char.id) })} />
                    <span className="min-w-0 break-words">{char.name}{!allowed && <span className="block text-[10px]">MCP 未授权</span>}</span>
                </label>;
            })}</div>
        </details>
        <button type="button" onClick={save} className="min-h-11 w-full rounded-xl bg-violet-100 py-2.5 text-xs font-bold text-violet-700 transition-colors hover:bg-violet-200">保存日记目标</button>
        {notice && <p role="status" className="break-words text-xs leading-relaxed text-violet-800">{notice}</p>}
        <details className="border-t border-violet-100 pt-3">
            <summary className="cursor-pointer text-xs font-medium text-slate-600">日记记录 · {pending ? `${pending} 篇待处理` : `${rows.length} 篇`}</summary>
            <div className="mt-3 space-y-3">
                <button type="button" onClick={reload} className={action}>刷新记录</button>
                {!rows.length && <p className="text-xs text-slate-400">暂无生成的独立日记</p>}
                {rows.map(row => <article key={row.id} className="min-w-0 rounded-xl bg-white p-3 text-xs">
                    <div className="flex flex-wrap justify-between gap-2"><strong className="break-words">{row.title}</strong><span className="text-violet-700">{diaryStateLabel[row.status] || '需核对'}</span></div>
                    <p className="my-2 text-[11px] text-slate-500">{row.charName} · {row.date}</p>
                    {row.message && <p className="my-2 break-words leading-relaxed text-slate-600">{row.message}</p>}
                    <details><summary className="cursor-pointer text-slate-500">查看正文与目标</summary><p className="mt-2 break-all text-slate-400">{row.path || '尚无可用目标'}</p><pre className="mt-3 whitespace-pre-wrap break-words font-sans leading-relaxed">{row.markdown}</pre></details>
                    {row.status !== 'written' && <div className="mt-3 flex flex-wrap gap-2">
                        <button type="button" disabled={row.status === 'writing'} className={action} onClick={() => void saveObsidianDiary(row.id).catch(() => setNotice('处理失败，正文保留'))}>{row.writeAttempted ? '核对保存结果' : '尝试写入'}</button>
                        {row.status === 'writing' && <button type="button" className={action} onClick={() => cancelObsidianDiary(row.id)}>停止</button>}
                    </div>}
                </article>)}
            </div>
        </details>
    </section>;
}
