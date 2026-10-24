// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import type { Message } from '../types';
import { DB } from './db';
import { extractRepairSegments, planHtmlFormatRepair } from './htmlFormatRepair';
import { normalizeMessageContent } from './messageFormat';

const row = (id: number, content: string, role: Message['role'] = 'assistant'): Message =>
    ({ id, charId: 'html-repair-test', role, type: 'text', content, timestamp: id * 1000 });
const cards = (source: string) => extractRepairSegments(source).filter(s => s.kind === 'html');

describe('manual HTML format repair', () => {
    it('restores the screenshot case: one complete bare HTML source with CSS', () => {
        const source = '<div class="mw-scope-root"><style>.x{color:red}</style><p>你好</p></div>';
        const plan = planHtmlFormatRepair([row(1, source)], 1)!;
        expect(plan.segments).toEqual([{ kind: 'html', html: source, textPreview: '你好' }]);
        expect(plan.anchor.id).toBe(1);
        expect(plan.deleteIds).toEqual([]);
    });

    it('accepts complete tagged and HTML-fenced source, removing only wrappers', () => {
        expect(cards('[html]<div>甲</div>[/html]')[0]).toMatchObject({ html: '<div>甲</div>' });
        expect(cards('```html\n<div>乙</div>\n```')[0]).toMatchObject({ html: '<div>乙</div>' });
    });

    it('preserves text/card/text and multiple cards in character order', () => {
        const source = '给你看：\n<div>甲</div>\n还有：\n<div>乙</div>\n怎么样？';
        const plan = planHtmlFormatRepair([row(1, source)], 1)!;
        expect(plan.segments.map(s => s.kind)).toEqual(['text', 'html', 'text', 'html', 'text']);
        expect(plan.content).toBe('给你看：\n[HTML卡片] 甲\n还有：\n[HTML卡片] 乙\n怎么样？');
    });

    it('recovers a card split across three assistant messages when the middle is selected', () => {
        const plan = planHtmlFormatRepair([
            row(1, '<div><style>.a{'), row(2, 'color:red'), row(3, '}</style>好</div>'),
        ], 2)!;
        expect(plan.anchor.id).toBe(1);
        expect(plan.deleteIds).toEqual([2, 3]);
        expect(plan.cardCount).toBe(1);
    });

    it('repairs two complete cards in one adjacent assistant reply with one click', () => {
        const plan = planHtmlFormatRepair([
            row(1, '第一张 <div>甲</div>'), row(2, '第二张 <div>乙'), row(3, '完成</div>'),
        ], 1)!;
        expect(plan.cardCount).toBe(2);
        expect(plan.segments.map(s => s.kind)).toEqual(['text', 'html', 'text', 'html']);
        expect(plan.deleteIds).toEqual([2, 3]);
    });

    it('keeps incomplete source as text while repairing complete cards', () => {
        const plan = planHtmlFormatRepair([row(1, '<div>甲</div>\n<div>坏')], 1)!;
        expect(plan.cardCount).toBe(1);
        expect(plan.segments.at(-1)).toEqual({ kind: 'text', text: '\n<div>坏' });
    });

    it('rejects missing starts and closes, protocol tags and non-HTML fences', () => {
        for (const source of ['</style>尾巴</div>', '<div><p>少闭合</div>', '<div><div>内层</div>',
            '<原文>你好</原文><翻译>Hi</翻译><语音>好</语音>',
            '<scrapbook_status>[a|b]</scrapbook_status>', '```ts\n<div>代码示例</div>\n```']) {
            expect(cards(source), source).toHaveLength(0);
        }
    });

    it('does not depend on the character HTML-mode switch', () => {
        const message = { ...row(1, '<div>可修</div>'), metadata: { htmlModeEnabled: false } };
        expect(planHtmlFormatRepair([message], 1)?.cardCount).toBe(1);
    });

    it('commits the anchor, source provenance and fragment deletion together', async () => {
        const charId = `html-repair-${Date.now()}`;
        const first = await DB.saveMessage({ charId, role: 'assistant', type: 'text', content: '说：<div>好', replyTo: { id: 7, name: '我', content: '引用' }, metadata: { thinkingChain: '保留' } });
        const second = await DB.saveMessage({ charId, role: 'assistant', type: 'text', content: '</div>结束' });
        const history = await DB.getMessagesByCharId(charId, true);
        const plan = planHtmlFormatRepair(history, second)!;
        const changed = await DB.applyHtmlFormatRepair(plan);
        expect(changed.id).toBe(first);
        expect(changed.timestamp).toBe(history[0].timestamp);
        expect(changed.replyTo?.id).toBe(7);
        expect(changed.metadata.thinkingChain).toBe('保留');
        expect(changed.metadata.htmlFormatRepair.sourceMessageIds).toEqual([first, second]);
        expect((await DB.getMessagesByCharId(charId, true)).map(m => m.id)).toEqual([first]);
        expect(normalizeMessageContent(changed, '角色', '我')).toBe('说：[HTML卡片] 好结束');
        expect(changed.content).not.toContain('<div>');
    });

    it('updates a pure card in place with the existing HtmlCard metadata shape', async () => {
        const charId = `html-repair-pure-${Date.now()}`;
        const id = await DB.saveMessage({ charId, role: 'user', type: 'text', content: '<div><style>.x{color:red}</style>纯卡</div>', metadata: { source: 'imported' } });
        const before = (await DB.getMessageById(id))!;
        const plan = planHtmlFormatRepair([before], id)!;
        const after = await DB.applyHtmlFormatRepair(plan);
        expect(after.id).toBe(id);
        expect(after.timestamp).toBe(before.timestamp);
        expect(after.role).toBe('user');
        expect(after.metadata.source).toBe('imported');
        expect(after.metadata.htmlSource).toBe(before.content);
        expect(after.metadata.htmlTextPreview).toBe('纯卡');
        expect(after.metadata.htmlRepairSegments).toBeUndefined();
        expect(normalizeMessageContent(after, '角色', '我')).toBe('[HTML卡片] 纯卡');
    });

    it('rejects a stale plan without partial changes', async () => {
        const charId = `html-repair-stale-${Date.now()}`;
        const id = await DB.saveMessage({ charId, role: 'assistant', type: 'text', content: '<div>原文</div>' });
        const plan = planHtmlFormatRepair(await DB.getMessagesByCharId(charId, true), id)!;
        await DB.updateMessage(id, '其他编辑');
        await expect(DB.applyHtmlFormatRepair(plan)).rejects.toThrow();
        expect((await DB.getMessageById(id))?.content).toBe('其他编辑');
    });
});
