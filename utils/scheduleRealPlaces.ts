import type { CharacterProfile, CharacterRealPlaceSchedule, ScheduleRealPlace } from '../types';
import { wgs84ToAmap } from './amapCoordinates';
import { loadUserLocationConfig, locationDistanceMeters, type UserPrivacyRegion } from './userLocationPrivacy';

export type PlaceCategory = ScheduleRealPlace['category'];
export type PlaceRegion = NonNullable<CharacterRealPlaceSchedule['region']>;
export type PlaceCandidate = ScheduleRealPlace & { longitude: number; latitude: number };

const AMAP_ORIGIN = 'https://restapi.amap.com';
const CALLBACK = '__sullySchedulePlace';
const CATEGORY: Record<PlaceCategory, { keyword: string; prefix: string }> = {
    school: { keyword: '学校', prefix: '14' },
    work: { keyword: '公司', prefix: '17' },
    food: { keyword: '餐饮', prefix: '05' },
    shop: { keyword: '便利店|书店', prefix: '06' },
    park: { keyword: '公园', prefix: '11' },
};
const clean = (value: unknown, length = 80): string => typeof value === 'string'
    ? value.replace(/[\r\n<>\u0000-\u001f]/g, ' ').trim().slice(0, length) : '';
const validKey = (key: string) => /^[a-zA-Z0-9_-]{1,128}$/.test(key);
const validId = (id: string) => /^[A-Za-z0-9]{6,32}$/.test(id);
const validRegion = (region: PlaceRegion | undefined): region is PlaceRegion => !!region
    && /^[\u4e00-\u9fa5·]{2,30}$/.test(region.name)
    && /^\d{6}$/.test(region.adcode);

export function amapPlaceUrl(place: ScheduleRealPlace): string | undefined {
    if (place.source !== 'amap' || !validId(place.id)) return;
    return `https://uri.amap.com/marker?poiid=${encodeURIComponent(place.id)}&src=SullyOS&callnative=0`;
}

/** Only fixed official paths; the opaque frame never receives privacy circles or character data. */
export function buildScheduleAmapUrl(path: '/v3/place/text' | '/v3/place/detail' | '/v3/config/district', key: string, params: Record<string, string>): string {
    if (!validKey(key)) throw new Error('请在真实定位设置中填写高德 Web服务 Key');
    const url = new URL(path, AMAP_ORIGIN);
    url.searchParams.set('key', key);
    url.searchParams.set('output', 'JSON');
    url.searchParams.set('callback', CALLBACK);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, value);
    return url.href;
}

export function queryScheduleAmap(url: string, signal?: AbortSignal): Promise<any> {
    if (new URL(url).origin !== AMAP_ORIGIN || !['/v3/place/text', '/v3/place/detail', '/v3/config/district'].includes(new URL(url).pathname))
        return Promise.reject(new Error('地图接口不可用'));
    return new Promise((resolve, reject) => {
        if (signal?.aborted) { reject(new Error('地图查询已取消')); return; }
        const frame = document.createElement('iframe');
        frame.hidden = true;
        frame.setAttribute('sandbox', 'allow-scripts');
        frame.referrerPolicy = 'no-referrer';
        frame.title = '角色地点查询';
        const token = crypto.randomUUID();
        let settled = false;
        const timer = window.setTimeout(() => finish(new Error('地图查询超时')), 8000);
        const finish = (error?: Error, result?: any) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timer);
            window.removeEventListener('message', receive);
            signal?.removeEventListener('abort', abort);
            frame.remove();
            if (error) reject(error); else resolve(result);
        };
        const abort = () => finish(new Error('地图查询已取消'));
        const receive = (event: MessageEvent) => {
            if (event.source !== frame.contentWindow || event.data?.token !== token) return;
            if (event.data.error) finish(new Error('地图网络不可用'));
            else finish(undefined, event.data.result);
        };
        window.addEventListener('message', receive);
        signal?.addEventListener('abort', abort, { once: true });
        const encode = (value: string) => JSON.stringify(value).replace(/</g, '\\u003c');
        frame.srcdoc = `<!doctype html><html><head><meta name="referrer" content="no-referrer"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://restapi.amap.com; connect-src 'none'; img-src 'none'; form-action 'none'; base-uri 'none'"></head><body><script>
            const token=${encode(token)};
            window.${CALLBACK}=result=>parent.postMessage({token,result},'*');
            const script=document.createElement('script');
            script.referrerPolicy='no-referrer';
            script.src=${encode(url)};
            script.onerror=()=>parent.postMessage({token,error:true},'*');
            document.body.appendChild(script);
        <\/script></body></html>`;
        try { document.body.appendChild(frame); }
        catch { finish(new Error('地图查询不可用')); }
    });
}

