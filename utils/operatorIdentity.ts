import type { OperatorIdentity } from '../types';

const makeId = (): string => {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return `mask-${crypto.randomUUID()}`;
    }
    return `mask-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

export function createOperatorIdentity(
    identities: OperatorIdentity[],
    input: { name: string; description?: string },
    options: { now?: number; id?: string } = {},
): { identities: OperatorIdentity[]; identity: OperatorIdentity } {
    const name = input.name.trim();
    if (!name) throw new Error('身份名字不能为空');
    const description = input.description?.trim() || undefined;
    const identity: OperatorIdentity = {
        id: options.id || makeId(),
        name,
        ...(description ? { description } : {}),
        createdAt: options.now ?? Date.now(),
    };
    return { identities: [...identities, identity], identity };
}

export function updateOperatorIdentity(
    identities: OperatorIdentity[],
    id: string,
    input: { name: string; description?: string },
    now = Date.now(),
): OperatorIdentity[] {
    const name = input.name.trim();
    if (!name) throw new Error('身份名字不能为空');
    const description = input.description?.trim() || undefined;
    return identities.map(identity => identity.id === id ? {
        ...identity,
        name,
        description,
        updatedAt: now,
    } : identity);
}

export function removeOperatorIdentity(identities: OperatorIdentity[], id: string): OperatorIdentity[] {
    return identities.filter(identity => identity.id !== id);
}

export function findOperatorIdentity(identities: OperatorIdentity[] | undefined, id: string | undefined) {
    return id ? identities?.find(identity => identity.id === id) : undefined;
}
