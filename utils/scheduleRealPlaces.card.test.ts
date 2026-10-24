// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CharacterProfile, DailySchedule, OSTheme, ScheduleSlot } from '../types';
import { ScheduleCardView } from '../components/schedule/ScheduleCard';

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
afterEach(() => { document.body.innerHTML = ''; vi.restoreAllMocks(); });

describe('日程卡真实地点标识和人工编辑', () => {
    it('显示高德来源与官方详情入口，改地点后提交的 slot 不再带认证', async () => {
        const host = document.createElement('div'); document.body.appendChild(host);
        const root = createRoot(host);
        const slot: ScheduleSlot = { startTime: '12:00', activity: '吃午饭', description: '在店里吃饭', location: '公开餐馆', homePosition: { kind: 'away' },
            realPlace: { source: 'amap', id: 'B000003', name: '公开餐馆', city: '北京市', district: '朝阳区', category: 'food' } };
        const schedule = { id: 'synthetic_2026-10-23', charId: 'synthetic', date: '2026-10-23', generatedAt: Date.now(), slots: [slot] } as DailySchedule;
        const onEdit = vi.fn();
        await act(async () => { root.render(React.createElement(ScheduleCardView, { schedule, character: { id: 'synthetic', name: '小林' } as CharacterProfile,
            theme: {} as OSTheme, onEdit, previewNow: new Date('2026-10-23T13:00:00') })); });
        const link = host.querySelector<HTMLAnchorElement>('a[aria-label="高德查看公开餐馆"]')!;
        expect(link.href).toContain('uri.amap.com/marker?poiid=B000003');
        expect(host.textContent).toContain('公开餐馆');
        await act(async () => { host.querySelector<HTMLElement>('[data-testid="schedule-slot-0"]')!.click(); });
        const input = host.querySelector<HTMLInputElement>('input[aria-label="日程地点"]')!;
        await act(async () => { const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!; setter.call(input, '另一家店'); input.dispatchEvent(new Event('input', { bubbles: true })); });
        await act(async () => { [...host.querySelectorAll('button')].find(button => button.textContent === '保存')!.click(); });
        expect(onEdit).toHaveBeenCalledOnce();
        expect(onEdit.mock.calls[0][1].location).toBe('另一家店');
        expect(onEdit.mock.calls[0][1].realPlace).toBeUndefined();
        await act(async () => { root.unmount(); });
    });
});
