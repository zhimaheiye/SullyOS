import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readRealConversationModes, realConversationPairKey, saveRealConversationModes } from './realConversationMode';

const source = readFileSync(new URL('../apps/CheckPhone.tsx', import.meta.url), 'utf8');
const storageKey = 'cp_real_conversation_modes_v1';

beforeEach(() => localStorage.removeItem(storageKey));
afterEach(() => vi.restoreAllMocks());

describe('真人对话模式偏好', () => {
    it('默认自由；同一角色对双向共用，不同角色对独立，重新读取仍保持', () => {
        const ab = realConversationPairKey('a', 'b');
        const ba = realConversationPairKey('b', 'a');
        const ac = realConversationPairKey('a', 'c');
        expect(ab).toBe(ba);
        expect(readRealConversationModes()[ab] ?? 'free').toBe('free');
        saveRealConversationModes({ [ab]: 'mutual-friend', [ac]: 'free' });
        expect(readRealConversationModes()[ba]).toBe('mutual-friend');
        expect(readRealConversationModes()[ac]).toBe('free');
        saveRealConversationModes({ ...readRealConversationModes(), [ac]: 'mutual-friend' });
        expect(readRealConversationModes()).toEqual({ [ab]: 'mutual-friend', [ac]: 'mutual-friend' });
        saveRealConversationModes({ ...readRealConversationModes(), [ba]: 'free' });
        expect(readRealConversationModes()).toEqual({ [ab]: 'free', [ac]: 'mutual-friend' });
    });

    it.each(['null', '[]', 'false', '"mutual-friend"', '{invalid'])('损坏值 %s 安全回退', value => {
        localStorage.setItem(storageKey, value);
        expect(readRealConversationModes()).toEqual({});
    });

    it('只读取有效模式，读写异常不抛出', () => {
        localStorage.setItem(storageKey, '{"a::b":"mutual-friend","a::c":true,"b::c":"other"}');
        expect(readRealConversationModes()).toEqual({ 'a::b': 'mutual-friend' });
        vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new Error('unavailable'); });
        expect(readRealConversationModes()['a::b'] ?? 'free').toBe('free');
        vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('quota'); });
        expect(() => saveRealConversationModes({ 'a::b': 'mutual-friend' })).not.toThrow();
    });

    it('UI 根据当前 pair 派生选择，仅真人分支显示且实际生成传入该 pair 的模式', () => {
        expect(source).toContain('useState(readRealConversationModes)');
        expect(source).toContain("selectedContact?.kind === 'real' && selectedContact.linkedCharId");
        expect(source).toContain('realConversationPairKey(targetChar.id, selectedContact.linkedCharId)');
        expect(source).toContain("(realPairKey && realConversationModes[realPairKey]) || 'free'");
        expect(source).toContain("mode: realConversationModes[realConversationPairKey(targetChar.id, b.id)] ?? 'free'");
        const realBranch = source.slice(source.indexOf(') : isReal ? ('), source.indexOf('onClick={() => handleNpcConversation(c)}'));
        expect(realBranch).toContain('aria-label="对话模式"');
        expect(realBranch).toContain('aria-pressed={realConversationMode === mode}');
        expect(realBranch).toContain('changeRealConversationMode(mode)');
        const change = source.slice(source.indexOf('const changeRealConversationMode'), source.indexOf('const [identityDraft'));
        expect(change).toContain('setRealConversationModes(next)');
        expect(change).toContain('saveRealConversationModes(next)');
    });

    it('清空仍删除双方记录/卡片/话题盒/水位线，但不删除模式或 learned', () => {
        const clear = source.slice(source.indexOf('const handleClearContactConversation ='), source.indexOf('const saveEditedConversation ='));
        expect(clear.match(/DB.deleteMessage/g)).toHaveLength(2);
        expect(clear.match(/topicBox: \[\], archivedThru: 0/g)).toHaveLength(2);
        expect(clear).not.toMatch(/localStorage|[Mm]ode|learned/);
    });
});
