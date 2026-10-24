// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import HtmlCard from '../components/chat/HtmlCard';
import { copyTextToClipboard } from './clipboard';

vi.mock('./clipboard', () => ({ copyTextToClipboard: vi.fn() }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const html = '  <div>原样 &amp; 😀</div>\n';

afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
});

describe('HtmlCard source copy button', () => {
    it('copies the html prop and keeps button gestures out of the message layer', async () => {
        vi.mocked(copyTextToClipboard).mockResolvedValue(true);
        const parentPointerDown = vi.fn();
        const parentClick = vi.fn();
        const parentContextMenu = vi.fn();
        const host = document.createElement('div');
        document.body.appendChild(host);
        const root = createRoot(host);

        await act(async () => {
            root.render(React.createElement(
                'div',
                { onPointerDown: parentPointerDown, onClick: parentClick, onContextMenu: parentContextMenu },
                React.createElement(HtmlCard, { html }),
            ));
        });

        const button = host.querySelector('button[aria-label="复制完整 HTML 源码"]') as HTMLButtonElement;
        expect(button).not.toBeNull();
        expect(host.querySelector('iframe')?.getAttribute('sandbox')).toBe('allow-same-origin');

        await act(async () => {
            button.dispatchEvent(new Event('pointerdown', { bubbles: true }));
            button.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
            button.click();
        });

        expect(copyTextToClipboard).toHaveBeenCalledWith(html);
        expect(parentPointerDown).not.toHaveBeenCalled();
        expect(parentClick).not.toHaveBeenCalled();
        expect(parentContextMenu).not.toHaveBeenCalled();
        expect(button.textContent).toContain('已复制');

        await act(async () => root.unmount());
    });
});
