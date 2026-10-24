import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DoorOpen, PaperPlaneTilt, Sparkle } from '@phosphor-icons/react';
import type { CharacterProfile, LifeReplaySession } from '../../types';
import TokenImg from '../os/TokenImg';
import { lifeReplayPassages, lifeReplayPortrait, type ReplayPassage } from '../../utils/lifeReplayPresentation';
import './LifeReplayScene.css';

type Mode = 'novel' | 'visual' | 'portrait';
const MODE_KEY = 'life_replay_reading_mode_v1';
const MODES: { id: Mode; label: string }[] = [
  { id: 'novel', label: '小说长篇' }, { id: 'visual', label: '视觉小说' }, { id: 'portrait', label: '见面立绘' },
];
const readMode = (): Mode => {
  try { const saved = localStorage.getItem(MODE_KEY); return MODES.find(item => item.id === saved)?.id || 'visual'; }
  catch { return 'visual'; }
};

const PortraitBackdrop: React.FC<{ char: CharacterProfile }> = ({ char }) => {
  const portrait = lifeReplayPortrait(char);
  const [failed, setFailed] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const [loadedValue, setLoadedValue] = useState('');
  useEffect(() => { setFailed(false); setAvatarFailed(false); }, [char.id, portrait.value]);
  const value = failed && !portrait.isAvatar ? char.avatar : portrait.value;
  const isAvatar = failed || portrait.isAvatar;
  useEffect(() => {
    if (!value || loadedValue === value) return;
    const timeout = window.setTimeout(() => {
      isAvatar ? setAvatarFailed(true) : setFailed(true);
    }, 5000);
    return () => window.clearTimeout(timeout);
  }, [char.id, value, isAvatar, loadedValue]);
  return <div className="replay-backdrop" aria-hidden="true">
    {value && !avatarFailed && <>
      {isAvatar && <TokenImg key={`${char.id}-blur-${value}`} value={value} className="replay-backdrop-blur" onError={() => setAvatarFailed(true)} />}
      <TokenImg key={`${char.id}-${value}`} value={value} className={isAvatar ? 'replay-avatar-image' : 'replay-sprite-image'} onLoad={() => setLoadedValue(value)} onError={() => isAvatar ? setAvatarFailed(true) : setFailed(true)} />
    </>}
    <div className="replay-backdrop-shade" />
  </div>;
};

const ChoicePanel: React.FC<{
  suggestions: string[]; busy: boolean; onChoose: (value: string) => void; onOpenFree: () => void; compact?: boolean;
}> = ({ suggestions, busy, onChoose, onOpenFree, compact }) => (
  <div className={compact ? 'replay-choice-panel replay-choice-panel-compact' : 'replay-choice-panel'} data-testid="replay-choices">
    {suggestions.slice(0, 3).map((item, index) =>
      <button key={`${index}-${item}`} type="button" disabled={busy} onClick={() => onChoose(item)} className="replay-choice" data-testid="replay-choice">{item}</button>)}
    <button type="button" disabled={busy} className="replay-free-trigger" onClick={onOpenFree}>自由输入 / 自定义行动</button>
  </div>
);

const ActionEditor: React.FC<{
  draft: string; setDraft: (value: string) => void; busy: boolean; error: string; focusRequest: number; onSend: () => void; onCancel: () => void;
}> = ({ draft, setDraft, busy, error, focusRequest, onSend, onCancel }) => {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, [focusRequest]);
  return <div className="replay-action-editor" data-testid="replay-action-editor">
    <label htmlFor="replay-action">确认或改写这次行动</label>
    <textarea id="replay-action" ref={inputRef} value={draft} onChange={event => setDraft(event.target.value)} rows={3} disabled={busy} placeholder="说一句话，或描述你要做什么……" />
    {error && <p className="replay-editor-error" role="alert">{error}</p>}
    <div className="replay-writing-actions">
      <button type="button" disabled={busy} onClick={onCancel}>取消编辑／返回阅读</button>
      <button type="button" disabled={busy || !draft.trim()} onClick={onSend}>发送行动 <PaperPlaneTilt size={15} /></button>
    </div>
  </div>;
};

