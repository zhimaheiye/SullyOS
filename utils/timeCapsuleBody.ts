import type { TimeCapsuleEntry } from '../types';
import { extractJson } from './safeApi';

function readCapsuleEnvelope(raw: string): any {
  let value: unknown = extractJson(raw.trim(), { allowTruncated: false, silent: true });
  for (let depth = 0; depth < 3 && typeof value === 'string'; depth += 1) {
    value = extractJson(value, { allowTruncated: false, silent: true });
  }
  return value;
}

/** Read-only compatibility for old model envelopes; handwritten capsules stay verbatim. */
export function timeCapsuleBodyText(capsule: Pick<TimeCapsuleEntry, 'content' | 'source'>): string {
  let text = capsule.content;
  if (capsule.source === 'user') return text;
  for (let depth = 0; depth < 3; depth += 1) {
    const parsed = readCapsuleEnvelope(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) break;
    const body = parsed.content ?? parsed.message;
    if (typeof body !== 'string' || !body.trim() || body === text) break;
    text = body.trim();
  }
  return text.replace(/\\r\\n|\\n/g, '\n');
}

/** Repair formatting before the existing strict capsule validator checks content and dates. */
export function normalizeTimeCapsuleResponse(raw: string): string {
  const envelope = readCapsuleEnvelope(raw);
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return raw;
  const content = envelope.content ?? envelope.message;
  if (typeof content !== 'string') return raw;
  return JSON.stringify({ ...envelope, content: timeCapsuleBodyText({ content, source: 'invited' }) });
}
