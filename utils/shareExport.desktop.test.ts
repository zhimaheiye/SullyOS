// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BROWSER_SHARE_FILE_LIMIT, downloadBlobLocally, isDesktopWeb } from './shareExport';

const originalUserAgent = Object.getOwnPropertyDescriptor(navigator, 'userAgent');
const originalMaxTouchPoints = Object.getOwnPropertyDescriptor(navigator, 'maxTouchPoints');

const stubNavigator = (overrides: Record<string, unknown>) => {
    for (const [key, value] of Object.entries(overrides)) {
        Object.defineProperty(navigator, key, { configurable: true, value });
    }
};

afterEach(() => {
    if (originalUserAgent) Object.defineProperty(navigator, 'userAgent', originalUserAgent);
    else Reflect.deleteProperty(navigator, 'userAgent');
    if (originalMaxTouchPoints) Object.defineProperty(navigator, 'maxTouchPoints', originalMaxTouchPoints);
    else Reflect.deleteProperty(navigator, 'maxTouchPoints');
    vi.restoreAllMocks();
});

describe('isDesktopWeb', () => {
    it('常量对齐 Chromium navigator.share 单文件 50 MiB 上限', () => {
        expect(BROWSER_SHARE_FILE_LIMIT).toBe(50 * 1024 * 1024);
    });
    it('普通桌面浏览器（无触点）判为桌面，直接下载', () => {
        expect(isDesktopWeb()).toBe(true);
    });
    it('安卓移动 UA 判为移动端，保留系统分享', () => {
        stubNavigator({ userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126 Mobile Safari/537.36', maxTouchPoints: 5 });
        expect(isDesktopWeb()).toBe(false);
    });
    it('iPadOS 桌面模式（Macintosh UA + 多点触控）判为移动端', () => {
        stubNavigator({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15', maxTouchPoints: 5 });
        expect(isDesktopWeb()).toBe(false);
    });
    it('触屏笔记本主指针是鼠标，仍判为桌面直接下载', () => {
        stubNavigator({ userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36', maxTouchPoints: 10 });
        const matchMedia = vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: false } as MediaQueryList);
        expect(isDesktopWeb()).toBe(true);
        expect(matchMedia).toHaveBeenCalledWith('(pointer: coarse)');
    });
    it('触点 + 粗主指针（纯平板）判为移动端', () => {
        stubNavigator({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/534.6 Safari/534.6', maxTouchPoints: 5 });
        vi.spyOn(window, 'matchMedia').mockReturnValue({ matches: true } as MediaQueryList);
        expect(isDesktopWeb()).toBe(false);
    });
});

describe('downloadBlobLocally', () => {
    it('通过 a.download 发起浏览器下载并返回 downloaded', async () => {
        const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
        const createObjectURL = vi.fn(() => 'blob:mock-url');
        const revokeObjectURL = vi.fn();
        const originals: Array<[string, PropertyDescriptor | undefined]> = [];
        for (const [key, value] of [['createObjectURL', createObjectURL], ['revokeObjectURL', revokeObjectURL]] as const) {
            originals.push([key, Object.getOwnPropertyDescriptor(URL, key)]);
            Object.defineProperty(URL, key, { configurable: true, value });
        }
        try {
            const blob = new Blob(['png-bytes'], { type: 'image/png' });
            await expect(downloadBlobLocally(blob, '卡片.sully.png')).resolves.toBe('downloaded');
            expect(click).toHaveBeenCalledTimes(1);
            const anchor = click.mock.instances[0] as unknown as HTMLAnchorElement;
            expect(anchor.download).toBe('卡片.sully.png');
            expect(anchor.href).toBe('blob:mock-url');
            expect(anchor.isConnected).toBe(false);
            expect(createObjectURL).toHaveBeenCalledWith(blob);
        } finally {
            for (const [key, descriptor] of originals) {
                if (descriptor) Object.defineProperty(URL, key, descriptor);
                else Reflect.deleteProperty(URL, key);
            }
        }
    });
});
