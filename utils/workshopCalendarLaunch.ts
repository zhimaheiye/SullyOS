import { useEffect, useRef, useState } from 'react';

export type WorkshopCalendarTarget = { kind: 'record'; recordId: string } | { kind: 'new'; date: string };
export type WorkshopCalendarLaunch = WorkshopCalendarTarget & { token: string };
const KEY = 'sully-workshop-calendar-launch';
const listeners = new Set<() => void>();

export function readWorkshopCalendarLaunch(): WorkshopCalendarLaunch | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(KEY) || 'null');
    return value?.token && (value.kind === 'record' && typeof value.recordId === 'string' || value.kind === 'new' && /^\d{4}-\d{2}-\d{2}$/.test(value.date)) ? value : null;
  } catch { return null; }
}
export function launchWorkshopCalendar(target: WorkshopCalendarTarget) {
  sessionStorage.setItem(KEY, JSON.stringify({ ...target, token: crypto.randomUUID() }));
  listeners.forEach(listener => listener());
}
export function clearWorkshopCalendarLaunch() { sessionStorage.removeItem(KEY); }
export function useWorkshopCalendarLaunch() {
  const [launch, setLaunch] = useState(readWorkshopCalendarLaunch);
  const last = useRef(launch?.token);
  useEffect(() => {
    const refresh = () => {
      const next = readWorkshopCalendarLaunch();
      if (next?.token !== last.current) { last.current = next?.token; setLaunch(next); }
    };
    listeners.add(refresh); refresh();
    return () => { listeners.delete(refresh); };
  }, []);
  return launch;
}
