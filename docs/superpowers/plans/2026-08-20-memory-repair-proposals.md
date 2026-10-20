# Memory Repair Proposal Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow AI to generate several memory-repair drafts for the current recall snapshot while requiring one explicit user approval for every single database write.

**Architecture:** Add a dry-run proposal planner and pure validation helpers to `memoryRepair.ts`. Keep `patchRecallMemory()` as the only write path, and add a transient review queue to `MemoryRepairPortal.tsx`; proposals are never persisted and never committed in bulk.

**Tech Stack:** React 18, TypeScript, Vitest, IndexedDB memory palace stores, existing OpenAI-compatible chat API and embedding pipeline.

**Spec:** `docs/memory-system-overview.md` and the approved 2026-08-20 user plan in the development conversation.

## Global Constraints

- Candidate IDs are restricted to the current explicit recall snapshot; diagnosed suspect IDs narrow the set when present.
- Model output cannot provide trusted original content, node kind, or event-box identity; the client fills those fields from the snapshot.
- Proposal generation has no database write dependency and must never call `patchRecallMemory()`.
- There is no apply-all, approve-all, automatic write, full-memory search, proposal persistence, or event-box cascade.
- Every approval calls `patchRecallMemory()` exactly once for the currently reviewed node.
- Before approval, the stored node content must still equal `proposal.originalContent`; otherwise the proposal becomes a conflict and is not written.
- Skip and manual adjustment change only transient review state until the user explicitly approves.

---

### Task 1: Proposal validation and conflict guard

**Files:**
- Modify: `utils/memoryPalace/memoryRepair.ts`
- Create: `utils/memoryPalace/memoryRepairProposals.test.ts`

**Interfaces:**
- Produces: `MemoryRepairProposal`, `MemoryRepairPlan`, `normalizeMemoryRepairProposals()`, `assertMemoryRepairProposalCurrent()`.

- [ ] Write failing tests proving unauthorized IDs, duplicates, blanks and no-op edits are filtered and snapshot metadata is authoritative.
- [ ] Run `vitest` and confirm failures are caused by missing proposal APIs.
- [ ] Implement the minimal pure normalization and current-content conflict guard.
- [ ] Run the tests and confirm they pass.

### Task 2: Dry-run AI proposal planner

**Files:**
- Modify: `utils/memoryPalace/memoryRepair.ts`
- Test: `utils/memoryPalace/memoryRepairProposals.test.ts`

**Interfaces:**
- Produces: `proposeRecallMemoryRepairs({ char, user, apiConfig, snapshot, candidateIds, instruction }): Promise<MemoryRepairPlan>`.

- [ ] Add a failing API-mock test proving the prompt receives only allowed snapshot candidates and invalid model IDs are discarded.
- [ ] Run the test and confirm the planner is missing.
- [ ] Implement one non-streaming planning request and normalize its JSON output through the pure validator.
- [ ] Assert that planning leaves all stored `MemoryNode` values unchanged.
- [ ] Run the proposal tests and existing `memoryRepair.test.ts`.

### Task 3: Transient one-by-one review queue

**Files:**
- Modify: `components/chat/MemoryRepairPortal.tsx`
- Test: `utils/memoryPalace/memoryRepairPortal.wiring.test.ts`

**Interfaces:**
- Consumes: proposal planner, conflict guard and existing `patchRecallMemory()`.
- Produces: inspect/planning/reviewing/complete UI states with per-proposal `pending`, `approved`, `skipped`, or `conflict` status.

- [ ] Add a failing wiring test for no bulk write API, no approve-all control, one `patchRecallMemory()` call site, and conflict checking before approval.
- [ ] Run the test and confirm the review layer is absent.
- [ ] Add repair instruction input after diagnosis, generate proposals from suspect IDs or all snapshot IDs, and show the zero-write safety notice.
- [ ] Add original/reason/suggestion sections plus Skip, Manual adjustment, and Approve-and-write controls.
- [ ] Keep a failed or conflicted proposal selected; advance only after a successful single write or an explicit skip.
- [ ] Keep the existing NodeEditor and manual repair path unchanged.
- [ ] Run wiring and proposal tests.

### Task 4: Documentation and verification

**Files:**
- Modify: `docs/memory-system-overview.md`
- Modify: `docs/handoff/CURRENT.md`

- [ ] Document the proposal-only AI boundary, transient queue, per-item write path, and original-content conflict rule.
- [ ] Run focused memory repair tests.
- [ ] Run the Vite production build.
- [ ] Run TypeScript checking and record unrelated pre-existing failures separately from touched-file failures.
- [ ] Inspect `git diff`, conflict markers and protected user/reference resources before committing.
