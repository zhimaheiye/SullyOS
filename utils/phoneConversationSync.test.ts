import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { CharacterProfile } from '../types';
import { flipTranscript } from './relationshipChat';
import { commitRealConversationSide } from './phoneConversationSync';

const checkPhoneSource = readFileSync(new URL('../apps/CheckPhone.tsx', import.meta.url), 'utf8');

function createPair(aSendToChat: boolean, bSendToChat: boolean) {
    const a = {
        id: 'a', name: '甲',
        phoneState: {
            sendToChat: aSendToChat,
            contacts: [{ id: 'a-b', name: '乙', kind: 'real', linkedCharId: 'b', affinity: 0, status: 'friend', createdAt: 1 }],
            records: [],
        },
    } as unknown as CharacterProfile;
    const b = {
        id: 'b', name: '乙',
        phoneState: {
            sendToChat: bSendToChat,
            contacts: [{ id: 'b-a', name: '甲', kind: 'real', linkedCharId: 'a', affinity: 0, status: 'friend', createdAt: 1 }],
            records: [],
        },
    } as unknown as CharacterProfile;
    return new Map([[a.id, a], [b.id, b]]);
}

function createPersistence(characters: Map<string, CharacterProfile>) {
    let nextMessageId = 1;
    const messages = new Map<number, any>();
    const deletedMessageIds: number[] = [];
    return {
        messages,
        deletedMessageIds,
        api: {
            deleteMessage: async (id: number) => {
                deletedMessageIds.push(id);
                messages.delete(id);
            },
            saveMessage: async (message: any) => {
                const id = nextMessageId++;
                messages.set(id, { ...message, id });
                return id;
            },
            updateCharacter: (
                id: string,
                updates: Partial<CharacterProfile> | ((current: CharacterProfile) => Partial<CharacterProfile>),
            ) => {
                const current = characters.get(id)!;
                const partial = typeof updates === 'function' ? updates(current) : updates;
                characters.set(id, { ...current, ...partial });
            },
        },
    };
}

async function commitPair(
    characters: Map<string, CharacterProfile>,
    persistence: ReturnType<typeof createPersistence>,
    detail: string,
    sharedSendToChat: boolean,
) {
    const a = characters.get('a')!;
    const b = characters.get('b')!;
    await commitRealConversationSide({
        owner: a, partnerName: b.name, partnerCharId: b.id,
        detail, delta: 0, options: { sendToChatOverride: sharedSendToChat },
    }, persistence.api);
    await commitRealConversationSide({
        owner: b, partnerName: a.name, partnerCharId: a.id,
        detail: flipTranscript(detail), delta: 0,
        options: { sendToChatOverride: sharedSendToChat },
    }, persistence.api);
}

