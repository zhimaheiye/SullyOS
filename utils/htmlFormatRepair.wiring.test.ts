import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import type { Message } from '../types';
import { normalizeMessageContent } from './messageFormat';

describe('private chat HTML repair integration', () => {
    it('keeps repaired mixed text and previews in context order without raw CSS', () => {
        const message = {
            id: 1, charId: 'c', role: 'assistant', type: 'html_card', timestamp: 1,
            content: '前言[HTML卡片] 可见文字后话',
            metadata: {
                htmlRepairSegments: [
                    { kind: 'text', text: '前言' },
                    { kind: 'html', html: '<div><style>.x{color:red}</style>可见文字</div>', textPreview: '可见文字' },
                    { kind: 'text', text: '后话' },
                ],
                htmlFormatRepair: { originalContents: [{ id: 1, content: '<div>raw</div>', timestamp: 1 }] },
            },
        } as Message;
        expect(normalizeMessageContent(message, '角色', '我')).toBe('前言[HTML卡片] 可见文字后话');
        expect(normalizeMessageContent(message, '角色', '我')).not.toContain('color:red');
        const old = { ...message, metadata: { htmlSource: '<div>旧卡</div>', htmlTextPreview: '旧卡' } };
        expect(normalizeMessageContent(old, '角色', '我')).toBe('[HTML卡片] 旧卡');
    });

    it('wires the action only into private chat and renders composite segments with HtmlCard', () => {
        const modal = readFileSync('components/chat/ChatModals.tsx', 'utf8');
        const chat = readFileSync('apps/Chat.tsx', 'utf8');
        const item = readFileSync('components/chat/MessageItem.tsx', 'utf8');
        const composite = readFileSync('components/chat/HtmlRepairComposite.tsx', 'utf8');
        const group = readFileSync('apps/GroupChat.tsx', 'utf8');
        expect(modal).toContain('快速修复格式');
        expect(chat).toContain('onQuickRepairHtml={handleQuickRepairHtml}');
        expect(chat).toContain('DB.applyHtmlFormatRepair(plan)');
        expect(item).toContain('<HtmlRepairComposite segments={segments}');
        expect(composite).toContain('data-html-repair-composite="true"');
        expect(composite).toContain('<HtmlCard key={index} html={segment.html} />');
        expect(group).not.toContain('onQuickRepairHtml');
    });
});
