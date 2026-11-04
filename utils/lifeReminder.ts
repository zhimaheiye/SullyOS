import type {
  ActiveMsg2TaskRecord, APIConfig, CharacterProfile, GroupProfile,
  MyScheduleSettings, RealtimeConfig, UserProfile,
} from '../types';
import { ActiveMsgClient } from './activeMsgClient';
import { applyScheduledTask } from './amsg2Tasks';

export interface LifeReminderEvent {
  id: string;
  message: string;
  dueAt: number;
  recurrenceType?: 'none' | 'daily' | 'weekly';
}

export function routeLifeReminder(settings: MyScheduleSettings, event?: LifeReminderEvent): string | null {
  if (!event || !settings.lifeRemindersEnabled || !settings.lifeReminderCharId) return null;
  if (!event.message.trim() || event.dueAt <= Date.now()) return null;
  return settings.lifeReminderCharId;
}

export async function scheduleLifeReminder(input: {
  settings: MyScheduleSettings;
  event: LifeReminderEvent;
  characters: CharacterProfile[];
  userProfile: UserProfile;
  groups: GroupProfile[];
  realtimeConfig: RealtimeConfig;
  apiConfig: APIConfig;
  taskUuid?: string;
  clientTaskId?: string;
}): Promise<{ charId: string; record: ActiveMsg2TaskRecord } | null> {
  const charId = routeLifeReminder(input.settings, input.event);
  if (!charId) return null;
  const char = input.characters.find(item => item.id === charId);
  if (!char?.activeMsg2Config?.enabled) throw new Error('提醒主角色需要先启用主动消息 2.0');
  const result = await ActiveMsgClient.scheduleCharacterTask({
    char,
    config: char.activeMsg2Config,
    taskUuid: input.taskUuid,
    clientTaskId: input.clientTaskId,
    task: {
      mode: 'fixed',
      firstSendTime: new Date(input.event.dueAt).toISOString(),
      recurrenceType: input.event.recurrenceType || 'none',
      userMessage: input.event.message,
      promptHint: input.event.id,
      expirePolicy: 'force',
    },
    userProfile: input.userProfile,
    groups: input.groups,
    realtimeConfig: input.realtimeConfig,
    apiConfig: input.apiConfig,
  });
  return {
    charId,
    record: {
      taskUuid: result.uuid,
      clientTaskId: result.clientTaskId,
      mode: 'fixed',
      firstSendTime: result.firstSendAt,
      recurrenceType: input.event.recurrenceType || 'none',
      userMessage: input.event.message,
      promptHint: input.event.id,
      expirePolicy: 'force',
      source: 'user',
      status: 'scheduled',
      createdAt: Date.now(),
      lifeReminder: true,
    },
  };
}

export function appendLifeReminderTask(char: CharacterProfile, record: ActiveMsg2TaskRecord) {
  const config = char.activeMsg2Config;
  if (!config) throw new Error('主动消息配置不存在');
  return {
    ...config,
    tasks: applyScheduledTask(config.tasks || [], record, {}, Date.now()),
    lastSyncedAt: Date.now(),
  };
}
