import type { Message } from '../types';

export interface MessageWithdrawalMetadata {
    by: 'user' | 'assistant';
    withdrawnAt: number;
    characterSawOriginal: boolean;
    emojiName?: string;
}

export function getWithdrawal(message: Pick<Message, 'metadata'>): MessageWithdrawalMetadata | undefined {
    return message.metadata?.withdrawal as MessageWithdrawalMetadata | undefined;
}

export function isWithdrawnMessage(message: Pick<Message, 'metadata'> | null | undefined): boolean {
    return !!message && !!getWithdrawal(message);
}

/** 角色、归档与记忆共同使用的撤回语义；未抓到时绝不返回原文或表情名。 */
export function formatWithdrawalForCharacterContext(message: Message): string | null {
    const withdrawal = getWithdrawal(message);
    if (!withdrawal) return null;

    const isEmoji = message.type === 'emoji';
    if (withdrawal.by === 'assistant') {
        return isEmoji
            ? `[你刚才发出了 [${withdrawal.emojiName || '未知表情'}] 表情，随后把它撤回了。]`
            : `[你刚才发出「${message.content}」，随后把这条消息撤回了。这是你自己做出的行为，所以你当然记得原文。]`;
    }

    if (!withdrawal.characterSawOriginal) {
        return isEmoji
            ? '[系统事件：对方撤回了一个表情包。你知道对方撤回了表情，但没看清是哪一个，不知道表情内容。]'
            : '[系统事件：对方刚才撤回了一条消息。你看到了“撤回”这个动作，但没来得及看到撤回前的内容。你不知道原文是什么，不得假装知道。]';
    }

    return isEmoji
        ? `[系统事件：对方撤回了一个表情包。你在撤回前看到了：[${withdrawal.emojiName || '未知表情'}]。这个表情随后被对方撤回。]`
        : `[系统事件：对方撤回了一条消息。你在撤回前看到了原文：「${message.content}」。你知道这句话已经被对方撤回；是否提起由你根据性格和当下关系自然决定。]`;
}

/** 新回复不再执行撤回。模型若仍写出旧标记，丢掉标记内原文，避免把它当成普通气泡。 */
export function stripWithdrawalMarkup(raw: string): string {
    return raw
        .replace(/\[\[WITHDRAW_TEXT\]\][\s\S]*?\[\[\/WITHDRAW_TEXT\]\]/gi, '')
        .replace(/\[\[WITHDRAW_EMOJI\s*[:：]\s*[^\]\r\n]+?\s*\]\]/gi, '');
}
