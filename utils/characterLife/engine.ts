/**
 * 旧版「角色自主生活」存档形状。
 *
 * 公开版不再运行自主生活调度，也没有相关 UI 或提示词。这里只保留字段定义，
 * 让旧备份仍能正常导入导出；不要依赖其中的状态做任何行为判断。
 */

export type LifePhase = 'awake' | 'winding_down' | 'sleeping';
export type LifeActivity = 'sleeping' | 'resting' | 'washing' | 'browsing_phone' | 'working' | 'gaming' | 'quiet';

export interface LifeEpisode {
  id: string;
  enteredAt: number;
  cutoffAt: number;
  activity?: LifeActivity;
  revision: number;
  reply?: string;
}

export interface LifeState {
  charId: string;
  version: number;
  phase: LifePhase;
  activity?: LifeActivity;
  activityNextAt?: number;
  social: 'available' | 'away';
  socialReason?: 'activity' | 'intent';
  changedAt: number;
  nextAt: number;
  episode?: LifeEpisode;
  lastActiveAt?: number;
  lastViewedAt?: number;
  lastNoticeAt?: number;
  recentNotices?: number;
  lastEvaluatedNoticeAt?: number;
  lastCallAt?: number;
  awokeForCallAt?: number;
  consecutiveCalls?: number;
  catchUpDueAt?: number;
  catchUpClaimedAt?: number;
}
