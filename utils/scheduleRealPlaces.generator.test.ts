import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CharacterProfile, UserProfile } from '../types';
import { DB } from './db';
import { generateDailyScheduleForChar } from './scheduleGenerator';
import { prepareSchedulePlaces } from './scheduleRealPlaces';

vi.mock('./memoryPalace/pipeline', () => ({ injectMemoryPalace: vi.fn() }));
vi.mock('./chatContextRange', () => ({ loadCharacterContextRange: async () => ({ messages: [] }) }));
vi.mock('./scheduleRealPlaces', async original => ({
    ...await original<typeof import('./scheduleRealPlaces')>(),
    prepareSchedulePlaces: vi.fn(),
}));

const food = { source: 'amap' as const, id: 'B000003', name: '公开餐馆', city: '北京市', district: '朝阳区', category: 'food' as const, longitude: 116.5, latitude: 39.98 };
const school = { source: 'amap' as const, id: 'B000004', name: '示例学校', city: '北京市', district: '海淀区', category: 'school' as const, longitude: 116.3, latitude: 39.98 };
const char = {
    id: 'synthetic-student', name: '小林', scheduleFeatureEnabled: true, scheduleStyle: 'lifestyle', timeAwarenessEnabled: false,
    realPlaceSchedule: { enabled: true, region: { name: '北京市', adcode: '110000' }, anchors: { school } },
    homeDefinition: { kind: 'between-worlds', notes: '' },
    home3D: { version: 1, activeRoomId: 'study', rooms: [{ id: 'study', name: '书房', level: 0, x: 0, z: 0, wall: '#ffffff', items: [] }] },
} as unknown as CharacterProfile;
const user = { name: '合成用户' } as UserProfile;
const api = { baseUrl: 'https://api.invalid/v1', apiKey: 'MOCK_API_KEY', model: 'mock' };
const modelSlots = [
    { startTime: '08:00', activity: '上课', description: '在教室听课', homePosition: { kind: 'away' }, poiId: school.id, location: school.name },
    { startTime: '10:00', activity: '自习', description: '整理笔记', homePosition: { kind: 'away' }, location: '学校' },
    { startTime: '12:00', activity: '吃午饭', description: '在店里吃饭', homePosition: { kind: 'away' }, poiId: food.id, location: food.name },
    { startTime: '15:00', activity: '看书', homePosition: { kind: 'home', roomId: 'study' }, poiId: food.id, location: food.name },
    { startTime: '18:00', activity: '吃晚饭', homePosition: { kind: 'away' }, poiId: 'FAKE_ID', location: '虚构餐馆' },
    { startTime: '20:00', activity: '吃点心', homePosition: { kind: 'away' }, poiId: food.id, location: '另一家店' },
];

beforeEach(() => {
    vi.spyOn(DB, 'getScheduleCoverImage').mockResolvedValue(undefined as any);
    vi.spyOn(DB, 'getEmojis').mockResolvedValue([]);
    vi.spyOn(DB, 'saveDailySchedule').mockResolvedValue(undefined);
    vi.mocked(prepareSchedulePlaces).mockResolvedValue({ candidates: [school, food] });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('单轮日程生成的真实地点候选', () => {
    it('模型只调用一次；候选进入 prompt，入库仅含本批已校验 POI，家园仍优先', async () => {
        const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ slots: modelSlots }) } }] }), { headers: { 'Content-Type': 'application/json' } }));
        vi.stubGlobal('fetch', fetch);
        const result = await generateDailyScheduleForChar(char, user, api, true);
        expect(result?.slots).toHaveLength(6);
        expect(result?.slots[0].realPlace).toMatchObject({ id: school.id, name: school.name });
        expect(result?.slots[1]).toMatchObject({ location: school.name, realPlace: { id: school.id } });
        expect(result?.slots[2].realPlace).toMatchObject({ id: food.id, name: food.name });
        expect(result?.slots[3]).toMatchObject({ location: '书房', homePosition: { kind: 'home', roomId: 'study' } });
        expect(result?.slots[3].realPlace).toBeUndefined();
        expect(result?.slots[4].realPlace).toBeUndefined();
        expect(result?.slots[5].realPlace).toBeUndefined();
        expect(JSON.stringify(result)).not.toContain('116.5');
        expect(fetch).toHaveBeenCalledTimes(1);
        const prompt = JSON.stringify(JSON.parse(fetch.mock.calls[0][1].body).messages);
        expect(prompt).toContain(food.id);
        expect(prompt).toContain(school.id);
        expect(prompt).not.toContain('116.5');
        expect(prompt).not.toContain('MOCK_API_KEY');
        expect(DB.saveDailySchedule).toHaveBeenCalledOnce();
    });

    it('地图不可用时照旧保存自由文本日程，不追加模型调用', async () => {
        vi.mocked(prepareSchedulePlaces).mockResolvedValue({ candidates: [], warning: '高德地点搜索暂不可用' });
        const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ slots: [
            { startTime: '12:00', activity: '吃午饭', location: '熟悉的小店', homePosition: { kind: 'away' } },
        ] }) } }] }), { headers: { 'Content-Type': 'application/json' } }));
        vi.stubGlobal('fetch', fetch);
        const warning = vi.fn();
        const result = await generateDailyScheduleForChar(char, user, api, true, warning);
        expect(result?.slots[0]).toMatchObject({ location: '熟悉的小店' });
        expect(result?.slots[0].realPlace).toBeUndefined();
        expect(warning).toHaveBeenCalledWith('高德地点搜索暂不可用');
        expect(fetch).toHaveBeenCalledTimes(1);
    });

    it('先前固定点未通过本次隐私复查时，名称和 ID 不进入候选提示', async () => {
        vi.mocked(prepareSchedulePlaces).mockResolvedValue({ candidates: [food] });
        const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ slots: [
            { startTime: '12:00', activity: '吃午饭', poiId: food.id, location: food.name, homePosition: { kind: 'away' } },
        ] }) } }] }), { headers: { 'Content-Type': 'application/json' } }));
        vi.stubGlobal('fetch', fetch);
        await generateDailyScheduleForChar(char, user, api, true);
        const prompt = JSON.stringify(JSON.parse(fetch.mock.calls[0][1].body).messages);
        expect(prompt).toContain(food.id);
        expect(prompt).not.toContain(school.id);
        expect(prompt).not.toContain(school.name);
    });
    it('查询后隐藏地点配置改变时丢弃候选，模型仍仅运行一次普通日程', async () => {
        vi.mocked(prepareSchedulePlaces).mockResolvedValue({ candidates: [food], safetySnapshot: 'stale-privacy-config' });
        const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ slots: [
            { startTime: '12:00', activity: '吃午饭', location: '普通小店', homePosition: { kind: 'away' } },
        ] }) } }] }), { headers: { 'Content-Type': 'application/json' } }));
        vi.stubGlobal('fetch', fetch);
        const warning = vi.fn();
        const result = await generateDailyScheduleForChar(char, user, api, true, warning);
        expect(JSON.stringify(JSON.parse(fetch.mock.calls[0][1].body).messages)).not.toContain(food.id);
        expect(result?.slots[0].realPlace).toBeUndefined();
        expect(warning).toHaveBeenCalledWith('隐藏地点设置已变化，本次按普通日程生成');
        expect(fetch).toHaveBeenCalledTimes(1);
    });
});
