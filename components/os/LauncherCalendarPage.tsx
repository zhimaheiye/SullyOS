import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocalDateKey } from '../../hooks/useLocalDateKey';
import type { Anniversary, CharacterProfile } from '../../types';
import { AppID } from '../../types';
import {
  calendarMonth, calendarOccurrenceStatus, projectCalendarMonth,
  readCalendarReminders, shiftCalendarMonth,
} from '../../utils/launcherCalendar';
import { LIFE_REMINDERS_UPDATED_EVENT } from '../../utils/lifeReminderRecords';
import { launchWorkshopCalendar } from '../../utils/workshopCalendarLaunch';

const WEEK = ['日', '一', '二', '三', '四', '五', '六'];
interface Props {
  contentColor: string;
  openApp: (app: AppID) => void;
  anniversaries: Anniversary[];
  characters: CharacterProfile[];
  acnh?: boolean;
  paper?: boolean;
}

export const LauncherCalendarPage = React.memo(function LauncherCalendarPage({ contentColor, openApp, anniversaries, characters, acnh = false, paper = false }: Props) {
  const today = useLocalDateKey();
  const [selected, setSelected] = useState(today);
  const [records, setRecords] = useState<Awaited<ReturnType<typeof readCalendarReminders>>>([]);
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try { setRecords(await readCalendarReminders()); setError(''); }
    catch { setError('提醒读取失败，请稍后重试'); }
  }, []);
  useEffect(() => {
    void refresh();
    const update = () => { void refresh(); };
    window.addEventListener(LIFE_REMINDERS_UPDATED_EVENT, update);
    window.addEventListener('focus', update);
    return () => { window.removeEventListener(LIFE_REMINDERS_UPDATED_EVENT, update); window.removeEventListener('focus', update); };
  }, [refresh]);

  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const month = selected.slice(0, 7);
  const { days, offset } = calendarMonth(month);
  const occurrences = useMemo(() => projectCalendarMonth(records, month, zone), [month, records, zone]);
  const agenda = occurrences.filter(item => item.date === selected);
  const allDay = anniversaries.filter(item => item.date === selected);
  const reminderDates = new Set(occurrences.map(item => item.date));
  const anniversaryDates = new Set(anniversaries.map(item => item.date));
  const launch = (target: Parameters<typeof launchWorkshopCalendar>[0]) => { launchWorkshopCalendar(target); openApp(AppID.TaskWorkshop); };
  const accent = acnh ? '#08796c' : paper ? '#637352' : '#f3e6ff';
  const cardStyle = acnh ? { background: '#f7f3df', border: '2px solid #e8e2d6', boxShadow: '0 6px 18px #3d34281f' }
    : paper ? { background: 'rgba(224,221,215,0.36)', border: '1px solid #5b483312', boxShadow: '0 5px 16px #5b48330d' }
      : { background: 'rgba(255,255,255,.25)', border: '1px solid #ffffff40', boxShadow: '0 6px 20px #0002' };
  const owner = (id?: string) => characters.find(character => character.id === id)?.name || '未绑定角色';

  return <div className="launcher-page flex h-full w-full flex-shrink-0 snap-center snap-always flex-col space-y-5 overflow-y-auto px-4 pb-8 pt-24 no-scrollbar" style={{ color: acnh ? '#414c3c' : contentColor }}>
    <section className="rounded-3xl p-4" style={cardStyle}>
      <div className="mb-3 flex items-center justify-between"><button className="min-h-11 rounded-xl px-4" onClick={() => setSelected(shiftCalendarMonth(selected, -1))}>‹</button><h3 className="text-lg font-bold tracking-wide">{month.replace('-', ' / ')}</h3><button className="min-h-11 rounded-xl px-4" onClick={() => setSelected(shiftCalendarMonth(selected, 1))}>›</button></div>
      <div className="grid grid-cols-7 gap-y-2 text-center">{WEEK.map(day => <div key={day} className="pb-1 text-xs opacity-60">{day}</div>)}{Array.from({ length: offset }, (_, index) => <span key={`pad${index}`} />)}{Array.from({ length: days }, (_, index) => {
        const date = `${month}-${String(index + 1).padStart(2, '0')}`;
        const active = date === selected;
        return <button key={date} onClick={() => setSelected(date)} className="relative flex min-h-11 min-w-0 flex-col items-center justify-center rounded-xl" style={{ background: active ? acnh || paper ? '#637352' : '#fff' : undefined, color: active ? acnh || paper ? '#fff' : '#342c44' : undefined, boxShadow: date === today ? `inset 0 0 0 2px ${accent}` : undefined }}><span className={date === today ? 'font-extrabold' : 'text-sm'}>{index + 1}</span><span className="absolute bottom-1 flex gap-1">{reminderDates.has(date) && <i className="h-1 w-1 rounded-full" style={{ background: active ? 'currentColor' : accent }} />}{anniversaryDates.has(date) && <i className="h-1 w-1 rounded-full bg-[#be7856]" />}</span></button>;
      })}</div>
      <div className="mt-3 flex items-center justify-between text-xs"><button className="min-h-11 rounded-xl px-3" onClick={() => setSelected(today)}>今天</button><span className="opacity-65">{zone}</span></div>
    </section>
    <section className="space-y-3 rounded-3xl p-4" style={cardStyle}>
      <div className="flex items-center justify-between"><h3 className="font-bold">{selected}</h3><button className="min-h-11 rounded-xl bg-black/10 px-3 text-xs font-bold" onClick={() => launch({ kind: 'new', date: selected })}>＋ 提醒</button></div>
      {error && <p className="text-sm">{error}</p>}
      {!agenda.length && !allDay.length && <p className="py-6 text-center text-sm opacity-70">这一天暂无安排</p>}
      {allDay.map(item => <button key={item.id} className="w-full rounded-2xl bg-black/5 p-3 text-left" onClick={() => openApp(AppID.Schedule)}><span className="text-xs opacity-70">全天 · 纪念日</span><b className="mt-1 block break-words text-sm">{item.title}</b><span className="text-xs opacity-70">{owner(item.charId)}</span></button>)}
      {agenda.map(item => <button key={item.key} className="w-full rounded-2xl bg-black/5 p-3 text-left" onClick={() => launch({ kind: 'record', recordId: item.record.id })}><span className="text-xs font-bold tabular-nums">{new Date(item.at).toLocaleTimeString('zh-CN', { timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })} · 提醒</span><b className="mt-1 block break-words text-sm">{item.record.title}</b><span className="mt-1 block text-xs opacity-75">{owner(item.record.ownerCharId)} · {calendarOccurrenceStatus(item)}</span></button>)}
      <button className="min-h-11 w-full rounded-xl bg-black/5 px-3 text-xs" onClick={() => openApp(AppID.Schedule)}>＋ 纪念日</button>
    </section>
  </div>;
});
