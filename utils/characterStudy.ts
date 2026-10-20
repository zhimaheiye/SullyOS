import type { CharacterStudySession } from '../types';
import { extractJson } from './safeApi';

export interface CharacterStudyOpening {
  rationale: string;
  opening: string;
  notesMarkdown: string;
}

export interface CharacterStudyReply {
  notePatch: string;
  response: string;
  beginnerThinking?: string;
  question?: string;
}

const text = (value: unknown) => typeof value === 'string' ? value.trim() : '';

export function characterStudyMarkdownFileName(topic: string): string {
  const safe = topic.trim().replace(/[\\/:*?"<>|\u0000-\u001F]/g, '_').replace(/[. ]+$/g, '').slice(0, 80);
  return `${safe || '课堂笔记'}.md`;
}

export function parseCharacterStudyOpening(raw: string): CharacterStudyOpening {
  const data = extractJson(raw);
  const rationale = text(data?.rationale);
  const opening = text(data?.opening);
  const notesMarkdown = text(data?.notesMarkdown);
  if (!rationale || !opening || !notesMarkdown) throw new Error('角色自习室初始化返回格式不完整，请重试');
  return { rationale, opening, notesMarkdown };
}

export function parseCharacterStudyReply(raw: string, questionAllowed: boolean): CharacterStudyReply {
  const data = extractJson(raw);
  const notePatch = text(data?.notePatch);
  const response = text(data?.response);
  const beginnerThinking = text(data?.beginnerThinking);
  const question = questionAllowed ? text(data?.question) : '';
  if (!notePatch || !response) throw new Error('角色自习室回复格式不完整，请重试');
  return { notePatch, response, beginnerThinking: beginnerThinking || undefined, question: question || undefined };
}

export function appendCharacterStudyNotes(current: string, patch: string): string {
  const base = current.replace(/\n*>\s*等待讲解\s*$/u, '').trim();
  const addition = patch.trim();
  if (!addition) return base;
  return base ? `${base}\n\n${addition}` : addition;
}

export function createCharacterStudySession(input: {
  charId: string;
  topic: string;
  opening: CharacterStudyOpening;
  now?: number;
}): CharacterStudySession {
  const now = input.now ?? Date.now();
  return {
    id: `character-study-${now}-${Math.random().toString(36).slice(2, 8)}`,
    charId: input.charId,
    topic: input.topic.trim(),
    rationale: input.opening.rationale,
    opening: input.opening.opening,
    notesMarkdown: input.opening.notesMarkdown,
    turns: [],
    status: 'active',
    createdAt: now,
    updatedAt: now,
  };
}
