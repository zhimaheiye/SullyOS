import type { HealingMemoryDraft, HealingMemoryNode } from '../../types';
import type { EmbeddingConfig } from '../memoryPalace/types';
import { ingestHealingMemoryDrafts } from './memoryService';

/** 0.2 的解析/预览流程完成后，只需把用户确认的 drafts 交给此入口。 */
export function ingestImportedHealingMemoryDrafts(
  drafts: HealingMemoryDraft[],
  embeddingConfig?: EmbeddingConfig | null,
): Promise<HealingMemoryNode[]> {
  return ingestHealingMemoryDrafts(drafts, { origin: 'import', embeddingConfig });
}
