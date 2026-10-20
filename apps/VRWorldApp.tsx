import { SAR_NPC_PREFERENCE_EVENT } from '../utils/vrWorld/sarNpcPreference';
import { closeSARFacilityGuide } from '../utils/vrWorld/sarFacilityGuides';
import { sarLaunch } from '../utils/sarUpdate';
import { trackSARFeature } from '../utils/sarAnalytics';
import { SARFamiliarityDialog } from './vrWorld/SARFamiliarityDialog';
import { flushFishingDeliveries } from '../utils/vrWorld/fishingDelivery';
import { flushMarketReceipts } from '../utils/vrWorld/fishingCharacter';
import React, { useState, useEffect, useCallback, useMemo, useRef, useLayoutEffect } from 'react';
import { useOS } from '../context/OSContext';
import {
    ArrowLeft, Plus, Trash, BookOpen, Planet, Clock, Play, CaretRight, X,
    UploadSimple, PencilSimple, FlipHorizontal, CaretLeft, Sparkle,
    CircleNotch, TextAa, Palette, Pause, MusicNotes, Queue, Question, Check, Gear, Package, Eye, EyeSlash,
    SpeakerHigh, SpeakerSlash, MagnifyingGlass, ShieldCheck, MagicWand,
} from '@phosphor-icons/react';
import TheaterPanel from './theater/TheaterPanel';
import { SARCaianDialogue, SARClubStage, SARUpdateModal } from './vrWorld/SARClubEvent';
import { SARGachaOverlay } from './vrWorld/SARGacha';
import { SARAssemblyCabinetOverlay } from './vrWorld/SARAssemblyCabinet';
import { SARModuleShopOverlay } from './vrWorld/SARModuleShop';
import { FishingMarketOverlay } from './vrWorld/FishingMarketOverlay';
import { SARHubPanels, type SARHubPanel } from './vrWorld/SARHubPanels';
const DinosaurGarden = React.lazy(() => import('./vrWorld/dinosaur/DinosaurGarden').then(m=>({default:m.DinosaurGarden})));
import { CreatorIframe, sullyPresets, type ChibiResult } from '../components/Like520Event';
import { useMusic, type Song } from '../context/MusicContext';
import { DB } from '../utils/db';
import { LibraryView, NovelPreferenceModal } from './vrWorld/VRLibrary';
import { VRActivityPicker, VRActivityRestrictions } from './vrWorld/VRActivityPicker';
import type { VRSARActivity } from '../types';
import { gardenResidents } from '../utils/vrWorld/dinosaurGarden';
import { readFishingMarketState } from '../utils/vrWorld/fishingMarket';
import { readableNovels, readingPreferenceLabel } from '../utils/vrWorld/library';
import type { VRLibraryCategory } from '../types';
import { useResilientAssetUrl, attachAudioMirrorFallback } from '../utils/assetUrl';
import { VRScheduler, VR_FAIL_LIMIT } from '../utils/vrWorld/scheduler';
import { allowsAutomaticVR, joinVRState, isSARActivityOccupant } from '../utils/vrWorld/participation';
import { collectVRDiagnostics } from '../utils/vrWorld/diagnostics';
import { VR_ROOMS, getRoom, VR_DEFAULT_INTERVAL_MIN } from '../utils/vrWorld/constants';
import { buildNovelAsync, groupAnnotationsBySeg, getBookmark } from '../utils/vrWorld/novel';
import { decodeBytes } from '../utils/vrWorld/decodeText';
import { extractPdfText, isPdfFile } from '../utils/pdfText';
import { stripLeakedAttrs } from '../utils/vrWorld/prompts';
import { getVRApi, setVRApi, getVRApiLog, clearVRApiLog, type VRApiCall } from '../utils/vrWorld/vrApi';
import { safeResponseJson } from '../utils/safeApi';
import {
    patchSARClubState,
    readSARClubState,
    rewindSARIntro,
    SAR_CLUB_UPDATE_VERSION,
    sarRoomView, nextSARRoomView, SAR_ROOM_VIEW_ACTIONS,
    type SARRoomView,
    type SARClubState,
    type SARIntroReaction,
    type SARNpcPreference,
} from '../utils/vrWorld/sarClub';

const genLocalId = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;

// 安全区单一来源：index.html :root 定义 --safe-top/--safe-bottom/--chrome-top，
// 由 utils/iosStandalone.ts 喂入 JS 探测值（iOS 全屏 PWA 下原生 env 偶发返回 0 时兜底）。
// 全屏浮层背景铺满屏幕，只用这些变量给顶/底「控件」让位。
const VR_TOP = 'var(--chrome-top)';                            // 安全区 + SullyOS 状态栏：全屏面板顶栏统一用它
const VR_SAFE_BOTTOM = 'var(--safe-bottom)';
const VR_ROOM_PANEL_TOP = 'calc(var(--chrome-top) + 3.75rem)'; // 房间内浮层从顶栏下方开始
// 底部额外留一点手势余量；iOS 全屏隐藏 home 条时也不让交互区贴着物理底边。
const VR_BOTTOM_TOUCH_GAP = '0.75rem';
// 底部内边距 / 贴底定位统一用它：base + 安全区 + 手势余量。
const vrBottomPad = (base: string) => `calc(${base} + ${VR_SAFE_BOTTOM} + ${VR_BOTTOM_TOUCH_GAP})`;

/** 气泡/动态里去掉开头多余的"自己名字"主语（角色播报本就该省略主语）。 */
const stripSelfName = (text: string | undefined, name: string | undefined): string => {
    if (!text) return '';
    if (!name) return text;
    const t = text.replace(/^\s+/, '');
    if (t.startsWith(name)) {
        const rest = t.slice(name.length).replace(/^[\s，,、：:·\-—]*/, '');
        if (rest) return rest;
    }
    return text;
};
import type { CharacterProfile, UserProfile, VRWorldNovel, VRWorldNovelSummary, VRNovelAnnotation, VRCardMeta, VRRoomId, VRMusicRoomState, CharPlaylistSong, VRGuestbookState, VRGuestbookMessage, ApiPreset, APIConfig } from '../types';

// ============ chibi 形象解析（vrState.chibi → 立绘 → 头像） ============
import { getChibi } from '../utils/vrWorld/chibi';
import { CharacterGroupFilterBar, filterCharactersByGroup, GROUP_FILTER_ALL } from '../components/character/CharacterGroupFilter';
import { trackEvent } from '../utils/analytics';
import { formatHours } from '../utils/format';
import TokenImg from '../components/os/TokenImg';

type Tab = 'world' | 'sar' | 'library' | 'settings' | 'api';

interface FeedItem {
    msgId: number; charId: string; charName: string; avatar: string;
    timestamp: number; meta: VRCardMeta; content: string;
}

// 每个房间的 chibi 站位（百分比坐标，底对齐）
const ROOM_SLOTS: Partial<Record<VRRoomId, { x: number; y: number }[]>> = {
    library:   [{ x: 24, y: 72 }, { x: 50, y: 78 }, { x: 74, y: 70 }, { x: 38, y: 64 }, { x: 62, y: 64 }],
    music:     [{ x: 30, y: 74 }, { x: 55, y: 78 }, { x: 72, y: 70 }, { x: 45, y: 66 }],
    guestbook: [{ x: 28, y: 76 }, { x: 52, y: 78 }, { x: 73, y: 74 }, { x: 40, y: 68 }],
    gym:       [{ x: 26, y: 74 }, { x: 50, y: 80 }, { x: 74, y: 74 }, { x: 38, y: 66 }, { x: 62, y: 66 }],
    theater:   [{ x: 30, y: 80 }, { x: 70, y: 80 }, { x: 50, y: 84 }, { x: 40, y: 72 }, { x: 60, y: 72 }],
    sar:       [{ x: 24, y: 76 }, { x: 50, y: 80 }, { x: 74, y: 74 }, { x: 38, y: 68 }, { x: 62, y: 68 }],
    cafe:      [{ x: 30, y: 74 }, { x: 54, y: 78 }, { x: 70, y: 72 }],
};

const IDLE_QUIPS: Partial<Record<VRRoomId, string[]>> = {
    library: ['翻着书页…', '这本还挺好看', '嘘，安静', '又是看书的一天'],
    music: ['随节奏轻晃', '这首单曲循环', '戴上耳机', '调一下音量'],
    guestbook: ['写点什么呢', '路过留个名', '看看墙上的话', '嗯…'],
    gym: ['活动一下', '再来一组！', '伸个懒腰', '热身中'],
    theater: ['对台词…', '再走一遍', '背词中', '候场'],
    sar: ['看看推演机', '模块说明书…', '去钓鱼吗', '活动记录中'],
    cafe: ['', '', '', ''],
};

