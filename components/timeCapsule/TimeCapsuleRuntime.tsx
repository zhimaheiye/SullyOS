import { useCallback, useEffect, useRef } from 'react';
import { useOS } from '../../context/OSContext';
import type { TimeCapsuleEntry } from '../../types';
import { DB } from '../../utils/db';
import {
  hasPendingAutoTimeCapsule, isTimeCapsuleVisitDue, nextTimeCapsuleVisitor,
} from '../../utils/timeCapsule';
import { requestCharacterTimeCapsule } from '../../utils/timeCapsuleService';

export const TIME_CAPSULE_UPDATED_EVENT = 'sully:time-capsule-updated';

/** 第一版只在 SullyOS 页面可见时轮换来访；休眠期间不追赶错过的多个周期。 */
const TimeCapsuleRuntime = () => {
  const { characters, userProfile, groups, apiConfig, realtimeConfig, isDataLoaded } = useOS();
  const runningRef = useRef(false);

  const check = useCallback(async () => {
    if (!isDataLoaded || runningRef.current || document.visibilityState === 'hidden') return;
    runningRef.current = true;
    try {
      const now = Date.now();
      const [settings, records] = await Promise.all([DB.getTimeCapsuleSettings(), DB.getTimeCapsuleRecords()]);
      if (!isTimeCapsuleVisitDue(settings, now)) return;
      const validIds = settings.visitorCharIds.filter(id => characters.some(char => char.id === id));
      const capsules = records.filter((item): item is TimeCapsuleEntry => item.kind === 'capsule');
      const blockedIds = validIds.filter(charId => hasPendingAutoTimeCapsule(capsules, charId));
      const normalized = { ...settings, visitorCharIds: validIds, enabled: settings.enabled && validIds.length > 0 };
      const { charId, nextIndex } = nextTimeCapsuleVisitor(normalized, blockedIds);
      const char = characters.find(item => item.id === charId);
      try {
        if (char) {
          const capsule = await requestCharacterTimeCapsule({
            char, userProfile, groups, apiConfig, realtimeConfig, source: 'auto',
          });
          await DB.saveTimeCapsuleRecord(capsule);
        }
      } catch (error) {
        console.warn('[TimeCapsule] automatic visit failed:', error);
      } finally {
        await DB.saveTimeCapsuleRecord({ ...normalized, nextVisitorIndex: nextIndex, lastVisitAt: now });
        window.dispatchEvent(new Event(TIME_CAPSULE_UPDATED_EVENT));
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

export default TimeCapsuleRuntime;
