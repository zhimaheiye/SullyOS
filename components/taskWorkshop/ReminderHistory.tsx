import React from 'react';
import type { LifeReminderRecord } from '../../types';

type Props = Pick<LifeReminderRecord, 'operationLog' | 'scheduleError' | 'scheduleState'>;
const format = (at: number) => new Date(at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export default function ReminderHistory({ operationLog = [], scheduleError, scheduleState }: Props) {
  return <details className="mt-3 text-[11px] text-slate-600">
    <summary className="min-h-8 cursor-pointer py-1 font-bold">执行记录（{operationLog.length}）</summary>
    {scheduleError && <p className="mt-2 whitespace-pre-wrap text-amber-800">{scheduleState === 'uncertain' ? '当前状态待核验' : '当前错误'}：{scheduleError}</p>}
    {operationLog.length ? <ul className="mt-2 space-y-2">{[...operationLog].reverse().map((item, index) => <li key={`${item.at}-${index}`} className="whitespace-pre-wrap break-words">{format(item.at)} · {item.action} · {item.result}</li>)}</ul> : <p className="py-2">暂无执行记录</p>}
  </details>;
}
