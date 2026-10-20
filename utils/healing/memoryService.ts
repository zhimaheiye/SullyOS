import type {
  APIConfig, HealingMemoryDraft, HealingMemoryNode, HealingMemoryOrigin, HealingSession,
} from '../../types';
import type { EmbeddingConfig } from '../memoryPalace/types';
import { cosineSimilarity, getEmbeddings } from '../memoryPalace/embedding';
import { ensureFloat32 } from '../memoryPalace/db';
import { DB } from '../db';
import { extractHealingMemoryDrafts } from './memoryExtraction';

export const HEALING_MEMORY_BUFFER_MESSAGES = 10;
export const HEALING_MEMORY_DEDUP_THRESHOLD = 0.9;

export interface IngestHealingMemoryOptions {
  origin: HealingMemoryOrigin;
  sourceSessionId?: string;
  sourceCharId?: string;
  embeddingConfig?: EmbeddingConfig | null;
}

const normalizedContent = (value: string): string => value.toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
const hasEmbedding = (config?: EmbeddingConfig | null): config is EmbeddingConfig => Boolean(config?.baseUrl && config.model);

const normalizeDraft = (draft: HealingMemoryDraft): HealingMemoryDraft | null => {
  const content = String(draft.content || '').trim();
  if (!content) return null;
  return {
    content,
    tags: [...new Set((draft.tags || []).map(tag => String(tag).trim()).filter(Boolean))].slice(0, 8),
    importance: Math.max(1, Math.min(10, Math.round(Number(draft.importance) || 5))),
    mood: draft.mood?.trim().slice(0, 40) || undefined,
    sourceMessageIds: [...new Set((draft.sourceMessageIds || []).filter(Number.isFinite))],
  };
};

export async function ingestHealingMemoryDrafts(
  drafts: HealingMemoryDraft[],
  options: IngestHealingMemoryOptions,
): Promise<HealingMemoryNode[]> {
  const normalized = drafts.map(normalizeDraft).filter((draft): draft is HealingMemoryDraft => Boolean(draft));
  if (!normalized.length) return [];
  const [existingNodes, existingVectors] = await Promise.all([DB.getHealingMemoryNodes(), DB.getHealingMemoryVectors()]);
  const exact = new Set(existingNodes.map(node => normalizedContent(node.content)));
  const vectors = existingVectors.map(row => ensureFloat32(row.vector));
  let generated: Float32Array[] = [];
  if (hasEmbedding(options.embeddingConfig)) {
    try {
      generated = await getEmbeddings(normalized.map(draft => draft.content), options.embeddingConfig);
    } catch (error) {
      console.warn('[Healing] 记忆向量化失败，已保留文本并转入关键词召回', error);
    }
  }

  const saved: HealingMemoryNode[] = [];
  for (let index = 0; index < normalized.length; index++) {
    const draft = normalized[index];
    const key = normalizedContent(draft.content);
    if (!key || exact.has(key)) continue;
    const vector = generated[index];
    if (vector && vectors.some(existing => existing.length === vector.length && cosineSimilarity(existing, vector) > HEALING_MEMORY_DEDUP_THRESHOLD)) continue;
    const now = Date.now();
    const node: HealingMemoryNode = {
      id: `healing-memory-${crypto.randomUUID?.() || `${now}-${index}`}`,
      content: draft.content,
      tags: draft.tags || [],
      importance: draft.importance || 5,
      mood: draft.mood,
      createdAt: now,
      updatedAt: now,
      lastAccessedAt: now,
      accessCount: 0,
      embedded: false,
      sourceSessionId: options.sourceSessionId,
      sourceMessageIds: draft.sourceMessageIds,
      sourceCharId: options.sourceCharId,
      origin: options.origin,
    };
    await DB.saveHealingMemoryNode(node);
    if (vector) {
      try {
        await DB.saveHealingMemoryVector({ memoryId: node.id, vector, dimensions: vector.length, model: options.embeddingConfig?.model });
        node.embedded = true;
        await DB.saveHealingMemoryNode(node);
        vectors.push(vector);
      } catch (error) {
        console.warn('[Healing] 记忆向量保存失败，文本记忆仍可使用', error);
      }
    }
    exact.add(key);
    saved.push(node);
  }
  return saved;
}

export async function backfillHealingMemoryVectors(config?: EmbeddingConfig | null): Promise<number> {
  if (!hasEmbedding(config)) return 0;
  const [nodes, rows] = await Promise.all([DB.getHealingMemoryNodes(), DB.getHealingMemoryVectors()]);
  const stored = new Set(rows.map(row => row.memoryId));
  const pending = nodes.filter(node => !node.embedded || !stored.has(node.id));
  if (!pending.length) return 0;
  const vectors = await getEmbeddings(pending.map(node => node.content), config);
  for (let index = 0; index < pending.length; index++) {
    const node = pending[index];
    const vector = vectors[index];
    await DB.saveHealingMemoryVector({ memoryId: node.id, vector, dimensions: vector.length, model: config.model });
    if (!node.embedded) await DB.saveHealingMemoryNode({ ...node, embedded: true, updatedAt: Date.now() });
  }
  return pending.length;
}

const processing = new Map<string, Promise<HealingMemoryNode[]>>();

export function processHealingMemoryBuffer(input: {
  sessionId: string;
  apiConfig: Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model'>;
  embeddingConfig?: EmbeddingConfig | null;
  force?: boolean;
}): Promise<HealingMemoryNode[]> {
  const active = processing.get(input.sessionId);
  if (active) return active;
  const run = (async () => {
    const session = await DB.getHealingSession(input.sessionId);
    if (!session) return [];
    const messages = await DB.getHealingMessages(session.id);
    const pending = messages.filter(message => message.id > (session.memoryProcessedThrough || 0));
    if (!pending.length || (!input.force && pending.length < HEALING_MEMORY_BUFFER_MESSAGES)) return [];
    const drafts = await extractHealingMemoryDrafts(pending, input.apiConfig);
    const sourceMessageIds = pending.filter(message => message.role === 'user').map(message => message.id);
    const saved = await ingestHealingMemoryDrafts(
      drafts.map(draft => ({ ...draft, sourceMessageIds })),
      { origin: 'chat', sourceSessionId: session.id, sourceCharId: session.charId, embeddingConfig: input.embeddingConfig },
    );
    const latest = pending.at(-1)!.id;
    const current = await DB.getHealingSession(session.id) || session;
    await DB.saveHealingSession({ ...current, memoryProcessedThrough: latest });
    return saved;
  })().finally(() => processing.delete(input.sessionId));
  processing.set(input.sessionId, run);
  return run;
}

export async function flushPendingHealingSessions(input: {
  sessions: HealingSession[];
  apiConfig: Pick<APIConfig, 'baseUrl' | 'apiKey' | 'model'>;
  embeddingConfig?: EmbeddingConfig | null;
}): Promise<void> {
  for (const session of input.sessions) {
    try {
      await processHealingMemoryBuffer({ sessionId: session.id, apiConfig: input.apiConfig, embeddingConfig: input.embeddingConfig, force: true });
    } catch (error) {
      console.warn(`[Healing] 会话 ${session.id} 的尾部记忆将在下次补处理`, error);
    }
  }
}
