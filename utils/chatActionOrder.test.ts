// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import {
    CHAT_ACTION_ORDER_KEY, loadChatActionOrders, mergeChatActionOrder, moveChatAction,
    normalizeChatActionOrders, resetChatActionOrder, saveChatActionOrder,
} from './chatActionOrder';

beforeEach(() => localStorage.clear());

describe('chat plus-menu order', () => {
    it('uses exact default order without a saved preference, then appends new IDs', () => {
        expect(mergeChatActionOrder(['a', 'b', 'c'], loadChatActionOrders().private)).toEqual(['a', 'b', 'c']);
        saveChatActionOrder('private', ['c', 'a', 'b']);
        expect(mergeChatActionOrder(['a', 'b', 'c', 'new-feature'], loadChatActionOrders().private)).toEqual(['c', 'a', 'b', 'new-feature']);
        expect(mergeChatActionOrder(['a', 'new_feature'], ['a'])).toEqual(['a', 'new_feature']);
        expect(mergeChatActionOrder(['a', 'b', 'c'], loadChatActionOrders().group)).toEqual(['a', 'b', 'c']);
    });

    it('cleans corrupted, duplicate, removed, and malicious IDs without hiding valid actions', () => {
        localStorage.setItem(CHAT_ACTION_ORDER_KEY, JSON.stringify({ private: ['c', 'c', '<script>', 3, 'deleted', 'a'], group: 'bad' }));
        expect(loadChatActionOrders()).toEqual({ private: ['c', 'deleted', 'a'], group: [] });
        expect(mergeChatActionOrder(['a', 'b', 'c'], loadChatActionOrders().private)).toEqual(['c', 'a', 'b']);
        localStorage.setItem(CHAT_ACTION_ORDER_KEY, '{broken');
        expect(loadChatActionOrders()).toEqual({ private: [], group: [] });
        expect(normalizeChatActionOrders({})).toEqual({ private: [], group: [] });
    });

    it('moves an ID across page boundaries and resets only the requested scope', () => {
        const ids = Array.from({ length: 18 }, (_, i) => `action-${i}`);
        const moved = moveChatAction(ids, 'action-17', 'action-0');
        expect(moved[0]).toBe('action-17');
        expect(new Set(moved).size).toBe(ids.length);
        saveChatActionOrder('private', moved);
        saveChatActionOrder('group', ['group-image', 'group-transfer']);
        resetChatActionOrder('private');
        expect(loadChatActionOrders()).toEqual({ private: [], group: ['group-image', 'group-transfer'] });
    });
});
