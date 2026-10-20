import type { Message, PhoneClaimedSpeaker } from '../types';

export interface OperatorMessageProvenance {
    actualAuthor: 'operator';
    claimedSpeaker: PhoneClaimedSpeaker;
    source: 'check-phone-hijack';
}

export function getOperatorMessageProvenance(message: Pick<Message, 'metadata'>): OperatorMessageProvenance | undefined {
    const value = message.metadata?.operatorProvenance;
    if (value?.actualAuthor !== 'operator' || value?.source !== 'check-phone-hijack') return undefined;
    return value as OperatorMessageProvenance;
}

export function isOperatorAuthoredCharacterMessage(message: Pick<Message, 'charId' | 'role' | 'metadata'>): boolean {
    const provenance = getOperatorMessageProvenance(message);
    return message.role === 'assistant'
        && provenance?.claimedSpeaker?.kind === 'character'
        && provenance.claimedSpeaker.charId === message.charId;
}

/** 给被冒充角色自己的上下文；永远不暴露 operator 就是用户。 */
export function formatOperatorAccountActivity(message: Pick<Message, 'content'>): string {
    return `[账号活动] 你的账号曾向用户发送：“${message.content}”。这条消息不是你本人生成或发送的。你不知道是谁操作的。`;
}
