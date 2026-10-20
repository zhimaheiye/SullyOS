import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync(
    new URL('../../components/chat/MemoryRepairPortal.tsx', import.meta.url),
    'utf8',
);

describe('MemoryRepairPortal proposal review wiring', () => {
    it('offers a dry-run proposal queue with explicit per-item actions', () => {
        expect(source).toContain('proposeRecallMemoryRepairs');
        expect(source).toContain('assertMemoryRepairProposalCurrent');
        expect(source).toContain('生成修补提案');
        expect(source).toContain('跳过');
        expect(source).toContain('手动调整');
        expect(source).toContain('同意并写回');
        expect(source).not.toContain('全部同意');
        expect(source).not.toContain('batchPatchRecallMemory');
    });

    it('keeps a single memory patch call site shared by manual and proposal edits', () => {
        expect(source.match(/patchRecallMemory\s*\(/g)).toHaveLength(1);
    });
});