const NovelReader: React.FC<{
  session: LifeReplaySession; passages: ReplayPassage[]; busy: boolean; busyLabel: string; error: string;
  choices: React.ReactNode; editor: React.ReactNode; onComplete: () => void;
}> = ({ session, passages, busy, busyLabel, error, choices, editor, onComplete }) => {
  const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { if (session.turns.length > 1) endRef.current?.scrollIntoView({ block: 'end' }); }, [session.turns.length]);
  return <div className="replay-novel-scroll" data-testid="replay-novel-scroll">
    <article className="replay-novel-page">
      <header><p>{session.blueprint.period || '过去'} · {session.blueprint.location || '记忆中的现场'}</p><h2>{session.presetTitle}</h2><span>这是一场私密的叙事模拟，已经发生的事实不会改变。</span></header>
      {session.turns.map((turn, index) => <section key={turn.id} className="replay-novel-turn">
        <h3>{turn.kind === 'opening' ? '抵达' : `第 ${index} 幕`}</h3>
        {passages.filter(item => item.turnId === turn.id).map(item => <p key={item.id} className={`replay-novel-passage replay-kind-${item.kind}`}><strong>{item.label}</strong><span>{item.text}</span></p>)}
      </section>)}
      {busy && <p className="replay-feedback">{busyLabel}</p>}
      {error && <p className="replay-error" role="alert">{error}</p>}
      {session.status === 'active' && <div className="replay-novel-actions"><h3>接下来，你想怎么做？</h3>{choices}{editor}<button type="button" disabled={busy || !session.turns.length} onClick={onComplete} className="replay-end"><DoorOpen size={16} />让这次重映停在这里</button></div>}
      <div ref={endRef} />
    </article>
  </div>;
};

const VisualNovelStage: React.FC<{
  session: LifeReplaySession; char: CharacterProfile; passages: ReplayPassage[]; cursor: number; setCursor: (value: number) => void;
  portrait: boolean; busy: boolean; busyLabel: string; error: string; choices: React.ReactNode; editor: React.ReactNode; editing: boolean; keyboardInset: number; onComplete: () => void;
}> = ({ session, char, passages, cursor, setCursor, portrait, busy, busyLabel, error, choices, editor, editing, keyboardInset, onComplete }) => {
  const passage = passages[cursor];
  const atEnd = cursor >= passages.length - 1;
  return <div className={`replay-stage ${portrait ? 'replay-stage-portrait' : ''} ${editing ? 'replay-stage-editing' : ''} ${keyboardInset > 80 ? 'replay-stage-keyboard' : ''}`} data-testid="replay-stage" style={{ '--replay-keyboard-inset': `${keyboardInset}px` } as React.CSSProperties}>
    {portrait && <PortraitBackdrop key={char.id} char={char} />}
    <div className="replay-stage-content">
      <div className="replay-stage-tools">
        <button type="button" disabled={cursor <= 0} onClick={() => setCursor(cursor - 1)}>上一段</button>
        <span>{passages.length ? `${cursor + 1} / ${passages.length}` : '现场'}</span>
        <button type="button" disabled={atEnd} onClick={() => setCursor(cursor + 1)}>下一段</button>
        {session.status === 'active' && <button type="button" disabled={busy || !session.turns.length} onClick={onComplete}>结束重映</button>}
      </div>
      <div className="replay-stage-middle" data-testid="replay-choice-region">
        {atEnd && session.status === 'active' && !busy && choices}
        {atEnd && busy && <p className="replay-stage-wait">{busyLabel}</p>}
        {atEnd && error && !editing && <p className="replay-stage-error" role="alert">{error}</p>}
      </div>
      {atEnd && session.status === 'active' && editor}
      <div className="replay-dialogue" data-testid="replay-dialogue">
        <div className="replay-dialogue-head"><strong>{passage?.label || '现场'}</strong><span>{atEnd ? '当前节点' : '点击空白处继续'}</span></div>
        <div className="replay-dialogue-scroll" onClick={event => {
          if (window.getSelection()?.toString()) return;
          const target = event.target as HTMLElement;
          if (target.closest('button, textarea')) return;
          if (!atEnd && target.scrollTop + target.clientHeight >= target.scrollHeight - 2) setCursor(cursor + 1);
        }}>
          <p>{passage?.text || '现场尚无记录。'}</p>
        </div>
        {!atEnd && <button type="button" className="replay-dialogue-next" onClick={() => setCursor(cursor + 1)}>继续 ›</button>}
      </div>
    </div>
  </div>;
};

