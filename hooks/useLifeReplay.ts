import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOS } from '../context/OSContext';
import type { LifeReplayBlueprint, LifeReplayPreset, LifeReplayRecord, LifeReplaySession } from '../types';
import { DB } from '../utils/db';
import {
  createLifeReplayPreset, createLifeReplaySession, makeLifeReplayTurn, newestLifeReplayFirst,
} from '../utils/lifeReplay';
import {
  requestLifeReplayAnalysis, requestLifeReplayCharacterBeat, requestLifeReplayOutcome,
  requestLifeReplayWorldBeat,
} from '../utils/lifeReplayService';

export function useLifeReplay() {
  const { characters, groups, userProfile, apiConfig, realtimeConfig, addToast } = useOS();
  const [records, setRecords] = useState<LifeReplayRecord[]>([]);
  const [busy, setBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    void DB.getLifeReplayRecords()
      .then(items => setRecords(newestLifeReplayFirst(items)))
      .catch(() => addToast('人生重映档案读取失败', 'error'));
  }, [addToast]);

  const presets = useMemo(() => newestLifeReplayFirst(records.filter((item): item is LifeReplayPreset => item.kind === 'preset')), [records]);
  const sessions = useMemo(() => newestLifeReplayFirst(records.filter((item): item is LifeReplaySession => item.kind === 'session')), [records]);

  const persist = useCallback(async (record: LifeReplayRecord) => {
    const next = { ...record, updatedAt: Date.now() } as LifeReplayRecord;
    await DB.saveLifeReplayRecord(next);
    setRecords(current => newestLifeReplayFirst([next, ...current.filter(item => item.id !== next.id)]));
    return next;
  }, []);

  const remove = useCallback(async (id: string) => {
    await DB.deleteLifeReplayRecord(id);
    setRecords(current => current.filter(item => item.id !== id));
  }, []);

  const run = useCallback(async <T,>(label: string, task: () => Promise<T>): Promise<T> => {
    setBusy(true); setBusyLabel(label); setError('');
    try { return await task(); }
    catch (cause) {
      const message = cause instanceof Error ? cause.message : '操作失败，请重试。';
      setError(message);
      throw cause;
    } finally { setBusy(false); setBusyLabel(''); }
  }, []);

  const analyze = useCallback((sourceText: string, desiredChange: string, boundaries: string) => run(
    '正在把这段过去整理成可编辑场景',
    () => requestLifeReplayAnalysis({ sourceText, desiredChange, boundaries, userProfile, apiConfig }),
  ), [apiConfig, run, userProfile]);

  const savePreset = useCallback(async (sourceText: string, blueprint: LifeReplayBlueprint, existing?: LifeReplayPreset | null) => {
    const record: LifeReplayPreset = existing
      ? { ...existing, sourceText: sourceText.trim(), blueprint, updatedAt: Date.now() }
      : createLifeReplayPreset(sourceText, blueprint);
    return persist(record) as Promise<LifeReplayPreset>;
  }, [persist]);

  const startSession = useCallback((preset: LifeReplayPreset, charId: string) => run('正在与角色一起抵达过去', async () => {
    const char = characters.find(item => item.id === charId);
    if (!char) throw new Error('找不到选择的角色，请重新选择。');
    let session = createLifeReplaySession(preset, char.id);
    const character = await requestLifeReplayCharacterBeat({
      char, userProfile, groups, apiConfig, realtimeConfig, session, userAction: '', opening: true,
    });
    setBusyLabel('场景正在回应你们的到来');
    const world = await requestLifeReplayWorldBeat({
      apiConfig, session, userName: userProfile.name || '现在的我', charName: char.name,
      userAction: '', character, opening: true,
    });
    session = {
      ...session,
      turns: [makeLifeReplayTurn({ kind: 'opening', userAction: '', character, world })],
      sceneState: world.sceneState,
    };
    return persist(session) as Promise<LifeReplaySession>;
  }), [apiConfig, characters, groups, persist, realtimeConfig, run, userProfile]);

  const submitAction = useCallback((session: LifeReplaySession, userAction: string) => run('同行角色正在回应', async () => {
    const char = characters.find(item => item.id === session.charId);
    if (!char) throw new Error('这段重映关联的角色已经不存在。');
    const character = await requestLifeReplayCharacterBeat({
      char, userProfile, groups, apiConfig, realtimeConfig, session, userAction,
    });
    setBusyLabel('场景正在继续变化');
    const world = await requestLifeReplayWorldBeat({
      apiConfig, session, userName: userProfile.name || '现在的我', charName: char.name,
      userAction, character,
    });
    const next: LifeReplaySession = {
      ...session,
      turns: [...session.turns, makeLifeReplayTurn({ kind: 'interaction', userAction: userAction.trim(), character, world })],
      sceneState: world.sceneState,
    };
    return persist(next) as Promise<LifeReplaySession>;
  }), [apiConfig, characters, groups, persist, realtimeConfig, run, userProfile]);

  const completeSession = useCallback((session: LifeReplaySession) => run('正在整理这次重映的落点', async () => {
    const char = characters.find(item => item.id === session.charId);
    if (!char) throw new Error('这段重映关联的角色已经不存在。');
    const outcome = await requestLifeReplayOutcome({
      apiConfig, session, userName: userProfile.name || '现在的我', charName: char.name,
    });
    return persist({ ...session, status: 'completed', outcome }) as Promise<LifeReplaySession>;
  }), [apiConfig, characters, persist, run, userProfile]);

  return {
    characters, userProfile, presets, sessions, busy, busyLabel, error, setError,
    analyze, savePreset, startSession, submitAction, completeSession, remove,
  };
}
