import React, { useState } from 'react';
import { useOS } from '../context/OSContext';
import { DB } from '../utils/db';
import { buildHostMysteryReport, buildPlayerMysteryReport } from '../utils/murderMystery/report';
import type { MurderMysteryEvent, MurderMysterySession } from '../utils/murderMystery/session';

const button = 'rounded-xl bg-stone-900 px-3 py-2 text-sm font-semibold text-white disabled:opacity-40';

export default function MurderMysteryEnding({ session, events, onChange, stopRound }: {
  session: MurderMysterySession; events: MurderMysteryEvent[]; onChange: () => Promise<void>; stopRound: () => void;
}) {
  const { characters, updateCharacter } = useOS();
  const [verdict, setVerdict] = useState('');
  const [endingId, setEndingId] = useState('');
  const [winners, setWinners] = useState<string[]>([]);
  const [reportCharId, setReportCharId] = useState(Object.values(session.seats)[0] || session.participation?.investigatorCharId || 'host');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const script = session.scriptSnapshot;
  const settled = session.status === 'ended';
  const report = settled ? (reportCharId === 'host' ? buildHostMysteryReport(session, events)
    : buildPlayerMysteryReport(session, events, reportCharId)) : '';
  const settle = async () => {
    if (!verdict.trim() || busy) return;
    stopRound(); setBusy(true); setNotice('');
    try {
      const fresh = await DB.getMurderMysterySession(session.id);
      if (!fresh) throw new Error('存档不存在');
      await DB.applyMurderMysteryCommand(fresh.id, fresh.revision, { type: 'end_game', endingId: endingId || undefined,
        winnerSeatIds: winners, verdict: verdict.trim() });
      await onChange(); setNotice('主持人最终裁定已保存。');
    } catch (error) { setNotice(String(error)); await onChange(); }
    finally { setBusy(false); }
  };
  const writeback = async (charId: string) => {
    setBusy(true); setNotice('');
    try {
      const result = await DB.writebackMurderMysteryReality(session.id, charId);
      if (result.written) updateCharacter(charId, { memories: result.character.memories });
      await onChange(); setNotice(result.written ? '共同游戏经历已写入该角色聊天与记忆。' : '该角色此前已写回，本次没有重复写入。');
    } catch (error) { setNotice(String(error)); await onChange(); }
    finally { setBusy(false); }
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([report], { type: 'text/plain;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url;
    link.download = `剧本杀-${script.title}-${reportCharId === 'host' ? '主持人完整战报' : '玩家个人战报'}.txt`;
    link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <section className="space-y-3 rounded-2xl bg-white p-4">
    <h2 className="font-bold">结算与战报</h2>
    {!settled ? <>
      <p className="text-xs text-stone-500">候选只供参考；以下由主持人最终确认。没有胜负的剧本可以不选胜出席位。</p>
      <textarea className="w-full rounded-xl border p-3 text-sm" value={verdict} onChange={event => setVerdict(event.target.value)} placeholder="主持人最终裁定／结局说明" />
      <select className="w-full rounded-xl border p-2 text-sm" value={endingId} onChange={event => setEndingId(event.target.value)}>
        <option value="">不指定预设结局</option>{script.endings.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select>
      <div className="flex flex-wrap gap-2 text-xs">{script.seats.map(seat => <label key={seat.id} className="rounded-xl bg-stone-100 p-2"><input type="checkbox" checked={winners.includes(seat.id)} onChange={event => setWinners(current => event.target.checked ? [...current, seat.id] : current.filter(id => id !== seat.id))} /> {seat.name} 胜出</label>)}</div>
      <button className={button} disabled={busy || !verdict.trim()} onClick={() => void settle()}>主持人确认结算</button>
    </> : <>
      <p className="text-sm">最终裁定：{session.outcome?.verdict}</p>
      <select className="w-full rounded-xl border p-2 text-sm" value={reportCharId} onChange={event => setReportCharId(event.target.value)}>
        <option value="host">主持人完整战报</option>{session.participation && <option value={session.participation.investigatorCharId}>调查者个人战报</option>}{script.seats.filter(seat => !!session.seats[seat.id]).map(seat => <option key={seat.id} value={session.seats[seat.id]}>{characters.find(char => char.id === session.seats[seat.id])?.name || '已删除角色'} 的个人战报</option>)}
      </select>
      <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-stone-100 p-3 text-xs">{report}</pre>
      <button className={button} onClick={download}>导出当前战报</button>
      <p className="text-xs text-stone-500">现实写回默认关闭。选择后仅记录共同玩过本局及扮演的席位，不把剧情行为当成角色现实经历。</p>
      <div className="flex flex-wrap gap-2">{[...script.seats.filter(seat => !!session.seats[seat.id]).map(seat => ({ id: session.seats[seat.id], label: seat.name })), ...(session.participation ? [{ id: session.participation.investigatorCharId, label: '调查者' }] : [])].map(({ id, label }) => <button key={id} className={button} disabled={busy || session.realityWritebackCharIds?.includes(id) || !characters.some(char => char.id === id)} onClick={() => void writeback(id)}>{session.realityWritebackCharIds?.includes(id) ? '已写回' : `写回 ${characters.find(char => char.id === id)?.name || label}`}</button>)}</div>
    </>}
    {notice && <p role="status" className="rounded-xl bg-amber-50 p-2 text-sm">{notice}</p>}
  </section>;
}
