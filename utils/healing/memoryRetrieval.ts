import type { HealingMemoryNode, HealingMessage } from '../../types';
import type { EmbeddingConfig } from '../memoryPalace/types';
import { cosineSimilarity, getEmbedding } from '../memoryPalace/embedding';
import { ensureFloat32 } from '../memoryPalace/db';
import { DB } from '../db';
import { backfillHealingMemoryVectors } from './memoryService';

export const HEALING_MEMORY_TOP_K = 6;

export function buildHealingMemoryQuery(messages: HealingMessage[]): string {
  return messages
    .filter(message => message.type === 'text' && message.content.trim())
    .slice(-3)
    .map(message => `${message.role === 'user' ? '用户' : '陪伴角色'}：${message.content.replace(/data:[^\s]+/gi, '')}`)
    .join('\n')
    .slice(-500);
}

const terms = (value: string): string[] => {
  const normalized = value.toLowerCase();
  const result = new Set(normalized.match(/[a-z0-9]{2,}|[\u3400-\u9fff]{2,}/g) || []);
  for (const run of normalized.match(/[\u3400-\u9fff]{3,}/g) || []) {
    for (let index = 0; index < run.length - 1; index++) result.add(run.slice(index, index + 2));
  }
  return [...result];
};

const keywordScore = (query: string, node: HealingMemoryNode): number => {
  const queryTerms = terms(query);
  if (!queryTerms.length) return 0;
  const haystack = `${node.content}\n${node.tags.join(' ')}`.toLowerCase();
  return queryTerms.filter(term => haystack.includes(term)).length / queryTerms.length;
};

export async function retrieveHealingMemories(
  query: string,
  config?: EmbeddingConfig | null,
  topK = HEALING_MEMORY_TOP_K,
): Promise<HealingMemoryNode[]> {
  if (config?.baseUrl && config.model) {
    try { await backfillHealingMemoryVectors(config); } catch (error) { console.warn('[Healing] 补向量失败，本轮使用已有向量/关键词', error); }
  }
  const [nodes, rows] = await Promise.all([DB.getHealingMemoryNodes(), DB.getHealingMemoryVectors()]);
  if (!nodes.length) return [];
  const vectors = new Map(rows.map(row => [row.memoryId, ensureFloat32(row.vector)]));
  let queryVector: Float32Array | undefined;
  if (query.trim() && config?.baseUrl && config.model) {
    try { queryVector = await getEmbedding(query, config); } catch (error) { console.warn('[Healing] 向量召回失败，本轮使用关键词与最近记忆', error); }
  }
  const ranked = nodes.map(node => {
    const vector = vectors.get(node.id);
    const semantic = queryVector && vector?.length === queryVector.length ? cosineSimilarity(queryVector, vector) : 0;
    const keyword = keywordScore(query, node);
    const recent = Math.max(0, 1 - (Date.now() - node.updatedAt) / (180 * 24 * 60 * 60 * 1000));
    return { node, score: semantic * 0.8 + keyword * 0.17 + recent * 0.03 };
  }).sort((a, b) => b.score - a.score || b.node.updatedAt - a.node.updatedAt).slice(0, Math.max(0, topK));
  const now = Date.now();
  await Promise.all(ranked.map(({ node }) => DB.saveHealingMemoryNode({ ...node, accessCount: node.accessCount + 1, lastAccessedAt: now })));
  return ranked.map(item => item.node);
}
