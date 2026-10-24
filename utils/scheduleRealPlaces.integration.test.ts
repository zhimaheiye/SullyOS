// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CharacterProfile, UserProfile } from '../types';
import { DB } from './db';
import { generateDailyScheduleForChar } from './scheduleGenerator';
import { USER_LOCATION_STORAGE_KEY } from './userLocationPrivacy';

vi.mock('./memoryPalace/pipeline', () => ({ injectMemoryPalace: vi.fn() }));
vi.mock('./chatContextRange', () => ({ loadCharacterContextRange: async () => ({ messages: [] }) }));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear(); document.body.innerHTML = ''; });

describe('官方搜索响应到单轮日程的合成契约', () => {
    it('从隔离接口取得候选后交给唯一模型请求，并在保存前验证 ID', async () => {
        localStorage.setItem(USER_LOCATION_STORAGE_KEY, JSON.stringify({ enabled: false, amapKey: 'SYNTHETIC_MAP_KEY', regions: [] }));
        const char = { id: 'synthetic-map-student', name: '小林', systemPrompt: '学生，白天去上课', scheduleFeatureEnabled: true,
            scheduleStyle: 'lifestyle', timeAwarenessEnabled: false, realPlaceSchedule: { enabled: true, region: { name: '北京市', adcode: '110000' } } } as CharacterProfile;
        const mapUrls: string[] = [];
        const originalAppend = document.body.appendChild.bind(document.body);
        vi.spyOn(document.body, 'appendChild').mockImplementation((node: Node) => {
            const appended = originalAppend(node);
            if (node instanceof HTMLIFrameElement) {
                const token = JSON.parse(node.srcdoc.match(/const token=("[^"]+");/)![1]);
                const url = JSON.parse(node.srcdoc.match(/script\.src=("[^"]+");/)![1]);
                mapUrls.push(url);
                const keywords = new URL(url).searchParams.get('keywords');
                const pois = keywords === '学校' ? [{ id: 'B000004', name: '示例学校', typecode: '141201', type: '科教文化服务;学校', cityname: '北京市', adname: '海淀区', adcode: '110108', location: '116.300000,39.980000' }]
                    : keywords === '餐饮' ? [{ id: 'B000003', name: '公开餐馆', typecode: '050100', cityname: '北京市', adname: '朝阳区', adcode: '110105', location: '116.500000,39.980000' }] : [];
                queueMicrotask(() => window.dispatchEvent(new MessageEvent('message', { source: node.contentWindow, data: { token, result: { status: '1', pois } } })));
            }
            return appended;
        });
        vi.spyOn(DB, 'getScheduleCoverImage').mockResolvedValue(undefined as any);
        vi.spyOn(DB, 'getEmojis').mockResolvedValue([]);
        vi.spyOn(DB, 'saveDailySchedule').mockResolvedValue(undefined);
        const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ slots: [
            { startTime: '08:00', activity: '上课', poiId: 'B000004', location: '示例学校' },
            { startTime: '12:00', activity: '吃午饭', poiId: 'B000003', location: '公开餐馆' },
            { startTime: '18:00', activity: '吃晚饭', poiId: 'MADE_UP', location: '幻觉饭店' },
        ] }) } }] }), { headers: { 'Content-Type': 'application/json' } }));
        vi.stubGlobal('fetch', fetch);
        const schedule = await generateDailyScheduleForChar(char, { name: '合成用户' } as UserProfile,
            { baseUrl: 'https://api.invalid/v1', apiKey: 'MODEL_MOCK', model: 'mock' }, true);
        expect(mapUrls).toHaveLength(4);
        expect(mapUrls.every(url => new URL(url).searchParams.get('city') === '110000')).toBe(true);
        expect(mapUrls.every(url => !url.includes('latitude') && !url.includes('longitude'))).toBe(true);
        expect(fetch).toHaveBeenCalledTimes(1);
        const prompt = JSON.stringify(JSON.parse(fetch.mock.calls[0][1].body).messages);
        expect(prompt).toContain('B000004'); expect(prompt).toContain('B000003');
        expect(prompt).not.toContain('SYNTHETIC_MAP_KEY');
        expect(schedule?.slots.map(slot => slot.realPlace?.id)).toEqual(['B000004', 'B000003', undefined]);
        expect(DB.saveDailySchedule).toHaveBeenCalledOnce();
    });
});
