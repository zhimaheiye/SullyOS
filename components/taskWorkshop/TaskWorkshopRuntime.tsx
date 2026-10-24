import { useCallback, useEffect, useRef } from 'react';
import { useOS } from '../../context/OSContext';
import type { TaskWorkshopTool, TaskWorkshopUnit } from '../../types';
import { DB } from '../../utils/db';
import { isTaskWorkshopVisitDue, nextTaskWorkshopVisitor, refreshTaskWorkshopToolStatuses } from '../../utils/taskWorkshop';
import { persistTaskWorkshopVisit, requestTaskWorkshopVisit } from '../../utils/taskWorkshopService';

export const TASK_WORKSHOP_UPDATED_EVENT = 'sully:task-workshop-updated';

/**
 * 第一版前台调度器：只要 SullyOS 页面还开着就工作；不注册 Worker、推送或系统后台任务。
 * 页面恢复可见时至多补一次到期来访，不追赶休眠期间错过的每个周期。
 */
const TaskWorkshopRuntime = () => {
  const { characters, userProfile, groups, apiConfig, realtimeConfig, isDataLoaded } = useOS();
  const runningRef = useRef(false);

  const check = useCallback(async () => {
    if (!isDataLoaded || runningRef.current || document.visibilityState === 'hidden') return;
    runningRef.current = true;
    try {
      const now = Date.now();
      const settings = await DB.getTaskWorkshopSettings();
      const records = await DB.getTaskWorkshopRecords();
      const storedTools = records.filter((item): item is TaskWorkshopTool => item.kind === 'tool');
      const tools = refreshTaskWorkshopToolStatuses(storedTools, now);
      const changedTools = tools.filter((tool, index) => tool !== storedTools[index]);
      await Promise.all(changedTools.map(tool => DB.saveTaskWorkshopRecord(tool)));
      if (changedTools.length) window.dispatchEvent(new Event(TASK_WORKSHOP_UPDATED_EVENT));
      if (!isTaskWorkshopVisitDue(settings)) return;
      const validCharIds = settings.visitorCharIds.filter(id => characters.some(char => char.id === id));
      const normalized = { ...settings, visitorCharIds: validCharIds };
      const { charId, nextIndex } = nextTaskWorkshopVisitor(normalized);
      if (!charId) {
        if (validCharIds.length !== settings.visitorCharIds.length) await DB.saveTaskWorkshopRecord(normalized);
        return;
      }
      const units = records.filter((item): item is TaskWorkshopUnit => item.kind === 'unit');
      const char = characters.find(item => item.id === charId);
      if (!char) return;

      try {
        const result = await requestTaskWorkshopVisit({ char, userProfile, groups, apiConfig, realtimeConfig, units, tools });
        const saved = await persistTaskWorkshopVisit(result.unit.id, result.visit);
        if (saved) window.dispatchEvent(new CustomEvent(TASK_WORKSHOP_UPDATED_EVENT, { detail: { unitId: saved.id } }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message !== '当前没有可供角色查看的任务') console.warn('[TaskWorkshop] automatic visit failed:', error);
      } finally {
        const latest = await DB.getTaskWorkshopSettings();
        const latestPosition = latest.visitorCharIds.indexOf(charId);
        const safeNextIndex = latestPosition >= 0 && latest.visitorCharIds.length > 0
          ? (latestPosition + 1) % latest.visitorCharIds.length
          : Math.min(nextIndex, Math.max(0, latest.visitorCharIds.length - 1));
        await DB.saveTaskWorkshopRecord({ ...latest, nextVisitorIndex: safeNextIndex, lastVisitAt: now });
        window.dispatchEvent(new Event(TASK_WORKSHOP_UPDATED_EVENT));
      }
    } finally {
      runningRef.current = false;
    }
  }, [apiConfig, characters, groups, isDataLoaded, realtimeConfig, userProfile]);

  useEffect(() => {
    void check();
    const timer = window.setInterval(() => void check(), 60_000);
    const onVisibility = () => { if (document.visibilityState === 'visible') void check(); };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [check]);

  return null;
};

export default TaskWorkshopRuntime;
