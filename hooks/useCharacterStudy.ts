import { useCallback, useEffect, useState } from 'react';
import type { APIConfig, CharacterProfile, CharacterStudySession, UserProfile } from '../types';
import { appendCharacterStudyNotes, createCharacterStudySession, parseCharacterStudyOpening, parseCharacterStudyReply } from '../utils/characterStudy';
import { requestCharacterStudyOpening, requestCharacterStudyReply } from '../utils/characterStudyService';
import { DB } from '../utils/db';

export function useCharacterStudy(input: { apiConfig: APIConfig; userProfile: UserProfile }) {
  const [sessions, setSessions] = useState<CharacterStudySession[]>([]);
  const [activeSession, setActiveSession] = useState<CharacterStudySession | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => setSessions(await DB.getCharacterStudySessions()), []);
  useEffect(() => { void load(); }, [load]);

  const persist = useCallback(async (session: CharacterStudySession) => {
    await DB.saveCharacterStudySession(session);
    setActiveSession(session);
    setSessions(current => [session, ...current.filter(item => item.id !== session.id)]);
    return session;
  }, []);

  const start = useCallback(async (char: CharacterProfile, topic: string) => {
    setBusy(true);
    try {
      const raw = await requestCharacterStudyOpening({ char, topic, ...input });
      return await persist(createCharacterStudySession({ charId: char.id, topic, opening: parseCharacterStudyOpening(raw) }));
    } finally {
      setBusy(false);
    }
  }, [input, persist]);

  const teach = useCallback(async (char: CharacterProfile, userText: string, questionAllowed: boolean) => {
    if (!activeSession) throw new Error('课堂尚未开始');
    setBusy(true);
    try {
      const raw = await requestCharacterStudyReply({ char, userText, questionAllowed, session: activeSession, ...input });
      const reply = parseCharacterStudyReply(raw, questionAllowed);
      const now = Date.now();
      return await persist({
        ...activeSession,
        notesMarkdown: appendCharacterStudyNotes(activeSession.notesMarkdown, reply.notePatch),
        turns: [...activeSession.turns, {
          id: `turn-${now}-${Math.random().toString(36).slice(2, 7)}`,
          userText: userText.trim(),
          charResponse: reply.response,
          beginnerThinking: reply.beginnerThinking,
          question: reply.question,
          questionAllowed,
          notePatch: reply.notePatch,
          createdAt: now,
        }],
        updatedAt: now,
      });
    } finally {
      setBusy(false);
    }
  }, [activeSession, input, persist]);

  const open = useCallback((session: CharacterStudySession) => setActiveSession(session), []);
  const close = useCallback(() => setActiveSession(null), []);
  const finish = useCallback(async () => {
    if (!activeSession) return;
    await persist({ ...activeSession, status: 'completed', updatedAt: Date.now() });
  }, [activeSession, persist]);
  const remove = useCallback(async (id: string) => {
    await DB.deleteCharacterStudySession(id);
    setSessions(current => current.filter(item => item.id !== id));
    setActiveSession(current => current?.id === id ? null : current);
  }, []);

  return { sessions, activeSession, busy, start, teach, open, close, finish, remove };
}
