import type { GroupMembershipWindow, GroupProfile, Message } from '../../types';

export type MembershipAudienceSegment = {
    messages: Message[];
    audienceMemberIds: string[];
};

const cloneWindows = (windows: GroupMembershipWindow[] = []): GroupMembershipWindow[] =>
    windows.map(window => ({ ...window }));

/** 读取时兼容旧群：旧版本成员从第一条群消息起一直可见。 */
export function normalizeGroupMembership(group: GroupProfile): Record<string, GroupMembershipWindow[]> {
    const normalized = Object.fromEntries(
        Object.entries(group.memberVisibilityWindows || {}).map(([charId, windows]) => [charId, cloneWindows(windows)]),
    );
    for (const charId of group.members) {
        normalized[charId] ||= [{ joinedAfterMessageId: 0 }];
    }
    return normalized;
}

export function materializeLegacyMembership(group: GroupProfile): GroupProfile {
    return {
        ...group,
        memberVisibilityWindows: normalizeGroupMembership(group),
        topicBoxes: group.topicBoxes?.map(box => box.deliveredMemberIds
            ? { ...box, deliveredMemberIds: [...box.deliveredMemberIds] }
            : { ...box, deliveredMemberIds: [...group.members] }),
    };
}

export function getMembershipWindows(group: GroupProfile, charId: string): GroupMembershipWindow[] {
    return normalizeGroupMembership(group)[charId] || [];
}

export function hasEverBeenGroupMember(group: GroupProfile, charId: string): boolean {
    return getMembershipWindows(group, charId).length > 0;
}

export function isGroupMessageVisibleToMember(
    group: GroupProfile,
    charId: string,
    messageOrId: Pick<Message, 'id'> | number,
): boolean {
    const messageId = typeof messageOrId === 'number' ? messageOrId : messageOrId.id;
    return getMembershipWindows(group, charId).some(window => (
        messageId > window.joinedAfterMessageId
        && (window.leftAtMessageId == null || messageId <= window.leftAtMessageId)
    ));
}

export function filterGroupMessagesForMember<T extends Pick<Message, 'id'>>(
    group: GroupProfile,
    charId: string,
    messages: T[],
): T[] {
    return messages.filter(message => isGroupMessageVisibleToMember(group, charId, message));
}

export function getVisibleMemberIdsForMessage(group: GroupProfile, messageOrId: Pick<Message, 'id'> | number): string[] {
    return Object.keys(normalizeGroupMembership(group))
        .filter(charId => isGroupMessageVisibleToMember(group, charId, messageOrId))
        .sort();
}

export function splitMessagesByMembershipAudience(group: GroupProfile, messages: Message[]): MembershipAudienceSegment[] {
    const segments: MembershipAudienceSegment[] = [];
    for (const message of messages) {
        const audienceMemberIds = getVisibleMemberIdsForMessage(group, message);
        const previous = segments[segments.length - 1];
        if (previous && previous.audienceMemberIds.join('\0') === audienceMemberIds.join('\0')) {
            previous.messages.push(message);
        } else {
            segments.push({ messages: [message], audienceMemberIds });
        }
    }
    return segments;
}

export function appendMemberJoinWindow(group: GroupProfile, charId: string, latestMessageId: number): GroupProfile {
    const materialized = materializeLegacyMembership(group);
    const windows = cloneWindows(materialized.memberVisibilityWindows?.[charId]);
    if (!windows.some(window => window.leftAtMessageId == null)) {
        windows.push({ joinedAfterMessageId: Math.max(0, latestMessageId) });
    }
    return {
        ...materialized,
        memberVisibilityWindows: { ...materialized.memberVisibilityWindows, [charId]: windows },
    };
}

export function closeMemberWindow(group: GroupProfile, charId: string, latestMessageId: number): GroupProfile {
    const materialized = materializeLegacyMembership(group);
    const windows = cloneWindows(materialized.memberVisibilityWindows?.[charId]);
    for (let index = windows.length - 1; index >= 0; index--) {
        if (windows[index].leftAtMessageId == null) {
            windows[index] = { ...windows[index], leftAtMessageId: Math.max(0, latestMessageId) };
            break;
        }
    }
    return {
        ...materialized,
        memberVisibilityWindows: { ...materialized.memberVisibilityWindows, [charId]: windows },
    };
}
