import { useCallback, useEffect, useState } from 'react';
import { useOS } from '../context/OSContext';
import type { CommunityCommitteeOpeningAnalysis, CommunityCommitteeSession } from '../types';
import { DB } from '../utils/db';
import {
  createCommunityCommitteeSession,
  getPendingCommitteeCharIds,
  makeCommunityCommitteeTurn,
  newestCommunityCommitteeFirst,
} from '../utils/communityCommittee';
import {
  persistCommunityCommitteeShare,
  requestCommunityCommitteeCharacter,
  requestCommunityCommitteeOpeningAnalysis,
  requestCommunityCommitteeSummary,
} from '../utils/communityCommitteeService';

export function useCommunityCommittee() {
  const {
    characters, groups, userProfile, apiConfig, realtimeConfig, memoryPalaceConfig,
    updateCharacter, addToast,
  } = useOS();
  const [sessions, setSessions] = useState<CommunityCommitteeSession[]>([]);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void DB.getCommunityCommitteeSessions()
      .then(items => setSessions(newestCommunityCommitteeFirst(items)))
      .catch(() => addToast('居委会记录读取失败', 'error'));
  }, [addToast]);

  const persist = useCallback(async (session: CommunityCommitteeSession) => {
    const next = { ...session, updatedAt: Date.now() };
    await DB.saveCommunityCommitteeSession(next);
    setSessions(current => newestCommunityCommitteeFirst([next, ...current.filter(item => item.id !== next.id)]));
    return next;
  }, []);

  const remove = useCallback(async (id: string) => {
    await DB.deleteCommunityCommitteeSession(id);
    setSessions(current => current.filter(item => item.id !== id));
  }, []);

  const run = useCallback(async <T,>(label: string, task: () => Promise<T>): Promise<T> => {
    setBusy(true);
    setBusyLabel(label);
    setError('');
    try {
      return await task();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '操作失败，请重试。';
      setError(message);
      throw cause;
    } finally {
      setBusy(false);
      setBusyLabel('');
    }
  }, []);

  const analyzeOpening = useCallback((openingText: string) => run(
    'AI 正在梳理这段话里的两股力量',
    () => requestCommunityCommitteeOpeningAnalysis({ apiConfig, openingText }),
  ), [apiConfig, run]);

  const respondPending = useCallback(async (session: CommunityCommitteeSession) => {
    let next = session;
    for (const charId of getPendingCommitteeCharIds(next)) {
      const char = characters.find(item => item.id === charId);
      if (!char) continue;
      setBusyLabel(`${char.name} 正在认真听这一层`);
      const content = await requestCommunityCommitteeCharacter({
        char, userProfile, groups, apiConfig, realtimeConfig, session: next,
      });
      next = await persist({
        ...next,
        turns: [...next.turns, makeCommunityCommitteeTurn({
          speakerType: 'character', charId: char.id, speakerName: char.name, content,
        })],
      });
    }
    return next;
  }, [apiConfig, characters, groups, persist, realtimeConfig, userProfile]);

  const pendingExistingCharIds = useCallback((session: CommunityCommitteeSession) =>
    getPendingCommitteeCharIds(session).filter(charId => characters.some(char => char.id === charId)),
  [characters]);

  const startSession = useCallback((input: {
    analysis: CommunityCommitteeOpeningAnalysis;
    charIds: string[];
  }) => run('正在把你的原话说给大家听', async () => {
    const session = await persist(createCommunityCommitteeSession({
      topic: input.analysis.topic,
      sideA: input.analysis.sideA,
      sideB: input.analysis.sideB,
      openingText: input.analysis.openingText,
      openingSegments: input.analysis.segments,
      speakerName: userProfile.name || '我',
      charIds: input.charIds,
    }));
    try {
      return await respondPending(session);
    } catch (cause) {
      setError(`你的原话已经保存，但有人还没来得及回应：${cause instanceof Error ? cause.message : '请稍后继续。'}`);
      return session;
    }
  }), [persist, respondPending, run, userProfile.name]);

  const submitLayer = useCallback((session: CommunityCommitteeSession, content: string) => run(
    '大家正在听你把这一层说完',
    async () => {
      if (session.stage !== 'peeling') throw new Error('这次讨论已经结束。');
      if (!content.trim()) throw new Error('先写下这一层真正想说的话。');
      if (pendingExistingCharIds(session).length) throw new Error('这一轮还有角色尚未回应，请先继续听完。');
      const withUser = await persist({
        ...session,
        turns: [...session.turns, makeCommunityCommitteeTurn({
          speakerType: 'user', speakerName: userProfile.name || '我', content,
        })],
      });
      try {
        return await respondPending(withUser);
      } catch (cause) {
        setError(`这一层已经保存，但有人还没来得及回应：${cause instanceof Error ? cause.message : '请稍后继续。'}`);
        return withUser;
      }
    },
  ), [pendingExistingCharIds, persist, respondPending, run, userProfile.name]);

  const retryPending = useCallback((session: CommunityCommitteeSession) => run(
    '正在请还没说完的人继续',
    async () => {
      if (!pendingExistingCharIds(session).length) return session;
      return respondPending(session);
    },
  ), [pendingExistingCharIds, respondPending, run]);

  const shareReport = useCallback(async (session: CommunityCommitteeSession) => {
    let next = session;
    const participantNames = next.charIds
      .map(charId => characters.find(char => char.id === charId)?.name)
      .filter((name): name is string => Boolean(name));
    let sharedMessageIds = { ...(next.sharedMessageIds || {}) };
    for (const charId of next.charIds) {
      if (sharedMessageIds[charId]) continue;
      const char = characters.find(item => item.id === charId);
      if (!char) continue;
      setBusyLabel(`正在把总结交给 ${char.name}`);
      const { messageId, memories } = await persistCommunityCommitteeShare({
        char, session: next, participantNames, userProfile, groups, realtimeConfig,
        apiConfig, memoryPalaceConfig,
      });
      sharedMessageIds = { ...sharedMessageIds, [charId]: messageId };
      updateCharacter(charId, { memories });
      next = await persist({ ...next, sharedMessageIds });
    }
    return next;
  }, [apiConfig, characters, groups, memoryPalaceConfig, persist, realtimeConfig, updateCharacter, userProfile]);

  const completeSession = useCallback((session: CommunityCommitteeSession) => run(
    '议事记录员正在整理这次倾诉',
    async () => {
      if (!session.turns.some(turn => turn.speakerType === 'user')) {
        throw new Error('至少先说出一层感受，再结束这次倾诉。');
      }
      if (pendingExistingCharIds(session).length) {
        throw new Error('这一轮还有角色尚未回应，请先继续听完。');
      }
      let next = session;
      if (!next.report) {
        const report = await requestCommunityCommitteeSummary({
          apiConfig, session: next, userName: userProfile.name || '用户',
        });
        next = await persist({
          ...next, stage: 'summary', report, reportGeneratedAt: Date.now(),
        });
      }
      try {
        next = await shareReport(next);
      } catch (cause) {
        setError(`总结已经保存在本机，但有角色尚未收到：${cause instanceof Error ? cause.message : '请稍后重试。'}`);
      }
      return next;
    },
  ), [apiConfig, pendingExistingCharIds, persist, run, shareReport, userProfile.name]);

  const retryShare = useCallback((session: CommunityCommitteeSession) => run(
    '正在继续写回聊天与记忆',
    () => shareReport(session),
  ), [run, shareReport]);

  return {
    characters,
    userProfile,
    sessions,
    busy,
    busyLabel,
    error,
    setError,
    analyzeOpening,
    startSession,
    submitLayer,
    retryPending,
    completeSession,
    retryShare,
    remove,
  };
}