function assertAmapResponse(data: any): void {
    if (String(data?.status) === '1') return;
    const code = String(data?.infocode);
    if (['10001', '10002', '10009', '10012', '10013'].includes(code)) throw new Error('高德 Key 可用于原定位，不代表已开通 POI 搜索；请检查 Web服务权限');
    if (['10003', '10004', '10010', '10014'].includes(code)) throw new Error('高德地点搜索已达额度或频率限制');
    throw new Error('高德地点搜索暂不可用');
}

export function parseScheduleRegions(data: any): PlaceRegion[] {
    assertAmapResponse(data);
    const output: PlaceRegion[] = [];
    const walk = (items: any[], depth: number) => {
        if (depth > 1) return;
        for (const item of items.slice(0, 20)) {
            const region = { name: clean(item?.name, 30), adcode: clean(item?.adcode, 6) };
            if ((['city', 'district'].includes(item?.level) || item?.level === 'province' && /^(北京市|上海市|天津市|重庆市)$/.test(region.name)) && validRegion(region)) output.push(region);
            if (Array.isArray(item?.districts)) walk(item.districts, depth + 1);
        }
    };
    walk(Array.isArray(data?.districts) ? data.districts : [], 0);
    return [...new Map(output.map(region => [region.adcode, region])).values()];
}

export async function searchScheduleRegions(keyword: string, signal?: AbortSignal): Promise<PlaceRegion[]> {
    if (!/^[\u4e00-\u9fa5·]{2,30}$/.test(keyword.trim())) throw new Error('请输入城市或区县名称');
    const key = loadUserLocationConfig().amapKey;
    if (!key) throw new Error('请先在真实定位设置填写高德 Web服务 Key');
    const data = await queryScheduleAmap(buildScheduleAmapUrl('/v3/config/district', key, {
        keywords: keyword.trim(), subdistrict: '1', extensions: 'base', page: '1', offset: '10',
    }), signal);
    return parseScheduleRegions(data);
}

/** AMap reports GCJ02. Invert locally, with a conservative 300m boundary margin. */
function outsideHiddenRegions(longitude: number, latitude: number, regions: UserPrivacyRegion[]): boolean {
    let wgsLongitude = longitude, wgsLatitude = latitude;
    for (let i = 0; i < 6; i++) {
        const [gcjLongitude, gcjLatitude] = wgs84ToAmap(wgsLongitude, wgsLatitude);
        wgsLongitude += longitude - gcjLongitude;
        wgsLatitude += latitude - gcjLatitude;
    }
    return regions.every(region => locationDistanceMeters(
        { longitude: wgsLongitude, latitude: wgsLatitude }, region,
    ) > region.radiusKm * 1000 + 300);
}

export function parseSchedulePlaces(data: any, region: PlaceRegion, category: PlaceCategory, regions: UserPrivacyRegion[]): PlaceCandidate[] {
    assertAmapResponse(data);
    if (!validRegion(region)) return [];
    const results = Array.isArray(data?.pois) ? data.pois : [];
    return results.slice(0, 10).flatMap((poi: any) => {
        const id = clean(poi?.id, 32), name = clean(poi?.name), city = clean(poi?.cityname) || clean(poi?.pname), district = clean(poi?.adname);
        const adcode = clean(poi?.adcode, 6), typecode = clean(poi?.typecode, 16);
        const sameCityCode = region.adcode.endsWith('0000')
            ? adcode.slice(0, 2) === region.adcode.slice(0, 2)
            : adcode.slice(0, 4) === region.adcode.slice(0, 4);
        const matchRegion = adcode === region.adcode || (city === region.name || clean(poi?.pname) === region.name) && sameCityCode;
        const coords = typeof poi?.location === 'string' ? poi.location.split(',').map(Number) : [];
        const [longitude, latitude] = coords;
        const kind = clean(poi?.type, 120);
        if (!validId(id) || !name || !city || !/^\d{6}$/.test(adcode) || !matchRegion
            || !typecode.startsWith(CATEGORY[category].prefix) || coords.length !== 2
            || category === 'school' && !!kind && !/学校/.test(kind)
            || category === 'park' && !!kind && !/公园|风景名胜/.test(kind)
            || !Number.isFinite(longitude) || !Number.isFinite(latitude)
            || longitude < 73 || longitude > 136 || latitude < 3 || latitude > 54
            || !outsideHiddenRegions(longitude, latitude, regions)) return [];
        return [{ source: 'amap' as const, id, name, city, district, category, longitude, latitude }];
    });
}

