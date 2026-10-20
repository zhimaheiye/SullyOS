import { describe, expect, it } from 'vitest';
import type { PhoneContact } from '../types';
import { createOperatorIdentity, removeOperatorIdentity } from './operatorIdentity';

describe('全局自建身份', () => {
    it('允许空简介和任意长度自由简介，使用稳定 id 而不是名字作 key', () => {
        const empty = createOperatorIdentity([], { name: ' 林弥 ', description: '   ' }, { id: 'mask-1', now: 1 });
        expect(empty.identity).toEqual({ id: 'mask-1', name: '林弥', createdAt: 1 });
        const longDescription = '很长的自由简介。'.repeat(500);
        const long = createOperatorIdentity(empty.identities, { name: '林弥2', description: longDescription }, { id: 'mask-2', now: 2 });
        expect(long.identity.description).toBe(longDescription);
        expect(long.identities.map(identity => identity.id)).toEqual(['mask-1', 'mask-2']);
    });

    it('同一身份定义可被 A/B 引用，但双方关系、learned 与历史容器互不共享；删除定义不删快照', () => {
        const { identities, identity } = createOperatorIdentity([], { name: '林弥' }, { id: 'mask-shared', now: 1 });
        const aContact: PhoneContact = { id: 'a-mask', name: identity.name, kind: 'custom', operatorIdentityId: identity.id, affinity: 10, learned: '喜欢摄影', status: 'friend', createdAt: 1 };
        const bContact: PhoneContact = { id: 'b-mask', name: identity.name, kind: 'custom', operatorIdentityId: identity.id, affinity: -5, learned: '以前的同事', status: 'friend', createdAt: 2 };
        expect(aContact.operatorIdentityId).toBe(bContact.operatorIdentityId);
        expect(aContact).not.toEqual(bContact);
        expect(removeOperatorIdentity(identities, identity.id)).toEqual([]);
        expect(aContact.name).toBe('林弥');
        expect(bContact.name).toBe('林弥');
    });
});
