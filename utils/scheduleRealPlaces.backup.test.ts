import { beforeEach, expect, it } from 'vitest';
import JSZip from 'jszip';
import type { CharacterProfile, DailySchedule } from '../types';
import { DB } from './db';
import { assembleV2Backup, writeV2Backup } from './backupFormat';
import { USER_LOCATION_STORAGE_KEY } from './userLocationPrivacy';

beforeEach(() => localStorage.clear());

it('角色区域与认证 slot 保留在完整分片备份；设备 Key 和隐藏坐标不进入包', async () => {
    localStorage.setItem(USER_LOCATION_STORAGE_KEY, JSON.stringify({ enabled: false, amapKey: 'NEVER_BACK_UP_KEY',
        regions: [{ id: 'hidden', name: '私密别名', longitude: 116.123456, latitude: 39.654321, radiusKm: 1 }] }));
    const place = { source: 'amap' as const, id: 'B000003', name: '公开餐馆', city: '北京市', district: '朝阳区', category: 'food' as const };
    const char = { id: 'synthetic-backup-char', name: '合成角色', avatar: '', realPlaceSchedule: {
        enabled: true, region: { name: '北京市', adcode: '110000' }, anchors: { school: { ...place, id: 'B000004', name: '示例学校', category: 'school' } },
    } } as CharacterProfile;
    const schedule = { id: `${char.id}_2026-10-23`, charId: char.id, date: '2026-10-23', generatedAt: Date.now(),
        slots: [{ startTime: '12:00', activity: '吃午饭', location: place.name, realPlace: place }] } as DailySchedule;
    await DB.saveCharacter(char);
    await DB.saveDailySchedule(schedule);
    const zip = new JSZip();
    const serialized: string[] = [];
    const manifest = await writeV2Backup(zip as any, await DB.exportFullData() as any,
        { mode: 'full', onSerialized: text => { serialized.push(text); } });
    const payload = serialized.join('\n');
    expect(payload).toContain(place.id);
    expect(payload).toContain('110000');
    expect(payload).not.toContain('NEVER_BACK_UP_KEY');
    expect(payload).not.toContain('116.123456');
    expect(payload).not.toContain('39.654321');
    const restored = await assembleV2Backup(await JSZip.loadAsync(await zip.generateAsync({ type: 'uint8array' })) as any, manifest) as any;
    expect(restored.characters.find((entry: CharacterProfile) => entry.id === char.id)?.realPlaceSchedule).toEqual(char.realPlaceSchedule);
    expect(restored.dailySchedules.find((entry: DailySchedule) => entry.id === schedule.id)?.slots[0].realPlace).toEqual(place);
    await DB.importFullData(restored);
    expect((await DB.getCharacter(char.id))?.realPlaceSchedule).toEqual(char.realPlaceSchedule);
    expect((await DB.getDailySchedule(char.id, schedule.date))?.slots[0].realPlace).toEqual(place);
    expect(localStorage.getItem(USER_LOCATION_STORAGE_KEY)).toContain('NEVER_BACK_UP_KEY');
});
