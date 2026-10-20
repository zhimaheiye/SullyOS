import { DB } from '../db';
import { createEmptyOneChangeSnapshot, type OneChangeSnapshot } from './engine';

export async function loadOneChangeSnapshot(): Promise<OneChangeSnapshot> {
  const stored = await DB.getOneChangeSnapshotData();
  const fallback = createEmptyOneChangeSnapshot();
  return {
    changes: stored.changes,
    records: stored.records,
    standardVersions: stored.standardVersions,
    stateEvents: stored.stateEvents,
    settings: stored.settings || fallback.settings,
  };
}
let mutationQueue: Promise<unknown> = Promise.resolve();

/** Serializes UI mutations and commits every domain snapshot as one five-store IDB transaction. */
export function mutateOneChange<T>(
  mutate: (snapshot: OneChangeSnapshot) => { snapshot: OneChangeSnapshot; result: T },
): Promise<{ snapshot: OneChangeSnapshot; result: T }> {
  const run = async () => {
    const current = await loadOneChangeSnapshot();
    const next = mutate(current);
    await DB.saveOneChangeSnapshotData(next.snapshot);
    return next;
  };
  const pending = mutationQueue.then(run, run);
  mutationQueue = pending.then(() => undefined, () => undefined);
  return pending;
}