const VRWorldApp: React.FC = () => {
    const { closeApp, characters, characterGroups, updateCharacter, addToast, registerBackHandler, userProfile, updateUserProfile, apiPresets, apiConfig, groups, realtimeConfig, memoryPalaceConfig } = useOS();
    useEffect(() => {
        const flush = () => { void flushFishingDeliveries(characters).then(() => flushMarketReceipts(characters)).catch(() => {}); };
        flush();
        window.addEventListener('vr-fishing-market-updated', flush);
        return () => window.removeEventListener('vr-fishing-market-updated', flush);
    }, [characters]);

    const userName = userProfile?.name || '我';
    const [tab, setTab] = useState<Tab>(() => sarLaunch.peek() ? 'sar' : 'world');
    useEffect(() => { sarLaunch.consume(); }, []);
    const [novels, setNovels] = useState<VRWorldNovelSummary[]>([]);
    const [feed, setFeed] = useState<FeedItem[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string[]>([]);
    const reloadGeneration = useRef(0);
    const feedLoadGeneration = useRef(0);
    useEffect(() => () => { feedLoadGeneration.current++; reloadGeneration.current++; }, []);

    const [enterRoom, setEnterRoom] = useState<VRRoomId | null>(null);
    useAppShortcut(ShortcutAppID.VRWorld, intent => {
        setReaderNovel(null); setReaderJump(null); setShowUpload(false); setShowHelp(false);
        setShowFishingMarket(null); setSarHubPanel(null); setShowSarModuleShop(false); setShowSarCabinet(false); setShowSarGacha(false); setShowSarDialogue(false); setFamiliarity(null);
        const id = intent.entryId || 'world';
        const isTab = ['world', 'library', 'sar', 'settings', 'api'].includes(id);
        setTab(isTab ? id as Tab : 'world');
        setEnterRoom(isTab ? null : id as VRRoomId);
    });
    const [readerNovel, setReaderNovel] = useState<VRWorldNovel | null>(null);
    const [readerJump, setReaderJump] = useState<{ novel: VRWorldNovel; seg: number } | null>(null);
    const [showUpload, setShowUpload] = useState(false);
    const [chibiEditChar, setChibiEditChar] = useState<CharacterProfile | null>(null);
    const [chibiEditUser, setChibiEditUser] = useState(false); // 用户本人捏 chibi
    const [showHelp, setShowHelp] = useState(false);
    const [sarState, setSarState] = useState<SARClubState>(() => readSARClubState());
    useEffect(() => {
        const sync = () => { const next = readSARClubState(); setSarState(next); if (next.npcPreference === 'hide') { setFamiliarity(null); setShowSarDialogue(false); setShowSarRewindConfirm(false); } };
        const storage = (event: StorageEvent) => { if (!event.key || event.key === 'vr_sar_club_state_v1') sync(); };
        window.addEventListener(SAR_NPC_PREFERENCE_EVENT, sync); window.addEventListener('storage', storage);
        return () => { window.removeEventListener(SAR_NPC_PREFERENCE_EVENT, sync); window.removeEventListener('storage', storage); };
    }, []);
    const [sarPromptStep, setSarPromptStep] = useState<'update' | 'preference' | null>(() =>
        readSARClubState().npcPreference ? null : 'update');
    const [showSarDialogue, setShowSarDialogue] = useState(false);
    const [familiarity, setFamiliarity] = useState<{npc:'caian'|'aiven';sceneId?:string}|null>(null);
    const [showSarGacha, setShowSarGacha] = useState(false);
    const [showSarCabinet, setShowSarCabinet] = useState(false);
    const [showSarModuleShop, setShowSarModuleShop] = useState(false);
    const [sarHubPanel, setSarHubPanel] = useState<SARHubPanel | null>(null);
    const sarHubBack = useRef<(() => boolean) | null>(null);
    const [showFishingMarket, setShowFishingMarket] = useState<'water' | 'board' | 'garden' | 'sell' | null>(null);
    const [sarModuleTargetCharId, setSarModuleTargetCharId] = useState<string | null>(null);
    const [showSarRewindConfirm, setShowSarRewindConfirm] = useState(false);
    const [incomingSarModule, setIncomingSarModule] = useState<{ charId: string; charName: string; moduleTitle: string } | null>(null);
    const sarHandledThisSession = useRef(false);
    useEffect(() => { if (tab === 'sar') trackSARFeature('room'); }, [tab]);
    useEffect(() => { if (showSarDialogue || familiarity) trackSARFeature(familiarity?.sceneId ? 'replay' : 'dialogue'); }, [showSarDialogue, familiarity]);
    useEffect(() => { if (showSarGacha) trackSARFeature('gacha'); }, [showSarGacha]);
    useEffect(() => { if (showSarCabinet) trackSARFeature('cabinet'); }, [showSarCabinet]);
    useEffect(() => { if (showSarModuleShop) trackSARFeature('modules'); }, [showSarModuleShop]);
    useEffect(() => { if (sarHubPanel) trackSARFeature(sarHubPanel); }, [sarHubPanel]);
    useEffect(() => { if (showFishingMarket) trackSARFeature(showFishingMarket === 'sell' ? 'water' : showFishingMarket); }, [showFishingMarket]);
    // 启用流程：设定 chibi 后回调启用
    const [pendingEnable, setPendingEnable] = useState<string | null>(null);
    const [libraryCategories, setLibraryCategories] = useState<VRLibraryCategory[]>([]);
    const [uploadCategoryId, setUploadCategoryId] = useState<string | undefined>();
    const [readingPreferenceCharId, setReadingPreferenceCharId] = useState<string | null>(null);
    const readingPreferenceChar = useMemo(
        () => characters.find(char => char.id === readingPreferenceCharId) || null,
        [characters, readingPreferenceCharId],
    );

    useEffect(() => {
        const onInstalled = (event: Event) => {
            const detail = (event as CustomEvent<{ charId?: string; charName?: string; moduleTitle?: string }>).detail;
            if (!detail?.charId || !detail.charName || !detail.moduleTitle) return;
            setIncomingSarModule({ charId: detail.charId, charName: detail.charName, moduleTitle: detail.moduleTitle });
        };
        window.addEventListener('sar-module-installed-on-user', onInstalled);
        return () => window.removeEventListener('sar-module-installed-on-user', onInstalled);
    }, []);

    // 初次进入彼方：自动弹出玩法说明（看过一次后不再自动弹）
    useEffect(() => {
        // 新版 SAR 选择优先展示；本次选完先让用户进入 SAR，通用玩法说明留到下次进入。
        if (sarPromptStep || sarHandledThisSession.current) return;
        try {
            if (!localStorage.getItem('vr_help_seen')) {
                setShowHelp(true);
                localStorage.setItem('vr_help_seen', '1');
            }
        } catch { /* ignore */ }
    }, [sarPromptStep]);

    const chooseSarNpcPreference = useCallback((preference: SARNpcPreference) => {
        sarHandledThisSession.current = true;
        const next = patchSARClubState({
            npcPreference: preference,
            updateSeenVersion: SAR_CLUB_UPDATE_VERSION,
        });
        setSarState(next);
        setSarPromptStep(null);
        trackEvent('选择彼方活动室NPC', { preference });
        if (preference === 'show') {
            setTab('sar');
        }
    }, []);

    const changeSarNpcPreference = useCallback((preference: SARNpcPreference) => {
        const next = patchSARClubState({ npcPreference: preference, updateSeenVersion: SAR_CLUB_UPDATE_VERSION });
        setSarState(next);
        trackEvent('切换彼方活动室NPC', { preference });
        if (preference === 'show') {
            setTab('sar');
            addToast?.('凯恩与艾文已来到活动室', 'success');
        } else {
            setShowSarDialogue(false);
            addToast?.('NPC 与相关内容已关闭，进度已保留', 'success');
        }
    }, [addToast]);

    const completeSarIntro = useCallback((reaction?: SARIntroReaction) => {
        const next = patchSARClubState({ caianMet: true, introReaction: reaction });
        setSarState(next);
        setShowSarDialogue(false);
        trackEvent('完成凯恩初次见面', { reaction: reaction || 'unknown' });
    }, []);

    const rewindSarIntro = useCallback(() => {
        const next = rewindSARIntro();
        setSarState(next);
        setShowSarDialogue(false);
        setShowSarRewindConfirm(false);
        trackEvent('回档凯恩初次见面');
        if (next.npcPreference === 'show') {
            setTab('sar');
            addToast?.('已回档至与凯恩初次见面前', 'success');
        } else {
            addToast?.('剧情已回档；重新显示 NPC 后即可重看', 'success');
        }
    }, [addToast]);

    // 网页游戏验证钩子：彼方是 DOM 场景而非 canvas，仍暴露当前可交互状态供自动化读取。
    useEffect(() => {
        if (showFishingMarket || sarHubPanel || familiarity) return; // 子水域拥有自己的游戏时钟与验证状态。
        const target = window as Window & {
            render_game_to_text?: () => string;
            advanceTime?: (ms: number) => void;
        };
        const renderState = () => JSON.stringify({
            mode: 'vr-world',
            coordinateSystem: 'DOM viewport; origin top-left; x right; y down',
            tab,
            loading,
            room: enterRoom,
            overlays: {
                sarUpdate: sarPromptStep,
                caianDialogue: showSarDialogue,
                sarGacha: showSarGacha,
                sarCabinet: showSarCabinet,
                sarModuleShop: showSarModuleShop,
                fishingMarket: showFishingMarket,
                help: showHelp,
            },
            sar: {
                npcPreference: sarState.npcPreference,
                caianMet: sarState.caianMet,
                labelsHidden: !!sarState.labelsHidden,
                roomView: sarRoomView(sarState),
            },
        });
        const advanceTime = (_ms: number) => { /* DOM 事件没有独立游戏时钟 */ };
        target.render_game_to_text = renderState;
        target.advanceTime = advanceTime;
        return () => {
            if (target.render_game_to_text === renderState) delete target.render_game_to_text;
            if (target.advanceTime === advanceTime) delete target.advanceTime;
        };
    }, [familiarity, sarHubPanel, tab, loading, enterRoom, sarPromptStep, showSarDialogue, showSarGacha, showSarCabinet, showSarModuleShop, showFishingMarket, showHelp, sarState]);

    const loadNovels = useCallback(async () => {
        const [books, categories] = await Promise.all([DB.getVRNovelSummaries(), DB.getVRLibraryCategories()]);
        setNovels(books); setLibraryCategories(categories);
    }, []);
    const loadFeed = useCallback(async () => {
        const generation = ++feedLoadGeneration.current;
        const items: FeedItem[] = [];
        for (const c of characters) {
            // 首页只展示最近 50 条动态，按角色限量读取；不受聊天的"最近 N 条窗口"、
            // 记忆宫殿高水位线（mp_lastMsgId_<charId>）、归档隐藏起点（hideBeforeMessageId）影响。
            // 这些机制只管「LLM 上下文能不能看到」——而彼方动态是用户自己的浏览界面，
            // 只要消息还在 IndexedDB 里就该一直能看到：
            //   · 记忆宫殿后台向量化推高水位 → 动态不该突然清零；
            //   · 角色记忆归档把旧聊天标记为"对 AI 隐藏" → 这些动态依旧存在，用户仍要能回看；
            //   · 聊天攒多了把旧 vr_card 挤出最近窗口 → 不该因此从动态流消失。
            // （清空聊天会真删消息，删掉就没了——那是预期行为，逻辑不变。）
            const msgs = await DB.getVRCardsByCharId(c.id, 50, m => !m.metadata?.userBoardPost);
            if (generation !== feedLoadGeneration.current) return;
            if (!msgs.length) continue;
            for (const m of msgs) {
                // 用户在留言簿的发言会广播进每个角色的 vr_card（供 LLM 上下文用），
                // 但它不是"角色自己的动态"——不进动态流，也不当作 chibi 气泡。
                if (!m.metadata?.userBoardPost) {
                    items.push({ msgId: m.id, charId: c.id, charName: c.name, avatar: c.avatar, timestamp: m.timestamp, meta: m.metadata as VRCardMeta, content: m.content });
                }
            }
            items.sort((a, b) => b.timestamp - a.timestamp);
            items.length = Math.min(items.length, 50);
        }
        if (generation !== feedLoadGeneration.current) return;
        items.sort((a, b) => b.timestamp - a.timestamp);
        setFeed(items.slice(0, 50));
    }, [characters]);

    const reloadAll = useCallback(async () => {
        // Background refresh must not unmount the library and reset its filter/selection.
        // Initial loading is already true until the first load finishes.
        const generation = ++reloadGeneration.current;
        const results = await Promise.allSettled([loadNovels(), loadFeed()]);
        if (generation !== reloadGeneration.current) return;
        setLoadError(results.flatMap((result, index) => result.status === 'rejected' ? [index === 0 ? '书库' : '动态'] : []));
        setLoading(false);
    }, [loadNovels, loadFeed]);

    useEffect(() => { void reloadAll(); }, [reloadAll]);
    useEffect(() => {
        const handler = () => { void reloadAll(); };
        window.addEventListener('vr-session-done', handler);
        return () => window.removeEventListener('vr-session-done', handler);
    }, [reloadAll]);

    // 最近一条动态（按角色）
    const latestByChar = useMemo(() => {
        const map: Record<string, FeedItem> = {};
        for (const f of feed) if (!map[f.charId]) map[f.charId] = f;
        return map;
    }, [feed]);

    const occupantsByRoom = useMemo(() => {
        const map: Record<string, CharacterProfile[]> = {};
        for (const c of characters) {
            if (c.vrState?.enabled) {
                const room = c.vrState.currentRoom || 'library';
                if(room!=='sar'||isSARActivityOccupant(c))(map[room] ||= []).push(c);
            }
        }
        // 用户本人接入彼方且设了 chibi → 作为伪 occupant 站进自己挂着的房间
        const uv = userProfile?.vrState;
        if (uv?.enabled && uv.chibi?.img) {
            const room = uv.currentRoom || 'guestbook';
            const pseudo = { id: 'user', name: userName, avatar: userProfile?.avatar || '', vrState: { enabled: true, intervalMinutes: 0, currentRoom: room, sarActivity:/钓鱼|垂钓/.test(uv.activity||'')?'fishing':undefined, chibi: uv.chibi, title: uv.title } } as unknown as CharacterProfile;
            (map[room] ||= []).push(pseudo);
        }
        return map;
    }, [characters, userProfile, userName]);

    const enabledCount = characters.filter(c => c.vrState?.enabled).length;

    // 返回键：有弹层先关弹层（阅读器/房间/上传/捏人），而不是直接退回桌面
    useEffect(() => registerBackHandler(() => {
        if (closeSARFacilityGuide()) return true;
        if (showSarRewindConfirm) { setShowSarRewindConfirm(false); return true; }
        if (familiarity && chibiEditUser) { setChibiEditUser(false); return true; }
        if (familiarity) { setFamiliarity(null); return true; }
        if (sarHubPanel) { if (!sarHubBack.current?.()) setSarHubPanel(null); return true; }
        if (showFishingMarket) { setShowFishingMarket(null); return true; }
        if (showSarModuleShop) { setShowSarModuleShop(false); setSarModuleTargetCharId(null); return true; }
        if (showSarCabinet) { setShowSarCabinet(false); return true; }
        if (showSarGacha) { setShowSarGacha(false); return true; }
        if (showSarDialogue) { setShowSarDialogue(false); return true; }
        if (readingPreferenceCharId) { setReadingPreferenceCharId(null); return true; }
        if (chibiEditChar) { setChibiEditChar(null); setPendingEnable(null); return true; }
        if (chibiEditUser) { setChibiEditUser(false); return true; }
        if (showUpload) { setShowUpload(false); return true; }
        if (readerJump) { setReaderJump(null); return true; }
        if (readerNovel) { setReaderNovel(null); return true; }
        if (enterRoom) { setEnterRoom(null); return true; }
        if (tab === 'sar') { setTab('world'); return true; }
        return false; // 无弹层 → 交回默认（关闭 App）
    }), [registerBackHandler, tab, familiarity, sarHubPanel, showFishingMarket, showSarModuleShop, showSarCabinet, showSarGacha, showSarRewindConfirm, showSarDialogue, readingPreferenceCharId, chibiEditChar, chibiEditUser, showUpload, readerJump, readerNovel, enterRoom]);

    // 从动态/批注点回原文：peek 模式打开阅读器跳到该段，不动用户书签
    const readerLoadGeneration = useRef(0);
    useEffect(() => () => { readerLoadGeneration.current++; }, []);
    const openNovel = useCallback(async (novelId: string, segIdx?: number) => {
        const generation = ++readerLoadGeneration.current;
        try {
            const novel = await DB.getVRNovel(novelId);
            if (generation !== readerLoadGeneration.current) return;
            if (!novel) { addToast?.('这本书已不存在，请刷新书库', 'info'); return; }
            if (segIdx === undefined) setReaderNovel(novel);
            else setReaderJump({ novel, seg: segIdx });
        } catch {
            if (generation === readerLoadGeneration.current) addToast?.('书籍载入失败，请重试', 'error');
        }
    }, [addToast]);
    const jumpToAnnotation = useCallback((novelId: string | undefined, segIdx: number) => {
        if (novelId) void openNovel(novelId, segIdx);
    }, [openNovel]);

    // 用户在留言簿发言：落墙 + 以小卡片广播给所有接入彼方的角色私聊
    const onUserBoardPost = useCallback(async (content: string, replyTo?: VRGuestbookMessage) => {
        const t = content.trim();
        if (!t) return;
        const id = `gb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
        await DB.appendVRGuestbookMessages([{
            id,
            authorId: 'user',
            authorName: userName,
            content: t,
            replyToId: replyTo?.id,
            replyToName: replyTo?.authorName,
            createdAt: Date.now(),
        }]);
        const activity = replyTo
            ? `${userName} 在留言墙上回复 ${replyTo.authorName}：${t}`
            : `${userName} 在留言墙上发了：${t}`;
        const enabled = characters.filter(c => c.vrState?.enabled);
        for (const c of enabled) {
            await DB.saveMessage({
                charId: c.id, role: 'user', type: 'vr_card',
                content: `「彼方 · 留言簿」${activity}`,
                metadata: {
                    vrCard: true,
                    room: 'guestbook',
                    userBoardPost: true,
                    activity,
                    boardPost: t,
                    boardReplyToName: replyTo?.authorName,
                },
            } as any);
        }
        const action = replyTo ? `已回复 ${replyTo.authorName}` : '已留言';
        addToast?.(enabled.length > 0 ? `${action}，并广播给 ${enabled.length} 位接入角色` : action, 'success');
    }, [characters, userName, addToast]);

    // 用户更新自己的彼方状态：以行为卡片广播给所有接入彼方的角色（机制同留言簿发言）
    const onUserVRBroadcast = useCallback(async (room: VRRoomId, activity: string) => {
        const roomName = VR_ROOMS.find(r => r.id === room)?.name || '彼方';
        const act = (activity || '').trim() || '在彼方里挂机放空';
        const line = `${userName} 现在在「彼方 · ${roomName}」：${act}`;
        const enabled = characters.filter(c => c.vrState?.enabled);
        for (const c of enabled) {
            await DB.saveMessage({
                charId: c.id, role: 'user', type: 'vr_card',
                content: `「彼方 · ${roomName}」${line}`,
                metadata: { vrCard: true, room, userBoardPost: true, activity: line },
            } as any);
        }
        addToast?.(enabled.length > 0 ? `已更新状态，并广播给 ${enabled.length} 位接入角色` : '已更新彼方状态', 'success');
    }, [characters, userName, addToast]);

    const onDeleteFeed = useCallback(async (msgId: number) => {
        await DB.deleteMessage(msgId);
        setFeed(prev => prev.filter(f => f.msgId !== msgId));
    }, []);
    const onDeleteFeedMany = useCallback(async (ids: number[]) => {
        if (ids.length === 0) return;
        await DB.deleteMessages(ids);
        const idSet = new Set(ids);
        setFeed(prev => prev.filter(f => !idSet.has(f.msgId)));
        addToast?.(`已删除 ${ids.length} 条彼方动态`, 'success');
    }, [addToast]);

    // 启用某角色（带 chibi 设定门槛）
    const enableChar = (char: CharacterProfile) => {
        const vrState = joinVRState(char.vrState);
        updateCharacter(char.id, { vrState });
        if (allowsAutomaticVR(vrState)) VRScheduler.start(char.id, vrState.intervalMinutes);
        else VRScheduler.stop(char.id);
        trackEvent('开启角色接入彼方', { action: 'enable' });
    };
    const requestEnable = (char: CharacterProfile) => {
        // 没设过专属 chibi → 先要求设定形象
        if (!char.vrState?.chibi?.img) {
            setPendingEnable(char.id);
            setChibiEditChar(char);
        } else {
            enableChar(char);
        }
    };

    return (
        <div className={`h-full w-full flex flex-col text-white relative overflow-hidden ${tab === 'sar' ? 'vr-sar-light' : ''}`}
            style={{ background: 'radial-gradient(130% 90% at 50% -15%, #20283f 0%, #141a2c 38%, #0a0d18 72%, #05060d 100%)' }}>
            <VRStyleTag />
            {/* 极光辉光 */}
            <div className="vr-aurora pointer-events-none absolute inset-0 overflow-hidden">
                <div className="absolute -top-1/4 -left-1/4 w-[80%] h-[60%] rounded-full"
                    style={{ background: 'radial-gradient(circle, rgba(120,150,230,.20), transparent 70%)', filter: 'blur(44px)', animation: 'vraurora 15s ease-in-out infinite' }} />
                <div className="absolute top-1/3 -right-1/4 w-[72%] h-[56%] rounded-full"
                    style={{ background: 'radial-gradient(circle, rgba(130,212,200,.15), transparent 70%)', filter: 'blur(50px)', animation: 'vraurora 19s ease-in-out infinite reverse' }} />
            </div>
            {/* 星尘 */}
            <div className="vr-stars pointer-events-none absolute inset-0"
                style={{ backgroundImage: 'radial-gradient(1px 1px at 18% 28%, rgba(255,255,255,.7), transparent), radial-gradient(1px 1px at 68% 18%, rgba(200,215,255,.6), transparent), radial-gradient(1px 1px at 82% 58%, rgba(230,220,255,.5), transparent), radial-gradient(1px 1px at 38% 72%, rgba(210,225,255,.5), transparent), radial-gradient(1.5px 1.5px at 52% 42%, rgba(255,255,255,.55), transparent)', animation: 'vrtwinkle 7s ease-in-out infinite' }} />

            {/* 顶栏 —— 外壳不再统一加 safe-area padding，这里用 --chrome-top 让开
                安全区 + SullyOS 状态栏（时间/电量），退出键落在其下方，不再怼到时钟上面。 */}
            {tab !== 'sar' && <>
            <div className="vr-topbar relative flex items-center gap-2.5 px-5 pb-2.5 shrink-0 z-10" style={{ paddingTop: VR_TOP }}>
                <button onClick={closeApp} className="p-1.5 -ml-1.5 rounded-full text-white/65 active:bg-white/10"><ArrowLeft size={21} weight="regular" /></button>
                <div className="flex items-center gap-2">
                    <Planet size={17} weight="light" className="text-indigo-100/90" style={{ filter: 'drop-shadow(0 0 7px rgba(165,185,255,.7))' }} />
                    <span className="vr-brand text-[22px] tracking-[0.42em] pl-1"
                        style={{ fontFamily: `'Noto Serif SC',serif`, fontWeight: 300, background: 'linear-gradient(100deg,#dcd4ff,#fff,#c2ece6)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', filter: 'drop-shadow(0 0 10px rgba(185,185,255,.35))' }}>彼方</span>
                </div>
                <span className="ml-auto text-[10.5px] tracking-[0.12em] text-white/45 font-light">
                    {enabledCount > 0 ? `${enabledCount} 位已接入` : '尚无人接入'}
                </span>
                <button onClick={() => setShowHelp(true)} aria-label="玩法说明"
                    className="ml-2.5 h-7 w-7 rounded-full flex items-center justify-center text-white/70 active:bg-white/10 shrink-0"
                    style={{ border: '1px solid rgba(255,255,255,.22)' }}>
                    <Question size={14} weight="bold" />
                </button>
            </div>

            {/* Tab — 发丝下划线 */}
            <div className="vr-tabs relative flex px-4 gap-3 sm:px-5 sm:gap-5 shrink-0 z-10 pb-px">
                {([['world', '世界'], ['sar', 'SAR'], ['library', '书库'], ['settings', '角色接入'], ['api', 'API']] as [Tab, string][]).map(([t, label]) => (
                    <button key={t} aria-current={tab === t ? 'page' : undefined} onClick={() => { setTab(t); if (t === 'sar' && userProfile?.vrState?.enabled) updateUserProfile({vrState:{...userProfile.vrState,currentRoom:'sar',activity:userProfile.vrState.activity || '在 SAR 活动室闲逛',updatedAt:Date.now()}}); trackEvent('切换彼方顶部标签', { tab: t }); }} className="relative shrink-0 whitespace-nowrap pb-2 text-[13.5px] tracking-[0.12em] sm:tracking-[0.22em] transition-colors"
                        style={{ fontFamily: `'Noto Serif SC',serif`, color: tab === t ? 'rgba(255,255,255,.95)' : 'rgba(255,255,255,.38)' }}>
                        {label}
                        {tab === t && <span className="absolute -bottom-px left-1/2 -translate-x-1/2 w-5 h-px"
                            style={{ background: 'linear-gradient(90deg,transparent,rgba(205,205,255,.95),transparent)', boxShadow: '0 0 8px rgba(185,185,255,.85)' }} />}
                    </button>
                ))}
                <div className="absolute bottom-0 left-5 right-5 h-px" style={{ background: 'linear-gradient(90deg,transparent,rgba(255,255,255,.09),transparent)' }} />
            </div>

            </>}

            {/* 滚动容器不同于浮动 dock：滚到底时最后一条内容贴 viewport bottom = 屏幕底，必须 + safe-bottom 让位 home 条，否则翻页按钮被压（即原 #158 报的问题）。 */}
            <div className="vr-world-scroll relative flex-1 overflow-y-auto vr-reader-scroll px-4 z-10" style={{ paddingTop: '1rem', paddingBottom: `calc(1rem + ${VR_SAFE_BOTTOM})` }}>
                {loading && <p role="status" className="px-5 py-2 text-center text-xs text-white/40">正在读取本地书库与动态，其他功能可先使用。</p>}
                {loadError.length > 0 && <div role="alert" className="px-5 py-3 text-center text-xs text-white/70">
                    {loadError.join('、')}读取未完成，请重试；持续失败时请关闭其他糯米机页面后重新打开。无需清理记忆或角色数据。
                    <button className="ml-3 underline" onClick={() => void reloadAll()}>重新载入</button>
                </div>}
                {loading && tab === 'library' ? (
                    <div className="text-center text-white/40 text-[13px] tracking-[0.2em] py-12" style={{ fontFamily: `'Noto Serif SC',serif` }}>载入彼方…</div>
                ) : tab === 'sar' ? (
                    <SARWorldPage occupants={occupantsByRoom.sar || []} npcEnabled={sarState.npcPreference === 'show'} caianMet={sarState.caianMet}
                        roomView={sarRoomView(sarState)} onToggleLabels={() => {const view=nextSARRoomView(sarRoomView(sarState));setSarState(patchSARClubState({roomView:view,labelsHidden:view==='text-hidden'}));}}
                        onTalkToCaian={() => sarState.caianMet ? setFamiliarity({npc:'caian'}) : setShowSarDialogue(true)} onTalkToAiven={() => setFamiliarity({npc:'aiven'})}
                        onSelectCharacter={char => { setSarModuleTargetCharId(char.id); setShowSarModuleShop(true); }}
                        onOpenGacha={() => setShowSarGacha(true)} onOpenCabinet={() => setShowSarCabinet(true)}
                        onOpenModuleShop={() => setShowSarModuleShop(true)} onOpenFishingMarket={setShowFishingMarket}
                        onOpenSarSettings={() => setSarHubPanel('settings')} onOpenSarWarehouse={() => setSarHubPanel('warehouse')}
                        onBackPage={() => setTab('world')}/>
                ) : tab === 'world' ? (
                    <WorldView occupantsByRoom={occupantsByRoom} feed={feed} novelCount={novels.length}
                        onEnterRoom={setEnterRoom} onGoLibrary={() => setTab('library')} onJump={jumpToAnnotation}
                        onDeleteFeed={onDeleteFeed} onDeleteFeedMany={onDeleteFeedMany}/>
                ) : tab === 'library' ? (
                    <LibraryView novels={novels} categories={libraryCategories} characters={characters} onOpen={novel => { void openNovel(novel.id); }}
                        onEdit={async edit => { await DB.editVRLibrary(edit); await loadNovels(); }}
                        onPreference={char => setReadingPreferenceCharId(char.id)}
                        onAdd={categoryId => { setUploadCategoryId(categoryId); setShowUpload(true); trackEvent('打开小说上架弹窗'); }}
                        onDelete={async (id) => { await DB.deleteVRNovel(id); await loadNovels(); addToast?.('已删除', 'success'); }} />
                ) : tab === 'settings' ? (
                    <div className="space-y-3">
                        <UserVRPanel userProfile={userProfile} updateUserProfile={updateUserProfile}
                            onEditChibi={() => setChibiEditUser(true)} onBroadcast={onUserVRBroadcast} addToast={addToast} />
                        <SettingsView characters={characters} updateCharacter={updateCharacter} addToast={addToast}
                            novels={novels} onReload={reloadAll}
                            onRequestEnable={requestEnable} onEditChibi={setChibiEditChar}
                            onEditReadingPreference={(char) => setReadingPreferenceCharId(char.id)} />
                    </div>
                ) : (
                    <VRApiSettings apiPresets={apiPresets} chatApi={apiConfig} addToast={addToast} characters={characters} />
                )}
            </div>

            {sarHubPanel && userProfile && <SARHubPanels backRef={sarHubBack} panel={sarHubPanel} onClose={() => setSarHubPanel(null)} npcEnabled={sarState.npcPreference === 'show'} onChangeNpc={changeSarNpcPreference} caianMet={sarState.caianMet} onRequestRewind={()=>setShowSarRewindConfirm(true)} userProfile={userProfile} characters={characters} onOpenFamiliarity={(npc,sceneId)=>setFamiliarity({npc,sceneId})}/>}
            {familiarity && sarState.npcPreference === 'show' && <SARFamiliarityDialog key={`${familiarity.npc}:${familiarity.sceneId||'today'}`} {...familiarity} onClose={()=>setFamiliarity(null)} onEditUserChibi={()=>setChibiEditUser(true)} onSellFish={()=>{setFamiliarity(null);setShowFishingMarket('sell');}}/>}
            {/* 进入房间场景 */}
            {enterRoom && (
                <RoomScene roomId={enterRoom} occupants={occupantsByRoom[enterRoom] || []}
                    latestByChar={latestByChar} onClose={() => setEnterRoom(null)} onJump={jumpToAnnotation}
                    characters={characters} userName={userName} onUserBoardPost={onUserBoardPost} addToast={addToast}
                    onUseModule={(character) => {
                        setSarModuleTargetCharId(character.id);
                        setShowSarModuleShop(true);
                    }} />
            )}
            {sarPromptStep && (
                <SARUpdateModal step={sarPromptStep} onContinue={() => setSarPromptStep('preference')} onChoose={chooseSarNpcPreference} />
            )}
            {showSarDialogue && sarState.npcPreference === 'show' && (
                <SARCaianDialogue onClose={() => setShowSarDialogue(false)} onComplete={completeSarIntro} />
            )}
            {showSarGacha && <SARGachaOverlay onClose={() => setShowSarGacha(false)} />}
            {showSarCabinet && userProfile && (
                <SARAssemblyCabinetOverlay onClose={() => setShowSarCabinet(false)} characters={characters} characterGroups={characterGroups}
                    apiConfig={apiConfig} userProfile={userProfile} groups={groups} realtimeConfig={realtimeConfig} />
            )}
            {showSarModuleShop && (
                <SARModuleShopOverlay
                    npcEnabled={sarState.npcPreference === 'show'}
                    initialTargetCharacterId={sarModuleTargetCharId}
                    onClose={() => { setShowSarModuleShop(false); setSarModuleTargetCharId(null); }}
                />
            )}
            {showFishingMarket==='garden' && userProfile && <React.Suspense fallback={<div className="fixed inset-0 z-[390] grid place-items-center bg-[#f2eee3] text-[#65785c]">箱庭正在打开…</div>}><DinosaurGarden userProfile={userProfile} characters={characters} onClose={()=>setShowFishingMarket(null)} onCharacterTrip={async char=>{
                const {runVRSession}=await import('../utils/vrWorld/runSession');return runVRSession({char,characters,userProfile,groups,apiConfig,realtimeConfig,memoryPalaceConfig,updateCharacter,updateUserProfile,forcedRoom:'sar',forcedSARActivity:'garden',manual:true});
            }}/></React.Suspense>}
            {showFishingMarket && showFishingMarket!=='garden' && userProfile && (
                <FishingMarketOverlay apiConfig={apiConfig} key={showFishingMarket} initialEntry={showFishingMarket} characters={characters} userProfile={userProfile} realtimeConfig={realtimeConfig}
                    addToast={addToast} onClose={() => setShowFishingMarket(null)} onOpenGarden={()=>setShowFishingMarket('garden')}
                    onCharacterTrip={async (char, mode) => {
                        const { runVRSession } = await import('../utils/vrWorld/runSession');
                        return runVRSession({ char, characters, userProfile, groups, apiConfig, realtimeConfig, memoryPalaceConfig,
                            updateCharacter, updateUserProfile, forcedRoom: 'sar', forcedSARActivity: mode, manual: true });
                    }} />
            )}
            {incomingSarModule && (() => {
                const source = characters.find(character => character.id === incomingSarModule.charId);
                return (
                    <div className="fixed inset-0 z-[620] grid place-items-center bg-[#03070b]/75 px-8 backdrop-blur-md" role="dialog" aria-modal="true" aria-label="角色对你装载了模块">
                        <style>{`@keyframes sar-user-approach{0%{opacity:0;transform:translateX(-52px) scale(.78)}65%{opacity:1;transform:translateX(0) scale(1.04)}100%{transform:none}}@keyframes sar-user-chip{0%{opacity:0;transform:translate(72px,-45px) rotate(45deg)}55%{opacity:1;transform:translate(28px,-10px) rotate(45deg)}100%{opacity:0;transform:translate(12px,0) rotate(45deg) scale(.3)}}`}</style>
                        <section className="w-full max-w-[330px] border border-emerald-100/20 bg-[#101b20] px-5 py-6 text-center shadow-[0_22px_80px_rgba(0,0,0,.65)]">
                            <div className="relative mx-auto grid h-36 w-48 place-items-center">
                                <div className="h-20 w-20 overflow-hidden rounded-full border border-emerald-100/30 bg-white/10 shadow-[0_0_36px_rgba(120,220,205,.2)]" style={{ animation: 'sar-user-approach .75s cubic-bezier(.2,.8,.2,1) both' }}>
                                    {source?.avatar ? <TokenImg value={source.avatar} alt={source.name} className="h-full w-full object-cover" /> : <span className="grid h-full place-items-center text-2xl text-white/80">{incomingSarModule.charName[0]}</span>}
                                </div>
                                <span className="absolute grid h-8 w-8 place-items-center border border-emerald-100/50 bg-emerald-900/70 text-emerald-100" style={{ animation: 'sar-user-chip .95s cubic-bezier(.2,.8,.2,1) both', transform: 'rotate(45deg)' }}><Sparkle size={14} /></span>
                            </div>
                            <div className="text-[8px] tracking-[.28em] text-emerald-100/45">MODULE INSTALLED</div>
                            <h2 className="mt-2 text-[18px] tracking-[.08em] text-white/90" style={{ fontFamily: `'Noto Serif SC',serif` }}>{incomingSarModule.charName} 对你使用了模块</h2>
                            <p className="mt-2 text-[11px] leading-relaxed text-white/55">「{incomingSarModule.moduleTitle}」将在接下来 5 次成功互动中改变你的外显表达，真实意图不会被覆盖。</p>
                            <button type="button" className="mt-5 w-full border border-emerald-100/20 bg-emerald-300/10 py-2.5 text-[11px] text-emerald-50" onClick={() => setIncomingSarModule(null)}>我知道了</button>
                        </section>
                    </div>
                );
            })()}
            <ConfirmDialog zIndex={500} open={showSarRewindConfirm} title="回档凯恩初次见面？"
                message="会清除这段初见剧情的完成记录，让凯恩重新出现感叹号。更新公告和 NPC 显示偏好不会改变。"
                confirmText="确认回档" onConfirm={rewindSarIntro} onCancel={() => setShowSarRewindConfirm(false)} />
            {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
            {readingPreferenceChar && (
                <NovelPreferenceModal
                    key={readingPreferenceChar.id}
                    char={readingPreferenceChar}
                    novels={novels}
                    categories={libraryCategories}
                    onClose={() => setReadingPreferenceCharId(null)}
                    onSave={preference => {
                        updateCharacter(readingPreferenceChar.id, latest => ({
                            vrState: { ...(latest.vrState || { enabled: false, intervalMinutes: VR_DEFAULT_INTERVAL_MIN }), ...preference },
                        }));
                        addToast?.('阅读偏好已保存', 'success');
                        setReadingPreferenceCharId(null);
                    }}
                />
            )}
            {readerNovel && <ReaderModal novel={readerNovel} characters={characters} onClose={() => setReaderNovel(null)} />}
            {readerJump && <ReaderModal novel={readerJump.novel} characters={characters} initialSeg={readerJump.seg} peek onClose={() => setReaderJump(null)} />}
            {showUpload && (
                <UploadModal categories={libraryCategories} initialCategoryId={uploadCategoryId} onClose={() => setShowUpload(false)}
                    onCommit={async (novel) => {
                        await DB.saveVRNovel(novel); await loadNovels(); setShowUpload(false);
                        addToast?.(`《${novel.title}》已上架（${novel.segments.length} 段）`, 'success');
                    }}
                    onError={(msg) => addToast?.(msg, 'error')} />
            )}
            {chibiEditChar && (
                <ChibiEditor char={chibiEditChar}
                    onClose={() => { setChibiEditChar(null); setPendingEnable(null); }}
                    onSave={(chibi) => {
                        updateCharacter(chibiEditChar.id, { vrState: { ...(chibiEditChar.vrState || { enabled: false, intervalMinutes: VR_DEFAULT_INTERVAL_MIN }), chibi } });
                        const wasPending = pendingEnable === chibiEditChar.id;
                        const charSnap = chibiEditChar;
                        setChibiEditChar(null);
                        if (wasPending) {
                            setPendingEnable(null);
                            const vrState = { ...joinVRState(charSnap.vrState), chibi };
                            updateCharacter(charSnap.id, { vrState });
                            if (allowsAutomaticVR(vrState)) VRScheduler.start(charSnap.id, vrState.intervalMinutes);
                            else VRScheduler.stop(charSnap.id);
                            addToast?.(`${charSnap.name} 已接入彼方`, 'success');
                            trackEvent('开启角色接入彼方', { action: 'enable' });
                        } else {
                            addToast?.('形象已更新', 'success');
                        }
                    }} />
            )}
            {chibiEditUser && (
                <div className="fixed inset-0 z-[600]"><UserChibiEditor userName={userName} existing={userProfile?.vrState?.chibi}
                    onClose={() => setChibiEditUser(false)}
                    onSave={(chibi) => {
                        const uv = userProfile?.vrState;
                        updateUserProfile({ vrState: { ...(uv || {}), enabled: !!uv?.enabled, chibi, updatedAt: Date.now() } });
                        setChibiEditUser(false);
                        addToast?.('形象已更新', 'success');
                    }} /></div>
            )}
        </div>
    );
};

// ============ 通用：CSS 房间场景背景 ============
const RoomBackground: React.FC<{ roomId: VRRoomId; className?: string }> = ({ roomId, className }) => {
    // 每个房间的插画底图（仓库相对路径，经 assetUrl 走多 CDN 镜像兜底，见 utils/assetUrl.ts）。
    // 统一套一层"彼方"调性处理：降饱和 + 压暗 + 轻柔化把图推远、弱化清晰度，
    // 再叠暗紫色洗 + 底部压暗 + 暗角，让五个房间是一套风格、且立绘能跳出来。
    const ROOM_BG: Partial<Record<VRRoomId, string>> = {
        library: 'img/BOOK.png',
        music: 'img/MUSIC.png',
        guestbook: 'img/PLAY.jpg',
        gym: 'img/ALL.png',
        theater: 'img/SHOW.png',
    };
    // hook 必须无条件调用：无底图的房间传 null，返回空串走下面的分支。
    const bgUrl = useResilientAssetUrl(ROOM_BG[roomId] ?? null);
    if (bgUrl) {
        return (
            <div className={`absolute inset-0 overflow-hidden ${className || ''}`} style={{ background: '#0a0816' }}>
                {/* 底图：降饱和/压暗/轻柔化，并略放大避免柔化露边 */}
                <div className="absolute inset-0" style={{
                    backgroundImage: `url(${bgUrl})`, backgroundSize: 'cover', backgroundPosition: 'center',
                    filter: 'saturate(0.78) brightness(0.6) contrast(1.02) blur(1.3px)',
                    transform: 'scale(1.06)',
                }} />
                {/* 统一暗紫色洗 + 底部压暗给立绘让位 */}
                <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(22,17,46,0.42) 0%, rgba(13,10,30,0.20) 42%, rgba(7,5,18,0.86) 100%)' }} />
                {/* 暗角 */}
                <div className="absolute inset-0" style={{ background: 'radial-gradient(120% 92% at 50% 36%, transparent 40%, rgba(5,4,14,0.66) 100%)' }} />
                {/* 顶部一抹冷紫晕，呼应"彼方"外壳 */}
                <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg, rgba(96,72,180,0.16), transparent 28%)' }} />
            </div>
        );
    }
    if (roomId === 'library') {
        return (
            <div className={`absolute inset-0 ${className || ''}`} style={{ background: 'linear-gradient(180deg,#3a2a1c 0%,#2a1d12 60%,#1c130b 100%)' }}>
                {/* 暖光窗 */}
                <div className="absolute top-[8%] right-[10%] w-20 h-28 rounded-md" style={{ background: 'linear-gradient(180deg,rgba(255,224,150,.55),rgba(255,180,90,.2))', boxShadow: '0 0 50px 18px rgba(255,200,120,.35)' }} />
                {/* 书架 */}
                <div className="absolute left-0 right-0 top-[20%] bottom-[28%]" style={{
                    backgroundImage: 'repeating-linear-gradient(90deg, #6b4a2b 0 4px, #8a5a30 4px 7px, #5a3a22 7px 14px, #9a6a3a 14px 18px, #4a2f1c 18px 22px)',
                    opacity: 0.85,
                }} />
                {/* 隔板 */}
                {[28, 44, 60].map(t => <div key={t} className="absolute left-0 right-0 h-1.5" style={{ top: `${t}%`, background: 'linear-gradient(180deg,#3a2615,#1c120a)' }} />)}
                {/* 地板 */}
                <div className="absolute left-0 right-0 bottom-0 h-[28%]" style={{ background: 'linear-gradient(180deg,#46301c,#241608)' }} />
            </div>
        );
    }
    if (roomId === 'music') {
        return (
            <div className={`absolute inset-0 ${className || ''}`} style={{ background: 'linear-gradient(180deg,#2a1140 0%,#16082a 70%,#0a0418 100%)' }}>
                <div className="absolute inset-x-0 top-[18%] flex items-end justify-center gap-1 h-[40%] px-6 opacity-70">
                    {Array.from({ length: 22 }).map((_, i) => (
                        <div key={i} className="flex-1 rounded-t" style={{ height: `${30 + (Math.sin(i * 1.7) + 1) * 35}%`, background: 'linear-gradient(180deg,#ff7bd5,#7b5bff)', animation: `vrwave 1.2s ${i * 0.05}s ease-in-out infinite alternate` }} />
                    ))}
                </div>
                <div className="absolute left-0 right-0 bottom-0 h-[26%]" style={{ background: 'linear-gradient(180deg,#1a0a30,#0a0418)' }} />
            </div>
        );
    }
    if (roomId === 'guestbook') {
        return (
            <div className={`absolute inset-0 ${className || ''}`} style={{ background: 'linear-gradient(180deg,#103050 0%,#0a2038 70%,#06121f 100%)' }}>
                <div className="absolute left-0 right-0 top-[14%] bottom-[28%]" style={{ background: 'linear-gradient(180deg,rgba(120,200,255,.10),rgba(80,160,230,.04))', boxShadow: 'inset 0 0 60px rgba(120,200,255,.2)' }}>
                    {[[18, 22, -6], [44, 30, 5], [68, 20, -3], [30, 55, 4], [60, 60, -5], [80, 48, 6]].map(([l, t, r], i) => (
                        <div key={i} className="absolute w-10 h-10 rounded-sm shadow-lg text-[7px] p-1 text-stone-700"
                            style={{ left: `${l}%`, top: `${t}%`, transform: `rotate(${r}deg)`, background: ['#fff7a8', '#ffd6e7', '#c8f7d4', '#cfe3ff'][i % 4] }} />
                    ))}
                </div>
                <div className="absolute left-0 right-0 bottom-0 h-[26%]" style={{ background: 'linear-gradient(180deg,#0c2236,#06121f)' }} />
            </div>
        );
    }
    if (roomId === 'sar') {
        return (
            <div className={`absolute inset-0 overflow-hidden ${className || ''}`} style={{ background: 'linear-gradient(180deg,#20243a 0%,#151827 58%,#0b0d16 100%)' }}>
                {/* 美术素材接入前的活动室底稿：墙面、窗光、地板和社团横幅分层保留，之后可直接替换 ROOM_BG。 */}
                <div className="absolute left-[7%] top-[13%] h-[37%] w-[48%]" style={{ background: 'linear-gradient(150deg,rgba(177,197,232,.17),rgba(85,100,132,.04))', border: '1px solid rgba(210,220,255,.09)', boxShadow: '0 0 45px rgba(126,154,205,.08)' }} />
                <div className="absolute right-[8%] top-[17%] h-[33%] w-[26%] rounded-sm" style={{ background: 'rgba(7,8,15,.28)', border: '1px solid rgba(255,255,255,.08)' }} />
                <div className="absolute left-[10%] top-[20%] text-[18px] tracking-[0.28em] text-white/12" style={{ fontFamily: `'Noto Serif SC',serif` }}>SAR</div>
                <div className="absolute inset-x-0 bottom-0 h-[38%]" style={{ background: 'linear-gradient(180deg,#26263a,#11121c)' }} />
                <div className="absolute inset-x-0 bottom-[23%] h-px bg-white/[0.07]" />
                <div className="absolute inset-0" style={{ background: 'radial-gradient(90% 70% at 50% 38%,transparent,rgba(5,6,14,.55))' }} />
            </div>
        );
    }
    if (roomId === 'cafe') {
        return (
            <div className={`absolute inset-0 ${className || ''}`} style={{ background: 'linear-gradient(180deg,#3a2a1e 0%,#271c14 60%,#160f0a 100%)' }}>
                <div className="absolute top-[20%] left-[18%] w-10 h-12 rounded-t-full" style={{ background: 'radial-gradient(circle at 50% 30%,rgba(255,210,150,.25),transparent 70%)', filter: 'blur(4px)' }} />
                <div className="absolute top-[24%] right-[22%] w-8 h-10 rounded-t-full" style={{ background: 'radial-gradient(circle at 50% 30%,rgba(255,190,130,.2),transparent 70%)', filter: 'blur(4px)' }} />
                <div className="absolute left-0 right-0 bottom-0 h-[32%]" style={{ background: 'linear-gradient(180deg,#4a3322,#1a110a)' }} />
            </div>
        );
    }
    // gym
    return (
        <div className={`absolute inset-0 ${className || ''}`} style={{ background: 'linear-gradient(180deg,#0a3a30 0%,#08261f 65%,#041511 100%)' }}>
            <div className="absolute left-0 right-0 bottom-0 h-[45%]" style={{
                backgroundImage: 'repeating-linear-gradient(90deg, transparent 0 38px, rgba(120,255,200,.18) 38px 40px), repeating-linear-gradient(0deg, transparent 0 38px, rgba(120,255,200,.12) 38px 40px)',
                transform: 'perspective(300px) rotateX(58deg)', transformOrigin: 'bottom',
            }} />
            <div className="absolute top-[14%] left-1/2 -translate-x-1/2 w-32 h-10 rounded-full" style={{ background: 'radial-gradient(ellipse,rgba(120,255,200,.3),transparent)' }} />
        </div>
    );
};

// ============ chibi 小人渲染 ============
const Chibi: React.FC<{ char: CharacterProfile; bubble?: string; onTap?: () => void; size?: number; dance?: boolean }> = ({ char, bubble, onTap, size = 96, dance }) => {
    const c = getChibi(char);
    return (
        <div
            className={`absolute flex flex-col items-center ${onTap ? 'cursor-pointer' : ''}`}
            style={{ transform: 'translate(-50%, -100%)' }}
            onClick={onTap}
            role={onTap ? 'button' : undefined}
            tabIndex={onTap ? 0 : undefined}
            aria-label={onTap ? `查看 ${char.name}` : undefined}
            onKeyDown={event => {
                if (onTap && (event.key === 'Enter' || event.key === ' ')) {
                    event.preventDefault();
                    onTap();
                }
            }}
        >
            {bubble && (
                <div className="relative mb-1 max-w-[120px] px-2 py-1 rounded-xl bg-white/95 text-stone-700 text-[10px] leading-snug font-medium shadow-[0_3px_10px_rgba(0,0,0,.3)] text-center">
                    {bubble.length > 22 ? bubble.slice(0, 22) + '…' : bubble}
                    <span className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-white/95 rotate-45" />
                </div>
            )}
            <div className="relative" style={{ animation: `${dance ? 'vrdance 0.9s' : 'vrfloat 3.2s'} ease-in-out infinite`, animationDelay: `${(char.id.charCodeAt(0) % 10) * 0.15}s` }}>
                {c.img ? (
                    <TokenImg value={c.img} alt={char.name}
                        style={{ height: size * c.scale, transform: `scaleX(${c.flip ? -1 : 1}) translateY(${c.offsetY}px)`, filter: 'drop-shadow(0 4px 6px rgba(0,0,0,.5))' }}
                        className="object-contain" />
                ) : (
                    <div className="rounded-full flex items-center justify-center font-bold text-white"
                        style={{ width: size * 0.55, height: size * 0.55, background: 'linear-gradient(120deg, rgba(150,168,255,.92), rgba(188,168,255,.85) 55%, rgba(150,212,204,.9))', fontSize: size * 0.22 }}>
                        {char.name.slice(0, 1)}
                    </div>
                )}
            </div>
            {/* 地面投影 */}
            <div className="rounded-[50%] -mt-1" style={{ width: size * 0.5, height: size * 0.12, background: 'radial-gradient(ellipse,rgba(0,0,0,.45),transparent)' }} />
            <div className="text-[9px] text-white/90 font-bold mt-0.5 px-1.5 rounded-full bg-black/30 backdrop-blur-sm whitespace-nowrap">{char.name}</div>
        </div>
    );
};

// ============ 通用：长按 hook + 确认弹窗（统一替代原生 confirm/alert） ============
const useLongPress = (onLong: () => void, ms = 500) => {
    const timer = useRef<number | null>(null);
    const [pressing, setPressing] = useState(false);
    const cancel = useCallback(() => { setPressing(false); if (timer.current) { clearTimeout(timer.current); timer.current = null; } }, []);
    const start = useCallback(() => { setPressing(true); timer.current = window.setTimeout(() => { setPressing(false); timer.current = null; onLong(); }, ms); }, [onLong, ms]);
    return { pressing, handlers: { onPointerDown: start, onPointerUp: cancel, onPointerLeave: cancel, onPointerCancel: cancel } };
};

const ConfirmDialog: React.FC<{
    open: boolean; title: string; message?: string;
    confirmText?: string; cancelText?: string; zIndex?: number;
    onConfirm: () => void; onCancel: () => void;
}> = ({ open, title, message, confirmText = '删除', cancelText = '取消', zIndex = 300, onConfirm, onCancel }) => {
    const root=useRef<HTMLDivElement>(null);
    useEffect(()=>{if(!open)return;const prior=document.activeElement as HTMLElement|null;root.current?.focus();return()=>prior?.focus();},[open]);
    if (!open) return null;
    return (
        <div ref={root} tabIndex={-1} role="dialog" aria-modal="true" aria-label={title} style={{zIndex}} className="fixed inset-0 flex items-center justify-center px-8 bg-black/55 backdrop-blur-sm" onClick={onCancel} onKeyDown={event=>{if(event.key==='Escape'){event.stopPropagation();onCancel();}}}>
            <div className="w-full max-w-[300px] rounded-2xl p-4 text-center" onClick={e => e.stopPropagation()}
                style={{ background: 'linear-gradient(180deg,#1b1830 0%,#100d20 100%)', border: '1px solid rgba(255,255,255,.12)', boxShadow: '0 16px 50px rgba(0,0,0,.6)' }}>
                <div className="text-[14px] font-semibold text-white tracking-wide" style={{ fontFamily: `'Noto Serif SC',serif` }}>{title}</div>
                {message && <p className="text-[11.5px] text-white/55 mt-1.5 leading-relaxed whitespace-pre-wrap">{message}</p>}
                <div className="flex gap-2 mt-4">
                    <button onClick={onCancel} className="flex-1 rounded-full py-2 text-[12.5px] text-white/75 active:bg-white/5" style={{ border: '1px solid rgba(255,255,255,.16)' }}>{cancelText}</button>
                    <button onClick={onConfirm} className="flex-1 rounded-full py-2 text-[12.5px] font-semibold text-white active:opacity-85" style={{ background: 'linear-gradient(120deg,#f43f5e,#e11d48)' }}>{confirmText}</button>
                </div>
            </div>
        </div>
    );
};

// 长按弹出的动作菜单（编辑 / 删除等）
const ActionSheet: React.FC<{
    open: boolean; title?: string;
    actions: { label: string; onClick: () => void; danger?: boolean }[];
    onClose: () => void;
}> = ({ open, title, actions, onClose }) => {
    if (!open) return null;
    return (
        <div className="fixed inset-0 z-[300] flex items-end justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
            <div className="w-full max-w-md p-3" style={{ paddingBottom: vrBottomPad('0.75rem') }} onClick={e => e.stopPropagation()}>
                <div className="rounded-2xl overflow-hidden" style={{ background: 'linear-gradient(180deg,#1b1830,#120f22)', border: '1px solid rgba(255,255,255,.12)' }}>
                    {title && <div className="px-4 py-2.5 text-[11px] text-white/45 text-center border-b border-white/8 whitespace-pre-wrap leading-snug">{title}</div>}
                    {actions.map((a, i) => (
                        <button key={i} onClick={() => { a.onClick(); }} className={`w-full py-3 text-[13.5px] active:bg-white/5 ${i > 0 ? 'border-t border-white/8' : ''} ${a.danger ? 'text-rose-400 font-semibold' : 'text-white/90'}`}>{a.label}</button>
                    ))}
                </div>
                <button onClick={onClose} className="w-full mt-2 rounded-2xl py-3 text-[13.5px] text-white/80 font-medium" style={{ background: 'rgba(40,36,60,.9)', border: '1px solid rgba(255,255,255,.1)' }}>取消</button>
            </div>
        </div>
    );
};

// 分页列表（每页 perPage 条，超出翻页）
function PagedList<T>({ items, perPage, render }: { items: T[]; perPage: number; render: (it: T, idx: number) => React.ReactNode }) {
    const [p, setP] = useState(0);
    const total = Math.max(1, Math.ceil(items.length / perPage));
    const cur = Math.min(p, total - 1);
    const slice = items.slice(cur * perPage, cur * perPage + perPage);
    return (
        <>
            {slice.map(render)}
            {total > 1 && (
                <div className="flex items-center justify-center gap-3 mb-1">
                    <button onClick={() => setP(Math.max(0, cur - 1))} disabled={cur === 0} className="h-6 w-6 rounded-full flex items-center justify-center text-white/60 disabled:opacity-25 active:bg-white/10" style={{ border: '1px solid rgba(255,255,255,.14)' }}><CaretLeft size={11} weight="bold" /></button>
                    <span className="text-[10px] text-white/45 tabular-nums">{cur + 1}/{total}</span>
                    <button onClick={() => setP(Math.min(total - 1, cur + 1))} disabled={cur >= total - 1} className="h-6 w-6 rounded-full flex items-center justify-center text-white/60 disabled:opacity-25 active:bg-white/10" style={{ border: '1px solid rgba(255,255,255,.14)' }}><CaretRight size={11} weight="bold" /></button>
                </div>
            )}
        </>
    );
}

// ============ 玩法说明 ============
const HelpModal: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const Block: React.FC<{ title: string; tone?: string; children: React.ReactNode }> = ({ title, tone = 'rgba(180,180,255,.9)', children }) => (
        <div className="rounded-xl p-3 mb-2.5" style={{ background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.07)' }}>
            <div className="flex items-center gap-1.5 mb-1.5">
                <span className="h-3 w-[3px] rounded-full shrink-0" style={{ background: tone }} />
                <span className="text-[12.5px] font-semibold tracking-wide" style={{ color: tone, fontFamily: `'Noto Serif SC',serif` }}>{title}</span>
            </div>
            <div className="text-[11.5px] text-white/70 leading-relaxed space-y-1">{children}</div>
        </div>
    );
    const Step: React.FC<{ n: number; children: React.ReactNode }> = ({ n, children }) => (
        <div className="flex gap-2">
            <span className="shrink-0 h-4 w-4 mt-0.5 rounded-full flex items-center justify-center text-[9px] font-bold text-black" style={{ background: 'linear-gradient(120deg,#f3d08a,#e8b75e)' }}>{n}</span>
            <span className="flex-1">{children}</span>
        </div>
    );
    return (
        <div className="fixed inset-0 z-[80] flex flex-col" style={{ background: 'linear-gradient(180deg,#0c0a1c 0%,#080612 100%)' }}>
            <div className="flex items-center gap-2.5 px-5 pb-3 shrink-0 border-b border-white/8" style={{ paddingTop: VR_TOP }}>
                <span className="text-[15px] tracking-[0.2em] text-white/95" style={{ fontFamily: `'Noto Serif SC',serif` }}>彼方 · 玩法说明</span>
                <button onClick={onClose} className="ml-auto p-1.5 rounded-full text-white/60 active:bg-white/10"><X size={19} /></button>
            </div>
            <div className="flex-1 overflow-y-auto vr-reader-scroll px-4 pt-4" style={{ paddingBottom: vrBottomPad('1rem') }}>
                <p className="text-[12px] text-white/75 leading-relaxed mb-3">
                    「彼方」是你的角色们<b className="text-indigo-200">自己会去逛</b>的一方小世界。开启后，ta 们会按你设的间隔独自登入，在不同房间里读书、听歌、发帖、看剧、瞎玩——所有举动都会变成「动态」，并<b className="text-indigo-200">同步进 ta 各自的聊天和记忆</b>里。这是 ta 不被你盯着的私人时间。
                </p>

                <Block title="世界观会自适应你的角色" tone="rgba(180,200,255,.95)">
                    <div>《彼方》本身是个<b className="text-indigo-200">类似 VRChat 的虚拟世界</b>。无论你的角色来自什么设定——现代、古代、魔法、末世、异世界都行——ta 都会用<b>符合自己世界观的方式</b>理解并进入这里，始终保持 ta 自己，不会因为来玩就 OOC。</div>
                    <div className="mt-1 text-white/60"><b className="text-amber-200">别担心「我家角色世界观对不上就不能玩」</b>：怎么进来、用什么道理解释自己身处其中，全交给角色自己圆。放心带 ta 来逛。</div>
                </Block>

                <Block title="怎么开始" tone="rgba(245,208,138,.95)">
                    <Step n={1}>去 <b>「角色接入」</b> 标签：给角色捏个小人形象，打开开关。默认<b>仅手动活动</b>；想让 ta 自己逛，再选「自动活动」和间隔。</Step>
                    <Step n={2}>想用图书馆，先去 <b>「书库」</b> 上传小说。可以按分类整理，并在「谁来读这些书」里让角色按分类轮换。</Step>
                    <Step n={3}>不想等？在「角色接入」里点 <b>「让 ta 现在去逛一次」</b>，可以<b className="text-amber-200">指定房间或随机</b>，立刻看效果。</Step>
                </Block>

                <Block title="房间都能干嘛">
                    <div><b className="text-indigo-100">图书馆</b>：角色读你上传的小说、<b>自己写批注</b>。你能翻看 ta 的批注（动态里点批注还能跳回原文），不过<b className="text-amber-200">暂时还不能自己写批注</b>。</div>
                    <div><b className="text-indigo-100">听歌房</b>：从角色自己的歌单点歌、锐评正在放的曲子。</div>
                    <div><b className="text-indigo-100">留言簿</b>：公共版聊墙，角色发帖、接话茬。你也能在底部<b className="text-sky-200">以自己身份留言</b>，会广播给所有接入的角色。</div>
                    <div><b className="text-indigo-100">娱乐室</b>：纯放飞，角色在这儿瞎玩造谣找乐子。</div>
                    <div><b style={{ color: '#f5a6a6' }}>剧院</b>：角色逛进来会<b>写一出舞台剧</b>投稿。你可以翻投稿、自己写/让 LLM 写/传 txt，挑一本<b>【编排】</b>：给角色选演员（缺角能 roll 个 NPC），角色读完会提意见/改戏，<b>【召唤导演】</b>整合成最终本，小人气泡<b>演一遍</b>，再收进历史舞台剧。</div>
                </Block>

                <Block title="小提示" tone="rgba(180,200,255,.9)">
                    <div>· 「世界」页的<b>动态</b>长按可删除；满 5 条一页、可翻页。</div>
                    <div>· 角色在留言簿说的话，会原样进 ta 的聊天，不只是一句小总结。</div>
                    <div>· 阅读器里的批注都是<b>角色自己留</b>的；你目前只能翻看，<b className="text-amber-200">还不能亲自写批注</b>（以后再说）。</div>
                    <div>· 彼方较费 API：可在 <b>「API」</b> 标签给它单独指定一份（和设置里的预设共用），还能看<b>调用记录</b>对账。</div>
                </Block>

                <div className="h-2" />
            </div>
        </div>
    );
};

// ============ 世界视图 ============
const SARWorldPage: React.FC<{
    occupants: CharacterProfile[];
    roomView: SARRoomView;
    onToggleLabels: () => void;
    npcEnabled: boolean;
    caianMet: boolean;
    onTalkToCaian: () => void;
    onTalkToAiven: () => void;
    onSelectCharacter: (char:CharacterProfile) => void;
    onOpenGacha: () => void;
    onOpenCabinet: () => void;
    onOpenModuleShop: () => void;
    onOpenSarSettings: () => void;
    onOpenSarWarehouse: () => void;
    onOpenFishingMarket: (entry: 'water' | 'board' | 'garden') => void;
    onBackPage: () => void;
}> = ({ occupants, roomView, onToggleLabels, npcEnabled, caianMet, onTalkToCaian, onTalkToAiven, onSelectCharacter, onOpenGacha, onOpenCabinet, onOpenModuleShop, onOpenSarSettings, onOpenSarWarehouse, onOpenFishingMarket, onBackPage }) => (
    <section className="sar-world-page relative overflow-hidden" aria-label="SAR 活动空间"
        style={{ minHeight: 0, height: '100%' }}>

        <div className="sar-world-heading absolute inset-x-5 top-5 z-10 flex items-start justify-between gap-4">
            <div className="sar-hub-identity">
                <button type="button" className="sar-hub-exit" onClick={onBackPage} aria-label="返回彼方"><ArrowLeft size={20}/></button>
                <div><div className="sar-world-eyebrow">ACTIVITY ROOM</div>
                <h2 style={{ fontFamily: `'Noto Serif SC',serif`, fontWeight: 500 }}>SAR 活动室</h2></div>
            </div>
            <div className="sar-hub-tools">
                <button type="button" onClick={onToggleLabels} aria-label={SAR_ROOM_VIEW_ACTIONS[roomView].description} title={SAR_ROOM_VIEW_ACTIONS[roomView].description} data-room-view={roomView}>{roomView==='characters-hidden' ? <Eye size={21}/> : <EyeSlash size={21}/>}<span>{SAR_ROOM_VIEW_ACTIONS[roomView].label}</span></button>
                <button type="button" onClick={onOpenSarSettings} aria-label="活动室设置"><Gear size={21}/><span>设置</span></button>
                <button type="button" onClick={onOpenSarWarehouse} aria-label="打开仓库"><Package size={21}/><span>仓库</span></button>
            </div>
        </div>

        <SARClubStage roomView={roomView} occupants={occupants} npcEnabled={npcEnabled} caianMet={caianMet} onTalkToCaian={onTalkToCaian} onTalkToAiven={onTalkToAiven} onSelectCharacter={onSelectCharacter} onOpenGacha={onOpenGacha} onOpenCabinet={onOpenCabinet} onOpenModuleShop={onOpenModuleShop} onOpenFishingMarket={onOpenFishingMarket} fullPage />

    </section>
);

const WorldView: React.FC<{
    occupantsByRoom: Record<string, CharacterProfile[]>;
    feed: FeedItem[]; novelCount: number;
    onEnterRoom: (r: VRRoomId) => void; onGoLibrary: () => void;
    onJump: (novelId: string | undefined, segIdx: number) => void;
    onDeleteFeed: (msgId: number) => void; onDeleteFeedMany: (ids: number[]) => void;
}> = ({ occupantsByRoom, feed, novelCount, onEnterRoom, onGoLibrary, onJump, onDeleteFeed, onDeleteFeedMany }) => {
    const FEED_PER_PAGE = 5;
    const [page, setPage] = useState(0);
    const totalPages = Math.max(1, Math.ceil(feed.length / FEED_PER_PAGE));
    const curPage = Math.min(page, totalPages - 1);
    const shown = feed.slice(curPage * FEED_PER_PAGE, curPage * FEED_PER_PAGE + FEED_PER_PAGE);
    const [confirmDel, setConfirmDel] = useState<FeedItem | null>(null);
    // 管理模式：多选删除（替代原「清空」）。选择跨页保留。
    const [manageMode, setManageMode] = useState(false);
    const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
    const [confirmBatch, setConfirmBatch] = useState(false);
    const exitManage = () => { setManageMode(false); setSelectedIds(new Set()); };
    const toggleSelect = (msgId: number) => setSelectedIds(prev => {
        const n = new Set(prev); n.has(msgId) ? n.delete(msgId) : n.add(msgId); return n;
    });
    const shownIds = shown.map(f => f.msgId);
    const allShownSelected = shownIds.length > 0 && shownIds.every(id => selectedIds.has(id));
    const toggleSelectPage = () => setSelectedIds(prev => {
        const n = new Set(prev);
        if (allShownSelected) shownIds.forEach(id => n.delete(id));
        else shownIds.forEach(id => n.add(id));
        return n;
    });
    // 世界保留公共房间；SAR 通过同级入口打开独立空间。
    const shownRooms = VR_ROOMS.filter(room => room.id !== 'sar' && room.id !== 'cafe');
    return (
    <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
            {shownRooms.map(room => {
                const occupants = occupantsByRoom[room.id] || [];
                return (
                    <button key={room.id} aria-label={room.implemented ? `进入 ${room.name}` : `${room.name}开发中`} onClick={() => { if (room.implemented) { onEnterRoom(room.id); trackEvent('进入彼方房间', { room: room.id }); } }}
                        className={`relative rounded-2xl h-36 overflow-hidden text-left active:scale-[0.98] transition-transform ${room.implemented ? '' : 'opacity-65'}`}
                        style={{ boxShadow: '0 8px 28px rgba(0,0,0,.4)', border: room.implemented ? '1px solid rgba(255,255,255,.12)' : '1px solid rgba(255,255,255,.05)' }}>
                        <RoomBackground roomId={room.id} />
                        {/* 顶部渐隐 + 标题 */}
                        <div className="absolute inset-0" style={{ background: 'linear-gradient(180deg,rgba(5,6,14,.45),transparent 38%,transparent 66%,rgba(5,6,14,.62))' }} />
                        {/* 内描边光 */}
                        <div className="absolute inset-0 rounded-2xl pointer-events-none" style={{ boxShadow: 'inset 0 1px 0 rgba(255,255,255,.12)' }} />
                        <div className="absolute top-2.5 left-3 flex items-center gap-1.5">
                            <span className="text-[12.5px] tracking-[0.14em] text-white drop-shadow" style={{ fontFamily: `'Noto Serif SC',serif`, fontWeight: 500 }}>{room.name}</span>
                            {!room.implemented && <span className="text-[7px] tracking-wider text-white/60 border border-white/25 rounded-full px-1.5 ml-0.5">开发中</span>}
                        </div>
                        {!room.implemented && (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <span className="text-[11px] tracking-[0.3em] text-white/55" style={{ fontFamily: `'Noto Serif SC',serif` }}>蒸笼预热中…</span>
                            </div>
                        )}
                        {/* 角色小头像缩影 */}
                        <div className="absolute bottom-2 left-2.5 right-2.5 flex items-end justify-between">
                            <div className="flex -space-x-2">
                                {occupants.slice(0, 4).map(c => {
                                    const ch = getChibi(c);
                                    return ch.img
                                        ? <TokenImg key={c.id} value={ch.img} className="h-9 w-9 object-contain object-bottom drop-shadow" alt="" style={{ transform: `scaleX(${ch.flip ? -1 : 1})` }} />
                                        : <div key={c.id} className="h-6 w-6 rounded-full bg-indigo-400/70 border border-white/40 flex items-center justify-center text-[9px]">{c.name.slice(0, 1)}</div>;
                                })}
                            </div>
                            {room.implemented && <span className="text-[9px] text-white/80 font-bold flex items-center gap-0.5">进入 <CaretRight size={10} weight="bold" /></span>}
                        </div>
                    </button>
                );
            })}
        </div>

        {novelCount === 0 && (
            <button onClick={onGoLibrary} className="w-full rounded-2xl py-3.5 text-[12px] text-white/65 tracking-wide active:bg-white/5"
                style={{ border: '1px dashed rgba(255,255,255,.18)', background: 'rgba(255,255,255,.02)' }}>
                书库尚空 · 上传一卷小说，角色便会在图书馆与它相遇 →
            </button>
        )}

        <div>
            <div className="flex items-center gap-2.5 mb-3 mt-1">
                {/* 左侧占位：与右侧齿轮等宽，撑对称，让「彼方动态」真正居中 */}
                {feed.length > 0 && <span className="w-7 shrink-0" aria-hidden="true" />}
                <span className="h-px flex-1" style={{ background: 'linear-gradient(90deg,transparent,rgba(255,255,255,.14))' }} />
                <span className="text-[10.5px] tracking-[0.3em] text-white/50" style={{ fontFamily: `'Noto Serif SC',serif` }}>彼方动态</span>
                <span className="h-px flex-1" style={{ background: 'linear-gradient(90deg,rgba(255,255,255,.14),transparent)' }} />
                {feed.length > 0 && (
                    <button onClick={() => manageMode ? exitManage() : setManageMode(true)}
                        aria-label={manageMode ? '退出管理' : '管理动态'}
                        className="shrink-0 h-7 w-7 rounded-full flex items-center justify-center transition-colors"
                        style={{ border: `1px solid ${manageMode ? 'rgba(129,140,248,.55)' : 'rgba(255,255,255,.14)'}`, background: manageMode ? 'rgba(99,102,241,.22)' : 'rgba(255,255,255,.03)', color: manageMode ? '#c7d2fe' : 'rgba(255,255,255,.55)' }}>
                        {manageMode ? <X size={13} weight="bold" /> : <Gear size={14} weight="bold" />}
                    </button>
                )}
            </div>
            {feed.length === 0 ? (
                <p className="text-[11px] text-white/40 py-5 text-center tracking-wide leading-relaxed">虚空尚无回响。<br />在「角色接入」里点亮角色，邀请 ta 来逛一次，也可以开启自动活动。</p>
            ) : (
                <>
                    {/* 翻页移到动态上方：底下翻页要滚到最后才够得着，放上方更顺手 */}
                    {totalPages > 1 && (
                        <div className="flex items-center justify-center gap-2 mb-3">
                            <button onClick={() => setPage(p => Math.max(0, Math.min(p, totalPages - 1) - 1))} disabled={curPage === 0}
                                className="h-8 pl-2 pr-3 rounded-full flex items-center gap-1 text-[11px] text-white/75 disabled:opacity-25 active:bg-white/10" style={{ border: '1px solid rgba(255,255,255,.14)', background: 'rgba(255,255,255,.04)' }}><CaretLeft size={12} weight="bold" />上一页</button>
                            <span className="text-[11px] text-white/55 tracking-wider tabular-nums min-w-[46px] text-center">{curPage + 1} / {totalPages}</span>
                            <button onClick={() => setPage(p => Math.min(totalPages - 1, Math.min(p, totalPages - 1) + 1))} disabled={curPage >= totalPages - 1}
                                className="h-8 pl-3 pr-2 rounded-full flex items-center gap-1 text-[11px] text-white/75 disabled:opacity-25 active:bg-white/10" style={{ border: '1px solid rgba(255,255,255,.14)', background: 'rgba(255,255,255,.04)' }}>下一页<CaretRight size={12} weight="bold" /></button>
                        </div>
                    )}
                    {manageMode ? (
                        <div className="flex items-center gap-2 mb-2.5 px-0.5">
                            <button onClick={toggleSelectPage}
                                className="text-[11px] text-white/85 rounded-full px-3 py-1.5 active:bg-white/10" style={{ border: '1px solid rgba(255,255,255,.18)', background: 'rgba(255,255,255,.04)' }}>
                                {allShownSelected ? '取消本页' : '选择本页'}
                            </button>
                            <span className="text-[10.5px] text-white/45 tabular-nums">已选 {selectedIds.size} 条</span>
                            <button onClick={() => { if (selectedIds.size > 0) setConfirmBatch(true); }} disabled={selectedIds.size === 0}
                                className="ml-auto text-[11px] font-semibold text-white rounded-full px-4 py-1.5 disabled:opacity-30 active:opacity-85" style={{ background: 'linear-gradient(120deg,#f43f5e,#e11d48)' }}>
                                删除{selectedIds.size > 0 ? ` (${selectedIds.size})` : ''}
                            </button>
                        </div>
                    ) : (
                        <p className="text-[9px] text-white/25 text-center mb-2">长按动态可删除 · 点「管理」可多选</p>
                    )}
                    <div className="space-y-2.5">
                        {shown.map(item => <FeedCard key={item.msgId} item={item} onJump={onJump} onRequestDelete={setConfirmDel}
                            manageMode={manageMode} selected={selectedIds.has(item.msgId)} onToggleSelect={toggleSelect} />)}
                    </div>
                </>
            )}
        </div>
        <ConfirmDialog open={!!confirmDel} title="删除这条动态？" message={confirmDel ? `${confirmDel.charName} 在${getRoom(confirmDel.meta.room).name}的这条记录将被移除。` : ''}
            onConfirm={() => { if (confirmDel) onDeleteFeed(confirmDel.msgId); setConfirmDel(null); }} onCancel={() => setConfirmDel(null)} />
        <ConfirmDialog open={confirmBatch} title={`删除选中的 ${selectedIds.size} 条动态？`} message="动态即聊天里的同一条卡片消息，删除后聊天记录里对应的卡片也会一并移除。"
            onConfirm={() => { onDeleteFeedMany(Array.from(selectedIds)); setSelectedIds(new Set()); setConfirmBatch(false); }} onCancel={() => setConfirmBatch(false)} />
    </div>
    );
};

// 单条动态卡片：非管理态长按删除；管理态点击多选。只展示数据库中仍存在的记录。
const FeedCard: React.FC<{ item: FeedItem; onJump: (novelId: string | undefined, segIdx: number) => void; onRequestDelete: (item: FeedItem) => void; manageMode?: boolean; selected?: boolean; onToggleSelect?: (msgId: number) => void }> = ({ item, onJump, onRequestDelete, manageMode, selected, onToggleSelect }) => {
    const room = getRoom(item.meta.room);
    const { pressing, handlers } = useLongPress(() => onRequestDelete(item), 550);
    const cardHandlers = manageMode ? { onClick: () => onToggleSelect?.(item.msgId) } : handlers;
    return (
        <div {...cardHandlers}
            className={`relative rounded-2xl p-3 flex gap-3 backdrop-blur-sm transition-transform ${pressing ? 'scale-[0.97]' : ''} ${manageMode ? 'cursor-pointer' : ''}`}
            style={{ background: selected ? 'rgba(99,102,241,0.20)' : pressing ? 'rgba(244,63,94,0.14)' : 'rgba(255,255,255,0.05)', border: `1px solid ${selected ? 'rgba(129,140,248,0.6)' : pressing ? 'rgba(244,63,94,0.4)' : 'rgba(255,255,255,0.07)'}`, boxShadow: '0 4px 18px rgba(0,0,0,.22)' }}>
            {manageMode && (
                <div className="self-center shrink-0 h-5 w-5 rounded-full flex items-center justify-center" style={{ border: `1.5px solid ${selected ? '#818cf8' : 'rgba(255,255,255,.35)'}`, background: selected ? '#6366f1' : 'transparent' }}>
                    {selected && <Check size={12} weight="bold" className="text-white" />}
                </div>
            )}
            {item.avatar ? <TokenImg value={item.avatar} className="h-8 w-8 rounded-full object-cover shrink-0" alt="" /> : <div className="h-8 w-8 rounded-full bg-indigo-400/40 shrink-0" />}
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 text-[11px]">
                    <span className="font-bold text-amber-200">{item.charName}</span>
                    <span className="text-indigo-300/50">{room.name}</span>
                    <span className="ml-auto text-indigo-300/40 text-[9px] shrink-0">{new Date(item.timestamp).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                </div>
                <p className="text-[11.5px] text-indigo-50/90 mt-0.5 leading-snug">{stripSelfName(item.meta.activity, item.charName)}</p>
                {item.meta.behavior && <p className="text-[10.5px] text-pink-200/80 mt-1 leading-snug">{stripSelfName(item.meta.behavior, item.charName)}</p>}
                {item.meta.annotationRefs && item.meta.annotationRefs.length > 0 ? (
                    <div className="mt-1 space-y-0.5">
                        {item.meta.annotationRefs.slice(0, 3).map((ref, i) => (
                            <button key={i} onClick={() => { if (manageMode) { onToggleSelect?.(item.msgId); return; } onJump(item.meta.novelId, ref.segIdx); }}
                                className="block w-full text-left text-[10.5px] text-indigo-200/80 pl-2 border-l-2 border-amber-300/50 leading-snug active:opacity-60 hover:text-amber-100">
                                {stripLeakedAttrs(ref.text)} <span className="text-amber-300/60">↗原文</span>
                            </button>
                        ))}
                    </div>
                ) : item.meta.annotationExcerpts && item.meta.annotationExcerpts.length > 0 ? (
                    <div className="mt-1 space-y-0.5">
                        {item.meta.annotationExcerpts.slice(0, 2).map((ex, i) => (
                            <div key={i} className="text-[10.5px] text-indigo-200/70 pl-2 border-l-2 border-amber-300/40 leading-snug">{stripLeakedAttrs(ex)}</div>
                        ))}
                    </div>
                ) : null}
            </div>
        </div>
    );
};



// ============ 房间场景（全屏） ============
const toSong = (s: CharPlaylistSong): Song => ({ id: s.id, name: s.name, artists: s.artists, album: s.album, albumPic: s.albumPic, duration: s.duration, fee: s.fee ?? 0 });

const GuestbookMessageButton: React.FC<{
    message: VRGuestbookMessage; selected: boolean;
    onReply: () => void; onMenu: () => void;
}> = ({ message: m, selected, onReply, onMenu }) => {
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const held = useRef(false);
    const pressOrigin = useRef({ x: 0, y: 0 });
    const cancel = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
    useEffect(() => cancel, []);
    return <button type="button"
        onPointerDown={e => { if (e.button !== 0) return; cancel(); pressOrigin.current = { x: e.clientX, y: e.clientY }; held.current = false; timer.current = setTimeout(() => { held.current = true; onMenu(); }, 500); }}
        onPointerUp={cancel} onPointerMove={e => { if (Math.hypot(e.clientX - pressOrigin.current.x, e.clientY - pressOrigin.current.y) > 10) cancel(); }} onPointerCancel={cancel} onPointerLeave={cancel}
        onContextMenu={e => { e.preventDefault(); cancel(); held.current = true; onMenu(); }}
        onClick={() => { if (!held.current) onReply(); held.current = false; }}
        aria-label={`${m.authorName}：${m.content}，长按编辑或删除`}
        className="block text-left text-[12.5px] leading-relaxed text-white/85 px-2.5 py-1 rounded-lg w-fit max-w-full select-none"
        style={{ background: selected ? 'rgba(96,165,250,0.18)' : 'rgba(255,255,255,0.055)', border: selected ? '1px solid rgba(125,211,252,.35)' : '1px solid transparent', WebkitTouchCallout: 'none' }}>
        {m.replyToName && <span className="text-[10px] text-sky-200/45 mr-1">↩{m.replyToName}</span>}
        {m.content}
        {m.authorId !== 'user' && <span className="ml-2 text-[9px] text-sky-200/35">回复</span>}
    </button>;
};

const RoomScene: React.FC<{
    roomId: VRRoomId; occupants: CharacterProfile[];
    latestByChar: Record<string, FeedItem>; onClose: () => void;
    onJump: (novelId: string | undefined, segIdx: number) => void;
    characters: CharacterProfile[];
    userName: string;
    onUserBoardPost: (content: string, replyTo?: VRGuestbookMessage) => Promise<void>;
    onUseModule: (character: CharacterProfile) => void;
    addToast?: (m: string, t?: any) => void;
}> = ({ roomId, occupants, latestByChar, onClose, onJump, characters, userName, onUserBoardPost, onUseModule, addToast }) => {
    const room = getRoom(roomId);
    const slots = ROOM_SLOTS[roomId] || ROOM_SLOTS.library!;
    const isMusic = roomId === 'music';
    const isGuestbook = roomId === 'guestbook';
    const isTheater = roomId === 'theater';
    const [detail, setDetail] = useState<CharacterProfile | null>(null);
    const [musicState, setMusicState] = useState<VRMusicRoomState | null>(null);
    const [board, setBoard] = useState<VRGuestbookState | null>(null);
    const [postText, setPostText] = useState('');
    const [replyingTo, setReplyingTo] = useState<VRGuestbookMessage | null>(null);
    const postInputRef = useRef<HTMLInputElement>(null);
    const [posting, setPosting] = useState(false);
    const [gbPage, setGbPage] = useState(0);          // 留言墙翻页：0 = 最新一页
    const [confirmClear, setConfirmClear] = useState(false); // 一键清空二次确认
    const [messageMenu, setMessageMenu] = useState<VRGuestbookMessage | null>(null);
    const [editingMessage, setEditingMessage] = useState<VRGuestbookMessage | null>(null);
    const [messageDraft, setMessageDraft] = useState('');
    const [deletingMessage, setDeletingMessage] = useState<VRGuestbookMessage | null>(null);
    const [savingMessage, setSavingMessage] = useState(false);
    const changeMessage = async (message: VRGuestbookMessage, content: string | null) => {
        if (savingMessage) return;
        setSavingMessage(true);
        try {
            await DB.editVRGuestbookMessage(message.id, content);
            setBoard(await DB.getVRGuestbook());
            if (replyingTo?.id === message.id) setReplyingTo(content === null ? null : { ...message, content });
            setEditingMessage(null); setDeletingMessage(null);
        } catch { addToast?.('留言保存失败，请重试', 'error'); }
        finally { setSavingMessage(false); }
    };
    const [hideChibi, setHideChibi] = useState(false);  // 隐藏小人（留言簿等文字面板会被小人挡住时用）
    const music = useMusic();

    useEffect(() => {
        if (!isGuestbook) return;
        const load = async () => setBoard(await DB.getVRGuestbook());
        void load();
        const onDone = () => { void load(); };
        window.addEventListener('vr-session-done', onDone);
        window.addEventListener('vr-guestbook-updated', onDone);
        return () => { window.removeEventListener('vr-session-done', onDone); window.removeEventListener('vr-guestbook-updated', onDone); };
    }, [isGuestbook]);

    const submitPost = async () => {
        const t = postText.trim();
        if (!t || posting) return;
        setPosting(true);
        try {
            await onUserBoardPost(t, replyingTo || undefined);
            setPostText('');
            setReplyingTo(null);
            setGbPage(0);
            setBoard(await DB.getVRGuestbook());
        }
        finally { setPosting(false); }
    };

    const startReply = (message: VRGuestbookMessage) => {
        if (message.authorId === 'user') return;
        setReplyingTo(message);
        requestAnimationFrame(() => postInputRef.current?.focus());
    };

    // 一键清空留言墙（只清这面公共墙；已广播进各角色私聊的卡片不动）
    const submitClear = async () => {
        await DB.clearVRGuestbook();
        setBoard(await DB.getVRGuestbook());
        setGbPage(0);
        setReplyingTo(null);
        setConfirmClear(false);
        trackEvent('清空彼方留言墙');
        addToast?.('留言墙已清空', 'success');
    };

    useEffect(() => {
        if (!isMusic) return;
        const load = async () => setMusicState(await DB.getVRMusicRoom());
        void load();
        const onDone = () => { void load(); };
        window.addEventListener('vr-session-done', onDone);
        return () => window.removeEventListener('vr-session-done', onDone);
    }, [isMusic]);

    const np = musicState?.nowPlaying;
    const npPlaying = !!np && music.current?.id === np.song.id && music.playing;
    // 记录是否由听歌房起播 —— 离开房间时只暂停"我们放的"那首，不动用户自己的音乐
    const startedRef = useRef(false);
    const musicRef = useRef(music);
    musicRef.current = music;
    const playNow = () => {
        if (!np) return;
        if (music.current?.id === np.song.id) music.togglePlay();
        else { music.playSong(toSong(np.song)); startedRef.current = true; }
        trackEvent('播放听歌房正在放的歌');
    };
    // 音乐只在听歌房内播放：离开场景时若仍在放我们起播的歌，暂停它
    useEffect(() => () => {
        const m = musicRef.current;
        if (startedRef.current && m.playing && m.current?.id === musicState?.nowPlaying?.song.id) {
            m.togglePlay();
        }
    }, []);

    return (
        <div className="fixed inset-0 z-50 flex flex-col" style={{ background: '#05060d' }}>
            <VRStyleTag />
            <div className="relative flex-1 overflow-hidden">
                <RoomBackground roomId={roomId} />
                {/* 空灵氛围：星尘 + 暗角，与外壳呼应 */}
                <div className="pointer-events-none absolute inset-0" style={{ backgroundImage: 'radial-gradient(1px 1px at 22% 24%, rgba(255,255,255,.5), transparent), radial-gradient(1px 1px at 72% 16%, rgba(210,220,255,.45), transparent), radial-gradient(1px 1px at 60% 66%, rgba(230,225,255,.4), transparent)', animation: 'vrtwinkle 7s ease-in-out infinite' }} />
                <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(120% 90% at 50% 30%, transparent 55%, rgba(5,6,14,.45) 100%)' }} />
                {/* 顶栏 */}
                <div className="absolute top-0 left-0 right-0 flex items-center gap-2.5 px-4 pb-3 z-[120]"
                    style={{ background: 'linear-gradient(180deg,rgba(5,6,14,.55),transparent)', paddingTop: VR_TOP }}>
                    <button onClick={onClose} aria-label={`离开 ${room.name}`} className="h-10 w-10 -ml-2 rounded-full bg-white/10 backdrop-blur-md active:bg-white/20 text-white/90 border border-white/10 flex items-center justify-center"><CaretLeft size={20} weight="regular" /></button>
                    <span className="text-[16px] text-white drop-shadow flex items-center gap-1.5 tracking-[0.14em]" style={{ fontFamily: `'Noto Serif SC',serif`, fontWeight: 500 }}>{room.name}</span>
                    <div className="ml-auto flex items-center gap-2">
                        {occupants.length > 0 && (
                            <button onClick={() => setHideChibi(h => !h)} title={hideChibi ? '显示小人' : '隐藏小人（避免挡住文字）'}
                                className="text-[10px] px-2.5 py-1 rounded-full bg-white/10 backdrop-blur-md text-white/85 border border-white/10 active:bg-white/20">
                                {hideChibi ? '显示小人' : '隐藏小人'}
                            </button>
                        )}
                        <span className="text-[10px] tracking-wider text-white/60">{occupants.length} 人在场</span>
                    </div>
                </div>

                {/* 听歌房：正在放 + 队列面板 */}
                {isMusic && (
                    <div className="absolute left-3 right-3 z-20" style={{ top: VR_ROOM_PANEL_TOP }}>
                        {np ? (
                            <div className="rounded-2xl p-2.5 flex items-center gap-3 backdrop-blur-md"
                                style={{ background: 'rgba(20,8,40,0.6)', border: '1px solid rgba(255,123,213,0.35)', boxShadow: '0 6px 20px rgba(120,40,160,.4)' }}>
                                {np.song.albumPic
                                    ? <TokenImg value={np.song.albumPic} className={`h-14 w-14 rounded-xl object-cover ${npPlaying ? 'animate-spin-slow' : ''}`} style={npPlaying ? { animation: 'spin 8s linear infinite' } : {}} alt="" />
                                    : <div className="h-14 w-14 rounded-xl bg-gradient-to-br from-pink-500 to-purple-600 flex items-center justify-center"><MusicNotes size={22} weight="fill" className="text-white/80" /></div>}
                                <div className="flex-1 min-w-0">
                                    <div className="text-[9px] text-pink-200/70 tracking-wide flex items-center gap-1"><MusicNotes size={9} weight="fill" /> NOW PLAYING · {np.charName} 点的</div>
                                    <div className="text-[13px] font-bold text-white truncate">{np.song.name}</div>
                                    <div className="text-[10.5px] text-pink-100/60 truncate">{np.song.artists}</div>
                                </div>
                                <button onClick={playNow} className="h-10 w-10 rounded-full bg-white/90 flex items-center justify-center active:scale-90 transition-transform shrink-0">
                                    {npPlaying ? <Pause size={18} weight="fill" className="text-purple-700" /> : <Play size={18} weight="fill" className="text-purple-700 ml-0.5" />}
                                </button>
                            </div>
                        ) : (
                            <div className="rounded-2xl p-3 text-center backdrop-blur-md" style={{ background: 'rgba(20,8,40,0.5)', border: '1px solid rgba(255,123,213,0.25)' }}>
                                <p className="text-[11px] text-pink-100/80">还没有人放歌。让有音乐人格的角色逛进来，ta 就会点一首。</p>
                                <p className="text-[9.5px] text-pink-200/50 mt-1">没有音乐人格？去「音乐」App 给角色生成一个网易云档案。</p>
                            </div>
                        )}
                        {musicState?.queue && musicState.queue.length > 0 && (
                            <div className="mt-1.5 flex items-center gap-1.5 px-2 py-1 rounded-full overflow-x-auto no-scrollbar" style={{ background: 'rgba(20,8,40,0.45)' }}>
                                <Queue size={12} weight="bold" className="text-pink-200/70 shrink-0" />
                                {musicState.queue.slice(0, 6).map((q, i) => (
                                    <span key={i} className="text-[9.5px] text-pink-100/70 whitespace-nowrap shrink-0">《{q.song.name}》<span className="text-pink-200/40">·{q.charName}</span>{i < Math.min(5, musicState.queue.length - 1) ? ' ·' : ''}</span>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {/* 留言簿：版聊墙（DC 风：头像 + 连续消息成组，回复弱化） */}
                {isGuestbook && (() => {
                    const GB_PAGE_SIZE = 50; // 每页 50 条，旧消息翻页查看
                    const all = board?.messages || [];
                    const totalPages = Math.max(1, Math.ceil(all.length / GB_PAGE_SIZE));
                    const page = Math.min(gbPage, totalPages - 1); // 0 = 最新一页（末尾 50 条）
                    const end = all.length - page * GB_PAGE_SIZE;
                    const msgs = all.slice(Math.max(0, end - GB_PAGE_SIZE), end);
                    // 连续同一作者（且非回复、间隔不久）合并为一组
                    const groups: VRGuestbookMessage[][] = [];
                    for (const m of msgs) {
                        const g = groups[groups.length - 1];
                        if (g && g[0].authorId === m.authorId && !m.kind && !m.replyToName && (m.createdAt - g[g.length - 1].createdAt) < 5 * 60 * 1000) g.push(m);
                        else groups.push([m]);
                    }
                    return (
                        <div className="absolute left-3 right-3 z-20 rounded-2xl overflow-hidden flex flex-col backdrop-blur-md"
                            style={{ top: VR_ROOM_PANEL_TOP, bottom: vrBottomPad(replyingTo ? '5.8rem' : '4rem'), background: 'rgba(10,22,38,0.62)', border: '1px solid rgba(140,200,255,0.22)', boxShadow: '0 8px 26px rgba(0,0,0,.4)' }}>
                            <div className="flex items-center gap-2 px-3 py-2 border-b border-white/10">
                                <span className="text-[10px] tracking-[0.25em] text-sky-200/70" style={{ fontFamily: `'Noto Serif SC',serif` }}>留言墙</span>
                                {all.length > 0 && <span className="text-[9px] text-white/30 tabular-nums">{all.length} 条</span>}
                                {all.length > 0 && (confirmClear ? (
                                    <span className="ml-auto flex items-center gap-1.5">
                                        <button onClick={submitClear} className="text-[10px] px-2 py-0.5 rounded-full text-white font-semibold" style={{ background: 'rgba(244,63,94,.85)' }}>确认清空</button>
                                        <button onClick={() => setConfirmClear(false)} className="text-[10px] px-2 py-0.5 rounded-full text-white/70 bg-white/10">取消</button>
                                    </span>
                                ) : (
                                    <button onClick={() => setConfirmClear(true)} className="ml-auto text-[10px] px-2.5 py-0.5 rounded-full text-rose-200/90 bg-white/5 border border-rose-300/20 active:bg-white/10">一键清空</button>
                                ))}
                            </div>
                            <div className="flex-1 overflow-y-auto vr-reader-scroll px-3 py-3 space-y-3">
                                {groups.length === 0 ? (
                                    <p className="text-[11px] text-white/40 text-center py-6">这面墙还空着。留下第一句话，或等角色们来开帖。</p>
                                ) : groups.map(g => {
                                    const head = g[0];
                                    const isUser = head.authorId === 'user';
                                    const isAnnouncement = head.kind === 'collection-unlock';
                                    const ch = isUser ? null : characters.find(c => c.id === head.authorId);
                                    const name = isUser ? head.authorName : (ch?.name || head.authorName);
                                    const hue = (() => { let h = 0; for (let i = 0; i < head.authorId.length; i++) h = (h * 31 + head.authorId.charCodeAt(i)) % 360; return h; })();
                                    const nameColor = isAnnouncement ? '#e9cf9c' : isUser ? '#7dd3fc' : `hsl(${hue},72%,74%)`;
                                    return (
                                        <div key={head.id} className="flex gap-2.5">
                                            {ch?.avatar
                                                ? <TokenImg value={ch.avatar} className="h-8 w-8 rounded-full object-cover shrink-0 mt-0.5" alt="" />
                                                : <div className="h-8 w-8 rounded-full shrink-0 mt-0.5 flex items-center justify-center text-[12px] font-bold text-white/95" style={{ background: isUser ? 'linear-gradient(135deg,#38bdf8,#6366f1)' : `hsl(${hue},45%,42%)` }}>{isAnnouncement ? '✧' : name.slice(0, 1)}</div>}
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-baseline gap-1.5">
                                                    <span className="text-[12px] font-bold" style={{ color: nameColor }}>{name}</span>
                                                    {isAnnouncement && <span className="text-[9px] text-amber-200/70">图鉴解锁</span>}
                                                    <span className="text-[8.5px] text-white/30 tabular-nums">{new Date(head.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                                                </div>
                                                <div className="mt-1 space-y-1">
                                                    {g.map(m => (
                                                        <GuestbookMessageButton key={m.id} message={m} selected={replyingTo?.id === m.id} onReply={() => startReply(m)} onMenu={() => setMessageMenu(m)} />
                                                    ))}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                            {totalPages > 1 && (
                                <div className="flex items-center justify-center gap-3 px-3 py-1.5 border-t border-white/10 text-[10.5px] text-white/70">
                                    <button onClick={() => setGbPage(p => Math.min(totalPages - 1, p + 1))} disabled={page >= totalPages - 1}
                                        className="px-2.5 py-0.5 rounded-full bg-white/8 disabled:opacity-30 active:bg-white/15">← 更早</button>
                                    <span className="tabular-nums text-white/45">{totalPages - page} / {totalPages}</span>
                                    <button onClick={() => setGbPage(p => Math.max(0, p - 1))} disabled={page <= 0}
                                        className="px-2.5 py-0.5 rounded-full bg-white/8 disabled:opacity-30 active:bg-white/15">更新 →</button>
                                </div>
                            )}
                        </div>
                    );
                })()}

                <ActionSheet open={!!messageMenu} title={messageMenu?.authorName} onClose={() => setMessageMenu(null)} actions={[
                    { label: '编辑留言', onClick: () => { setEditingMessage(messageMenu); setMessageDraft(messageMenu?.content || ''); setMessageMenu(null); } },
                    { label: '删除留言', danger: true, onClick: () => { setDeletingMessage(messageMenu); setMessageMenu(null); } },
                ]} />
                <ConfirmDialog open={!!deletingMessage} title="删除这条留言？" message="只删除留言墙上的这条记录。" onCancel={() => { if (!savingMessage) setDeletingMessage(null); }} onConfirm={() => { if (deletingMessage) void changeMessage(deletingMessage, null); }} />
                {editingMessage && <div className="fixed inset-0 z-[300] bg-black/60 flex items-center justify-center p-5" role="dialog" aria-modal="true" aria-label="编辑留言">
                    <div className="w-full max-w-md rounded-2xl bg-slate-900 p-4 text-white">
                        <h3>编辑留言</h3>
                        <textarea autoFocus aria-label="留言内容" value={messageDraft} onChange={e => setMessageDraft(e.target.value)} className="w-full h-32 my-3 p-3 rounded-xl bg-white/10" />
                        <div className="flex justify-end gap-4"><button disabled={savingMessage} onClick={() => setEditingMessage(null)}>取消</button><button disabled={savingMessage || !messageDraft.trim()} onClick={() => void changeMessage(editingMessage, messageDraft.trim())}>{savingMessage ? '保存中…' : '保存'}</button></div>
                    </div>
                </div>}

                {/* 剧院：话剧部门面板（投稿 / 编排 / 演出 / 历史） */}
                {isTheater && <TheaterPanel addToast={addToast} />}

                {/* chibi 站位（可隐藏，避免挡住留言墙等文字） */}
                {!hideChibi && occupants.map((c, i) => {
                    const slot = slots[i % slots.length];
                    const latest = latestByChar[c.id];
                    const quips = IDLE_QUIPS[roomId] || IDLE_QUIPS.library!;
                    const idle = quips[i % quips.length];
                    const bubble = latest ? (stripSelfName(latest.meta.activity, c.name) || idle) : idle;
                    return (
                        <div key={c.id} className="absolute" style={{ left: `${slot.x}%`, top: `${slot.y}%`, zIndex: Math.round(slot.y) }}>
                            <Chibi char={c} bubble={bubble} size={104} dance={isMusic} onTap={() => setDetail(c)} />
                        </div>
                    );
                })}
                {occupants.length === 0 && !isMusic && !isGuestbook && !isTheater && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        <p className="text-white/70 text-[12px] bg-black/30 rounded-full px-4 py-2">这个房间还没有人。去「角色接入」启用角色吧。</p>
                    </div>
                )}

                {/* 留言簿：用户发言（广播给所有接入角色） */}
                {isGuestbook && (
                    <div className="absolute left-0 right-0 z-30 flex flex-col gap-1.5 px-3 py-2.5"
                        style={{ bottom: vrBottomPad('0px'), background: 'linear-gradient(0deg,rgba(5,12,22,.92),transparent)' }}>
                        {replyingTo && (
                            <div className="flex items-center gap-2 px-3 text-[10px] text-sky-100/70 min-w-0">
                                <span className="shrink-0">回复 {replyingTo.authorName}</span>
                                <span className="truncate text-white/35">{replyingTo.content}</span>
                                <button type="button" onClick={() => setReplyingTo(null)} aria-label="取消回复" className="ml-auto shrink-0 text-white/45 active:text-white"><X size={13} /></button>
                            </div>
                        )}
                        <div className="flex items-center gap-2 w-full">
                            <input ref={postInputRef} value={postText} onChange={e => setPostText(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') submitPost(); }}
                                placeholder={replyingTo ? `回复 ${replyingTo.authorName}…` : `以 ${userName} 的身份留句话…`}
                                className="flex-1 min-w-0 rounded-full px-4 py-2 text-[12.5px] text-white placeholder-white/35 outline-none backdrop-blur-md"
                                style={{ background: 'rgba(255,255,255,.08)', border: '1px solid rgba(140,200,255,.25)' }} />
                            <button onClick={submitPost} disabled={!postText.trim() || posting}
                                className="h-9 px-4 rounded-full text-[12px] font-semibold text-white disabled:opacity-40 shrink-0"
                                style={{ background: 'linear-gradient(120deg, rgba(120,180,255,.9), rgba(150,200,235,.85))' }}>
                                {posting ? '…' : replyingTo ? '回复' : '留言'}
                            </button>
                        </div>
                    </div>
                )}
            </div>

            {/* 角色活动详情 —— 盖在 chibi 之上（zIndex 高于任何 chibi） */}
            {detail && (
                <div className="absolute inset-0 flex items-end bg-black/45" style={{ zIndex: 200 }} onClick={() => setDetail(null)}>
                    <div className="w-full rounded-t-2xl p-4 text-white" style={{ background: 'linear-gradient(180deg,#1a2236 0%,#0d1119 100%)', paddingBottom: vrBottomPad('1rem') }} onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-2 mb-2">
                            {detail.avatar ? <TokenImg value={detail.avatar} className="h-9 w-9 rounded-full object-cover" alt="" /> : <div className="h-9 w-9 rounded-full bg-indigo-400/40" />}
                            <span className="font-bold">{detail.name}</span>
                            <button onClick={() => setDetail(null)} className="ml-auto p-1 text-white/60"><X size={18} /></button>
                        </div>
                        {latestByChar[detail.id] ? (() => {
                            const m = latestByChar[detail.id].meta;
                            return (
                                <>
                                    <p className="text-[12.5px] text-indigo-50/90 leading-relaxed">{stripSelfName(m.activity, detail.name)}</p>
                                    {m.behavior && <p className="text-[11px] text-pink-200/80 mt-1.5">{stripSelfName(m.behavior, detail.name)}</p>}
                                    {m.annotationRefs && m.annotationRefs.length > 0
                                        ? m.annotationRefs.map((ref, i) => (
                                            <button key={i} onClick={() => { onJump(m.novelId, ref.segIdx); setDetail(null); }}
                                                className="block w-full text-left mt-1.5 text-[11.5px] text-indigo-200/85 pl-2 border-l-2 border-amber-300/50 leading-snug active:opacity-60">
                                                {stripLeakedAttrs(ref.text)} <span className="text-amber-300/70">↗原文</span>
                                            </button>
                                        ))
                                        : m.annotationExcerpts?.map((ex, i) => (
                                            <div key={i} className="mt-1.5 text-[11.5px] text-indigo-200/80 pl-2 border-l-2 border-amber-300/50 leading-snug">{stripLeakedAttrs(ex)}</div>
                                        ))}
                                    <p className="text-[9px] text-indigo-300/50 mt-2">{new Date(latestByChar[detail.id].timestamp).toLocaleString('zh-CN')}</p>
                                </>
                            );
                        })() : (
                            <p className="text-[12px] text-indigo-300/60">还没有留下动态，等 ta 下一次登入吧。</p>
                        )}
                        {detail.id !== 'user' && (
                            <>
                                {detail.vrState?.sarModule && (
                                    <p className="mt-3 text-[10px] leading-relaxed text-emerald-100/55">
                                        当前模块：{detail.vrState.sarModule.moduleTitle} · {detail.vrState.sarModule.phase === 'active'
                                            ? `剩余 ${detail.vrState.sarModule.remainingTurns} 回合`
                                            : `稳定期 ${detail.vrState.sarModule.afterglowTurns}/3`}
                                    </p>
                                )}
                                <button
                                    type="button"
                                    onClick={() => { onUseModule(detail); setDetail(null); }}
                                    className="mt-4 flex h-11 w-full items-center justify-center gap-2 border border-emerald-100/20 bg-emerald-300/10 text-[12px] tracking-[.08em] text-emerald-50 active:scale-[.985]"
                                >
                                    <MagicWand size={16} weight="fill" />抓住 {detail.name} · 使用模块
                                </button>
                                <p className="mt-2 text-center text-[9px] text-white/35">无论 TA 正在哪个区域，都可以从你的模块袋装载</p>
                            </>
                        )}
                    </div>
                </div>
            )}
        </div>
    );
};

// ============ 书库 ============
// ============ 阅读器主题 ============
interface ReaderTheme { id: string; name: string; bg: string; paper: string; text: string; sub: string; accent: string; annBg: string; }
const READER_THEMES: ReaderTheme[] = [
    { id: 'paper', name: '纸白', bg: '#e9e3d6', paper: '#f7f3ea', text: '#322d25', sub: '#8a7f6c', accent: '#a0673b', annBg: '#efe7d4' },
    { id: 'sepia', name: '羊皮', bg: '#d8c6a3', paper: '#ece0c6', text: '#48381f', sub: '#917a52', accent: '#8a5a2b', annBg: '#e2d3b2' },
    { id: 'green', name: '护眼', bg: '#bcd4bc', paper: '#d6e8d4', text: '#26331f', sub: '#5d7350', accent: '#3f6b3a', annBg: '#cadfc6' },
    { id: 'night', name: '夜阅', bg: '#15161a', paper: '#1f2128', text: '#cfc9bd', sub: '#7d7869', accent: '#c0915a', annBg: '#262932' },
    { id: 'ink', name: '墨黑', bg: '#0a0a0e', paper: '#131319', text: '#b9b4ab', sub: '#6f6a78', accent: '#8b9bff', annBg: '#1a1a24' },
];
const FONT_SIZES = [13, 15, 17, 20];
const READER_THEME_KEY = 'vr_reader_theme';
const READER_FONT_KEY = 'vr_reader_font';
const READER_MODE_KEY = 'vr_reader_mode'; // 'page' | 'scroll'
// 用户书签（段索引，per-novel，独立于角色书签）
const userBmKey = (id: string) => `vr_user_bm_${id}`;
const readUserBm = (id: string): number => {
    const v = Number(localStorage.getItem(userBmKey(id)));
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
};
const writeUserBm = (id: string, idx: number) => {
    try { localStorage.setItem(userBmKey(id), String(Math.max(0, idx))); } catch { /* ignore */ }
};

// 单段渲染（翻页/滚动共用）
const SegBlock: React.FC<{
    seg: { idx: number; text: string }; anns: VRNovelAnnotation[];
    theme: ReaderTheme; fontSize: number; nameOf: (id: string) => string | undefined; highlight?: boolean;
}> = ({ seg, anns, theme, fontSize, nameOf, highlight }) => (
    <div data-seg={seg.idx} className="mb-5 rounded-lg transition-colors" style={highlight ? { background: `${theme.accent}1f`, boxShadow: `0 0 0 2px ${theme.accent}66`, padding: '8px 10px', margin: '0 -10px 20px' } : undefined}>
        <p className="whitespace-pre-wrap" style={{ color: theme.text, fontSize, lineHeight: 1.9, textIndent: '2em' }}>{seg.text}</p>
        {anns.map(a => (
            <div key={a.id} className="mt-2 ml-2 rounded-lg px-3 py-2" style={{ background: theme.annBg, borderLeft: `3px solid ${theme.accent}` }}>
                <span className="font-bold" style={{ color: theme.accent, fontSize: fontSize - 3 }}>{nameOf(a.authorId) || a.authorName}</span>
                {a.targetAnnotationId && <span style={{ color: theme.sub, fontSize: fontSize - 3 }}> 回应</span>}
                <span style={{ color: theme.text, fontSize: fontSize - 3 }}>：{stripLeakedAttrs(a.content)}</span>
            </div>
        ))}
    </div>
);

const ReaderModal: React.FC<{ novel: VRWorldNovel; characters: CharacterProfile[]; onClose: () => void; initialSeg?: number; peek?: boolean; }> = ({ novel, characters, onClose, initialSeg, peek }) => {
    const PAGE_SIZE = 8;
    const total = novel.segments.length;
    // peek（查看某条批注）时落在 initialSeg，且全程不写用户书签
    const initialBm = useMemo(() => {
        const base = (initialSeg != null) ? initialSeg : readUserBm(novel.id);
        return Math.min(Math.max(0, base), Math.max(0, total - 1));
    }, [novel.id, total, initialSeg]);

    const [annotations, setAnnotations] = useState<VRNovelAnnotation[]>([]);
    const [themeId, setThemeId] = useState<string>(() => localStorage.getItem(READER_THEME_KEY) || 'paper');
    const [fontSize, setFontSize] = useState<number>(() => Number(localStorage.getItem(READER_FONT_KEY)) || 15);
    const [mode, setMode] = useState<'page' | 'scroll'>(() => (localStorage.getItem(READER_MODE_KEY) === 'scroll' ? 'scroll' : 'page'));
    const [showCtl, setShowCtl] = useState(false);

    // 翻页态
    const [page, setPage] = useState(() => Math.floor(initialBm / PAGE_SIZE));
    // 滚动态：窗口 [winStart, winEnd)，初始落在书签处
    const [winStart, setWinStart] = useState(() => initialBm);
    const [winEnd, setWinEnd] = useState(() => Math.min(total, initialBm + 30));
    const [topSeg, setTopSeg] = useState(initialBm);

    const scrollRef = useRef<HTMLDivElement>(null);
    const prevHeightRef = useRef<number | null>(null);
    const bmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => { void (async () => setAnnotations(await DB.getVRAnnotations(novel.id)))(); }, [novel.id]);
    useEffect(() => { localStorage.setItem(READER_THEME_KEY, themeId); }, [themeId]);
    useEffect(() => { localStorage.setItem(READER_FONT_KEY, String(fontSize)); }, [fontSize]);

    // 翻页：换页存书签 + 回顶（peek 模式不写书签）
    useEffect(() => {
        if (mode !== 'page') return;
        if (!peek) writeUserBm(novel.id, page * PAGE_SIZE);
        if (scrollRef.current) scrollRef.current.scrollTop = 0;
    }, [page, mode, novel.id, peek]);

    // 滚动：prepend 后补偿滚动位置，避免跳动
    useLayoutEffect(() => {
        if (prevHeightRef.current != null && scrollRef.current) {
            const el = scrollRef.current;
            el.scrollTop += el.scrollHeight - prevHeightRef.current;
            prevHeightRef.current = null;
        }
    }, [winStart]);

    const switchMode = (m: 'page' | 'scroll') => {
        if (m === mode) return;
        if (m === 'scroll') {
            const bm = page * PAGE_SIZE;
            setWinStart(bm); setWinEnd(Math.min(total, bm + 30)); setTopSeg(bm);
        } else {
            setPage(Math.floor(readUserBm(novel.id) / PAGE_SIZE));
        }
        setMode(m);
        localStorage.setItem(READER_MODE_KEY, m);
    };

    const onScroll = () => {
        const el = scrollRef.current;
        if (!el || mode !== 'scroll') return;
        // 触底加载更多
        if (el.scrollTop + el.clientHeight > el.scrollHeight - 900 && winEnd < total) {
            setWinEnd(e => Math.min(total, e + 20));
        }
        // 触顶往回加载
        if (el.scrollTop < 400 && winStart > 0) {
            prevHeightRef.current = el.scrollHeight;
            setWinStart(s => Math.max(0, s - 20));
        }
        // 节流存书签（取顶部首个可见段）
        if (bmTimerRef.current) return;
        bmTimerRef.current = setTimeout(() => {
            bmTimerRef.current = null;
            const cur = scrollRef.current;
            if (!cur) return;
            const top = cur.scrollTop;
            const nodes = cur.querySelectorAll<HTMLElement>('[data-seg]');
            for (const n of Array.from(nodes)) {
                if (n.offsetTop + n.offsetHeight > top + 4) {
                    const idx = Number(n.dataset.seg);
                    setTopSeg(idx); if (!peek) writeUserBm(novel.id, idx);
                    break;
                }
            }
        }, 300);
    };

    const theme = READER_THEMES.find(t => t.id === themeId) || READER_THEMES[0];
    const annBySeg = useMemo(() => groupAnnotationsBySeg(annotations), [annotations]);
    const nameOf = (id: string) => characters.find(c => c.id === id)?.name;
    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const renderSegs = mode === 'page'
        ? novel.segments.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE)
        : novel.segments.slice(winStart, winEnd);

    return (
        <div className="fixed inset-0 z-50 flex flex-col" style={{ background: theme.bg }}>
            {/* 顶栏 */}
            <div className="flex items-center gap-2 px-4 pb-2 shrink-0" style={{ borderBottom: `1px solid ${theme.accent}22`, paddingTop: VR_TOP }}>
                <button onClick={onClose} className="p-1.5 -ml-1.5 rounded-full active:bg-black/5" style={{ color: theme.text }}><X size={20} weight="bold" /></button>
                <div className="min-w-0 flex-1">
                    <div className="text-[14px] font-bold truncate" style={{ color: theme.text }}>{novel.title}</div>
                    <div className="text-[10px]" style={{ color: theme.sub }}>
                        {mode === 'page'
                            ? `第 ${page * PAGE_SIZE + 1}~${Math.min((page + 1) * PAGE_SIZE, total)} 段 / 共 ${total} 段`
                            : `读到第 ${topSeg + 1} 段 / 共 ${total} 段 · ${Math.round((topSeg / Math.max(1, total)) * 100)}%`}
                    </div>
                </div>
                <button onClick={() => setShowCtl(s => !s)} className="p-1.5 rounded-full active:bg-black/5" style={{ color: theme.accent }}><Palette size={18} weight="bold" /></button>
            </div>

            {peek && (
                <div className="px-4 py-1.5 shrink-0 text-[11px] text-center" style={{ background: `${theme.accent}1a`, color: theme.accent }}>
                    正在查看批注位置 · 不会改动你的书签
                </div>
            )}

            {/* 控制条：主题 / 字号 / 模式 */}
            {showCtl && (
                <div className="px-4 py-2.5 shrink-0 space-y-2.5" style={{ background: theme.paper, borderBottom: `1px solid ${theme.accent}22` }}>
                    <div className="flex items-center gap-2">
                        <Palette size={14} style={{ color: theme.sub }} />
                        <div className="flex gap-1.5 flex-1">
                            {READER_THEMES.map(t => (
                                <button key={t.id} onClick={() => setThemeId(t.id)}
                                    className="flex-1 h-8 rounded-lg flex items-center justify-center text-[10px] font-bold transition-all"
                                    style={{ background: t.paper, color: t.text, border: themeId === t.id ? `2px solid ${t.accent}` : `1px solid ${t.accent}33` }}>
                                    {t.name}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <TextAa size={14} style={{ color: theme.sub }} />
                        <div className="flex gap-1.5 flex-1">
                            {FONT_SIZES.map(fs => (
                                <button key={fs} onClick={() => setFontSize(fs)}
                                    className="w-9 h-7 rounded-lg font-bold transition-all"
                                    style={{ background: fontSize === fs ? theme.accent : 'transparent', color: fontSize === fs ? theme.paper : theme.sub, border: `1px solid ${theme.accent}44`, fontSize: Math.min(fs, 15) }}>
                                    A
                                </button>
                            ))}
                        </div>
                        {/* 模式切换 */}
                        <div className="flex gap-1.5">
                            {(['page', 'scroll'] as const).map(m => (
                                <button key={m} onClick={() => switchMode(m)}
                                    className="px-2.5 h-7 rounded-lg text-[11px] font-bold transition-all"
                                    style={{ background: mode === m ? theme.accent : 'transparent', color: mode === m ? theme.paper : theme.sub, border: `1px solid ${theme.accent}44` }}>
                                    {m === 'page' ? '翻页' : '滚动'}
                                </button>
                            ))}
                        </div>
                    </div>
                    <div className="text-[10px] leading-snug pt-0.5" style={{ color: theme.sub }}>书里的批注都是角色自己留的；你可以翻看，暂时还不能亲自写批注。</div>
                </div>
            )}

            {/* 正文 */}
            <div ref={scrollRef} onScroll={mode === 'scroll' ? onScroll : undefined}
                className="flex-1 overflow-y-auto vr-reader-scroll px-5 py-4" style={{ background: theme.bg, fontFamily: `'Noto Serif SC','Songti SC','Noto Serif','Georgia',serif` }}>
                {mode === 'scroll' && winStart > 0 && (
                    <div className="text-center text-[10px] mb-3" style={{ color: theme.sub }}>—— 上滑加载更早内容 ——</div>
                )}
                {renderSegs.map(seg => (
                    <SegBlock key={seg.idx} seg={seg} anns={annBySeg.get(seg.idx) || []} theme={theme} fontSize={fontSize} nameOf={nameOf} highlight={peek && seg.idx === initialSeg} />
                ))}
            </div>

            {/* 底栏 */}
            {mode === 'page' ? (
                <div className="flex items-center justify-between px-5 py-2.5 shrink-0" style={{ background: theme.paper, borderTop: `1px solid ${theme.accent}22`, paddingBottom: vrBottomPad('0.625rem') }}>
                    <button disabled={page === 0} onClick={() => setPage(p => Math.max(0, p - 1))} className="text-[12px] disabled:opacity-30 font-semibold" style={{ color: theme.accent }}>‹ 上一页</button>
                    <span className="text-[11px]" style={{ color: theme.sub }}>{page + 1} / {totalPages}</span>
                    <button disabled={page >= totalPages - 1} onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} className="text-[12px] disabled:opacity-30 font-semibold" style={{ color: theme.accent }}>下一页 ›</button>
                </div>
            ) : (
                <div className="flex items-center justify-center gap-4 px-5 py-2 shrink-0" style={{ background: theme.paper, borderTop: `1px solid ${theme.accent}22`, paddingBottom: vrBottomPad('0.5rem') }}>
                    <button onClick={() => { setWinStart(0); setWinEnd(Math.min(total, 30)); setTopSeg(0); if (scrollRef.current) scrollRef.current.scrollTop = 0; }}
                        className="text-[11px] font-semibold" style={{ color: theme.accent }}>↑ 从头</button>
                    <span className="text-[10px]" style={{ color: theme.sub }}>滚动阅读 · 自动记录位置</span>
                </div>
            )}
        </div>
    );
};

// ============ 上传弹窗（支持大文件 .txt / .pdf，内容不入 DOM） ============
type UploadFileInfo = {
    name: string;
    chars: number;
    preview: string;
    encoding: string;
    kind: 'text' | 'pdf';
    pages?: number;
};

const UploadModal: React.FC<{
    categories: VRLibraryCategory[]; initialCategoryId?: string;
    onClose: () => void;
    onCommit: (novel: VRWorldNovel) => Promise<void> | void;
    onError: (msg: string) => void;
}> = ({ onClose, onCommit, onError, categories, initialCategoryId }) => {
    const [categoryId, setCategoryId] = useState(initialCategoryId || '');
    const uploadFieldClass = 'w-full rounded-lg border border-indigo-100/70 bg-white px-3 py-2 text-slate-800 caret-indigo-500 placeholder:text-indigo-300 outline-none focus:border-indigo-300';
    const [title, setTitle] = useState('');
    const [author, setAuthor] = useState('');
    const [summary, setSummary] = useState('');
    // 手动粘贴的小段文本走 state；大文件内容只存 ref，不进 textarea（否则 12MB 会冻 UI）
    const [pasteText, setPasteText] = useState('');
    const [fileInfo, setFileInfo] = useState<UploadFileInfo | null>(null);
    const fileContentRef = useRef<string>('');
    // 留着原始字节，手动换编码时无需重新读盘即可重解码
    const fileBufRef = useRef<ArrayBuffer | null>(null);
    const [chosenEncoding, setChosenEncoding] = useState<string>('auto');
    const fileRef = useRef<HTMLInputElement>(null);
    const [reading, setReading] = useState(false);
    const [readingStatus, setReadingStatus] = useState('');
    const [busy, setBusy] = useState(false);
    const [progress, setProgress] = useState(0);

    // 用某个编码（auto = 自动识别）解码当前缓存的字节并刷新预览
    const applyDecode = (name: string, buf: ArrayBuffer, enc: string) => {
        const { text: content, encoding } = decodeBytes(buf, enc === 'auto' ? undefined : enc);
        fileContentRef.current = content;
        setFileInfo({
            name,
            chars: content.length,
            preview: content.slice(0, 300).replace(/\s+/g, ' ').trim(),
            encoding,
            kind: 'text',
        });
    };

    const onFile = async (f: File | undefined) => {
        if (!f) return;
        const pdfFile = isPdfFile(f);
        const textFile = f.type.toLowerCase() === 'text/plain' || /\.(txt|text)$/i.test(f.name);
        if (!pdfFile && !textFile) {
            onError('目前只支持 .txt 和 .pdf 文件');
            if (fileRef.current) fileRef.current.value = '';
            return;
        }
        setReading(true);
        setReadingStatus(pdfFile ? '正在载入 PDF…' : '读取并识别编码中…');
        try {
            const buf = await f.arrayBuffer();
            if (pdfFile) {
                fileBufRef.current = null;
                const result = await extractPdfText(buf, {
                    onProgress: ({ page, totalPages }) => setReadingStatus(`正在提取 PDF 文本… ${page}/${totalPages}`),
                });
                const content = result.text.trim();
                if (!content) {
                    onError('PDF 中没有可提取的文字，可能是扫描件或图片 PDF；请先 OCR 后再导入');
                    return;
                }
                fileContentRef.current = content;
                setFileInfo({
                    name: f.name,
                    chars: content.length,
                    preview: content.slice(0, 300).replace(/\s+/g, ' ').trim(),
                    encoding: 'PDF',
                    kind: 'pdf',
                    pages: result.pageCount,
                });
                trackEvent('导入 PDF 小说到彼方书库', { pages: result.pageCount, chars: content.length });
            } else {
                fileBufRef.current = buf;
                setChosenEncoding('auto');
                applyDecode(f.name, buf, 'auto');
            }
            setPasteText(''); // 文件优先，清掉粘贴框
            if (!title.trim()) setTitle(f.name.replace(/\.(txt|text|pdf)$/i, ''));
        } catch (e) {
            console.error('[VRWorld] read novel file failed', e);
            onError(pdfFile ? 'PDF 读取失败，文件可能已损坏、加密或网络组件加载失败' : '文件读取失败');
        } finally {
            setReading(false);
            setReadingStatus('');
        }
    };

    // 手动换编码（乱码时用）：拿缓存字节重新解码，不必再选一遍文件
    const redecode = (enc: string) => {
        const buf = fileBufRef.current;
        if (!buf || !fileInfo) return;
        setChosenEncoding(enc);
        applyDecode(fileInfo.name, buf, enc);
    };

    const clearFile = () => {
        fileContentRef.current = '';
        fileBufRef.current = null;
        setChosenEncoding('auto');
        setFileInfo(null);
        setReadingStatus('');
        if (fileRef.current) fileRef.current.value = '';
    };

    const totalChars = fileInfo ? fileInfo.chars : pasteText.length;
    const canSave = !!title.trim() && totalChars > 0 && !busy;

    const handleSave = async () => {
        const content = fileInfo ? fileContentRef.current : pasteText;
        if (!title.trim() || !content) { onError('书名和正文都要填'); return; }
        setBusy(true);
        setProgress(0);
        try {
            // 让出一帧，先让"处理中"渲染出来
            await new Promise<void>(r => setTimeout(r));
            const novel = await buildNovelAsync(title, content, {
                author, summary,
                onProgress: (r) => setProgress(Math.round(r * 100)),
            });
            if (novel.segments.length === 0) { onError('正文是空的'); setBusy(false); return; }
            await onCommit({ ...novel, categoryId: categories.some(c => c.id === categoryId) ? categoryId : undefined });
            trackEvent('上架一本小说到书库');
        } catch (e) {
            console.error('[VRWorld] build novel failed', e);
            onError('处理失败，文件可能太大或格式异常');
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50" onClick={busy ? undefined : onClose}>
            <div className="w-full max-w-md rounded-t-2xl p-4 max-h-[88vh] overflow-y-auto vr-reader-scroll" style={{ background: 'linear-gradient(180deg,#161c2e 0%,#0c1019 100%)', paddingBottom: vrBottomPad('1rem') }} onClick={e => e.stopPropagation()}>
                <div className="flex items-center mb-3">
                    <span className="text-[15px] font-bold text-white">上传小说</span>
                    {!busy && <button onClick={onClose} className="ml-auto p-1 text-indigo-300/60"><X size={18} /></button>}
                </div>

                <input ref={fileRef} type="file" accept=".txt,text/plain,.pdf,application/pdf" className="hidden" onChange={e => onFile(e.target.files?.[0])} />
                {reading ? (
                    <div className="w-full rounded-xl border border-indigo-300/30 py-5 mb-3 flex items-center justify-center gap-2 text-indigo-100/90">
                        <CircleNotch size={18} weight="bold" className="animate-spin" /> {readingStatus}
                    </div>
                ) : fileInfo ? (
                    <div className="rounded-xl border border-indigo-300/30 p-3 mb-3 bg-white/5">
                        <div className="flex items-center gap-2">
                            <BookOpen size={16} weight="fill" className="text-amber-200 shrink-0" />
                            <span className="text-[12.5px] text-white font-semibold truncate flex-1">{fileInfo.name}</span>
                            <span className="text-[8.5px] text-indigo-300/60 border border-indigo-300/30 rounded px-1 uppercase">
                                {fileInfo.kind === 'pdf' ? `PDF · ${fileInfo.pages} 页` : fileInfo.encoding}
                            </span>
                            {!busy && <button onClick={clearFile} className="text-indigo-300/60 p-1"><X size={14} /></button>}
                        </div>
                        <div className="text-[10px] text-indigo-300/60 mt-1">{fileInfo.chars.toLocaleString()} 字 · 预计 ~{Math.ceil(fileInfo.chars / 400).toLocaleString()} 段</div>
                        <p className="text-[10.5px] text-indigo-200/50 mt-1.5 leading-snug line-clamp-2">{fileInfo.preview}…</p>
                        {!busy && fileInfo.kind === 'text' && (
                            <div className="flex items-center gap-1.5 mt-2">
                                <span className="text-[9.5px] text-indigo-300/55 shrink-0">乱码？换编码</span>
                                <select value={chosenEncoding} onChange={e => redecode(e.target.value)}
                                    className="flex-1 text-[10px] bg-[#1b2236] text-indigo-100 border border-indigo-300/25 rounded px-1.5 py-1 outline-none">
                                    <option value="auto">自动识别</option>
                                    <option value="utf-8">UTF-8</option>
                                    <option value="gb18030">简体中文 · GB18030 / GBK</option>
                                    <option value="big5">繁体中文 · Big5</option>
                                    <option value="shift_jis">日文 · Shift_JIS</option>
                                    <option value="euc-jp">日文 · EUC-JP</option>
                                </select>
                            </div>
                        )}
                    </div>
                ) : (
                    <button onClick={() => fileRef.current?.click()}
                        className="w-full rounded-xl border border-dashed border-indigo-300/40 py-3 mb-3 text-[12.5px] text-indigo-100/90 flex items-center justify-center gap-2 active:bg-white/5">
                        <UploadSimple size={16} weight="bold" /> 选择 .txt / .pdf 文件（大文件也 OK）
                    </button>
                )}

                <div className="space-y-2.5">
                    <input value={title} onChange={e => setTitle(e.target.value)} placeholder="书名（必填）" className={`${uploadFieldClass} text-[13px]`} />
                    <input value={author} onChange={e => setAuthor(e.target.value)} placeholder="作者（选填）" className={`${uploadFieldClass} text-[13px]`} />
                    <label className="block text-[11px] text-indigo-100">书籍分类<select aria-label="上架书籍分类" value={categoryId} onChange={e => setCategoryId(e.target.value)} disabled={busy} className={`${uploadFieldClass} mt-1 text-[13px]`}><option value="">未分类</option>{categories.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
                    <input value={summary} onChange={e => setSummary(e.target.value)} placeholder="一句话简介（选填，喂给角色当背景）" className={`${uploadFieldClass} text-[13px]`} />
                    {!fileInfo && (
                        <>
                            <div className="text-[10px] text-indigo-300/50">或直接粘贴正文（小段文本用；大文件请走上面的文件选择）↓</div>
                            <textarea value={pasteText} onChange={e => setPasteText(e.target.value)} placeholder="粘贴正文…" rows={6}
                                className={`${uploadFieldClass} text-[12.5px] leading-relaxed`} />
                        </>
                    )}
                    <div className="text-[10px] text-indigo-300/50">{totalChars.toLocaleString()} 字</div>
                </div>

                {busy ? (
                    <div className="mt-3">
                        <div className="h-2 rounded-full bg-white/10 overflow-hidden">
                            <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, background: 'linear-gradient(90deg,#8b7bf0,#b06ad6)' }} />
                        </div>
                        <div className="text-[11px] text-indigo-200/70 text-center mt-1.5">处理中… {progress}%（大文件需要点时间）</div>
                    </div>
                ) : (
                    <button onClick={handleSave} disabled={!canSave}
                        className="w-full mt-3 rounded-xl py-2.5 text-[13px] font-bold text-white disabled:opacity-40" style={{ background: 'linear-gradient(120deg, rgba(150,168,255,.92), rgba(188,168,255,.85) 55%, rgba(150,212,204,.9))' }}>
                        上架到书库
                    </button>
                )}
            </div>
        </div>
    );
};

// ============ chibi 形象编辑器（复用特别时光的捏人系统） ============
type ChibiSave = { img: string; state?: any; scale: number; offsetY: number; flip: boolean };
const ChibiEditor: React.FC<{
    char: CharacterProfile;
    onClose: () => void;
    onSave: (chibi: ChibiSave) => void;
}> = ({ char, onClose, onSave }) => {
    const existing = char.vrState?.chibi;
    // 已捏过的：进入"预览 + 微调"页；点"重新捏"再开捏人器。没捏过：直接进捏人器。
    const [creating, setCreating] = useState<boolean>(!existing?.img);
    const [img, setImg] = useState<string>(existing?.img || '');
    const [state, setState] = useState<any>(existing?.state);
    const [scale, setScale] = useState<number>(existing?.scale ?? 1);
    const [offsetY, setOffsetY] = useState<number>(existing?.offsetY ?? 0);
    const [flip, setFlip] = useState<boolean>(!!existing?.flip);

    const isSully = (char.name || '').toLowerCase().includes('sully');
    // 回填：捏人器 init 读 presets（扁平 map），用上次导出的 state.selected
    const presets = existing?.state?.selected || (isSully ? sullyPresets() : undefined);

    const onConfirm = (r: ChibiResult) => {
        setImg(r.transparentDataUrl);
        setState(r.state);
        setScale(1); setOffsetY(0); setFlip(false);
        setCreating(false);
    };

    if (creating) {
        return (
            <div className="fixed inset-0 z-[60] flex flex-col bg-black">
                <div className="flex items-center gap-2 px-4 pb-2 shrink-0 text-white" style={{ background: 'linear-gradient(180deg,#161c2e 0%,#0c1019 100%)', paddingTop: VR_TOP }}>
                    <button onClick={() => existing?.img ? setCreating(false) : onClose()} className="p-1.5 -ml-1.5 rounded-full active:bg-white/10"><CaretLeft size={20} weight="bold" /></button>
                    <span className="text-[14px] font-bold">捏 {char.name} 的小人</span>
                </div>
                <div className="flex-1 min-h-0">
                    <CreatorIframe mode="char" charName={char.name} isSully={isSully} presets={presets}
                        savedState={existing?.state}
                        draftKey={`vr_${char.id}`} title={`捏一个小人 · ${char.name}`} subtitle="彼方 · CHIBI"
                        onConfirm={onConfirm} />
                </div>
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/55" onClick={onClose}>
            <VRStyleTag />
            <div className="w-full max-w-md rounded-t-2xl p-4" style={{ background: 'linear-gradient(180deg,#161c2e 0%,#0c1019 100%)', paddingBottom: vrBottomPad('1rem') }} onClick={e => e.stopPropagation()}>
                <div className="flex items-center mb-1">
                    <span className="text-[15px] font-bold text-white">{char.name} 的彼方形象</span>
                    <button onClick={onClose} className="ml-auto p-1 text-indigo-300/60"><X size={18} /></button>
                </div>
                <p className="text-[10.5px] text-indigo-300/60 mb-3">这个 Q 版小人会站在彼方的房间里。可以重新捏，或微调站位。</p>

                <div className="relative rounded-xl h-48 overflow-hidden mb-3 flex items-end justify-center" style={{ background: 'linear-gradient(180deg,#2a2350,#15132b)' }}>
                    <div className="absolute inset-0 opacity-50" style={{ backgroundImage: 'radial-gradient(1.5px 1.5px at 30% 30%, rgba(255,255,255,.5), transparent), radial-gradient(1.5px 1.5px at 70% 50%, rgba(200,220,255,.4), transparent)' }} />
                    {img && <TokenImg value={img} alt="" className="object-contain mb-3" style={{ height: 140 * scale, transform: `scaleX(${flip ? -1 : 1}) translateY(${offsetY}px)`, filter: 'drop-shadow(0 4px 8px rgba(0,0,0,.5))', animation: 'vrfloat 3.2s ease-in-out infinite' }} />}
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-[50%]" style={{ width: 76, height: 17, background: 'radial-gradient(ellipse,rgba(0,0,0,.5),transparent)' }} />
                </div>

                <button onClick={() => setCreating(true)} className="w-full rounded-lg border border-indigo-300/40 py-2 mb-3 text-[12px] text-indigo-100 flex items-center justify-center gap-1.5 active:bg-white/5">
                    <PencilSimple size={14} weight="bold" /> 重新捏小人
                </button>

                <div className="space-y-2.5 mb-3">
                    <label className="flex items-center gap-2 text-[11px] text-indigo-200/80">
                        <UploadSimple size={14} className="rotate-90" /> 大小
                        <input type="range" min={0.5} max={1.6} step={0.05} value={scale} onChange={e => setScale(Number(e.target.value))} className="flex-1 accent-indigo-400" />
                    </label>
                    <button onClick={() => setFlip(f => !f)} className={`text-[11px] rounded-full px-3 py-1 flex items-center gap-1.5 ${flip ? 'bg-indigo-400 text-white' : 'bg-white/10 text-indigo-200/80'}`}>
                        <FlipHorizontal size={13} /> 水平翻转
                    </button>
                </div>

                <button onClick={() => { if (img) onSave({ img, state, scale, offsetY, flip }); }} disabled={!img}
                    className="w-full rounded-xl py-2.5 text-[13px] font-bold text-white disabled:opacity-40" style={{ background: 'linear-gradient(120deg, rgba(150,168,255,.92), rgba(188,168,255,.85) 55%, rgba(150,212,204,.9))' }}>
                    保存形象{char.vrState?.enabled ? '' : ' 并接入'}
                </button>
            </div>
        </div>
    );
};

// ============ 用户本人捏 chibi（mode="user"，结构同角色 chibi） ============
const UserChibiEditor: React.FC<{
    userName: string;
    existing?: { img: string; state?: any; scale?: number; offsetY?: number; flip?: boolean };
    onClose: () => void;
    onSave: (chibi: ChibiSave) => void;
}> = ({ userName, existing, onClose, onSave }) => {
    const [creating, setCreating] = useState<boolean>(!existing?.img);
    const [img, setImg] = useState<string>(existing?.img || '');
    const [state, setState] = useState<any>(existing?.state);
    const [scale, setScale] = useState<number>(existing?.scale ?? 1);
    const [offsetY, setOffsetY] = useState<number>(existing?.offsetY ?? 0);
    const [flip, setFlip] = useState<boolean>(!!existing?.flip);
    const presets = existing?.state?.selected;

    const onConfirm = (r: ChibiResult) => {
        setImg(r.transparentDataUrl); setState(r.state);
        setScale(1); setOffsetY(0); setFlip(false); setCreating(false);
    };

    if (creating) {
        return (
            <div className="fixed inset-0 z-[60] flex flex-col bg-black" style={{ paddingTop: VR_TOP }}>
                <CreatorIframe mode="user" charName={userName} presets={presets}
                    savedState={existing?.state}
                    draftKey="vr_user" title={`捏一个你自己 · ${userName}`} subtitle="彼方 · 你的 CHIBI"
                    onConfirm={onConfirm} />
            </div>
        );
    }

    return (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/55" onClick={onClose}>
            <div className="w-full max-w-md rounded-t-2xl p-4" style={{ background: 'linear-gradient(180deg,#161c2e 0%,#0c1019 100%)', paddingBottom: vrBottomPad('1rem') }} onClick={e => e.stopPropagation()}>
                <div className="flex items-center gap-2 mb-2">
                    <span className="text-[15px] font-bold text-white">你的彼方形象</span>
                    <button onClick={onClose} className="ml-auto p-1 text-indigo-300/60"><X size={18} /></button>
                </div>
                <p className="text-[10.5px] text-indigo-300/60 mb-3">这个 Q 版小人就是「你」在彼方里的化身，会站在你挂着的房间里。</p>
                <div className="relative rounded-xl h-48 overflow-hidden mb-3 flex items-end justify-center" style={{ background: 'linear-gradient(180deg,#2a2350,#15132b)' }}>
                    {img && <TokenImg value={img} alt="" className="object-contain mb-3" style={{ height: 140 * scale, transform: `scaleX(${flip ? -1 : 1}) translateY(${offsetY}px)`, filter: 'drop-shadow(0 4px 8px rgba(0,0,0,.5))', animation: 'vrfloat 3.2s ease-in-out infinite' }} />}
                    <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-[50%]" style={{ width: 76, height: 17, background: 'radial-gradient(ellipse,rgba(0,0,0,.5),transparent)' }} />
                </div>
                <button onClick={() => setCreating(true)} className="w-full rounded-lg border border-indigo-300/40 py-2 mb-3 text-[12px] text-indigo-100 flex items-center justify-center gap-1.5 active:bg-white/5">
                    <PencilSimple size={14} weight="bold" /> 重新捏小人
                </button>
                <div className="space-y-2.5 mb-3">
                    <label className="flex items-center gap-2 text-[11px] text-indigo-200/80">
                        <UploadSimple size={14} className="rotate-90" /> 大小
                        <input type="range" min={0.5} max={1.6} step={0.05} value={scale} onChange={e => setScale(Number(e.target.value))} className="flex-1 accent-indigo-400" />
                    </label>
                    <button onClick={() => setFlip(f => !f)} className={`text-[11px] rounded-full px-3 py-1 flex items-center gap-1.5 ${flip ? 'bg-indigo-400 text-white' : 'bg-white/10 text-indigo-200/80'}`}>
                        <FlipHorizontal size={13} /> 水平翻转
                    </button>
                </div>
                <button onClick={() => { if (img) onSave({ img, state, scale, offsetY, flip }); }} disabled={!img}
                    className="w-full rounded-xl py-2.5 text-[13px] font-bold text-white disabled:opacity-40" style={{ background: 'linear-gradient(120deg, rgba(150,168,255,.92), rgba(188,168,255,.85) 55%, rgba(150,212,204,.9))' }}>
                    保存形象
                </button>
            </div>
        </div>
    );
};

// ============ 用户本人接入彼方面板（捏 chibi / 选房间 / 写在干嘛 / 广播） ============
const USER_VR_PRESETS = ['在看小说', '在自习 / 刷题', '在听歌单曲循环', '单纯挂机放空', '在娱乐室瞎玩', '在剧院看剧本'];
const UserVRPanel: React.FC<{
    userProfile?: UserProfile;
    updateUserProfile: (u: Partial<UserProfile>) => void;
    onEditChibi: () => void;
    onBroadcast: (room: VRRoomId, activity: string) => Promise<void> | void;
    addToast?: (m: string, t?: any) => void;
}> = ({ userProfile, updateUserProfile, onEditChibi, onBroadcast, addToast }) => {
    const uv = userProfile?.vrState;
    const enabled = !!uv?.enabled;
    const chibi = uv?.chibi;
    const ROOMS: [VRRoomId, string][] = [['library', '图书馆'], ['music', '听歌房'], ['guestbook', '留言簿'], ['gym', '娱乐室'], ['theater', '剧院'], ['sar', 'SAR 活动空间']];
    const pickRoom = (id?: VRRoomId): VRRoomId => (id && ROOMS.some(([roomId]) => roomId === id) ? id : 'guestbook');
    const [room, setRoom] = useState<VRRoomId>(pickRoom(uv?.currentRoom));
    const [activity, setActivity] = useState(uv?.activity || '');

    // userProfile 外部变化（如刚捏完 chibi）时同步本地草稿。
    useEffect(() => { setRoom(pickRoom(uv?.currentRoom)); setActivity(uv?.activity || ''); }, [uv?.currentRoom, uv?.activity]);

    const join = () => {
        if (!chibi?.img) { onEditChibi(); return; } // 没捏小人 → 先捏，再回来开接入
        updateUserProfile({ vrState: { ...(uv || {}), enabled: true, currentRoom: room, activity: activity.trim(), updatedAt: Date.now() } });
        addToast?.('你已接入彼方', 'success');
        trackEvent('开启用户本人接入彼方', { action: 'enable' });
    };
    const logout = () => {
        updateUserProfile({ vrState: { ...(uv || {}), enabled: false } });
        addToast?.('已从彼方登出', 'success'); // 登出后角色聊天里的"你在彼方"提示随之消失
        trackEvent('开启用户本人接入彼方', { action: 'disable' });
    };
    const saveBroadcast = () => {
        updateUserProfile({ vrState: { ...(uv || {}), enabled: true, currentRoom: room, activity: activity.trim(), updatedAt: Date.now() } });
        void onBroadcast(room, activity.trim());
    };

    return (
        <div className="rounded-2xl p-3.5 backdrop-blur-sm" style={{ background: 'linear-gradient(135deg, rgba(120,130,255,0.10), rgba(150,212,204,0.06))', border: '1px solid rgba(150,168,255,0.22)' }}>
            <div className="flex items-center gap-2.5">
                <button onClick={onEditChibi} className="relative h-12 w-12 rounded-xl overflow-hidden bg-black/20 flex items-end justify-center shrink-0 active:opacity-80">
                    {chibi?.img ? <TokenImg value={chibi.img} className="h-11 object-contain object-bottom" style={{ transform: `scaleX(${chibi.flip ? -1 : 1})` }} alt="" /> : <span className="text-lg text-indigo-300/60 mb-2">＋</span>}
                    <span className="absolute bottom-0 right-0 bg-indigo-500/90 rounded-tl-md p-0.5"><PencilSimple size={9} weight="bold" /></span>
                </button>
                <div className="flex-1 min-w-0">
                    <div className="text-[13px] font-bold text-white truncate">你自己 · {userProfile?.name || '我'}</div>
                    <div className="text-[10px] text-indigo-300/60">{enabled ? '已接入彼方 · 角色能看到你在这儿' : chibi?.img ? '已捏形象 · 未接入' : '捏个自己的小人，接入彼方'}</div>
                </div>
                <button onClick={enabled ? logout : join}
                    className={`relative w-11 h-6 rounded-full transition-colors ${enabled ? 'bg-indigo-400' : 'bg-white/15'}`}>
                    <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${enabled ? 'translate-x-5' : ''}`} />
                </button>
            </div>
            {enabled && (
                <>
                    <div className="mt-3 text-[10px] tracking-[0.2em] text-indigo-200/55 mb-1.5">你挂在哪个房间</div>
                    <div className="flex flex-wrap gap-1.5">
                        {ROOMS.map(([rid, label]) => (
                            <button key={rid} onClick={() => setRoom(rid)}
                                className={`text-[10.5px] rounded-full px-2.5 py-1 font-semibold ${room === rid ? 'bg-indigo-400 text-white' : 'bg-white/10 text-indigo-200/70'}`}>
                                {label}
                            </button>
                        ))}
                    </div>
                    <div className="mt-3 text-[10px] tracking-[0.2em] text-indigo-200/55 mb-1.5">你在干嘛（角色会看到）</div>
                    <input value={activity} onChange={e => setActivity(e.target.value)}
                        placeholder="例：在看小说 / 在自习 / 单纯挂机…"
                        className="w-full rounded-lg px-3 py-2 text-[12.5px] text-white placeholder-white/30 outline-none" style={{ background: 'rgba(255,255,255,.07)', border: '1px solid rgba(150,200,255,.2)' }} />
                    <div className="flex flex-wrap gap-1.5 mt-1.5">
                        {USER_VR_PRESETS.map(p => (
                            <button key={p} onClick={() => setActivity(p)} className="text-[10px] rounded-full px-2 py-0.5 bg-white/[0.08] text-indigo-200/60 active:bg-white/15">{p}</button>
                        ))}
                    </div>
                    <button onClick={saveBroadcast}
                        className="mt-3 w-full rounded-xl py-2 text-[12.5px] font-bold text-white" style={{ background: 'linear-gradient(120deg, rgba(150,168,255,.92), rgba(188,168,255,.85) 55%, rgba(150,212,204,.9))' }}>
                        保存并广播给所有角色
                    </button>
                    <div className="mt-3 flex items-center gap-2.5 rounded-xl border border-white/10 bg-black/10 px-3 py-2.5">
                        <ShieldCheck size={17} weight={uv?.allowCharacterModules ? 'fill' : 'regular'} className={uv?.allowCharacterModules ? 'text-emerald-200' : 'text-indigo-200/45'} />
                        <div className="min-w-0 flex-1">
                            <div className="text-[11px] font-semibold text-white/80">允许角色对我使用模块</div>
                            <div className="mt-0.5 text-[9px] leading-relaxed text-indigo-200/40">默认关闭；仅在你与角色同时位于 SAR 时可能触发，持续 5 次成功互动。</div>
                        </div>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={uv?.allowCharacterModules === true}
                            aria-label="允许角色对我使用模块"
                            onClick={() => updateUserProfile({ vrState: { ...(uv || {}), allowCharacterModules: uv?.allowCharacterModules !== true } })}
                            className={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${uv?.allowCharacterModules ? 'bg-emerald-400/75' : 'bg-white/15'}`}
                        >
                            <span className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform ${uv?.allowCharacterModules ? 'translate-x-5' : ''}`} />
                        </button>
                    </div>
                    {uv?.sarModule && (
                        <div className="mt-2 rounded-lg border border-emerald-200/15 bg-emerald-300/[0.06] px-3 py-2 text-[9.5px] text-emerald-100/65">
                            你身上的模块：{uv.sarModule.moduleTitle} · {uv.sarModule.phase === 'active'
                                ? `剩余 ${uv.sarModule.remainingTurns}/${uv.sarModule.totalTurns} 次`
                                : `退场稳定 ${uv.sarModule.afterglowTurns}/3`}
                        </div>
                    )}
                    <p className="text-[9.5px] text-indigo-300/45 mt-2 leading-relaxed">角色聊天里会知道"你此刻在彼方做什么"，但已明确告知 ta：这只是虚拟空间挂机、你本人不一定在线，一切以聊天记录为准。</p>
                </>
            )}
        </div>
    );
};

// ============ 接入设置 ============
const INTERVAL_OPTIONS = [60, 120, 180, 360, 720];

const SettingsView: React.FC<{
    characters: CharacterProfile[];
    updateCharacter: ReturnType<typeof useOS>['updateCharacter'];
    addToast?: (msg: string, type?: any) => void;
    novels: VRWorldNovelSummary[]; onReload: () => void;
    onRequestEnable: (char: CharacterProfile) => void;
    onEditChibi: (char: CharacterProfile) => void;
    onEditReadingPreference: (char: CharacterProfile) => void;
}> = ({ characters, updateCharacter, addToast, novels, onReload, onRequestEnable, onEditChibi, onEditReadingPreference }) => {
    const [pickFor, setPickFor] = useState<CharacterProfile | null>(null);
    // 接入列表的分组筛选（characters 由 props 传入，这里单独取 characterGroups 即可）
    const { characterGroups } = useOS();
    const [settingsGroupId, setSettingsGroupId] = useState<string>(GROUP_FILTER_ALL);
    const [settingsPage, setSettingsPage] = useState(0);
    const groupedCharacters = useMemo(() => filterCharactersByGroup(characters, characterGroups, settingsGroupId), [characters, characterGroups, settingsGroupId]);
    const pageCount = Math.max(1, Math.ceil(groupedCharacters.length / 5));
    const currentPage = Math.min(settingsPage, pageCount - 1);
    const visibleCharacters = groupedCharacters.slice(currentPage * 5, currentPage * 5 + 5);
    useEffect(() => { setSettingsPage(0); }, [settingsGroupId]);
    const novelCount = novels.length;

    const go = (room?: VRRoomId, sarActivity?: VRSARActivity) => {
        if (!pickFor) return;
        if (room === 'library' && !readableNovels(novels, pickFor).length) {
            addToast?.('当前阅读范围内还没有书，请先归入书籍或调整阅读偏好。', 'info');
            return;
        }
        if (sarActivity === 'garden') {
            const market = readFishingMarketState();
            if (!market.dinosaurGarden?.visitsEnabled || !gardenResidents(market).length) {
                addToast?.('先在恐龙箱庭开启共同摆弄，并在桌上放一只恐龙。', 'info');
                return;
            }
        }
        VRScheduler.triggerNow(pickFor.id, room, sarActivity);
        addToast?.(`${pickFor.name} 正在登入彼方…`, 'info');
        setTimeout(onReload, 4000);
        setPickFor(null);
    };

    const disable = (char: CharacterProfile) => {
        updateCharacter(char.id, { vrState: { ...(char.vrState || { intervalMinutes: VR_DEFAULT_INTERVAL_MIN }), enabled: false } as any });
        VRScheduler.stop(char.id);
        trackEvent('开启角色接入彼方', { action: 'disable' });
    };
    const setInterval = (char: CharacterProfile, minutes: number) => {
        updateCharacter(char.id, { vrState: { ...(char.vrState || {}), enabled: char.vrState?.enabled ?? true, intervalMinutes: minutes } });
        if (allowsAutomaticVR(char.vrState)) VRScheduler.start(char.id, minutes);
    };
    const setActivityMode = (char: CharacterProfile, activityMode: 'manual' | 'scheduled') => {
        const vrState = { ...joinVRState(char.vrState), activityMode };
        updateCharacter(char.id, { vrState });
        if (allowsAutomaticVR(vrState)) VRScheduler.start(char.id, vrState.intervalMinutes);
        else VRScheduler.stop(char.id);
    };
    const pageNavigation = pageCount > 1 && <nav className="flex items-center justify-between gap-2 py-2 text-[11px] text-indigo-200/70" aria-label="角色接入分页">
        <button type="button" disabled={currentPage === 0} onClick={() => setSettingsPage(currentPage - 1)} className="min-h-10 rounded-xl bg-white/[0.06] px-3 disabled:opacity-25">上一页</button>
        <span className="tabular-nums">{currentPage + 1} / {pageCount} 页 · 共 {groupedCharacters.length} 位</span>
        <button type="button" disabled={currentPage >= pageCount - 1} onClick={() => setSettingsPage(currentPage + 1)} className="min-h-10 rounded-xl bg-white/[0.06] px-3 disabled:opacity-25">下一页</button>
    </nav>;

    return (
        <div className="space-y-3">
            <p className="text-[11px] text-indigo-300/60 leading-relaxed">
                接入后，角色会知道「彼方」，小人可以挂在房间里。默认仅手动活动：等你选房间、邀请钓鱼或玩箱庭时才行动，不设置间隔、不自动调用模型。
                想让 ta 自己逛，再开启自动活动。每次实际活动会留下动态卡片；自动活动连着 {VR_FAIL_LIMIT} 次调不通模型会暂停。
                {novelCount === 0 && <span className="text-amber-300/80"> 书库还空着，先去「书库」上传一本。</span>}
            </p>
            {characters.length === 0 && <p className="text-[11px] text-indigo-300/50 py-4 text-center">还没有角色。</p>}
            {/* 分组筛选（没建分组时不渲染）：深色底 */}
            <CharacterGroupFilterBar characters={characters} groups={characterGroups} dark
                value={settingsGroupId} onChange={setSettingsGroupId} />
            {pageNavigation}
            {characters.length > 0 && groupedCharacters.length === 0 &&
                <p className="text-[11px] text-indigo-300/50 py-4 text-center">该分组下没有角色</p>}
            {visibleCharacters.map(char => {
                const st = char.vrState;
                const enabled = !!st?.enabled;
                const automatic = allowsAutomaticVR(st);
                const interval = st?.intervalMinutes || VR_DEFAULT_INTERVAL_MIN;
                const chibi = getChibi(char);
                const failStreak = VRScheduler.getFailStreak(char.id);
                return (
                    <div key={char.id} data-vr-character={char.id} className="rounded-2xl p-3.5 backdrop-blur-sm" style={{ background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.07)' }}>
                        <div className="flex items-center gap-2.5">
                            {/* chibi 缩略 */}
                            <button onClick={() => onEditChibi(char)} className="relative h-12 w-12 rounded-xl overflow-hidden bg-black/20 flex items-end justify-center shrink-0 active:opacity-80">
                                {chibi.img ? <TokenImg value={chibi.img} className="h-11 object-contain object-bottom" style={{ transform: `scaleX(${chibi.flip ? -1 : 1})` }} alt="" /> : <span className="text-lg text-indigo-300/60 mb-2">？</span>}
                                <span className="absolute bottom-0 right-0 bg-indigo-500/90 rounded-tl-md p-0.5"><PencilSimple size={9} weight="bold" /></span>
                            </button>
                            <div className="flex-1 min-w-0">
                                <div className="text-[13px] font-bold truncate">{char.name}</div>
                                {enabled ? (
                                    <div className="text-[10px] text-indigo-300/60">
                                        {automatic ? `每 ${interval >= 60 ? `${formatHours(interval)} 小时` : `${interval} 分`}自动活动一次` : '仅手动活动 · 等你邀请'}
                                        {st?.sarModule && <span className="text-emerald-200/70"> · {st.sarModule.moduleTitle} {st.sarModule.phase === 'active' ? `${st.sarModule.remainingTurns}/${st.sarModule.totalTurns}` : `稳定 ${st.sarModule.afterglowTurns}/3`}</span>}
                                        {/* 后台失败本来一点声响都没有，攒到熔断前先让用户看见 */}
                                        {automatic && failStreak > 0 && <span className="text-amber-300/80"> · 已连续 {failStreak} 次没调通</span>}
                                    </div>
                                ) : <div className="text-[10px] text-indigo-300/40">{chibi.isFallback ? '未设形象 · 未接入' : '未接入'}</div>}
                            </div>
                            <button type="button" role="switch" aria-checked={enabled} aria-label={`${char.name}的彼方接入`} onClick={() => enabled ? disable(char) : onRequestEnable(char)}
                                className={`relative w-11 h-6 rounded-full transition-colors ${enabled ? 'bg-indigo-400' : 'bg-white/15'}`}>
                                <span className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white transition-transform ${enabled ? 'translate-x-5' : ''}`} />
                            </button>
                        </div>
                        {enabled && (
                            <>
                                <div className="mt-3 grid grid-cols-2 gap-2" role="group" aria-label={`${char.name}的活动方式`}>
                                    <button type="button" aria-pressed={!automatic} onClick={() => setActivityMode(char, 'manual')}
                                        className={`rounded-xl px-3 py-2.5 text-left border ${!automatic ? 'bg-indigo-400/20 border-indigo-300/60 text-indigo-100' : 'border-white/10 text-indigo-200/60'}`}>
                                        <b className="block text-[12px]">仅手动活动</b><span className="text-[10px]">你选择时才行动</span>
                                    </button>
                                    <button type="button" aria-pressed={automatic} onClick={() => setActivityMode(char, 'scheduled')}
                                        className={`rounded-xl px-3 py-2.5 text-left border ${automatic ? 'bg-indigo-400/20 border-indigo-300/60 text-indigo-100' : 'border-white/10 text-indigo-200/60'}`}>
                                        <b className="block text-[12px]">自动活动</b><span className="text-[10px]">按间隔自己去逛</span>
                                    </button>
                                </div>
                                {automatic && <div className="flex flex-wrap gap-1.5 mt-2.5" aria-label="自动活动间隔">
                                    {INTERVAL_OPTIONS.map(opt => (
                                        <button key={opt} onClick={() => setInterval(char, opt)}
                                            className={`text-[10.5px] rounded-full px-2.5 py-1 font-semibold ${interval === opt ? 'bg-indigo-400 text-white' : 'bg-white/10 text-indigo-200/70'}`}>
                                            {opt >= 60 ? `${formatHours(opt)}h` : `${opt}min`}
                                        </button>
                                    ))}
                                </div>}
                                <button onClick={() => setPickFor(char)}
                                    className="mt-2.5 text-[11px] text-amber-200 font-semibold flex items-center gap-1 active:opacity-70">
                                    <Play size={12} weight="fill" /> 让 ta 现在去逛一次
                                </button>
                            </>
                        )}
                        <VRActivityRestrictions char={char} onChange={change => {
                            updateCharacter(char.id, latest => ({vrState:change(latest.vrState || {enabled:false,intervalMinutes:VR_DEFAULT_INTERVAL_MIN})}));
                        }}/>
                        {novelCount > 0 && (
                            <button onClick={() => onEditReadingPreference(char)}
                                className="mt-2.5 flex w-full items-center gap-2 border-t border-white/[0.07] pt-2.5 text-left active:opacity-70">
                                <BookOpen size={13} weight="fill" className="text-indigo-200/70" />
                                <span className="text-[11px] font-semibold text-indigo-100/75">阅读偏好</span>
                                <span className="ml-auto text-[10px] text-indigo-300/45">{readingPreferenceLabel(char)}</span>
                                <CaretRight size={11} weight="bold" className="text-indigo-300/35" />
                            </button>
                        )}
                    </div>
                );
            })}
            {pageNavigation}
            {pickFor && <VRActivityPicker char={pickFor} libraryAvailable={readableNovels(novels,pickFor).length > 0}
                gardenReason={(() => {const market=readFishingMarketState();return !market.dinosaurGarden?.visitsEnabled ? '先在箱庭开启共同摆弄' : !gardenResidents(market).length ? '先在桌上放一只恐龙' : undefined;})()}
                onGo={go} onClose={() => setPickFor(null)}/>}
        </div>
    );
};

// ============ 彼方 · API 设置 + 调用记录 ============
const VRApiSettings: React.FC<{ apiPresets: ApiPreset[]; chatApi: APIConfig; addToast?: (m: string, t?: any) => void; characters: CharacterProfile[] }> = ({ apiPresets, chatApi, addToast, characters }) => {
    const [vrApi, setVr] = useState<APIConfig | null>(null);
    const [log, setLog] = useState<VRApiCall[]>([]);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<string | null>(null);
    const [presetsOpen, setPresetsOpen] = useState(false);   // 折叠「保存的预设」长列表
    const [snapshot, setSnapshot] = useState<string | null>(null);   // 排障快照正文
    const [collecting, setCollecting] = useState(false);

    useEffect(() => {
        void getVRApi().then(setVr);
        void getVRApiLog().then(setLog);
        const h = () => { void getVRApiLog().then(setLog); };
        window.addEventListener('vr-api-log', h);
        return () => window.removeEventListener('vr-api-log', h);
    }, []);

    const follow = !vrApi?.baseUrl;
    const effective = follow ? chatApi : vrApi!;
    const sameAs = (c: APIConfig) => !follow && vrApi!.baseUrl === c.baseUrl && vrApi!.model === c.model && vrApi!.apiKey === c.apiKey;
    const host = (u?: string) => { try { return u ? new URL(u).host : '—'; } catch { return u || '—'; } };

    const choose = (cfg: APIConfig | null) => {
        void setVRApi(cfg); setVr(cfg); setTestResult(null);
        addToast?.(cfg ? '已切换彼方 API' : '彼方改为角色回复跟随角色 API，未设置则跟随全局', 'success');
    };

    const test = async () => {
        const cfg = effective;
        if (!cfg?.baseUrl) { setTestResult('当前没有可用的 API'); return; }
        setTesting(true); setTestResult(null);
        try {
            const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${cfg.apiKey || 'sk-none'}` },
                body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: 'Hi' }], max_tokens: 5, stream: false }),
            });
            if (res.ok) { const d = await safeResponseJson(res); const r = d.choices?.[0]?.message?.content || ''; setTestResult(`连接成功 — 模型回复:"${r.slice(0, 24)}"`); }
            else { const t = await res.text().catch(() => ''); setTestResult(`HTTP ${res.status}: ${t.slice(0, 80)}`); }
        } catch (e: any) { setTestResult(`连接失败: ${e.message}`); } finally { setTesting(false); }
    };

    // 手机上没有控制台，「界面全关了记录还在涨」这类问题光靠截图说不清。
    // 一次把该看的都收齐，复制走即可；收的全是状态，不含名字、聊天和 key。
    const exportSnapshot = async () => {
        setCollecting(true);
        try {
            const text = await collectVRDiagnostics(characters, chatApi);
            setSnapshot(text);
            try {
                await navigator.clipboard.writeText(text);
                addToast?.('排障快照已复制，可以直接粘给开发者', 'success');
            } catch {
                // 剪贴板被浏览器挡住也不算失败——下面把正文摊开，截图一样能用
                addToast?.('快照已生成（这台设备不让自动复制，长按下面的文字选中即可）', 'info');
            }
        } catch (e: any) {
            addToast?.(`收集失败: ${e?.message || e}`, 'error');
        } finally { setCollecting(false); }
    };

    // 日志里混着两种行：真实的模型调用，和「调度动了但没走到模型」的诊断行。
    // 对账只该看前者，把诊断行算进分母会让「成功几次」失真。
    const calls = log.filter(l => !l.kind);
    const okCount = calls.filter(l => l.ok).length;

    return (
        <div className="space-y-3">
            <p className="text-[11px] text-indigo-300/60 leading-relaxed">
                彼方里的角色会自主、按间隔登入触发模型调用，比较费 API。你可以在这里给彼方<b className="text-indigo-200">单独指定一份 API</b>（和「设置」里保存的预设共用同一批），不设则角色回复跟随角色 API，未设置则跟随全局。
            </p>

            {/* 当前生效 */}
            <div className="rounded-2xl p-3.5" style={{ background: 'rgba(255,255,255,0.045)', border: '1px solid rgba(255,255,255,0.08)' }}>
                <div className="text-[10px] tracking-[0.2em] text-indigo-200/60 mb-1.5" style={{ fontFamily: `'Noto Serif SC',serif` }}>当前生效</div>
                <div className="text-[12.5px] text-white/90 font-semibold">{follow ? '按角色使用模型' : effective?.model || '未配置'}</div>
                <div className="text-[10px] text-white/40 mt-0.5">{follow ? `全局备用：${chatApi.model || '未配置'} · ${host(chatApi.baseUrl)}` : `${host(effective?.baseUrl)} · 彼方独立`}</div>
                <button onClick={test} disabled={testing} className="mt-2.5 text-[11px] px-3 py-1.5 rounded-full font-semibold disabled:opacity-50"
                    style={{ background: 'rgba(120,180,255,.16)', color: '#bcd4ff', border: '1px solid rgba(140,180,255,.3)' }}>
                    {testing ? '测试中…' : follow ? '测试全局备用 API' : '测试连接'}
                </button>
                {testResult && <div className={`mt-2 text-[10.5px] px-2.5 py-1.5 rounded-lg leading-snug ${testResult.startsWith('连接成功') ? 'text-emerald-300' : 'text-rose-300'}`} style={{ background: 'rgba(0,0,0,.25)' }}>{testResult}</div>}
            </div>

            {/* 选择 API */}
            <div>
                <div className="text-[10px] tracking-[0.2em] text-indigo-200/55 mb-1.5 px-0.5" style={{ fontFamily: `'Noto Serif SC',serif` }}>选择彼方 API</div>
                <button onClick={() => choose(null)}
                    className="w-full flex items-center gap-2 rounded-xl p-3 mb-1.5 text-left active:scale-[0.99] transition-transform"
                    style={{ background: follow ? 'rgba(120,180,255,.12)' : 'rgba(255,255,255,.04)', border: `1px solid ${follow ? 'rgba(140,180,255,.4)' : 'rgba(255,255,255,.07)'}` }}>
                    <div className="flex-1 min-w-0">
                        <div className="text-[12px] text-white/90 font-semibold">跟随角色设置</div>
                        <div className="text-[10px] text-white/40 truncate">{chatApi?.model || '未配置'} · {host(chatApi?.baseUrl)}</div>
                    </div>
                    {follow && <span className="text-[10px] text-sky-300 font-bold shrink-0">✓ 使用中</span>}
                </button>
                {apiPresets.length === 0 ? (
                    <p className="text-[10.5px] text-white/35 px-1 py-1.5">「设置」里还没有保存的 API 预设。去设置里保存几个模型，这里就能选。</p>
                ) : (() => {
                    const activePreset = apiPresets.find(p => sameAs(p.config));
                    const shown = presetsOpen ? apiPresets : (activePreset ? [activePreset] : []);
                    return (
                        <>
                            <button onClick={() => setPresetsOpen(o => !o)}
                                className="w-full flex items-center gap-2 rounded-lg px-2.5 py-1.5 mb-1.5 text-left active:bg-white/5"
                                style={{ border: '1px solid rgba(255,255,255,.07)' }}>
                                <span className="text-[10.5px] text-white/55">保存的预设</span>
                                <span className="text-[9.5px] text-white/35 rounded-full px-1.5 leading-tight" style={{ background: 'rgba(255,255,255,.08)' }}>{apiPresets.length}</span>
                                {!presetsOpen && activePreset && <span className="text-[9.5px] text-sky-300/70 truncate">当前 · {activePreset.name}</span>}
                                <span className="ml-auto text-[10px] text-white/40">{presetsOpen ? '收起' : '展开'}</span>
                            </button>
                            {shown.map(p => {
                                const on = sameAs(p.config);
                                return (
                                    <button key={p.id} onClick={() => choose(p.config)}
                                        className="w-full flex items-center gap-2 rounded-xl p-3 mb-1.5 text-left active:scale-[0.99] transition-transform"
                                        style={{ background: on ? 'rgba(120,180,255,.12)' : 'rgba(255,255,255,.04)', border: `1px solid ${on ? 'rgba(140,180,255,.4)' : 'rgba(255,255,255,.07)'}` }}>
                                        <div className="flex-1 min-w-0">
                                            <div className="text-[12px] text-white/90 font-semibold truncate">{p.name}</div>
                                            <div className="text-[10px] text-white/40 truncate">{p.config.model} · {host(p.config.baseUrl)}</div>
                                        </div>
                                        {on && <span className="text-[10px] text-sky-300 font-bold shrink-0">✓ 使用中</span>}
                                    </button>
                                );
                            })}
                        </>
                    );
                })()}
            </div>

            {/* 调用记录 */}
            <div className="rounded-2xl p-3" style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <div className="flex items-center gap-1.5 mb-2">
                    <span className="text-[10px] tracking-[0.2em] text-indigo-200/60" style={{ fontFamily: `'Noto Serif SC',serif` }}>调用记录</span>
                    <span className="text-[9.5px] text-white/40 rounded-full px-1.5 leading-tight" style={{ background: 'rgba(255,255,255,.08)' }}>{calls.length}{calls.length ? ` · 成功${okCount}` : ''}</span>
                    {log.length > 0 && <button onClick={() => { void clearVRApiLog(); setLog([]); }} className="ml-auto text-[10px] text-white/40 hover:text-rose-300/80">清空</button>}
                </div>
                {log.length === 0 ? (
                    <p className="text-[10.5px] text-white/35 py-2 text-center">还没有调用。角色每次登入彼方触发的模型调用都会记在这里，方便你对账。</p>
                ) : (
                    <div className="space-y-1">
                        {log.slice(0, 60).map((l, i) => {
                            const diag = !!l.kind;   // 诊断行：调度到点了，但这一轮没走到模型
                            return (
                                <div key={i} className="flex flex-wrap items-start gap-2 text-[10.5px] py-1 border-b border-white/5 last:border-0">
                                    <span className={`shrink-0 ${diag ? 'text-amber-400/70' : l.ok ? 'text-emerald-400/80' : 'text-rose-400/80'}`}>{diag ? '◌' : l.ok ? '●' : '○'}</span>
                                    <span className="text-white/75 truncate shrink-0">{l.charName || l.charId?.slice(-4) || '—'}</span>
                                    {diag ? (
                                        <span className="flex-1 min-w-0 text-amber-200/55 leading-snug">{l.note}</span>
                                    ) : (
                                        <>
                                            <span className="text-indigo-300/40 shrink-0">{l.room ? getRoom(l.room as VRRoomId).name : ''}</span>
                                            {/* 接入明明是关的却还是发了请求 —— 这就是「关不掉」的现场，标出来别让它混在红点里 */}
                                            {l.charEnabled === false && <span className="text-rose-300/75 shrink-0">未接入却发了</span>}
                                            <span className="ml-auto text-white/30 shrink-0 tabular-nums">{(l.ms / 1000).toFixed(1)}s</span>
                                        </>
                                    )}
                                    <span className="text-white/35 shrink-0 tabular-nums w-[68px] text-right">{new Date(l.ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                                    {l.error && <p className="w-full break-words text-rose-300/90">{l.error}</p>}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* 排障快照 */}
            <div className="rounded-2xl p-3" style={{ background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.07)' }}>
                <div className="flex items-center gap-1.5 mb-1.5">
                    <span className="text-[10px] tracking-[0.2em] text-indigo-200/60" style={{ fontFamily: `'Noto Serif SC',serif` }}>排障快照</span>
                    {snapshot && <button onClick={() => setSnapshot(null)} className="ml-auto text-[10px] text-white/40 hover:text-rose-300/80">收起</button>}
                </div>
                <p className="text-[10.5px] text-white/40 leading-relaxed mb-2">
                    角色明明没接入却还在调用、或者设置改完过一阵又退回去 —— 遇到这类说不清的情况，点一下把当前状态收成一段文字发给开发者。
                    里面只有开关、时间和用量，<b className="text-indigo-200/70">不含角色名字、聊天记录和 API key</b>。
                </p>
                <button onClick={exportSnapshot} disabled={collecting}
                    className="text-[11px] px-3 py-1.5 rounded-full font-semibold disabled:opacity-50"
                    style={{ background: 'rgba(120,180,255,.16)', color: '#bcd4ff', border: '1px solid rgba(140,180,255,.3)' }}>
                    {collecting ? '收集中…' : '生成并复制'}
                </button>
                {snapshot && (
                    <pre className="mt-2.5 max-h-64 overflow-auto text-[9.5px] leading-relaxed text-white/55 whitespace-pre-wrap break-all select-all p-2 rounded-lg"
                        style={{ background: 'rgba(0,0,0,.3)' }}>{snapshot}</pre>
                )}
            </div>
        </div>
    );
};

// ============ 动画关键帧 ============
const VRStyleTag: React.FC = () => (
    <style>{`
        @keyframes vrfloat { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-6px); } }
        @keyframes vrwave { from { transform: scaleY(0.5); } to { transform: scaleY(1.05); } }
        @keyframes vrdance { 0%{transform:translateY(0) rotate(-5deg)} 25%{transform:translateY(-9px) rotate(3deg)} 50%{transform:translateY(0) rotate(5deg)} 75%{transform:translateY(-9px) rotate(-3deg)} 100%{transform:translateY(0) rotate(-5deg)} }
        @keyframes vraurora { 0%,100%{transform:translate(0,0) scale(1);opacity:.75} 50%{transform:translate(6%,4%) scale(1.14);opacity:1} }
        @keyframes vrtwinkle { 0%,100%{opacity:.5} 50%{opacity:.85} }
        @keyframes sarquest { 0%,100%{transform:translate(-50%,0)} 50%{transform:translate(-50%,-6px)} }
    `}</style>
);

export default VRWorldApp;
import { useAppShortcut } from '../utils/appShortcutLaunch';
import { AppID as ShortcutAppID } from '../types';