describe('真人手机私聊共享同步', () => {
    it('生成开始时从 target 冻结一次 shared 值，并显式传给 A/B 两侧', () => {
        const real = checkPhoneSource.slice(
            checkPhoneSource.indexOf('const handleRealConversation ='),
            checkPhoneSource.indexOf('const handleNpcConversation ='),
        );
        expect(real.indexOf('const sharedSendToChat = targetChar.phoneState?.sendToChat !== false'))
            .toBeLessThan(real.indexOf('setIsLoading(true)'));
        expect(real.match(/sendToChatOverride: sharedSendToChat/g)).toHaveLength(2);
        expect(real).not.toContain('b.phoneState?.sendToChat');
    });

    it('未传 override 时保留 owner 自己的旧 sendToChat 行为，并保留显式 false', async () => {
        const characters = createPair(true, false);
        const persistence = createPersistence(characters);
        const b = characters.get('b')!;

        const result = await commitRealConversationSide({
            owner: b, partnerName: '甲', partnerCharId: 'a', detail: '我: 本地记录', delta: 0,
        }, persistence.api);

        expect(result.sendToChat).toBe(false);
        expect(persistence.messages.size).toBe(0);
        expect(characters.get('b')!.phoneState!.records).toHaveLength(1);
    });

    it('target 开、B 自己关时，双方各写自身视角 phone_card 并绑定各自 message id', async () => {
        const characters = createPair(true, false);
        const persistence = createPersistence(characters);
        const aDetail = '我: 你也认识她？\n对方: 原来我们说的是同一个人。';

        await commitPair(characters, persistence, aDetail, true);

        const aRecord = characters.get('a')!.phoneState!.records[0];
        const bRecord = characters.get('b')!.phoneState!.records[0];
        expect(aRecord).toMatchObject({ detail: aDetail, systemMessageId: 1 });
        expect(bRecord).toMatchObject({ detail: flipTranscript(aDetail), systemMessageId: 2 });
        expect(persistence.messages.get(1)).toMatchObject({ charId: 'a', type: 'phone_card' });
        expect(persistence.messages.get(1).metadata.phoneCard.detail).toBe(aDetail);
        expect(persistence.messages.get(2)).toMatchObject({ charId: 'b', type: 'phone_card' });
        expect(persistence.messages.get(2).metadata.phoneCard.detail).toBe(flipTranscript(aDetail));
    });

    it('target 关、B 自己开时，双方 records 正常保存但都不写主聊天卡片', async () => {
        const characters = createPair(false, true);
        const persistence = createPersistence(characters);

        await commitPair(characters, persistence, '我: 先别告诉她。\n对方: 好。', false);

        expect(persistence.messages.size).toBe(0);
        expect(characters.get('a')!.phoneState!.records).toHaveLength(1);
        expect(characters.get('b')!.phoneState!.records).toHaveLength(1);
        expect(characters.get('a')!.phoneState!.records[0].systemMessageId).toBeUndefined();
        expect(characters.get('b')!.phoneState!.records[0].systemMessageId).toBeUndefined();
    });

    it('账号被代发的一侧保存 structured thread，但不写普通 phone_card、不改变 affinity/learned', async () => {
        const characters = createPair(true, true);
        const persistence = createPersistence(characters);
        const a = characters.get('a')!;
        const turns = [{
            id: 'operator-a', side: 'owner' as const, text: '这句由操作者写', author: 'operator' as const,
            claimedSpeaker: { kind: 'character' as const, charId: 'a' }, impersonated: true,
            source: 'check-phone-impersonation' as const,
        }];
        await commitRealConversationSide({
            owner: a, partnerName: '乙', partnerCharId: 'b', detail: '我: 这句由操作者写',
            delta: 20, learnedNew: '不应写入', conversationTurns: turns,
            options: { sendToChatOverride: true, participant: false },
        }, persistence.api);
        expect(persistence.messages.size).toBe(0);
        expect(characters.get('a')!.phoneState!.contacts![0]).toMatchObject({ affinity: 0 });
        expect(characters.get('a')!.phoneState!.contacts![0].learned).toBeUndefined();
        expect(characters.get('a')!.phoneState!.records[0].conversationTurns).toEqual(turns);
    });

    it('接管 A→B 时只有真正回复的 B 更新好感与了解', async () => {
        const characters = createPair(true, true);
        const persistence = createPersistence(characters);
        const a = characters.get('a')!;
        const b = characters.get('b')!;
        await commitRealConversationSide({
            owner: a, partnerName: b.name, partnerCharId: b.id,
            detail: '我: 代发\n对方: 回复', delta: 18, learnedNew: '不应属于 A',
            options: { sendToChatOverride: true, participant: false },
        }, persistence.api);
        await commitRealConversationSide({
            owner: b, partnerName: a.name, partnerCharId: a.id,
            detail: '对方: 代发\n我: 回复', delta: 7, learnedNew: 'A 似乎在试探',
            options: { sendToChatOverride: true, participant: true },
        }, persistence.api);
        expect(characters.get('a')!.phoneState!.contacts![0]).toMatchObject({ affinity: 0 });
        expect(characters.get('a')!.phoneState!.contacts![0].learned).toBeUndefined();
        expect(characters.get('b')!.phoneState!.contacts![0]).toMatchObject({ affinity: 7, learned: 'A 似乎在试探' });
        expect([...persistence.messages.values()]).toHaveLength(1);
        expect([...persistence.messages.values()][0]).toMatchObject({ charId: 'b', type: 'phone_card' });
    });

    it('续写时双方分别删除旧卡，只保留最新完整卡并更新 record id', async () => {
        const characters = createPair(true, false);
        const persistence = createPersistence(characters);
        await commitPair(characters, persistence, '我: A\n对方: B', true);
        const oldA = characters.get('a')!.phoneState!.records[0].systemMessageId!;
        const oldB = characters.get('b')!.phoneState!.records[0].systemMessageId!;

        const full = '我: A\n对方: B\n我: C\n对方: D';
        await commitPair(characters, persistence, full, true);

        const nextA = characters.get('a')!.phoneState!.records[0];
        const nextB = characters.get('b')!.phoneState!.records[0];
        expect(persistence.deletedMessageIds).toEqual([oldA, oldB]);
        expect([...persistence.messages.keys()]).toEqual([3, 4]);
        expect(nextA).toMatchObject({ detail: full, systemMessageId: 3 });
        expect(nextB).toMatchObject({ detail: flipTranscript(full), systemMessageId: 4 });
    });

    it('清空仍按双方 record 删除卡片、记录、topicBox 与 archivedThru', () => {
        const clear = checkPhoneSource.slice(
            checkPhoneSource.indexOf('const handleClearContactConversation ='),
            checkPhoneSource.indexOf('const saveEditedConversation ='),
        );
        expect(clear).toContain('if (myRec?.systemMessageId) await DB.deleteMessage(myRec.systemMessageId)');
        expect(clear).toContain('if (bRec?.systemMessageId) await DB.deleteMessage(bRec.systemMessageId)');
        expect(clear.match(/filter\(r => !isChatWith/g)).toHaveLength(2);
        expect(clear.match(/topicBox: \[\], archivedThru: 0/g)).toHaveLength(2);
    });

    it('NPC 继续只读取 target 自己的 sendToChat，不套用真人共享覆盖', () => {
        const npc = checkPhoneSource.slice(
            checkPhoneSource.indexOf('const handleNpcConversation ='),
            checkPhoneSource.indexOf('const handleClearContactConversation ='),
        );
        expect(npc).toContain('const pushToChat = targetChar.phoneState?.sendToChat !== false');
        expect(npc).not.toContain('sendToChatOverride');
        expect(npc).not.toContain('sharedSendToChat');
    });

    it('普通手机证据与手工事后同步仍按原有单角色路径', () => {
        const manual = checkPhoneSource.slice(
            checkPhoneSource.indexOf('const syncEvidenceRecordToChat ='),
            checkPhoneSource.indexOf('const fmtClock ='),
        );
        expect(manual).toContain("charId: targetChar.id");
        expect(manual).toContain("type: 'phone_card'");
        expect(manual).toContain('item.id === record.id');
        expect(manual).not.toContain('sharedSendToChat');
        expect(manual).not.toContain('sendToChatOverride');
    });

    it('编辑真人对话时只取当前 target 的共享选择刷新双侧，NPC 仍走 owner 开关', () => {
        const edit = checkPhoneSource.slice(
            checkPhoneSource.indexOf('const saveEditedConversation ='),
            checkPhoneSource.indexOf('const exitMsgSelect ='),
        );
        expect(edit).toContain("const sharedSendToChat = c.kind === 'real'");
        expect(edit).toContain("? targetChar.phoneState?.sendToChat !== false");
        expect(edit).toContain('const ownerSendToChat = sharedSendToChat ?? (targetChar.phoneState?.sendToChat !== false)');
        expect(edit).toContain('if (has && ownerSendToChat && ownerMayRefreshCard)');
        expect(edit).toContain('if (bHas && sharedSendToChat && contactMayRefreshCard)');
        expect(edit).toContain("const lastOperator = newTurns ? newTurns.map(turn => turn.author).lastIndexOf('operator') : -1");
        expect(edit).not.toContain('b.phoneState?.sendToChat');
    });
});
