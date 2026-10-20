import React, { useEffect, useRef, useState } from 'react';
import { DoorOpen, PaperPlaneTilt, Sparkle } from '@phosphor-icons/react';
import type { CharacterProfile, LifeReplaySession } from '../../types';

const Avatar: React.FC<{ char: CharacterProfile }> = ({ char }) => (
  <div className="h-10 w-10 shrink-0 overflow-hidden rounded-full bg-indigo-100 ring-2 ring-white/80">
    {char.avatar ? <img src={char.avatar} alt={char.name} className="h-full w-full object-cover" /> : <div className="flex h-full w-full items-center justify-center font-black text-indigo-700">{char.name.slice(0, 1)}</div>}
  </div>
);

export const LifeReplayScene: React.FC<{
  session: LifeReplaySession;
  char: CharacterProfile;
  userName: string;
  busy: boolean;
  busyLabel: string;
  error: string;
  onSubmit: (value: string) => Promise<void>;
  onComplete: () => Promise<void>;
}> = ({ session, char, userName, busy, busyLabel, error, onSubmit, onComplete }) => {
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const suggestions = session.turns[session.turns.length - 1]?.world.suggestedActions || [];

  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }); }, [busy, session.turns.length]);

  const send = async () => {
    const value = draft.trim();
    if (!value || busy) return;
    try {
      await onSubmit(value);
      setDraft('');
    } catch { /* 保留输入和现场错误，允许原样重试 */ }
  };

  if (session.status === 'completed' && session.outcome) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-8">
        <div className="rounded-2xl bg-[#151a35] p-6 text-white shadow-[0_18px_50px_rgba(21,26,53,0.24)]">
          <div className="flex items-center gap-3"><Sparkle size={24} weight="fill" className="text-rose-300" /><h2 className="text-xl font-black tracking-[-0.02em]">这次重映停在这里</h2></div>
          <p className="mt-5 whitespace-pre-wrap text-sm leading-7 text-indigo-50">{session.outcome.summary}</p>
          {session.outcome.changedTrajectory && <div className="mt-6 border-t border-white/15 pt-5"><h3 className="text-xs font-bold text-rose-200">模拟中的走向变化</h3><p className="mt-2 whitespace-pre-wrap text-sm leading-7 text-white/85">{session.outcome.changedTrajectory}</p></div>}
          {session.outcome.closingImage && <div className="mt-6 border-t border-white/15 pt-5"><h3 className="text-xs font-bold text-rose-200">最后的画面</h3><p className="mt-2 whitespace-pre-wrap text-sm italic leading-7 text-white/85">{session.outcome.closingImage}</p></div>}
        </div>
        <p className="mt-5 px-2 text-center text-xs leading-5 text-slate-500">这份结果只保存在人生重映中，没有写入聊天或长期记忆。</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-8 pt-5">
        <div className="mx-auto max-w-2xl">
          <div className="mb-7 rounded-2xl bg-[#151a35] p-5 text-white shadow-[0_16px_45px_rgba(21,26,53,0.2)]">
            <div className="text-sm font-black">{session.blueprint.period || '过去'} · {session.blueprint.location || '记忆中的现场'}</div>
            <p className="mt-2 text-xs leading-5 text-indigo-100">现在的你与 {char.name} 在场；“{session.blueprint.pastSelf.label}”是独立的过去视角。</p>
          </div>

          <div className="space-y-8">
            {session.turns.map(turn => (
              <article key={turn.id} className="space-y-4">
                {turn.kind === 'interaction' && turn.userAction && (
                  <div className="ml-auto max-w-[88%] rounded-2xl rounded-br-md bg-indigo-600 px-4 py-3 text-sm leading-6 text-white shadow-[0_7px_20px_rgba(79,70,229,0.22)]">
                    <div className="mb-1 text-[11px] font-bold text-indigo-100">{userName || '现在的我'}</div>{turn.userAction}
                  </div>
                )}

                <div className="flex items-start gap-3">
                  <Avatar char={char} />
                  <div className="min-w-0 flex-1">
                    <div className="rounded-2xl rounded-tl-md bg-white px-4 py-3 shadow-[0_7px_22px_rgba(30,41,59,0.08)]">
                      <div className="text-xs font-black text-slate-800">{char.name}</div>
                      {turn.character.perception && <p className="mt-2 text-xs italic leading-5 text-slate-500">{turn.character.perception}</p>}
                      {turn.character.action && <p className="mt-2 text-sm leading-6 text-slate-700">{turn.character.action}</p>}
                      {turn.character.speech && <p className="mt-2 text-sm font-semibold leading-6 text-slate-900">“{turn.character.speech}”</p>}
                    </div>
                  </div>
                </div>

                <div className="mx-auto max-w-[94%] border-y border-slate-200 py-4">
                  {turn.world.narrative && <p className="whitespace-pre-wrap text-sm leading-7 text-slate-600">{turn.world.narrative}</p>}
                  {(turn.world.pastSelfReaction || turn.world.pastSelfSpeech) && (
                    <div className="mt-4 rounded-2xl bg-rose-50 px-4 py-3 text-rose-950">
                      <div className="text-xs font-black text-rose-700">{session.blueprint.pastSelf.label}</div>
                      {turn.world.pastSelfReaction && <p className="mt-2 text-sm leading-6">{turn.world.pastSelfReaction}</p>}
                      {turn.world.pastSelfSpeech && <p className="mt-2 text-sm font-semibold leading-6">“{turn.world.pastSelfSpeech}”</p>}
                    </div>
                  )}
                  {turn.world.npcBeats.map((npc, index) => (
                    <div key={`${npc.npcId}-${index}`} className="mt-3 px-1">
                      <div className="text-xs font-black text-slate-700">{npc.name}</div>
                      <p className="mt-1 text-sm leading-6 text-slate-600">{npc.action}{npc.speech ? ` “${npc.speech}”` : ''}</p>
                    </div>
                  ))}
                  {turn.world.directionChange && <p className="mt-4 text-xs leading-5 text-indigo-600">走向变化：{turn.world.directionChange}</p>}
                </div>
              </article>
            ))}
          </div>

          {busy && <div className="mt-6 flex items-center gap-3 rounded-2xl bg-indigo-50 px-4 py-3 text-sm font-semibold text-indigo-800"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-indigo-500" />{busyLabel}</div>}
          {error && <div className="mt-5 rounded-2xl bg-rose-50 px-4 py-3 text-sm leading-6 text-rose-800">{error}</div>}
          <div ref={endRef} />
        </div>
      </div>

      <div className="shrink-0 border-t border-slate-200 bg-[#f7f6fb] px-4 pb-[calc(var(--safe-bottom)+12px)] pt-3">
        <div className="mx-auto max-w-2xl">
          {suggestions.length > 0 && <div className="mb-2 flex gap-2 overflow-x-auto pb-1 no-scrollbar">{suggestions.map(item => <button key={item} disabled={busy} onClick={() => setDraft(item)} className="shrink-0 rounded-full bg-white px-3 py-2 text-xs font-semibold text-indigo-700 shadow-[0_4px_14px_rgba(30,41,59,0.07)] disabled:opacity-50">{item}</button>)}</div>}
          <div className="flex items-end gap-2">
            <textarea value={draft} onChange={event => setDraft(event.target.value)} rows={2} placeholder="说一句话，或描述你要做什么……" disabled={busy} className="min-h-14 flex-1 resize-none rounded-2xl bg-white px-4 py-3 text-sm leading-5 text-slate-900 shadow-[0_5px_18px_rgba(30,41,59,0.08)] outline-none placeholder:text-slate-400 focus:ring-2 focus:ring-indigo-400 disabled:opacity-60" />
            <button onClick={() => void send()} disabled={busy || !draft.trim()} className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-[0_8px_22px_rgba(79,70,229,0.25)] disabled:bg-slate-300 disabled:shadow-none" aria-label="送出行动"><PaperPlaneTilt size={23} weight="fill" /></button>
          </div>
          <button onClick={() => { void onComplete().catch(() => undefined); }} disabled={busy || session.turns.length === 0} className="mt-2 flex h-10 w-full items-center justify-center gap-2 rounded-xl text-xs font-bold text-slate-500 hover:bg-white disabled:opacity-40"><DoorOpen size={17} />让这次重映停在这里</button>
        </div>
      </div>
    </div>
  );
};