export function getScheduleMapAccess(char: CharacterProfile): { key: string; region: PlaceRegion; hidden: UserPrivacyRegion[] } | undefined {
    if (char.scheduleStyle === 'mindful' || !char.realPlaceSchedule?.enabled || !validRegion(char.realPlaceSchedule.region)) return;
    // An invalid privacy config fails closed, including when device location itself is disabled.
    const config = loadUserLocationConfig();
    if (!config.amapKey || !validKey(config.amapKey)) return;
    return { key: config.amapKey, region: char.realPlaceSchedule.region, hidden: config.regions };
}

export function isSchedulePlaceSafetyCurrent(snapshot: string): boolean {
    try { return JSON.stringify(loadUserLocationConfig()) === snapshot; }
    catch { return false; }
}

const cache = new Map<string, { at: number; data: any }>();
const inFlight = new Map<string, Promise<any>>();
async function requestPlace(url: string): Promise<any> {
    const entry = cache.get(url);
    if (entry && Date.now() - entry.at < 5 * 60_000) return entry.data;
    const pending = inFlight.get(url);
    if (pending) return pending;
    const request = queryScheduleAmap(url).then(data => {
        assertAmapResponse(data);
        if (cache.size > 20) cache.clear();
        cache.set(url, { at: Date.now(), data });
        return data;
    }).finally(() => inFlight.delete(url));
    inFlight.set(url, request);
    return request;
}

export async function searchSchedulePlaces(region: PlaceRegion, category: PlaceCategory, keyword?: string): Promise<PlaceCandidate[]> {
    const config = loadUserLocationConfig();
    if (!config.amapKey || !validRegion(region)) throw new Error('请先设置高德 Key 与角色生活区域');
    const url = buildScheduleAmapUrl('/v3/place/text', config.amapKey, {
        keywords: keyword?.trim().slice(0, 40) || CATEGORY[category].keyword,
        city: region.adcode, citylimit: 'true', offset: '8', page: '1', extensions: 'base',
    });
    const data = await requestPlace(url);
    if (JSON.stringify(loadUserLocationConfig()) !== JSON.stringify(config)) throw new Error('隐藏地点设置已变化，请重新查询');
    return parseSchedulePlaces(data, region, category, config.regions);
}