export const LifeReplayScene: React.FC<{
  session: LifeReplaySession; char: CharacterProfile; userName: string; busy: boolean; busyLabel: string; error: string;
  onSubmit: (value: string) => Promise<void>; onComplete: () => Promise<void>;
}> = ({ session, char, userName, busy, busyLabel, error, onSubmit, onComplete }) => {
  const [mode, setMode] = useState<Mode>(readMode);
  const [draft, setDraft] = useState('');
  const [editing, setEditing] = useState(false);
  const [focusRequest, setFocusRequest] = useState(0);
  const [pending, setPending] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [keyboardInset, setKeyboardInset] = useState(0);
  const passages = useMemo(() => lifeReplayPassages(session, char.name, userName), [session, char.name, userName]);
  const [cursor, setCursor] = useState(() => session.turns.length > 1 ? Math.max(0, passages.length - 1) : 0);
  const previousTurnCount = useRef(session.turns.length);
  const submitting = useRef(false);
  useEffect(() => {
    if (session.turns.length > previousTurnCount.current) {
      const newestId = session.turns[session.turns.length - 1]?.id;
      setCursor(Math.max(0, passages.findIndex(item => item.turnId === newestId)));
      setDraft('');
      setEditing(false);
      submitting.current = false;
      setPending(false);
      setSubmitError('');
    }
    previousTurnCount.current = session.turns.length;
  }, [session.turns, passages]);
  useEffect(() => {
    if (!editing || mode === 'novel') { setKeyboardInset(0); return; }
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => setKeyboardInset(Math.max(0, Math.round(window.innerHeight - viewport.height - viewport.offsetTop)));
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => { viewport.removeEventListener('resize', update); viewport.removeEventListener('scroll', update); };
  }, [editing, mode]);
  const chooseMode = (next: Mode) => { setMode(next); try { localStorage.setItem(MODE_KEY, next); } catch { /* optional preference */ } };
  const submit = async (value: string) => {
    const action = value.trim();
    if (!action || busy || submitting.current || session.status !== 'active') return;
    submitting.current = true;
    setPending(true);
    setSubmitError('');
    try { await onSubmit(action); }
    catch (cause) {
      submitting.current = false;
      setPending(false);
      setSubmitError(cause instanceof Error ? cause.message : '行动发送失败，请重试。');
    }
  };
  const isBusy = busy || pending;
  const progressLabel = busyLabel || '正在推进下一幕…';
  const visibleError = error || submitError;
  const openEditor = (value?: string) => { if (value !== undefined) setDraft(value); setEditing(true); setFocusRequest(count => count + 1); };
  const choices = <ChoicePanel suggestions={session.turns.at(-1)?.world.suggestedActions || []} busy={isBusy} onChoose={openEditor} onOpenFree={() => openEditor()} compact={mode !== 'novel'} />;
  const editor = editing && <ActionEditor draft={draft} setDraft={setDraft} busy={isBusy} error={mode === 'novel' ? '' : visibleError} focusRequest={focusRequest} onSend={() => void submit(draft)} onCancel={() => setEditing(false)} />;
  return <div className="replay-scene" data-mode={mode}>
    <nav className="replay-mode-switch" aria-label="阅读模式">{MODES.map(item => <button key={item.id} type="button" aria-pressed={mode === item.id} onClick={() => chooseMode(item.id)}>{item.label}</button>)}</nav>
    {mode === 'novel'
      ? <NovelReader session={session} passages={passages} busy={isBusy} busyLabel={progressLabel} error={visibleError} choices={choices} editor={editor} onComplete={() => { void onComplete().catch(() => undefined); }} />
      : <VisualNovelStage session={session} char={char} passages={passages} cursor={cursor} setCursor={setCursor} portrait={mode === 'portrait'} busy={isBusy} busyLabel={progressLabel} error={visibleError} choices={choices} editor={editor} editing={editing} keyboardInset={keyboardInset} onComplete={() => { void onComplete().catch(() => undefined); }} />}
    {session.status === 'completed' && session.outcome && <div className="replay-outcome"><div className="replay-outcome-title"><Sparkle size={20} />这次重映停在这里</div><p>{session.outcome.summary}</p>{session.outcome.changedTrajectory && <p><strong>模拟中的走向变化</strong>{session.outcome.changedTrajectory}</p>}{session.outcome.closingImage && <p><strong>最后的画面</strong>{session.outcome.closingImage}</p>}<small>这份结果只保存在人生重映中，没有写入聊天或长期记忆。</small></div>}
  </div>;
};
