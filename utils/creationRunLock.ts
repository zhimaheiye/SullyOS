// Locks contain no creative material and are released only after the local task settles.
const held = new Set<string>();

export async function withCreationRunLock<T>(key: string, signal: AbortSignal, task: () => Promise<T>): Promise<T> {
    signal.throwIfAborted();
    if (held.has(key)) throw new Error('已有创作正在进行，请等本地请求收尾后再试');
    held.add(key);
    try {
        if (typeof navigator !== 'undefined' && navigator.locks) {
            return await navigator.locks.request(`sully:creation:${key}`, { ifAvailable: true }, lock => {
                if (!lock) throw new Error('另一页面已有创作正在进行，请稍后再试');
                signal.throwIfAborted();
                return task();
            });
        }
        return await task();
    } finally {
        held.delete(key);
    }
}

// A modal can report cancellation immediately without releasing the underlying role lock.
export function runRoleCreation<T>(key: string, signal: AbortSignal, waitForSettlement: boolean,
    task: (earlyFailure: (error: unknown) => void) => Promise<T>): Promise<T> {
    if (waitForSettlement) return withCreationRunLock(key, signal, () => task(() => {}));
    let earlyFailure!: (error: unknown) => void;
    const cancelled = new Promise<never>((_resolve, reject) => { earlyFailure = reject; });
    return Promise.race([withCreationRunLock(key, signal, () => task(earlyFailure)), cancelled]);
}
