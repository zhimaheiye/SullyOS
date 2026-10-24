import type {
  TaskWorkshopSettings, TaskWorkshopTool, TaskWorkshopUnit, TaskWorkshopUnitStatus, TaskWorkshopVisit,
} from '../types';

const VISITABLE_STATUS: TaskWorkshopUnitStatus[] = ['blocked', 'active', 'inbox'];

export const DEFAULT_TASK_WORKSHOP_SETTINGS: TaskWorkshopSettings = {
  id: 'settings',
  kind: 'settings',
  enabled: false,
  visitorCharIds: [],
  intervalMinutes: 60,
  nextVisitorIndex: 0,
};

export const createTaskWorkshopId = (prefix: string): string =>
  `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

export function normalizeTaskWorkshopTags(raw: string | string[]): string[] {
  const items = Array.isArray(raw) ? raw : raw.split(/[,，#\n]/);
  return [...new Set(items.map(item => item.trim()).filter(Boolean))].slice(0, 12);
}

export function createTaskWorkshopUnit(input: {
  title: string;
  description?: string;
  tags?: string[];
}): TaskWorkshopUnit {
  const now = Date.now();
  return {
    id: createTaskWorkshopId('unit'), kind: 'unit', title: input.title.trim(),
    description: input.description?.trim() || '', status: 'inbox',
    tags: normalizeTaskWorkshopTags(input.tags || []), linkedToolIds: [], entries: [], steps: [], visits: [],
    createdAt: now, updatedAt: now,
  };
}

export function createTaskWorkshopTool(input: {
  name: string;
  description?: string;
  tags?: string[];
}): TaskWorkshopTool {
  const now = Date.now();
  return {
    id: createTaskWorkshopId('tool'), kind: 'tool', name: input.name.trim(),
    description: input.description?.trim() || '', tags: normalizeTaskWorkshopTags(input.tags || []),
    status: 'available', notes: '', createdAt: now, updatedAt: now,
  };
}

export function taskWorkshopLocalDateKey(now = Date.now()): string {
  const date = new Date(now);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

/** 已到达的最近一条日期规则胜出；同日同时设置时“不可用”优先。 */
export function resolveTaskWorkshopToolStatus(tool: TaskWorkshopTool, now = Date.now()): TaskWorkshopTool {
  const today = taskWorkshopLocalDateKey(now);
  const valid = (value?: string) => /^\d{4}-\d{2}-\d{2}$/.test(value || '');
  const transitions = [
    ...(valid(tool.availableFrom) ? [{ date: tool.availableFrom!, status: 'available' as const, priority: 0 }] : []),
    ...(valid(tool.unavailableFrom) ? [{ date: tool.unavailableFrom!, status: 'unavailable' as const, priority: 1 }] : []),
  ].filter(item => item.date <= today).sort((a, b) => a.date.localeCompare(b.date) || a.priority - b.priority);
  const status = transitions.at(-1)?.status;
  return status && status !== tool.status ? { ...tool, status, updatedAt: now } : tool;
}

export function refreshTaskWorkshopToolStatuses(tools: TaskWorkshopTool[], now = Date.now()): TaskWorkshopTool[] {
  return tools.map(tool => resolveTaskWorkshopToolStatus(tool, now));
}

/** 阻塞任务优先；同优先级先看该角色最久没看过的，再看最久未更新的。 */
export function selectTaskWorkshopUnitForVisit(
  units: TaskWorkshopUnit[],
  charId: string,
): TaskWorkshopUnit | null {
  const candidates = units.filter(unit => VISITABLE_STATUS.includes(unit.status));
  candidates.sort((a, b) => {
    const statusDiff = VISITABLE_STATUS.indexOf(a.status) - VISITABLE_STATUS.indexOf(b.status);
    if (statusDiff !== 0) return statusDiff;
    const aVisit = a.visits.find(item => item.charId === charId)?.updatedAt || 0;
    const bVisit = b.visits.find(item => item.charId === charId)?.updatedAt || 0;
    if (aVisit !== bVisit) return aVisit - bVisit;
    return a.updatedAt - b.updatedAt;
  });
  return candidates[0] || null;
}

export function upsertTaskWorkshopVisit(
  unit: TaskWorkshopUnit,
  visit: TaskWorkshopVisit,
): TaskWorkshopUnit {
  const exists = unit.visits.some(item => item.charId === visit.charId);
  const visits = exists
    ? unit.visits.map(item => item.charId === visit.charId ? visit : item)
    : [visit, ...unit.visits];
  return { ...unit, visits, updatedAt: Math.max(unit.updatedAt, visit.updatedAt) };
}

export function nextTaskWorkshopVisitor(settings: TaskWorkshopSettings): {
  charId: string | null;
  nextIndex: number;
} {
  if (settings.visitorCharIds.length === 0) return { charId: null, nextIndex: 0 };
  const index = Math.max(0, settings.nextVisitorIndex) % settings.visitorCharIds.length;
  return {
    charId: settings.visitorCharIds[index],
    nextIndex: (index + 1) % settings.visitorCharIds.length,
  };
}

export function isTaskWorkshopVisitDue(settings: TaskWorkshopSettings, now = Date.now()): boolean {
  if (!settings.enabled || settings.visitorCharIds.length === 0) return false;
  const intervalMs = Math.max(5, settings.intervalMinutes || 60) * 60_000;
  return !settings.lastVisitAt || now - settings.lastVisitAt >= intervalMs;
}

const stripFence = (raw: string): string => raw.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

export function parseTaskWorkshopVisit(raw: string, charId: string, now = Date.now()): TaskWorkshopVisit {
  let parsed: any = null;
  const cleaned = stripFence(raw);
  try { parsed = JSON.parse(cleaned); } catch {
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) try { parsed = JSON.parse(match[0]); } catch { /* fall through */ }
  }
  const summary = String(parsed?.summary || parsed?.observation || cleaned || '暂时没有新的建议。').trim().slice(0, 1200);
  const suggestedSteps = Array.isArray(parsed?.suggestedSteps)
    ? parsed.suggestedSteps.map((item: unknown) => String(item).trim()).filter(Boolean).slice(0, 3)
    : [];
  const nextAction = String(parsed?.nextAction || suggestedSteps[0] || '').trim().slice(0, 300);
  return { charId, summary, suggestedSteps, nextAction, createdAt: now, updatedAt: now };
}

export function buildTaskWorkshopWorkspaceSummary(
  units: TaskWorkshopUnit[],
  tools: TaskWorkshopTool[],
  focusId: string,
): string {
  const ordered = [...units]
    .filter(unit => unit.status !== 'archived')
    .sort((a, b) => (a.id === focusId ? -1 : b.id === focusId ? 1 : b.updatedAt - a.updatedAt))
    .slice(0, 12);
  const unitText = ordered.map(unit => {
    const latestEntries = unit.entries.slice(-4).map(entry => `${entry.kind}: ${entry.content}`).join('；');
    const pendingSteps = unit.steps.filter(step => !step.done).slice(0, 5).map(step => step.content).join('；');
    return [
      `${unit.id === focusId ? '[本次查看]' : '[其他任务]'} ${unit.title}`,
      `状态=${unit.status}`,
      unit.description ? `说明=${unit.description}` : '',
      unit.tags.length ? `标签=${unit.tags.join('、')}` : '',
      latestEntries ? `最近记录=${latestEntries}` : '',
      pendingSteps ? `待办步骤=${pendingSteps}` : '',
    ].filter(Boolean).join('；').slice(0, 2400);
  }).join('\n');
  const toolText = tools.slice(0, 16).map(tool =>
    `${tool.name}（${tool.status}${tool.availableFrom ? `；${tool.availableFrom} 起恢复可用` : ''}${tool.unavailableFrom ? `；${tool.unavailableFrom} 起不可用` : ''}）：${tool.description || tool.notes || '未补充说明'}`.slice(0, 500),
  ).join('\n');
  return `【任务盒】\n${unitText || '暂无任务'}\n\n【工具箱】\n${toolText || '暂无工具条目'}`;
}
