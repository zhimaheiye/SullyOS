import type { CharacterProfile, Message, PhoneConversationTurn } from '../types';
import { applyRealConversationToPhoneState, normName } from './relationshipChat';
import { projectPhoneConversationForViewer } from './phoneConversationProvenance';

export type CommitConversationOptions = {
    sendToChatOverride?: boolean;
    /** false 表示该角色只是账号被代发：保留镜像，但不写普通 phone_card，也不改关系心理状态。 */
    participant?: boolean;
};

type CharacterUpdater = (
    id: string,
    updates: Partial<CharacterProfile> | ((current: CharacterProfile) => Partial<CharacterProfile>),
) => void;

type ConversationPersistence = {
    deleteMessage: (id: number) => Promise<void>;
    saveMessage: (message: Omit<Message, 'id' | 'timestamp'> & { timestamp?: number }) => Promise<number>;
    updateCharacter: CharacterUpdater;
};

type CommitConversationSideInput = {
    owner: CharacterProfile;
    partnerName: string;
    partnerCharId: string;
    detail: string;
    delta: number;
    partnerNote?: string;
    learnedNew?: string;
    seedIdentity?: string;
    conversationTurns?: PhoneConversationTurn[];
    options?: CommitConversationOptions;
};

/**
 * 落一侧真人私聊镜像。默认沿用机主自己的 sendToChat；真人共享事件可显式覆盖，
 * 让 A/B 两侧使用同一份由当前查手机会话决定的同步选择。
 */
export async function commitRealConversationSide(
    input: CommitConversationSideInput,
    persistence: ConversationPersistence,
): Promise<{ messageId?: number; sendToChat: boolean }> {
    const {
        owner, partnerName, partnerCharId, detail, delta,
        partnerNote, learnedNew, seedIdentity, conversationTurns, options,
    } = input;
    const timestamp = Date.now();
    const result = {
        partnerName, partnerCharId, detail, delta, partnerNote, learnedNew, seedIdentity,
        timestamp, recordId: `rec-${timestamp}-${Math.random()}`,
        conversationTurns,
        updateRelationshipState: options?.participant !== false,
    };
    const contact = owner.phoneState?.contacts?.find(c => c.linkedCharId === partnerCharId
        || normName(c.name) === normName(partnerName));
    const existing = owner.phoneState?.records?.find(r => r.type === 'chat'
        && ((contact && r.contactId === contact.id) || (!r.contactId && normName(r.title) === normName(partnerName))));
    const sendToChat = options?.participant !== false
        && (options?.sendToChatOverride ?? (owner.phoneState?.sendToChat !== false));
    let messageId: number | undefined;
    if (sendToChat) {
        // 续写时先删掉上一张完整卡片，主聊天只保留最新完整版本。
        if (existing?.systemMessageId) await persistence.deleteMessage(existing.systemMessageId);
        const promptDetail = conversationTurns?.length
            ? projectPhoneConversationForViewer(conversationTurns, {
                viewerCharId: owner.id,
                ownerCharId: owner.id,
                ownerName: owner.name,
                contactName: partnerName,
            })
            : detail;
        messageId = await persistence.saveMessage({
            charId: owner.id, role: 'assistant', type: 'phone_card',
            content: `[你手机的聊天软件] 你和「${partnerName}」的对话：${promptDetail.replace(/\n/g, ' ')}`,
            metadata: { phoneCard: { app: '聊天软件', kind: 'chat', title: partnerName, detail, conversationTurns } },
        });
    }
    // 自动加删友播报与这次真人共享事件使用同一同步选择。
    const { broadcast } = applyRealConversationToPhoneState(owner.phoneState, result);
    if (broadcast && sendToChat) {
        await persistence.saveMessage({ charId: owner.id, role: 'assistant', type: 'text', content: broadcast });
    }
    persistence.updateCharacter(owner.id, current => ({
        phoneState: applyRealConversationToPhoneState(current.phoneState, {
            ...result,
            systemMessageId: messageId,
        }).phoneState,
    }));
    return { messageId, sendToChat };
}
