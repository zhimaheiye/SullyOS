import { describe, expect, it } from 'vitest';
import type { GroupProfile, Message } from '../../types';
import {
    appendMemberJoinWindow,
    closeMemberWindow,
    filterGroupMessagesForMember,
    getMembershipWindows,
    materializeLegacyMembership,
    splitMessagesByMembershipAudience,
} from './membership';

const group = (members: string[] = ['A', 'B']): GroupProfile => ({
    id: 'g', name: '群', members, createdAt: 1,
});
const messages = (...ids: number[]): Message[] => ids.map(id => ({
    id, charId: 'user', groupId: 'g', role: 'user', type: 'text', content: String(id), timestamp: id,
}));

describe('group membership visibility windows', () => {
    it('treats legacy current members as visible from the first message', () => {
        expect(getMembershipWindows(group(), 'A')).toEqual([{ joinedAfterMessageId: 0 }]);
        expect(filterGroupMessagesForMember(group(), 'A', messages(1, 2, 3)).map(m => m.id)).toEqual([1, 2, 3]);
    });

    it('fills partial legacy windows and freezes old topic-box recipients before membership changes', () => {
        const legacy = {
            ...group(),
            memberVisibilityWindows: { A: [{ joinedAfterMessageId: 5 }] },
            topicBoxes: [{
                id: 'box', groupId: 'g', title: '旧盒子', summary: '旧内容',
                sourceStartMessageId: 1, sourceEndMessageId: 5, messageCount: 5,
                participants: ['A'], createdAt: 1, updatedAt: 1,
            }],
        } satisfies GroupProfile;
        const materialized = materializeLegacyMembership(legacy);
        expect(materialized.memberVisibilityWindows?.B).toEqual([{ joinedAfterMessageId: 0 }]);
        expect(materialized.topicBoxes?.[0].deliveredMemberIds).toEqual(['A', 'B']);
    });

    it('tracks join, leave and rejoin as separate message-id windows', () => {
        let next = appendMemberJoinWindow(group(), 'C', 100);
        next = { ...next, members: [...next.members, 'C'] };
        expect(filterGroupMessagesForMember(next, 'C', messages(100, 101, 160, 161)).map(m => m.id)).toEqual([101, 160, 161]);

        next = closeMemberWindow(next, 'C', 160);
        next = { ...next, members: next.members.filter(id => id !== 'C') };
        next = appendMemberJoinWindow(next, 'C', 220);
        next = { ...next, members: [...next.members, 'C'] };

        expect(getMembershipWindows(next, 'C')).toEqual([
            { joinedAfterMessageId: 100, leftAtMessageId: 160 },
            { joinedAfterMessageId: 220 },
        ]);
        expect(filterGroupMessagesForMember(next, 'C', messages(99, 100, 101, 160, 161, 220, 221)).map(m => m.id))
            .toEqual([101, 160, 221]);
    });

    it('lets a member invited to an empty group see its first message', () => {
        const next = appendMemberJoinWindow(group(), 'C', 0);
        expect(filterGroupMessagesForMember(next, 'C', messages(1)).map(m => m.id)).toEqual([1]);
    });

    it('splits consecutive messages whenever the visible audience changes', () => {
        let next = appendMemberJoinWindow(group(['A']), 'B', 2);
        next = { ...next, members: ['A', 'B'] };
        next = closeMemberWindow(next, 'B', 4);
        const segments = splitMessagesByMembershipAudience(next, messages(1, 2, 3, 4, 5));
        expect(segments.map(segment => ({ ids: segment.messages.map(m => m.id), audience: segment.audienceMemberIds }))).toEqual([
            { ids: [1, 2], audience: ['A'] },
            { ids: [3, 4], audience: ['A', 'B'] },
            { ids: [5], audience: ['A'] },
        ]);
    });
});
