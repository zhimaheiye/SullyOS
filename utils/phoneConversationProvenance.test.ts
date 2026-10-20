import { describe, expect, it } from 'vitest';
import type { PhoneConversationTurn, PhoneEvidence } from '../types';
import {
    deletePhoneConversationTurns,
    editPhoneConversationTurn,
    materializePhoneConversationTurns,
    mirrorPhoneConversationTurns,
    projectPhoneConversationForViewer,
    serializePhoneConversationTurns,
} from './phoneConversationProvenance';

const forgedBToA: PhoneConversationTurn[] = [{
    id: 'turn-1', side: 'contact', text: '你跟芝麻到底怎么回事？', author: 'operator',
    claimedSpeaker: { kind: 'character', charId: 'b' }, impersonated: true,
    source: 'check-phone-impersonation',
}];

describe('手机对话 provenance 与视角投影', () => {
    it('冒充 B→A 时 A 只见 B 的表象，B 只见非本人账号记录且不泄露 operator/user', () => {
        const aView = projectPhoneConversationForViewer(forgedBToA, {
            viewerCharId: 'a', ownerCharId: 'a', ownerName: '甲', contactName: '乙',
        });
        expect(aView).toBe('乙: 你跟芝麻到底怎么回事？');
        expect(aView).not.toMatch(/operator|冒充|用户代发|幕后/);

        const bView = projectPhoneConversationForViewer(forgedBToA, {
            viewerCharId: 'b', ownerCharId: 'a', ownerName: '甲', contactName: '乙',
        });
        expect(bView).toContain('不是你本人生成或发送');
        expect(bView).toContain('不知道是谁操作');
        expect(bView).not.toMatch(/operator|用户冒充|芝麻(?:就是|在幕后|操作了)/);
        expect(bView).not.toContain('乙:');
    });

    it('接管 A→B 对称成立，镜像只翻 side 而不丢实际作者', () => {
        const turns: PhoneConversationTurn[] = [{
            id: 'turn-a', side: 'owner', text: '你今天怎么怪怪的？', author: 'operator',
            claimedSpeaker: { kind: 'character', charId: 'a' }, impersonated: true,
            source: 'check-phone-impersonation',
        }];
        expect(projectPhoneConversationForViewer(turns, {
            viewerCharId: 'b', ownerCharId: 'a', ownerName: '甲', contactName: '乙',
        })).toBe('甲: 你今天怎么怪怪的？');
        expect(projectPhoneConversationForViewer(turns, {
            viewerCharId: 'a', ownerCharId: 'a', ownerName: '甲', contactName: '乙',
        })).toContain('不是你本人生成或发送');
        expect(mirrorPhoneConversationTurns(turns)[0]).toMatchObject({ id: 'turn-a', side: 'contact', author: 'operator', impersonated: true });
    });

    it('旧 detail 确定性物化，序列化、编辑、删除与刷新都保留稳定 provenance', () => {
        const record = { id: 'record-1', detail: '我: 第一条\n续行\n对方: 第二条' } as PhoneEvidence;
        const first = materializePhoneConversationTurns(record, { ownerCharId: 'a', contactCharId: 'b' });
        const second = materializePhoneConversationTurns(record, { ownerCharId: 'a', contactCharId: 'b' });
        expect(second).toEqual(first);
        expect(first.map(turn => turn.id)).toEqual(['record-1:legacy:0', 'record-1:legacy:1', 'record-1:legacy:2']);
        expect(serializePhoneConversationTurns(first)).toBe('我: 第一条\n我: 续行\n对方: 第二条');

        const withOperator = [...first, ...forgedBToA];
        const edited = editPhoneConversationTurn(withOperator, 'turn-1', '改过但仍是代发');
        expect(edited.at(-1)).toMatchObject({ author: 'operator', text: '改过但仍是代发', impersonated: true });
        expect(deletePhoneConversationTurns(edited, ['record-1:legacy:1']).map(turn => turn.id))
            .toEqual(['record-1:legacy:0', 'record-1:legacy:2', 'turn-1']);

        const persisted = { ...record, detail: serializePhoneConversationTurns(edited), conversationTurns: edited };
        expect(materializePhoneConversationTurns(persisted, { ownerCharId: 'a', contactCharId: 'b' })).toEqual(edited);
    });
});
