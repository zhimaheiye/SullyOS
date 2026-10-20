import { describe, expect, it } from 'vitest';
import type { DiaryEntry, DiaryObservations } from '../types';
import {
    canReceiveUserDiaryBroadcast,
    DEFAULT_USER_DIARY_TEMPLATE,
    diaryTextOrTemplate,
    isPristineUserDiaryTemplate,
    resolveJournalTemplate,
    isUnansweredDiaryExpired,
    normalizeDiaryObservations,
    serializeUserDiaryForExchange,
    shouldRollJournalAtMidnight,
    syncUserDiaryContent,
} from './journal';

describe('exchange journal shared user page', () => {
    it('only fills the template when the user page is blank', () => {
        expect(diaryTextOrTemplate('   ')).toBe(DEFAULT_USER_DIARY_TEMPLATE);
        expect(DEFAULT_USER_DIARY_TEMPLATE).not.toContain('>');
        expect(diaryTextOrTemplate('  我自己的开头')).toBe('  我自己的开头');
    });

    it('replaces user text and observations on an existing unanswered diary', () => {
        const existing = {
            id: 'existing', charId: 'char-b', date: '2026-08-15', timestamp: 1, isArchived: true,
            userPage: { text: '旧正文', paperStyle: 'pink', stickers: [{ id: 's', url: 'x', x: 1, y: 2, rotation: 3 }] },
            chatCardMessageId: 41, autoSync: false,
        } as DiaryEntry;
        const synced = syncUserDiaryContent(existing, 'char-b', existing.date, {
            text: '共享后的正文',
            observations: { physical: { sleep: ' 睡得很好 ' }, cognitive: '想通了一件事' },
        }, 99);
        expect(canReceiveUserDiaryBroadcast(existing)).toBe(true);
        expect(synced.userPage).toEqual({
            ...existing.userPage,
            text: '共享后的正文',
            observations: { physical: { sleep: '睡得很好' }, cognitive: '想通了一件事' },
        });
        expect(synced.id).toBe('existing');
        expect(synced.timestamp).toBe(1);
        expect(synced.isArchived).toBe(true);
        expect(synced.chatCardMessageId).toBe(41);
        expect(synced.autoSync).toBe(false);
    });

    it('does not change a diary that already has a character reply', () => {
        const existing = {
            id: 'replied', charId: 'char-a', date: '2026-08-15', timestamp: 1, isArchived: true,
            userPage: {
                text: '交换时的正文', paperStyle: 'pink', stickers: [],
                observations: { emotional: '交换时的感受', events: [{ id: 'old', body: '交换时的事件' }] },
            },
            charPage: { text: '角色回复', paperStyle: 'plain', stickers: [] }, chatCardMessageId: 42,
        } as DiaryEntry;

        const synced = syncUserDiaryContent(existing, 'char-a', existing.date, {
            text: '别本日记的新正文', observations: { emotional: '开心' },
        }, 99);

        expect(canReceiveUserDiaryBroadcast(existing)).toBe(false);
        expect(synced).toBe(existing);
        expect(synced.userPage.text).toBe('交换时的正文');
        expect(synced.userPage.observations).toEqual(existing.userPage.observations);
        expect(synced.charPage).toBe(existing.charPage);
        expect(synced.chatCardMessageId).toBe(42);
    });

    it('creates a local editable user page without a character reply', () => {
        const synced = syncUserDiaryContent(undefined, 'char-c', '2026-08-15', {
            text: '今天的正文', observations: { volitional: '还是去做了' },
        }, 99);
        expect(synced.userPage.text).toBe('今天的正文');
        expect(synced.userPage.observations).toEqual({ volitional: '还是去做了' });
        expect(synced.charPage).toBeUndefined();
        expect(synced.chatCardMessageId).toBeUndefined();
        expect(synced.autoSync).toBe(true);
    });

    it('syncs only unanswered or missing diaries in a mixed broadcast', () => {
        const replied = {
            id: 'replied', charId: 'char-a', date: '2026-08-15', timestamp: 1, isArchived: false,
            userPage: { text: 'A 旧正文', paperStyle: 'grid', stickers: [] },
            charPage: { text: 'A 回复', paperStyle: 'plain', stickers: [] },
        } as DiaryEntry;
        const unanswered = {
            id: 'unanswered', charId: 'char-b', date: '2026-08-15', timestamp: 2, isArchived: false,
            userPage: { text: 'B 旧正文', paperStyle: 'pink', stickers: [] },
        } as DiaryEntry;
        const targets = [replied, unanswered, undefined];

        const results = targets.map((existing, index) => {
            if (!canReceiveUserDiaryBroadcast(existing)) return { status: 'skipped_replied' as const, entry: existing };
            return {
                status: 'synced' as const,
                entry: syncUserDiaryContent(existing, `char-${index}`, '2026-08-15', {
                    text: '广播新正文', observations: { emotional: '平静' },
                }, 99),
            };
        });

        expect(results.map(result => result.status)).toEqual(['skipped_replied', 'synced', 'synced']);
        expect(results.filter(result => result.status === 'synced')).toHaveLength(2);
        expect(results[0].entry?.userPage.text).toBe('A 旧正文');
        expect(results[1].entry?.userPage.text).toBe('广播新正文');
        expect(results[2].entry?.userPage.text).toBe('广播新正文');
    });

    it('removes empty fields, modules, and meaningless events before persistence', () => {
        const input: DiaryObservations = {
            physical: { sleep: '  ', diet: ' 米饭 ', exercise: '', body: '\n' },
            emotional: ' ',
            cognitive: '  想清楚了  ',
            volitional: '',
            events: [
                { id: ' empty ', title: ' ', body: ' ' },
                { id: ' kept ', title: ' 午后 ', body: ' 见到一只猫 ' },
            ],
        };

        expect(normalizeDiaryObservations(input)).toEqual({
            physical: { diet: '米饭' },
            cognitive: '想清楚了',
            events: [{ id: 'kept', title: '午后', body: '见到一只猫' }],
        });
        expect(normalizeDiaryObservations({ physical: {}, events: [] })).toBeUndefined();
    });

    it('keeps body-only exchange serialization compatible with the old diary content', () => {
        expect(serializeUserDiaryForExchange({ text: '  今天下雨了。  ' })).toBe('今天下雨了。');
        expect(serializeUserDiaryForExchange({ text: '今天下雨了。', observations: undefined }))
            .toBe('今天下雨了。');
    });

    it('serializes only the present observation modules without JSON or empty headings', () => {
        const serialized = serializeUserDiaryForExchange({
            text: '今天下雨了。',
            observations: { physical: { sleep: '七小时' }, cognitive: '注意力更集中' },
        });

        expect(serialized).toBe([
            '【我的日记】',
            '今天下雨了。',
            '',
            '【今天的一些观察】',
            '体能',
            '睡眠：七小时',
            '',
            '思维',
            '注意力更集中',
        ].join('\n'));
        expect(serialized).not.toContain('undefined');
        expect(serialized).not.toContain('情感');
        expect(serialized).not.toContain('{');
    });

    it('keeps multiple observation events in their original order', () => {
        const serialized = serializeUserDiaryForExchange({
            text: '正文',
            observations: {
                events: [
                    { id: 'a', title: '早上', body: '去买花' },
                    { id: 'b', body: '晚上散步' },
                ],
            },
        });

        expect(serialized.indexOf('早上')).toBeLessThan(serialized.indexOf('晚上散步'));
        expect(serialized).toContain('记录一件事情 · 早上\n去买花');
        expect(serialized).toContain('记录一件事情\n晚上散步');
    });

    it('broadcasts deletions as a source snapshot while preserving target paper and stickers', () => {
        const target = {
            id: 'target', charId: 'char-b', date: '2026-08-15', timestamp: 3, isArchived: false,
            userPage: {
                text: '旧正文', paperStyle: 'pink',
                stickers: [{ id: 's', url: 'x', x: 1, y: 2, rotation: 3 }],
                observations: {
                    cognitive: '旧思维',
                    events: [{ id: 'old-event', title: '旧事件', body: '旧内容' }],
                },
            },
        } as DiaryEntry;

        const synced = syncUserDiaryContent(target, target.charId, target.date, {
            text: '新正文', observations: { physical: { sleep: '八小时' } },
        }, 99);

        expect(synced.userPage.observations).toEqual({ physical: { sleep: '八小时' } });
        expect(synced.userPage.paperStyle).toBe('pink');
        expect(synced.userPage.stickers).toEqual(target.userPage.stickers);
    });

    it('removes the observations property from unanswered targets when the source clears it', () => {
        const target = {
            id: 'target', charId: 'char-b', date: '2026-08-15', timestamp: 3, isArchived: false,
            userPage: {
                text: '旧正文', paperStyle: 'grid', stickers: [],
                observations: { cognitive: '旧思维', events: [{ id: 'e', body: '旧事件' }] },
            },
        } as DiaryEntry;

        const synced = syncUserDiaryContent(target, target.charId, target.date, {
            text: '新正文', observations: { cognitive: ' ', events: [{ id: 'e', body: '' }] },
        });

        expect(synced.userPage).not.toHaveProperty('observations');
    });

    it('rolls only the just-finished day back to a fresh template page', () => {
        expect(shouldRollJournalAtMidnight('2026-08-16', '2026-08-16', '2026-08-17')).toBe(true);
        expect(shouldRollJournalAtMidnight('2026-08-15', '2026-08-16', '2026-08-17')).toBe(false);
        expect(shouldRollJournalAtMidnight('2026-08-16', '2026-08-16', '2026-08-16')).toBe(false);
    });

    it('treats a blank starting page as untouched and leaves saved custom text alone', () => {
        expect(resolveJournalTemplate({ mode: 'blank' })).toBe('');
        expect(isPristineUserDiaryTemplate({
            text: '', paperStyle: 'grid', stickers: [],
        }, '')).toBe(true);
        expect(isPristineUserDiaryTemplate({
            text: '我的模板', paperStyle: 'grid', stickers: [],
        }, '我的模板')).toBe(true);
        expect(diaryTextOrTemplate('已经写过', '')).toBe('已经写过');
        expect(diaryTextOrTemplate('   ', '自定义开头')).toBe('自定义开头');
    });

    it('does not persist an untouched template as an empty historical diary', () => {
        expect(isPristineUserDiaryTemplate({
            text: DEFAULT_USER_DIARY_TEMPLATE, paperStyle: 'grid', stickers: [],
        })).toBe(true);
        expect(isPristineUserDiaryTemplate({
            text: `${DEFAULT_USER_DIARY_TEMPLATE}\n写了一点`, paperStyle: 'grid', stickers: [],
        })).toBe(false);
        expect(isPristineUserDiaryTemplate({
            text: DEFAULT_USER_DIARY_TEMPLATE, paperStyle: 'grid', stickers: [],
            observations: { emotional: '有一点期待' },
        })).toBe(false);
    });

    it('expires an unanswered diary only after its local date has passed', () => {
        const unanswered = {
            id: 'unanswered', charId: 'char-a', date: '2026-08-16', timestamp: 1, isArchived: false,
            userPage: { text: '今天的正文', paperStyle: 'grid', stickers: [] },
        } as DiaryEntry;

        expect(isUnansweredDiaryExpired(unanswered, '2026-08-16')).toBe(false);
        expect(isUnansweredDiaryExpired(unanswered, '2026-08-17')).toBe(true);
    });

    it('never expires a diary that already has a character reply', () => {
        const replied = {
            id: 'replied', charId: 'char-a', date: '2026-08-16', timestamp: 1, isArchived: false,
            userPage: { text: '用户正文', paperStyle: 'grid', stickers: [] },
            charPage: { text: '角色回复', paperStyle: 'plain', stickers: [] },
        } as DiaryEntry;

        expect(isUnansweredDiaryExpired(replied, '2026-08-17')).toBe(false);
        expect(isUnansweredDiaryExpired(replied, '2026-09-01')).toBe(false);
    });
});
