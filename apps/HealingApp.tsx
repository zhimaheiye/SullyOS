import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { X } from '@phosphor-icons/react';
import { useOS } from '../context/OSContext';
import { resolveFeatureApi } from '../utils/featureApi';
import type { CharacterProfile, HealingMemoryNode, HealingMessage, HealingSession } from '../types';
import HealingChat from '../components/healing/HealingChat';
import HealingHome from '../components/healing/HealingHome';
import HealingMemoryView from '../components/healing/HealingMemoryView';
import HealingTranscript from '../components/healing/HealingTranscript';
import { DB } from '../utils/db';
import { processImageToBlob } from '../utils/file';
import { putImageBlob } from '../utils/blobRef';
import { sendHealingMessage } from '../utils/healing/chatService';
import { flushPendingHealingSessions, processHealingMemoryBuffer } from '../utils/healing/memoryService';

type View = 'home' | 'chat' | 'transcripts' | 'memory';
type ReturnView = 'home' | 'chat' | 'memory';

const HealingApp: React.FC = () => {
  const {
    closeApp, registerBackHandler, characters, characterGroups, userProfile, apiConfig,
    memoryPalaceConfig, addToast,
  } = useOS();
  const [view, setView] = useState<View>('home');
  const [returnView, setReturnView] = useState<ReturnView>('home');
  const [sessions, setSessions] = useState<HealingSession[]>([]);
  const [memories, setMemories] = useState<HealingMemoryNode[]>([]);
  const [activeSession, setActiveSession] = useState<HealingSession | null>(null);
  const [messages, setMessages] = useState<HealingMessage[]>([]);
  const [selectedTranscript, setSelectedTranscript] = useState<HealingSession>();
  const [transcriptMessages, setTranscriptMessages] = useState<HealingMessage[]>([]);
  const [busy, setBusy] = useState(false);
  const [placeholder, setPlaceholder] = useState('');

  const charById = useMemo(() => new Map(characters.map(char => [char.id, char])), [characters]);
  const activeChar = activeSession ? charById.get(activeSession.charId) : undefined;
  const embeddingConfig = memoryPalaceConfig.embedding?.baseUrl ? memoryPalaceConfig.embedding : null;
  const extractionApi = resolveFeatureApi('healingMemory', { mainApi: apiConfig, memoryApi: memoryPalaceConfig.lightLLM }).api || apiConfig;

  const reloadIndex = useCallback(async () => {
    const [nextSessions, nextMemories] = await Promise.all([DB.getHealingSessions(), DB.getHealingMemoryNodes()]);
    setSessions(nextSessions);
    setMemories(nextMemories);
    return nextSessions;
  }, []);

  useEffect(() => {
    let alive = true;
    void reloadIndex().then(nextSessions => {
      if (!alive) return;
      void flushPendingHealingSessions({ sessions: nextSessions, apiConfig: extractionApi, embeddingConfig })
        .then(reloadIndex)
        .catch(() => undefined);
    }).catch(() => addToast('聊愈资料读取失败', 'error'));
    return () => { alive = false; };
  }, []); // 只在进入 App 时补处理意外关闭留下的尾巴

  const openSession = useCallback(async (char: CharacterProfile) => {
    const now = Date.now();
    const session: HealingSession = {
      id: `healing-session-${crypto.randomUUID?.() || now}`,
      charId: char.id,
      createdAt: now,
      updatedAt: now,
    };
    await DB.saveHealingSession(session);
    setSessions(current => [session, ...current]);
    setActiveSession(session);
    setMessages([]);
    setView('chat');
  }, []);

  const flushSession = useCallback((session: HealingSession) => {
    void processHealingMemoryBuffer({
      sessionId: session.id,
      apiConfig: extractionApi,
      embeddingConfig,
      force: true,
    }).then(reloadIndex).catch(error => console.warn('[Healing] 尾部记忆将在下次进入时补处理', error));
  }, [embeddingConfig, extractionApi, reloadIndex]);

  const leaveChat = useCallback(async () => {
    if (!activeSession) { setView('home'); return; }
    const ended = { ...activeSession, endedAt: activeSession.endedAt || Date.now() };
    await DB.saveHealingSession(ended);
    setSessions(current => [ended, ...current.filter(session => session.id !== ended.id)]);
    flushSession(ended);
    setActiveSession(null);
    setMessages([]);
    setView('home');
  }, [activeSession, flushSession]);

  const openMemory = (from: ReturnView) => { setReturnView(from); setView('memory'); };
  const openTranscripts = (from: ReturnView) => { setSelectedTranscript(undefined); setTranscriptMessages([]); setReturnView(from); setView('transcripts'); };

  const openTranscriptSession = useCallback(async (session: HealingSession) => {
    setSelectedTranscript(session);
    setTranscriptMessages(await DB.getHealingMessages(session.id));
  }, []);

  const panelBack = useCallback(() => {
    if (view === 'transcripts' && selectedTranscript) {
      setSelectedTranscript(undefined);
      setTranscriptMessages([]);
      return;
    }
    setView(returnView);
  }, [returnView, selectedTranscript, view]);

  const handleBack = useCallback(() => {
    if (placeholder) { setPlaceholder(''); return true; }
    if (view === 'home') { closeApp(); return true; }
    if (view === 'chat') { void leaveChat(); return true; }
    panelBack();
    return true;
  }, [closeApp, leaveChat, panelBack, placeholder, view]);

  useEffect(() => registerBackHandler(handleBack), [handleBack, registerBackHandler]);

  const persistUserTurn = async (type: 'text' | 'image', content: string) => {
    if (!activeSession || !activeChar || busy) return;
    setBusy(true);
    const timestamp = Date.now();
    try {
      const id = await DB.saveHealingMessage({
        sessionId: activeSession.id,
        charId: activeChar.id,
        role: 'user',
        type,
        content,
        timestamp,
      });
      const userMessage: HealingMessage = { id, sessionId: activeSession.id, charId: activeChar.id, role: 'user', type, content, timestamp };
      const nextSession = { ...activeSession, updatedAt: timestamp, endedAt: undefined };
      await DB.saveHealingSession(nextSession);
      setActiveSession(nextSession);
      setSessions(current => [nextSession, ...current.filter(session => session.id !== nextSession.id)]);
      const nextMessages = [...messages, userMessage];
      setMessages(nextMessages);
      const reply = await sendHealingMessage({
        session: nextSession,
        messages: nextMessages,
        char: activeChar,
        userProfile,
        apiConfig,
        embeddingConfig,
      });
      const repliedSession = { ...nextSession, updatedAt: reply.timestamp };
      setActiveSession(repliedSession);
      setSessions(current => [repliedSession, ...current.filter(session => session.id !== repliedSession.id)]);
      setMessages(current => [...current, reply]);
      void processHealingMemoryBuffer({ sessionId: nextSession.id, apiConfig: extractionApi, embeddingConfig })
        .then(reloadIndex)
        .catch(error => console.warn('[Healing] 缓冲记忆整理失败，稍后重试', error));
    } catch (error) {
      addToast(error instanceof Error ? error.message : '聊愈发送失败，请重试', 'error');
    } finally {
      setBusy(false);
    }
  };

  const sendImage = async (file: File) => {
    if (busy) return;
    try {
      const blob = await processImageToBlob(file, { maxWidth: 600, quality: 0.6, forceJpeg: true });
      const ref = await putImageBlob(blob);
      await persistUserTurn('image', ref);
    } catch (error) {
      addToast(error instanceof Error ? error.message : '图片处理失败', 'error');
    }
  };

  const deleteMemory = async (memory: HealingMemoryNode) => {
    await DB.deleteHealingMemory(memory.id);
    setMemories(current => current.filter(item => item.id !== memory.id));
  };

  const showMemorySource = async (memory: HealingMemoryNode) => {
    const session = sessions.find(item => item.id === memory.sourceSessionId) || (memory.sourceSessionId ? await DB.getHealingSession(memory.sourceSessionId) : undefined);
    if (!session) { addToast('对应疗愈手记已不存在', 'info'); return; }
    setReturnView('memory');
    setView('transcripts');
    await openTranscriptSession(session);
  };

  return <div className="absolute inset-0 overflow-hidden font-sans">
    {view === 'home' && <HealingHome characters={characters} groups={characterGroups} onSelect={char => void openSession(char)} onClose={closeApp} onMemory={() => openMemory('home')} onTranscripts={() => openTranscripts('home')} />}
    {view === 'chat' && activeChar && <HealingChat char={activeChar} userAvatar={userProfile.perCharAvatars?.[activeChar.id] || userProfile.avatar} messages={messages} busy={busy} onBack={() => void leaveChat()} onMemory={() => openMemory('chat')} onTranscripts={() => openTranscripts('chat')} onSendText={text => void persistUserTurn('text', text)} onSendImage={file => void sendImage(file)} onPlaceholder={setPlaceholder} />}
    {view === 'transcripts' && <HealingTranscript sessions={sessions} characters={characters} selected={selectedTranscript} messages={transcriptMessages} onSelect={session => void openTranscriptSession(session)} onBack={panelBack} />}
    {view === 'memory' && <HealingMemoryView memories={memories} characters={characters} onBack={panelBack} onDelete={memory => void deleteMemory(memory)} onSource={memory => void showMemorySource(memory)} onImport={() => setPlaceholder('记忆导入')} />}
    {placeholder && <div className="fixed inset-0 z-50 flex items-end bg-[#173a2c]/35 p-3 backdrop-blur-sm sm:items-center sm:justify-center" onMouseDown={event => { if (event.target === event.currentTarget) setPlaceholder(''); }}><section className="w-full max-w-sm rounded-[28px] bg-white p-6 text-center text-[#294638] shadow-2xl"><button onClick={() => setPlaceholder('')} className="ml-auto flex h-10 w-10 items-center justify-center rounded-full bg-emerald-50" aria-label="关闭"><X size={20} /></button><h2 className="mt-2 text-xl font-black">{placeholder}</h2><p className="mt-3 text-sm text-[#718076]">功能将在后续版本开放</p><button onClick={() => setPlaceholder('')} className="mt-6 h-11 w-full rounded-2xl bg-[#2e684d] font-bold text-white">知道了</button></section></div>}
  </div>;
};

export default HealingApp;
