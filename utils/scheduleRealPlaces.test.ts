// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CharacterProfile } from '../types';
import { buildScheduleAmapUrl, getScheduleMapAccess, parseSchedulePlaces, parseScheduleRegions, queryScheduleAmap, verifiedSchedulePlace } from './scheduleRealPlaces';
import { USER_LOCATION_STORAGE_KEY } from './userLocationPrivacy';

const region = { name: '北京市', adcode: '110000' };
const hidden = { id: 'private', name: '别名', longitude: 116.397, latitude: 39.914, radiusKm: 2 };
const poi = (id: string, name: string, typecode: string, location = '116.500000,39.980000') => ({
    id, name, typecode, cityname: '北京市', adname: '朝阳区', adcode: '110105', location,
});
const char = (city = region) => ({ id: 'synthetic-1', name: '小林', scheduleStyle: 'lifestyle', realPlaceSchedule: { enabled: true, region: city } }) as CharacterProfile;
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

describe('角色地点候选的独立区域和隐私校验', () => {
    it('只按角色选择的行政区构造固定官方查询，不读取 GPS 或隐藏中心', () => {
        localStorage.setItem(USER_LOCATION_STORAGE_KEY, JSON.stringify({ enabled: false, regions: [hidden], amapKey: 'SYNTHETIC_KEY' }));
        vi.stubGlobal('navigator', { geolocation: { getCurrentPosition: () => { throw new Error('GPS must not be read'); } } });
        expect(getScheduleMapAccess(char())).toMatchObject({ key: 'SYNTHETIC_KEY', region });
        expect(getScheduleMapAccess({ ...char({ name: '杭州市', adcode: '330100' }), id: 'synthetic-2' })?.region)
            .toEqual({ name: '杭州市', adcode: '330100' });
        const url = new URL(buildScheduleAmapUrl('/v3/place/text', 'SYNTHETIC_KEY', { keywords: '餐饮', city: region.adcode, citylimit: 'true' }));
        expect(url.origin + url.pathname).toBe('https://restapi.amap.com/v3/place/text');
        expect(url.searchParams.get('city')).toBe('110000');
        expect(url.href).not.toContain(String(hidden.longitude));
        expect(url.href).not.toContain(hidden.name);
        expect(url.href).not.toContain('synthetic-1');
    });

    it('高德返回内圈、模糊边界、错区、错类和无坐标 POI 全部不认证', () => {
        const results = parseSchedulePlaces({ status: '1', pois: [
            poi('B000001', '隐私圈内餐馆', '050100', '116.397000,39.914000'),
            poi('B000002', '边界餐馆', '050100', '116.421000,39.914000'),
            poi('B000003', '公开餐馆', '050100'),
            { ...poi('B000004', '异地餐馆', '050100'), adcode: '310101', cityname: '上海市' },
            poi('B000005', '错类书店', '060300'),
            poi('B000006', '没坐标', '050100', ''),
        ] }, region, 'food', [hidden]);
        expect(results.map(place => place.id)).toEqual(['B000003']);
        expect(results[0]).toMatchObject({ name: '公开餐馆', category: 'food', district: '朝阳区' });
    });

    it('只承认本批候选中 ID、原名和活动类别均匹配的地点，保存不带精确坐标', () => {
        const [candidate] = parseSchedulePlaces({ status: '1', pois: [poi('B000003', '公开餐馆', '050100')] }, region, 'food', []);
        expect(verifiedSchedulePlace('B000003', '公开餐馆', '吃午饭', '和朋友一起吃饭', { kind: 'away' }, [candidate]))
            .toEqual({ source: 'amap', id: 'B000003', name: '公开餐馆', city: '北京市', district: '朝阳区', category: 'food' });
        expect(verifiedSchedulePlace('FAKE_ID', '公开餐馆', '吃午饭', '', undefined, [candidate])).toBeUndefined();
        expect(verifiedSchedulePlace('B000003', '另一家餐馆', '吃午饭', '', undefined, [candidate])).toBeUndefined();
        expect(verifiedSchedulePlace('B000003', '公开餐馆', '写代码', '', undefined, [candidate])).toBeUndefined();
        expect(verifiedSchedulePlace('B000003', '公开餐馆', '吃午饭', '', { kind: 'home', roomId: 'study' }, [candidate])).toBeUndefined();
    });

    it('损坏的隐藏圈配置一律停用增强；旧角色和 mindful 不访问地图', () => {
        localStorage.setItem(USER_LOCATION_STORAGE_KEY, JSON.stringify({ enabled: false, regions: [{ ...hidden, radiusKm: -1 }], amapKey: 'SYNTHETIC_KEY' }));
        expect(() => getScheduleMapAccess(char())).toThrow();
        expect(getScheduleMapAccess({ ...char(), scheduleStyle: 'mindful' })).toBeUndefined();
        expect(getScheduleMapAccess({ ...char(), realPlaceSchedule: undefined })).toBeUndefined();
        expect(parseScheduleRegions({ status: '1', districts: [{ name: '北京市', adcode: '110000', level: 'province', districts: [{ name: '海淀区', adcode: '110108', level: 'district' }] }] }))
            .toEqual([{ name: '北京市', adcode: '110000' }, { name: '海淀区', adcode: '110108' }]);
    });

    it('高德脚本只在隔离框执行，伪造回程无效且结束即清理', async () => {
        const url = buildScheduleAmapUrl('/v3/place/text', 'SYNTHETIC_KEY', { keywords: '餐饮', city: '110000' });
        const pending = queryScheduleAmap(url);
        const frame = document.querySelector('iframe')!;
        expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
        expect(frame.srcdoc).toContain("connect-src 'none'");
        expect(frame.srcdoc).not.toContain(hidden.name);
        const token = JSON.parse(frame.srcdoc.match(/const token=("[^"]+");/)![1]);
        window.dispatchEvent(new MessageEvent('message', { source: window, data: { token, result: { status: '1' } } }));
        expect(frame.isConnected).toBe(true);
        window.dispatchEvent(new MessageEvent('message', { source: frame.contentWindow, data: { token, result: { status: '1', pois: [] } } }));
        await expect(pending).resolves.toMatchObject({ status: '1', pois: [] });
        expect(frame.isConnected).toBe(false);
    });
});
