import type { PhoneClaimedSpeaker, PhoneConversationTurn, PhoneEvidence } from '../types';

export interface MaterializePhoneTurnsOptions {
    recordId: string;
    ownerCharId?: string;
    contactCharId?: string;
    customIdentityId?: string;
    firstUnprefixedIsOwner?: boolean;
}

export function parseLegacyPhoneDetail(detail: string, firstUnprefixedIsOwner = false): Array<{ side: 'owner' | 'contact'; text: string }> {
    const out: Array<{ side: 'owner' | 'contact'; text: string }> = [];
    let side: 'owner' | 'contact' = firstUnprefixedIsOwner ? 'owner' : 'contact';
    for (const raw of (detail || '').split('\n')) {
        const line = raw.trim();
        if (!line) continue;
        const match = line.match(/^(我|对方|Me|Them)\s*[:：]\s*(.*)$/);
        if (match) {
            side = match[1] === '我' || match[1] === 'Me' ? 'owner' : 'contact';
            if (match[2].trim()) out.push({ side, text: match[2].trim() });
        } else {
            out.push({ side, text: line });
        }
    }
    return out;
}

function legacyClaimedSpeaker(side: 'owner' | 'contact', options: MaterializePhoneTurnsOptions): PhoneClaimedSpeaker | undefined {
    if (side === 'owner' && options.ownerCharId) return { kind: 'character', charId: options.ownerCharId };
    if (side === 'contact' && options.contactCharId) return { kind: 'character', charId: options.contactCharId };
    if (side === 'contact' && options.customIdentityId) return { kind: 'custom', identityId: options.customIdentityId };
    return undefined;
}

/** 旧 detail 第一次参与接管时，按 record id + 原始下标生成稳定 id，不做破坏性 DB migration。 */
export function materializePhoneConversationTurns(
    record: Pick<PhoneEvidence, 'id' | 'detail' | 'conversationTurns'> | undefined,
    options: Omit<MaterializePhoneTurnsOptions, 'recordId'> & { recordId?: string },
): PhoneConversationTurn[] {
    if (record?.conversationTurns?.length) return record.conversationTurns.map(turn => ({ ...turn }));
    const recordId = options.recordId || record?.id || 'new-record';
    const fullOptions: MaterializePhoneTurnsOptions = { ...options, recordId };
    return parseLegacyPhoneDetail(record?.detail || '', options.firstUnprefixedIsOwner).map((turn, index) => ({
        id: `${recordId}:legacy:${index}`,
        side: turn.side,
        text: turn.text,
        author: 'legacy',
        claimedSpeaker: legacyClaimedSpeaker(turn.side, fullOptions),
        source: 'legacy',
    }));
}

export function serializePhoneConversationTurns(turns: PhoneConversationTurn[]): string {
    return turns
        .flatMap(turn => turn.text.split('\n').map(line => line.trim()).filter(Boolean)
            .map(line => `${turn.side === 'owner' ? '我' : '对方'}: ${line}`))
        .join('\n');
}

export function mirrorPhoneConversationTurns(turns: PhoneConversationTurn[]): PhoneConversationTurn[] {
    return turns.map(turn => ({ ...turn, side: turn.side === 'owner' ? 'contact' : 'owner' }));
}

export function createPhoneConversationTurn(input: Omit<PhoneConversationTurn, 'id'> & { id?: string }): PhoneConversationTurn {
    return {
        ...input,
        id: input.id || `turn-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    };
}

export function deletePhoneConversationTurns(turns: PhoneConversationTurn[], ids: Iterable<string>): PhoneConversationTurn[] {
    const selected = new Set(ids);
    return turns.filter(turn => !selected.has(turn.id));
}

export function editPhoneConversationTurn(turns: PhoneConversationTurn[], id: string, text: string): PhoneConversationTurn[] {
    return turns.map(turn => turn.id === id ? { ...turn, text: text.trim() } : turn).filter(turn => turn.text);
}

const isClaimedCharacter = (turn: PhoneConversationTurn, charId: string) =>
    turn.claimedSpeaker?.kind === 'character' && turn.claimedSpeaker.charId === charId;

/**
 * 同一真实 thread 按观看角色投影：收件人只见世界内表象；被冒充者只知道账号异常，不知道幕后操作者。
 */
export function projectPhoneConversationForViewer(
    turns: PhoneConversationTurn[],
    input: { viewerCharId: string; ownerCharId: string; ownerName: string; contactName: string },
): string {
    return turns.map(turn => {
        const speakerName = turn.side === 'owner' ? input.ownerName : input.contactName;
        const otherName = turn.side === 'owner' ? input.contactName : input.ownerName;
        if (turn.author === 'operator' && isClaimedCharacter(turn, input.viewerCharId)) {
            return `[账号记录] 你的账号曾向「${otherName}」发出：“${turn.text}”，但这条不是你本人生成或发送的。你不知道是谁操作的。`;
        }
        return `${speakerName}: ${turn.text}`;
    }).join('\n');
}

export function containsOperatorAuthoredTurn(turns: PhoneConversationTurn[]): boolean {
    return turns.some(turn => turn.author === 'operator');
}
