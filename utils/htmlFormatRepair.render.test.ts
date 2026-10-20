// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import HtmlRepairComposite from '../components/chat/HtmlRepairComposite';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => document.body.replaceChildren());

describe('repaired composite rendering', () => {
    it('renders text, two existing HtmlCards and text in original order without raw source text', async () => {
        const host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);
        await act(async () => root.render(React.createElement(HtmlRepairComposite, { isUser: false, segments: [
            { kind: 'text', text: '前言' },
            { kind: 'html', html: '<div>甲</div>', textPreview: '甲' },
            { kind: 'text', text: '中间' },
            { kind: 'html', html: '<div>乙</div>', textPreview: '乙' },
            { kind: 'text', text: '后话' },
        ] })));
        const children = [...host.querySelector('[data-html-repair-composite]')!.children];
        expect(children).toHaveLength(5);
        expect(children.map(element => element.querySelector('iframe') ? 'card' : element.textContent)).toEqual(['前言', 'card', '中间', 'card', '后话']);
        expect(host.querySelectorAll('iframe')).toHaveLength(2);
        expect(host.textContent).not.toContain('<div>');
        await act(async () => root.unmount());
    });
});