export async function prepareSchedulePlaces(char: CharacterProfile): Promise<{ candidates: PlaceCandidate[]; warning?: string; safetySnapshot?: string }> {
    let access: ReturnType<typeof getScheduleMapAccess>;
    try { access = getScheduleMapAccess(char); }
    catch { return { candidates: [], warning: '隐藏地点设置需要检查，本次按普通日程生成' }; }
    if (!access) return { candidates: [], warning: char.realPlaceSchedule?.enabled && char.scheduleStyle !== 'mindful' ? '请设置角色生活区域和本机高德 Web服务 Key；本次按普通日程生成' : undefined };
    const { key, region, hidden } = access;
    let safetySnapshot: string;
    try {
        const latest = loadUserLocationConfig();
        if (latest.amapKey !== key || JSON.stringify(latest.regions) !== JSON.stringify(hidden))
            return { candidates: [], warning: '隐藏地点设置已变化，本次按普通日程生成' };
        safetySnapshot = JSON.stringify(latest);
    }
    catch { return { candidates: [], warning: '隐藏地点设置需要检查，本次按普通日程生成' }; }
    const categories: PlaceCategory[] = ['food', 'shop', 'park'];
    const anchors = char.realPlaceSchedule?.anchors || {};
    if (anchors.school || /学生|就读|上学|大学|中学|小学/.test(`${char.systemPrompt} ${char.description}`)) categories.unshift('school');
    if (anchors.work || /上班|公司|工作|职业|职员|雇员/.test(`${char.systemPrompt} ${char.description}`)) categories.unshift('work');
    const candidates: PlaceCandidate[] = [];
    let warning: string | undefined;
    for (const category of categories) {
        try {
            const fixed = category === 'school' ? anchors.school : category === 'work' ? anchors.work : undefined;
            const path = fixed && validId(fixed.id) ? '/v3/place/detail' : '/v3/place/text';
            const params: Record<string, string> = path === '/v3/place/detail' ? { id: fixed!.id, extensions: 'base' }
                : { keywords: CATEGORY[category].keyword, city: region.adcode, citylimit: 'true', offset: '6', page: '1', extensions: 'base' };
            const data = await requestPlace(buildScheduleAmapUrl(path, key, params));
            if (JSON.stringify(loadUserLocationConfig()) !== safetySnapshot) return { candidates: [], warning: '隐藏地点设置已变化，本次按普通日程生成' };
            const found = parseSchedulePlaces(data, region, category, hidden);
            candidates.push(...(fixed ? found.filter(place => place.id === fixed.id && place.name === fixed.name) : found).slice(0, 6));
        } catch (error) { warning = error instanceof Error ? error.message : '高德地点搜索暂不可用'; break; }
    }
    try { if (JSON.stringify(loadUserLocationConfig()) !== safetySnapshot) return { candidates: [], warning: '隐藏地点设置已变化，本次按普通日程生成' }; }
    catch { return { candidates: [], warning: '隐藏地点设置需要检查，本次按普通日程生成' }; }
    return { candidates: [...new Map(candidates.map(place => [place.id, place])).values()], warning, safetySnapshot };
}

export function verifiedSchedulePlace(id: unknown, location: unknown, activity: unknown, description: unknown, home: unknown, candidates: PlaceCandidate[]): ScheduleRealPlace | undefined {
    if (typeof id !== 'string' || typeof location !== 'string' || typeof activity !== 'string' || home && typeof home === 'object' && (home as any).kind === 'home') return;
    const place = candidates.find(candidate => candidate.id === id && candidate.name === location.trim());
    if (!place) return;
    const text = `${activity} ${typeof description === 'string' ? description : ''}`;
    const relevant: Record<PlaceCategory, RegExp> = {
        school: /课|学习|自习|读书|考试|校园|学校/,
        work: /工作|上班|开会|办公|值班|公司|项目/,
        food: /吃|饭|餐|咖啡|茶|饮|点心/,
        shop: /买|逛|书|购物|采购/,
        park: /散步|跑|公园|游|休闲|骑行/,
    };
    if (!relevant[place.category].test(text)) return;
    const { longitude: _longitude, latitude: _latitude, ...saved } = place;
    return saved;
}

/** A user-confirmed institution wins over a generic model label, after fresh ID/privacy recheck. */
export function fixedSchedulePlaceForSlot(char: CharacterProfile, activity: unknown, location: unknown, home: unknown, candidates: PlaceCandidate[]): ScheduleRealPlace | undefined {
    if (home && typeof home === 'object' && (home as any).kind === 'home' || typeof activity !== 'string') return;
    const kind = /课|上学|校园|教室|学校|自习/.test(activity) ? 'school'
        : /上班|工作|开会|办公|值班|公司/.test(activity) ? 'work' : undefined;
    if (!kind) return;
    const anchor = char.realPlaceSchedule?.anchors?.[kind];
    if (!anchor || typeof location !== 'string' && location !== undefined) return;
    const label = typeof location === 'string' ? location.trim() : '';
    if (label && label !== anchor.name && !/^(学校|校园|教室|公司|单位|办公室|工作地点)$/.test(label)) return;
    const candidate = candidates.find(place => place.category === kind && place.id === anchor.id && place.name === anchor.name);
    if (!candidate) return;
    const { longitude: _longitude, latitude: _latitude, ...saved } = candidate;
    return saved;
}
