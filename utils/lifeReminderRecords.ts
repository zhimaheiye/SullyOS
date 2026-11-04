import type {
  APIConfig, CharacterProfile, GroupProfile, LifeReminderRecord,
  RealtimeConfig, UserProfile,
} from '../types';
import { ActiveMsgClient } from './activeMsgClient';
import { appendLifeReminderTask, scheduleLifeReminder } from './lifeReminder';
import { lifeOccurrenceOnDay } from './lifeReminderOccurrences';
import { DB } from './db';

export const LIFE_REMINDERS_UPDATED_EVENT = 'sully-life-reminders-updated';
const now = () => Date.now();

const saveReminder = async (record: LifeReminderRecord) => {
  await DB.saveMyScheduleRecord(record);
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(LIFE_REMINDERS_UPDATED_EVENT));
};

const logResult = (
  record: LifeReminderRecord,
  action: string,
  result: string,
  outcome: 'success' | 'error' | 'uncertain',
): LifeReminderRecord => ({
  ...record,
  operationLog: [...(record.operationLog || []).slice(-19), { at: now(), action, result, outcome }],
});

export async function listLifeReminders(): Promise<LifeReminderRecord[]> {
  return (await DB.getMyScheduleRecords())
    .filter((record): record is LifeReminderRecord => record.kind === 'life_reminder')
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function nextLifeOccurrence(record: LifeReminderRecord, from = now()): number | null {
  if (record.schedule.type === 'conditional') return null;
  if (record.schedule.type === 'once') return record.schedule.at && record.schedule.at > from ? record.schedule.at : null;
  const local = new Intl.DateTimeFormat('en-CA', {
    timeZone: record.timezone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(from));
  const year = Number(local.find(part => part.type === 'year')?.value);
  const month = Number(local.find(part => part.type === 'month')?.value);
  const day = Number(local.find(part => part.type === 'day')?.value);
  for (let step = 0; step < 370; step += 1) {
    const occurrence = lifeOccurrenceOnDay(record, new Date(Date.UTC(year, month - 1, day + step)));
    if (occurrence !== null && occurrence > from) return occurrence;
  }
  return null;
}

export interface LifeReminderDeps {
  characters: CharacterProfile[];
  userProfile: UserProfile;
  groups: GroupProfile[];
  realtimeConfig: RealtimeConfig;
  apiConfig: APIConfig;
  updateCharacter: (id: string, updates: Partial<CharacterProfile> | ((previous: CharacterProfile) => Partial<CharacterProfile>)) => void;
}

export interface LifeReminderCommand {
  action: 'create' | 'list' | 'reschedule' | 'cancel' | 'complete' | 'pause' | 'resume' | 'edit';
  id?: string;
  title?: string;
  message?: string;
  at?: string;
  recurrence?: 'none' | 'daily' | 'weekly';
}

function identify(records: LifeReminderRecord[], key?: string): LifeReminderRecord | null {
  if (!key) return null;
  const exact = records.find(record => record.id === key || record.sourceId === key);
  if (exact) return exact;
  const matches = records.filter(record => record.title.includes(key) || key.includes(record.title));
  return matches.length === 1 ? matches[0] : null;
}

async function cancelRemote(record: LifeReminderRecord, deps: LifeReminderDeps): Promise<void> {
  if (!record.taskUuid) return;
  await ActiveMsgClient.cancelTask(record.taskUuid);
  const remote = await ActiveMsgClient.getRemoteTaskStatus(record.taskUuid);
  if (remote.state === 'pending') throw new Error('远端仍有旧任务，取消尚未确认');
  const owner = deps.characters.find(character => character.id === record.ownerCharId);
  if (owner?.activeMsg2Config) {
    deps.updateCharacter(owner.id, previous => ({
      activeMsg2Config: {
        ...previous.activeMsg2Config!,
        tasks: (previous.activeMsg2Config?.tasks || []).filter(task => task.taskUuid !== record.taskUuid),
      },
    }));
  }
}

async function scheduleRecord(record: LifeReminderRecord, deps: LifeReminderDeps): Promise<LifeReminderRecord> {
  const settings = await DB.getMyScheduleSettings();
  if (!settings.lifeRemindersEnabled || !settings.lifeReminderCharId) throw new Error('请先在“我的日程”中启用提醒并选择提醒角色');
  const dueAt = nextLifeOccurrence(record);
  if (!dueAt) throw new Error('没有可排程的未来时间');
  const taskUuid = record.pendingTaskUuid || crypto.randomUUID();
  const result = await scheduleLifeReminder({
    settings,
    event: {
      id: record.id,
      message: record.message,
      dueAt,
      recurrenceType: record.schedule.type === 'daily' || record.schedule.type === 'weekly' ? record.schedule.type : 'none',
    },
    characters: deps.characters,
    userProfile: deps.userProfile,
    groups: deps.groups,
    realtimeConfig: deps.realtimeConfig,
    apiConfig: deps.apiConfig,
    taskUuid,
    clientTaskId: taskUuid,
  });
  if (!result) throw new Error('主动消息 2.0 未受理这条提醒');
  deps.updateCharacter(result.charId, previous => ({
    activeMsg2Config: appendLifeReminderTask(previous, result.record),
  }));
  return {
    ...record,
    ownerCharId: result.charId,
    taskUuid: result.record.taskUuid,
    clientTaskId: result.record.clientTaskId,
    scheduledFor: dueAt,
    scheduleState: 'scheduled',
    scheduleError: undefined,
    pendingTaskUuid: undefined,
    pendingAction: undefined,
    status: 'active',
    updatedAt: now(),
    version: record.version + 1,
  };
}

export async function executeLifeReminder(command: LifeReminderCommand, deps: LifeReminderDeps): Promise<string> {
  const records = await listLifeReminders();
  if (command.action === 'list') {
    return records.length
      ? records.map(record => `[${record.id}] ${record.title}：${record.status}${record.scheduledFor ? `；下次 ${new Date(record.scheduledFor).toLocaleString('zh-CN')}` : ''}${record.scheduleError ? `；失败：${record.scheduleError}` : ''}`).join('\n')
      : '目前没有生活提醒。';
  }

  let record = identify(records, command.id);
  if (command.action !== 'create' && !record) {
    const active = records.filter(item => item.status === 'active' || item.status === 'paused' || item.status === 'error');
    return command.id ? '没有唯一匹配的提醒。请说标题或清单中的 ID。' : active.length === 1
      ? `请确认是“${active[0].title}”吗？`
      : '你想改哪一条提醒？请说标题或清单中的 ID。';
  }

  if (command.action === 'create') {
    if (!command.title?.trim() || !command.at || !Number.isFinite(Date.parse(command.at))) return '请给出提醒内容和明确时间。';
    const at = Date.parse(command.at);
    if (at <= now() + 60_000) return '提醒时间至少要在一分钟后。';
    const recurrence = command.recurrence || 'none';
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const schedule: LifeReminderRecord['schedule'] = recurrence === 'none'
      ? { type: 'once', at }
      : { type: recurrence, time: new Date(at).toLocaleTimeString('en-GB', { timeZone: timezone, hour: '2-digit', minute: '2-digit' }) };
    record = {
      id: `life:${crypto.randomUUID()}`,
      kind: 'life_reminder',
      sourceId: `manual:${crypto.randomUUID()}`,
      title: command.title.trim(),
      message: command.message?.trim() || `提醒你：${command.title.trim()}`,
      status: 'active',
      schedule,
      timezone,
      startAt: at,
      externalManaged: false,
      pendingTaskUuid: crypto.randomUUID(),
      createdAt: now(),
      updatedAt: now(),
      version: 1,
    };
    await saveReminder(record);
  }
  if (!record) return '没有找到提醒。';

  const original = record;
  try {
    if (command.action === 'cancel' || command.action === 'pause' || command.action === 'complete') {
      await cancelRemote(original, deps);
      const status = command.action === 'cancel' ? 'cancelled' : command.action === 'complete' ? 'completed' : 'paused';
      const changed = logResult({
        ...original,
        status,
        taskUuid: undefined,
        clientTaskId: undefined,
        scheduledFor: undefined,
        scheduleState: undefined,
        scheduleError: undefined,
        pendingAction: undefined,
        updatedAt: now(),
        version: original.version + 1,
      }, command.action, '云端任务已取消，本地状态已更新', 'success');
      await saveReminder(changed);
      return `已${command.action === 'cancel' ? '取消' : command.action === 'complete' ? '完成' : '暂停'}“${changed.title}”。`;
    }

    if (command.action === 'edit' || command.action === 'reschedule' || command.action === 'resume') {
      const at = command.at ? Date.parse(command.at) : undefined;
      if (command.at && (!Number.isFinite(at) || at! <= now() + 60_000)) return '新时间无效或过近，请给出至少一分钟后的明确时间。';
      await cancelRemote(original, deps);
      const recurrence = command.recurrence || (original.schedule.type === 'daily' || original.schedule.type === 'weekly' ? original.schedule.type : 'none');
      const schedule: LifeReminderRecord['schedule'] = at === undefined ? original.schedule : recurrence === 'none'
        ? { type: 'once', at }
        : { type: recurrence, time: new Date(at).toLocaleTimeString('en-GB', { timeZone: original.timezone, hour: '2-digit', minute: '2-digit' }) };
      record = {
        ...original,
        title: command.title?.trim() || original.title,
        message: command.message?.trim() || original.message,
        schedule,
        startAt: at ?? original.startAt,
        status: 'active',
        taskUuid: undefined,
        clientTaskId: undefined,
        pendingTaskUuid: crypto.randomUUID(),
        scheduledFor: undefined,
        scheduleState: undefined,
        scheduleError: undefined,
        updatedAt: now(),
        version: original.version + 1,
      };
      await saveReminder(record);
    }

    const scheduled = await scheduleRecord(record, deps);
    const result = `已安排“${scheduled.title}”：${new Date(scheduled.scheduledFor!).toLocaleString('zh-CN')}。[${scheduled.id}]`;
    await saveReminder(logResult(scheduled, command.action, result, 'success'));
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = logResult({
      ...record,
      status: 'error',
      scheduleState: 'uncertain',
      scheduleError: message,
      updatedAt: now(),
      version: record.version + 1,
    }, command.action, `未完成：${message}`, 'uncertain');
    await saveReminder(failed);
    return `操作未完成：${message}。请检查设置后重试同一条 [${record.id}]。`;
  }
}

export async function refreshLifeReminderRemoteStates(): Promise<void> {
  for (const record of await listLifeReminders()) {
    if (!record.taskUuid || record.status !== 'active') continue;
    try {
      const remote = await ActiveMsgClient.getRemoteTaskStatus(record.taskUuid);
      const scheduleState = remote.state === 'pending' ? 'scheduled' : remote.state === 'completed' ? 'triggered' : 'uncertain';
      if (scheduleState === record.scheduleState && record.lastRemoteCheckedAt && now() - record.lastRemoteCheckedAt < 60_000) continue;
      await saveReminder({
        ...record,
        scheduleState,
        scheduleError: scheduleState === 'uncertain' ? '云端任务提前消失，无法确认自动送达' : undefined,
        lastRemoteCheckedAt: now(),
        updatedAt: now(),
        version: record.version + 1,
      });
    } catch {
      // Offline is not evidence that the task failed; leave the last known state intact.
    }
  }
}

export const LIFE_REMINDER_TOOL_NAME = 'manage_life_reminder';
export const LIFE_REMINDER_TOOLS = [{
  type: 'function' as const,
  function: {
    name: LIFE_REMINDER_TOOL_NAME,
    description: '管理用户自己创建的现实生活提醒。新增、查询、改期、取消、暂停、恢复或完成提醒时调用。只有工具回报成功，才能确认已排程。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['create', 'list', 'reschedule', 'cancel', 'complete', 'pause', 'resume', 'edit'] },
        id: { type: 'string', description: '已有提醒的稳定 ID 或唯一标题。' },
        title: { type: 'string', description: '新建时必填。' },
        message: { type: 'string', description: '到点发送的固定文案。' },
        at: { type: 'string', description: '带时区偏移的 ISO 8601 绝对时间。' },
        recurrence: { type: 'string', enum: ['none', 'daily', 'weekly'] },
      },
      required: ['action'],
    },
  },
}];

export async function executeLifeReminderTool(args: Record<string, unknown>, deps: LifeReminderDeps): Promise<string> {
  return executeLifeReminder({
    action: args.action as LifeReminderCommand['action'],
    id: typeof args.id === 'string' ? args.id : undefined,
    title: typeof args.title === 'string' ? args.title : undefined,
    message: typeof args.message === 'string' ? args.message : undefined,
    at: typeof args.at === 'string' ? args.at : undefined,
    recurrence: args.recurrence === 'daily' || args.recurrence === 'weekly' || args.recurrence === 'none' ? args.recurrence : undefined,
  }, deps);
}
