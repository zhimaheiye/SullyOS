import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

describe('message withdrawal wiring', () => {
    it('no longer marks messages read or offers a withdraw action', () => {
        const chatAi = readFileSync(new URL('../hooks/useChatAI.ts', import.meta.url), 'utf8');
        const chat = readFileSync(new URL('../apps/Chat.tsx', import.meta.url), 'utf8');
        const modals = readFileSync(new URL('../components/chat/ChatModals.tsx', import.meta.url), 'utf8');
        expect(chatAi).not.toContain('getUserMessagesToMarkRead');
        expect(chat).not.toContain('handleWithdrawMessage');
        expect(modals).not.toContain('撤回消息');
        expect(modals).not.toContain('撤回被抓包概率');
    });

    it('keeps already withdrawn history on the delete-only branch', () => {
        const source = readFileSync(new URL('../components/chat/ChatModals.tsx', import.meta.url), 'utf8');
        expect(source).toContain('{!isWithdrawnMessage(selectedMessage) && <>');
        expect(source.indexOf('</>}')).toBeLessThan(source.indexOf('删除消息'));
    });
});
