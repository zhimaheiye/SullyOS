import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const chat = readFileSync(fileURLToPath(new URL('../apps/Chat.tsx', import.meta.url)), 'utf8');
const input = readFileSync(fileURLToPath(new URL('../components/chat/ChatInputArea.tsx', import.meta.url)), 'utf8');
const item = readFileSync(fileURLToPath(new URL('../components/chat/MessageItem.tsx', import.meta.url)), 'utf8');

describe('私聊多选转发接线', () => {
    it('保留原底栏入口，在同一选角色弹窗明确切换两种方式并确认逐条发送', () => {
        expect(input).toContain('onForwardSelected?.()');
        expect(input).toContain('转发 ({selectedCount})');
        expect(chat).toContain("useState<'merged' | 'individual'>('merged')");
        expect(chat).toContain("'逐条转发' : '合并转发'");
        expect(chat).toContain('确认逐条发送');
        expect(chat).toContain('filterCharactersByGroup(forwardCandidates, characterGroups, forwardGroupId)');
        expect(chat).toContain('forwardConfirmation.plan.skippedCount');
        expect(chat).toContain('forwardConfirmation.plan.messages.length === 0');
    });

    it('逐条模式走批量事务，原合并模式仍写卡片和来源系统记录', () => {
        const forward = chat.slice(chat.indexOf('const handleForwardToCharacter'), chat.indexOf('const handleOpenCollaborationFile'));
        expect(forward).toContain("if (forwardMode === 'individual')");
        expect(forward).toContain('planIndividualForward(');
        expect(forward).toContain('DB.saveMessagesAtomic(');
        expect(forward).toContain("type: 'chat_forward'");
        expect(forward).toContain('`[转发了 ${selectedMsgs.length} 条聊天记录给 ${targetChar?.name || \'\'}]`');
        expect(forward).not.toContain('handleSendText(');
        expect(forward).not.toContain('triggerAI(');
        expect(forward).toContain('savingForward.current = true');
        expect(forward).toContain('activeCharIdRef.current !== confirmation.sourceCharId');
        expect(item).toContain('const ForwardCard: React.FC');
    });
});
