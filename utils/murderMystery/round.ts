import type { APIConfig, CharacterProfile, UserProfile } from '../../types';
import { DB } from '../db';
import { requestMysteryPublicDecision, type MysteryPublicDecision } from './service';
import type { MurderMysteryEvent, MurderMysterySession } from './session';

const MAX_PUBLIC_REPLIES = 12;
const MAX_REPLIES_PER_PLAYER = 3;

export function chooseMysterySpeaker(input: {
  session: MurderMysterySession; events: MurderMysteryEvent[]; characters: CharacterProfile[];
  attemptedAt: Record<string, number>; replyCounts: Record<string, number>;
}): CharacterProfile | null {
  const { session, events, characters, attemptedAt, replyCounts } = input;
  const latest = [...events].reverse().find(event => event.channel === 'public_table');
  if (!latest) return null;
  const at = latest.revision;
  const candidates = characters.filter(char => Object.values(session.seats).includes(char.id)
    && char.id !== latest.speakerCharId
    && attemptedAt[char.id] !== at
    && !(session.activeEffects || []).some(effect => effect.targetSeatId === Object.entries(session.seats).find(([, id]) => id === char.id)?.[0] && effect.blocksPublicSpeech && effect.remainingRounds > 0)
    && (replyCounts[char.id] || 0) < MAX_REPLIES_PER_PLAYER);
  candidates.sort((a, b) => {
    const seatA = session.scriptSnapshot.seats.find(seat => session.seats[seat.id] === a.id)?.name || '';
    const seatB = session.scriptSnapshot.seats.find(seat => session.seats[seat.id] === b.id)?.name || '';
    const named = (name: string) => !!name && (latest.content.includes(name) || name.length > 2 && latest.content.includes(name.slice(0, 2)));
    const mention = (char: CharacterProfile, seat: string) => Number(named(char.name) || named(seat));
    return mention(b, seatB) - mention(a, seatA)
      || (replyCounts[a.id] || 0) - (replyCounts[b.id] || 0)
      || Object.values(session.seats).indexOf(a.id) - Object.values(session.seats).indexOf(b.id);
  });
  return candidates[0] || null;
}

export async function runMurderMysteryRound(input: {
  sessionId: string; characters: CharacterProfile[]; user: UserProfile; apiConfig: APIConfig;
  signal: AbortSignal;
  onCommit?: (session: MurderMysterySession, events: MurderMysteryEvent[]) => void;
  onFailure?: (char: CharacterProfile, error: unknown) => void;
  request?: typeof requestMysteryPublicDecision;
}): Promise<{ replies: number; failures: number; stopped: 'exhausted' | 'cancelled' | 'stale' | 'limit' }> {
  const attemptedAt: Record<string, number> = {};
  const replyCounts: Record<string, number> = {};
  const seen = new Set<string>();
  let replies = 0;
  let failures = 0;
  const request = input.request || requestMysteryPublicDecision;
  while (replies < MAX_PUBLIC_REPLIES) {
    if (input.signal.aborted) return { replies, failures, stopped: 'cancelled' };
    const session = await DB.getMurderMysterySession(input.sessionId);
    if (!session || session.status === 'ended') return { replies, failures, stopped: 'stale' };
    const events = await DB.getMurderMysteryEvents(input.sessionId);
    const char = chooseMysterySpeaker({ session, events, characters: input.characters, attemptedAt, replyCounts });
    if (!char) return { replies, failures, stopped: 'exhausted' };
    const publicRevision = [...events].reverse().find(event => event.channel === 'public_table')!.revision;
    attemptedAt[char.id] = publicRevision;
    let decision: MysteryPublicDecision;
    try { decision = await request({ session, events, char, user: input.user, apiConfig: input.apiConfig, signal: input.signal }); }
    catch (error) {
      if (input.signal.aborted) return { replies, failures, stopped: 'cancelled' };
      failures++; input.onFailure?.(char, error); continue;
    }
    if (input.signal.aborted) return { replies, failures, stopped: 'cancelled' };
    if (decision.decision === 'private_request') {
      try {
        const next = await DB.appendMurderMysteryEvent(session.id, session.revision, {
          channel: 'host_system', audienceIds: [], speakerCharId: char.id,
          seatId: Object.entries(session.seats).find(([, id]) => id === char.id)?.[0],
          targetSeatId: decision.targetSeatId, speechMode: 'out_of_character',
          content: decision.purpose || '申请秘密交流', action: 'private_request',
        });
        input.onCommit?.(next, await DB.getMurderMysteryEvents(session.id));
      } catch { return { replies, failures, stopped: 'stale' }; }
      continue;
    }
    if (decision.decision === 'skip') continue;
    const normalized = decision.content.replace(/\s+/g, '').toLowerCase();
    if (!normalized || seen.has(normalized) || events.slice(-20).some(event => event.channel === 'public_table' && event.content.replace(/\s+/g, '').toLowerCase() === normalized)) continue;
    seen.add(normalized);
    try {
      const next = await DB.appendMurderMysteryEvent(session.id, session.revision, {
        channel: 'public_table', audienceIds: Object.values(session.seats), speakerCharId: char.id,
        seatId: Object.entries(session.seats).find(([, id]) => id === char.id)?.[0],
        speechMode: decision.speechMode, content: decision.content, action: 'public_speech',
      });
      replies++; replyCounts[char.id] = (replyCounts[char.id] || 0) + 1;
      input.onCommit?.(next, await DB.getMurderMysteryEvents(session.id));
    } catch {
      return { replies, failures, stopped: 'stale' };
    }
  }
  return { replies, failures, stopped: 'limit' };
}
