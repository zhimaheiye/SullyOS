import React, { useEffect, useRef, useState } from 'react';
import type { CharacterProfile, CharacterRealPlaceSchedule, ScheduleRealPlace } from '../../types';
import { amapPlaceUrl, searchSchedulePlaces, searchScheduleRegions, type PlaceCandidate, type PlaceRegion } from '../../utils/scheduleRealPlaces';
import { loadUserLocationConfig } from '../../utils/userLocationPrivacy';

interface Props {
    character: CharacterProfile;
    onChange: (config: CharacterRealPlaceSchedule) => void;
}

const RealPlaceScheduleSettings: React.FC<Props> = ({ character, onChange }) => {
    const config = character.realPlaceSchedule || { enabled: false };
    const [regionInput, setRegionInput] = useState('');
    const [regions, setRegions] = useState<PlaceRegion[]>([]);
    const [places, setPlaces] = useState<PlaceCandidate[]>([]);
    const [placeInput, setPlaceInput] = useState('');
    const [searching, setSearching] = useState(false);
    const [error, setError] = useState('');
    const [anchorKind, setAnchorKind] = useState<'school' | 'work' | null>(null);
    const requestId = useRef(0);
    useEffect(() => {
        requestId.current++;
        setRegions([]); setPlaces([]); setRegionInput(''); setPlaceInput(''); setAnchorKind(null); setError(''); setSearching(false);
    }, [character.id]);
    const patch = (next: Partial<CharacterRealPlaceSchedule>) => onChange({ ...config, ...next });
    const hasKey = (() => { try { return !!loadUserLocationConfig().amapKey; } catch { return false; } })();
    const searchRegion = async () => {
        const current = ++requestId.current;
        setSearching(true); setError(''); setRegions([]); setPlaces([]);
        try {
            const found = await searchScheduleRegions(regionInput);
            if (current !== requestId.current) return;
            setRegions(found);
            if (!found.length) setError('未找到这个行政区域，请输入中国大陆城市或区县名称');
        } catch (e) { if (current === requestId.current) setError(e instanceof Error ? e.message : '区域查询失败'); }
        finally { if (current === requestId.current) setSearching(false); }
    };
    const searchAnchor = async (kind: 'school' | 'work') => {
        const current = ++requestId.current;
        setAnchorKind(kind); setSearching(true); setError(''); setPlaces([]); setRegions([]);
        try {
            const found = await searchSchedulePlaces(config.region!, kind, placeInput);
            if (current !== requestId.current) return;
            setPlaces(found);
            if (!found.length) setError('没有找到安全且类别匹配的地点，可换关键词或继续普通日程');
        } catch (e) { if (current === requestId.current) setError(e instanceof Error ? e.message : '地点查询失败'); }
        finally { if (current === requestId.current) setSearching(false); }
    };
    const saveAnchor = (candidate: PlaceCandidate) => {
        if (!anchorKind) return;
        const { longitude: _longitude, latitude: _latitude, ...place } = candidate;
        patch({ anchors: { ...config.anchors, [anchorKind]: place } });
        setPlaces([]); setAnchorKind(null);
    };
    const anchorRow = (kind: 'school' | 'work', label: string) => {
        const anchor: ScheduleRealPlace | undefined = config.anchors?.[kind];
        const href = anchor && amapPlaceUrl(anchor);
        return <div className="rounded-xl border border-slate-200 bg-white p-2.5" key={kind}>
            <div className="flex items-center justify-between gap-2 text-xs">
                <span className="font-bold text-slate-700">固定{label}</span>
                <button type="button" className="text-violet-600 font-bold" disabled={!config.region || !hasKey || searching} onClick={() => searchAnchor(kind)}>{anchor ? '更换' : '查找建议'}</button>
            </div>
            <div className="mt-1 text-[11px] text-slate-500 break-words">{anchor ? `${anchor.name} · ${anchor.city}${anchor.district || ''}` : '未固定；已有明确设定请按原设定，地图候选仅供参考'}</div>
            {anchor && <div className="flex gap-3 mt-1 text-[11px]">
                {href && <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-600" onClick={e => e.stopPropagation()}>高德查看</a>}
                <button type="button" className="text-slate-500" onClick={() => patch({ anchors: { ...config.anchors, [kind]: undefined } })}>清除固定点</button>
            </div>}
        </div>;
    };
    return <section className="mb-4 rounded-2xl border border-slate-200 bg-slate-50 p-3 text-slate-700">
        <div className="flex items-center justify-between gap-2">
            <div><div className="text-xs font-bold">真实地点增强</div><p className="text-[10px] text-slate-500">只在生成日程时用角色生活区查询，不读取手机定位</p></div>
            <button type="button" role="switch" aria-checked={config.enabled} aria-label="真实地点增强" onClick={() => patch({ enabled: !config.enabled })} className={`w-10 h-6 rounded-full p-1 flex-shrink-0 ${config.enabled ? 'bg-primary' : 'bg-slate-300'}`}><span className={`block w-4 h-4 rounded-full bg-white transition-transform ${config.enabled ? 'translate-x-4' : ''}`} /></button>
        </div>
        {config.enabled && <div className="mt-3 space-y-2">
            <div className="flex items-start justify-between gap-2"><p className="text-[11px] text-slate-500">生活区域：{config.region ? config.region.name : '未设置'}。修改后需手动重抽日程，新区域不会改写今天已生成的记录。</p>{config.region && <button type="button" className="shrink-0 text-[11px] text-slate-500" onClick={() => { requestId.current++; patch({ region: undefined, anchors: undefined }); setPlaces([]); setRegions([]); }}>清除区域</button>}</div>
            <div className="flex gap-2">
                <input aria-label="搜索角色生活城市或区县" value={regionInput} onChange={e => setRegionInput(e.target.value)} placeholder="城市或区县，如杭州市" className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs" />
                <button type="button" disabled={!hasKey || searching || !regionInput.trim()} onClick={searchRegion} className="px-3 py-2 rounded-lg bg-white border border-slate-200 text-xs font-bold disabled:opacity-40">查区域</button>
            </div>
            {!hasKey && <p className="text-[11px] text-amber-700">请先在「系统设置 → 实时感知 → 真实定位」填写本机高德 Web服务 Key；此开关不要求启用设备定位。</p>}
            {regions.length > 0 && <div className="max-h-32 overflow-y-auto rounded-lg border border-slate-200 bg-white">{regions.map(region => <button type="button" key={region.adcode} onClick={() => { requestId.current++; patch({ region, anchors: config.region?.adcode === region.adcode ? config.anchors : undefined }); setRegions([]); setPlaces([]); setRegionInput(''); }} className="block w-full text-left px-3 py-2 text-xs border-b border-slate-100 last:border-0">{region.name}</button>)}</div>}
            {config.region && <>
                <div className="grid grid-cols-1 gap-2">{anchorRow('school', '学校')}{anchorRow('work', '工作点')}</div>
                <input aria-label="固定地点关键词" value={placeInput} onChange={e => setPlaceInput(e.target.value)} placeholder="查找固定地点时可填学校／单位名称" className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs" />
                {places.length > 0 && <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 bg-white">{places.map(place => <button type="button" key={place.id} onClick={() => saveAnchor(place)} className="block w-full text-left px-3 py-2 text-xs border-b border-slate-100 last:border-0"><span className="font-bold">{place.name}</span><span className="block text-[10px] text-slate-500">{place.city} · {place.district || '区域待补'}</span></button>)}</div>}
            </>}
            {searching && <p className="text-[11px]">正在查询高德…</p>}
            {error && <p role="alert" className="text-[11px] text-amber-700">{error}</p>}
            <p className="text-[10px] text-slate-500">仅高德返回且本机隐私检查通过的地点会标记真实；已有角色设定和家园房间优先。</p>
        </div>}
    </section>;
};

export default RealPlaceScheduleSettings;
