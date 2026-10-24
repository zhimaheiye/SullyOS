import { describe, expect, it } from 'vitest';
import type { TaskWorkshopSettings, TaskWorkshopTool, TaskWorkshopUnit } from '../types';
import {
  isTaskWorkshopVisitDue, nextTaskWorkshopVisitor, parseTaskWorkshopVisit,
  selectTaskWorkshopUnitForVisit, upsertTaskWorkshopVisit,
  resolveTaskWorkshopToolStatus,
} from './taskWorkshop';

const unit = (id: string, status: TaskWorkshopUnit['status'], updatedAt: number, visits: TaskWorkshopUnit['visits'] = []): TaskWorkshopUnit => ({
  id, kind: 'unit', title: id, description: '', status, tags: [], linkedToolIds: [], entries: [], steps: [], visits,
  createdAt: updatedAt, updatedAt,
});

describe('task workshop scheduling', () => {
  it('rotates selected characters and only becomes due after the configured interval', () => {
    const settings: TaskWorkshopSettings = { id: 'settings', kind: 'settings', enabled: true, visitorCharIds: ['a', 'b'], intervalMinutes: 30, nextVisitorIndex: 1, lastVisitAt: 1_000 };
    expect(nextTaskWorkshopVisitor(settings)).toEqual({ charId: 'b', nextIndex: 0 });
    expect(isTaskWorkshopVisitDue(settings, 1_000 + 29 * 60_000)).toBe(false);
    expect(isTaskWorkshopVisitDue(settings, 1_000 + 30 * 60_000)).toBe(true);
  });

  it('prefers blocked work, then the task this character saw least recently', () => {
    const oldVisit = { charId: 'a', summary: '', suggestedSteps: [], nextAction: '', createdAt: 10, updatedAt: 10 };
    const selected = selectTaskWorkshopUnitForVisit([
      unit('active', 'active', 1),
      unit('blocked-new', 'blocked', 3, [{ ...oldVisit, updatedAt: 30 }]),
      unit('blocked-old', 'blocked', 2, [{ ...oldVisit, updatedAt: 20 }]),
      unit('done', 'done', 0),
    ], 'a');
    expect(selected?.id).toBe('blocked-old');
  });

  it('replaces a character own note instead of accumulating it', () => {
    const base = unit('x', 'active', 1, [{ charId: 'a', summary: 'old', suggestedSteps: [], nextAction: '', createdAt: 1, updatedAt: 1 }]);
    const visit = parseTaskWorkshopVisit('{"summary":"new","suggestedSteps":["one","two","three","four"],"nextAction":"one"}', 'a', 20);
    const next = upsertTaskWorkshopVisit(base, visit);
    expect(next.visits).toHaveLength(1);
    expect(next.visits[0].summary).toBe('new');
    expect(next.visits[0].suggestedSteps).toHaveLength(3);
  });

  it('按本地日期自动恢复或停用工具但不删除条目', () => {
    const tool: TaskWorkshopTool = {
      id: 'tool', kind: 'tool', name: '预约渠道', description: '', tags: [], notes: '', status: 'unavailable',
      availableFrom: '2026-08-20', unavailableFrom: '2026-08-25', createdAt: 1, updatedAt: 1,
    };
    expect(resolveTaskWorkshopToolStatus(tool, new Date(2026, 7, 19, 23).getTime()).status).toBe('unavailable');
    expect(resolveTaskWorkshopToolStatus(tool, new Date(2026, 7, 20, 0).getTime()).status).toBe('available');
    expect(resolveTaskWorkshopToolStatus(tool, new Date(2026, 7, 25, 0).getTime()).status).toBe('unavailable');
    expect(resolveTaskWorkshopToolStatus(tool, new Date(2026, 7, 25, 0).getTime()).id).toBe('tool');
  });
});
