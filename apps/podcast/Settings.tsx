import React, { useEffect, useState } from 'react';
import { podcastBridge } from '../../utils/podcast/service';
import { button, primary } from './Panels';

export default function PodcastSettings({ onClear }: { onClear: () => Promise<void> }) {
  const [connected, setConnected] = useState<boolean>();
  const [accountClient, setAccountClient] = useState(false);
  const [loggedIn, setLoggedIn] = useState(false);
  const [error, setError] = useState('');
  const [qr, setQr] = useState('');
  const [scanned, setScanned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const check = async (signal?: AbortSignal) => {
    try {
      const status = await podcastBridge<{ loggedIn: boolean; accountClient: boolean }>('status', signal);
      setAccountClient(status.accountClient); setConnected(true); setLoggedIn(status.loggedIn); setError('');
    } catch (cause) {
      if (!signal?.aborted) { setConnected(false); setError(String((cause as Error).message)); }
    }
  };
  useEffect(() => { const controller = new AbortController(); void check(controller.signal); return () => controller.abort(); }, []);
  useEffect(() => {
    if (!qr) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const result = await podcastBridge<{ state: string }>('loginPoll', controller.signal);
        if (controller.signal.aborted) return;
        if (result.state === 'CONFIRMED') { setQr(''); setLoggedIn(true); return; }
        setScanned(result.state === 'SCANNED');
        timer = setTimeout(poll, 1800);
      } catch (cause) {
        if (!controller.signal.aborted) { setError(String((cause as Error).message)); setQr(''); }
      }
    };
    timer = setTimeout(poll, 1000);
    return () => { controller.abort(); clearTimeout(timer); };
  }, [qr]);
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError('');
    try { await work(); }
    catch (cause) { setError(String((cause as Error).message)); }
    finally { setBusy(false); }
  }
  return <section className="mx-auto w-full max-w-lg space-y-4 rounded-2xl border border-sky-100 bg-white/80 p-5 dark:border-slate-700 dark:bg-slate-800">
    <div>
      <h2 className="font-semibold">本机工具</h2>
      <p role="status" className="mt-1 text-sm text-slate-600 dark:text-slate-300">{connected === undefined ? '正在检查' : connected ? loggedIn ? '检测到本机登录，可获取文稿' : '已连接 · 未登录' : '本机接口不可用'}</p>
    </div>
    {connected && !accountClient && <p className="text-sm text-slate-600">可读取公开节目、导入本机音频与时间戳文稿。扫码和在线文稿需要自行配置兼容本机客户端。</p>}
    <div className="flex flex-wrap gap-2">
      <button className={button} disabled={busy} onClick={() => void run(check)}>检查连接</button>
      <button className={primary} disabled={busy || !connected || !accountClient || !!qr} onClick={() => void run(async () => {
        const result = await podcastBridge<{ svg: string }>('loginStart'); setScanned(false); setQr(result.svg);
      })}>{loggedIn ? '重新扫码' : '扫码登录'}</button>
      {loggedIn && <button className={button} disabled={busy || !!qr} onClick={() => setConfirmLogout(true)}>退出登录</button>}
    </div>
    {qr && <div className="space-y-3 rounded-xl bg-sky-50 p-3 dark:bg-slate-900">
      <img className="h-44 w-44 rounded-lg" alt="小宇宙登录二维码" src={'data:image/svg+xml,' + encodeURIComponent(qr)} />
      <p className="text-sm" role="status">{scanned ? '请在手机上确认登录。' : '请用手机小宇宙扫一扫，授权名称为小宇宙网页版。'}</p>
      <button className={button} onClick={() => setQr('')}>取消扫码</button>
    </div>}
    {confirmLogout && <div className="space-y-2 rounded-xl bg-sky-50 p-3 dark:bg-slate-900">
      <p className="text-sm">这会移除共享的本机登录，原小宇宙工具也需要重新扫码。</p>
      <button className={button} disabled={busy} onClick={() => void run(async () => {
        await podcastBridge('logout'); setLoggedIn(false); setQr(''); setConfirmLogout(false);
      })}>确认退出</button> <button className={button} onClick={() => setConfirmLogout(false)}>取消</button>
    </div>}
    <div className="space-y-2 border-t border-sky-100 pt-4 dark:border-slate-700">
      <h2 className="font-semibold">文稿缓存</h2>
      {confirmClear ? <>
        <p className="text-sm">移除节目中缓存的文稿。已有讨论、引用和磁盘上的导出文件会保留。</p>
        <button className={button} disabled={busy} onClick={() => void run(async () => { await onClear(); setConfirmClear(false); })}>确认清理</button> <button className={button} onClick={() => setConfirmClear(false)}>取消</button>
      </> : <button className={button} disabled={busy} onClick={() => setConfirmClear(true)}>清理缓存</button>}
    </div>
    {error && <p role="alert" className="rounded-xl bg-rose-50 p-3 text-sm text-rose-800 dark:bg-rose-950 dark:text-rose-200">{error}</p>}
  </section>;
}
