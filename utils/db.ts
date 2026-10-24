import type { MurderMysteryScript } from './murderMystery/script';
import type { MurderMysterySession, MurderMysteryEvent } from './murderMystery/session';
import { normalizeMurderMysterySession } from './murderMystery/session';
import { buildMysteryRealitySummary } from './murderMystery/report';
import { getLocalDateKey } from './localDate';
import { planMurderMysteryCommand, type MurderMysteryCommand } from './murderMystery/rules';
import type { LifeState } from './characterLife/engine';
import { readLocalCursor } from './localRead';
import { reportDatabaseFailure } from './databaseHealth';
import { associateDatabaseOpen, beginDatabaseOpen, recordDatabaseOpen } from './databaseOpenDiagnostics';
import {migrateLegacyWhiteboxPresets} from './legacyWhiteboxPresets';
import {restoreDecorationMedia} from './decorationMediaBackup';
import {exportBeautyPreferences,importBeautyPreferences} from './beautyPreferencesBackup';
import {exportBeautyAuthorBackup,importBeautyAuthorBackup} from './beautyAuthorBackup';
import { toMountedWorldbook } from './worldbook';
import { persistCharacterWithHomeMessages } from './homeMessageBridge';
import {deleteSecretNotesForIds, announceSecretNotesChanged} from './secretNote';
import { ensureStoryTimelineRepair, invalidateStoryTimelineRepair } from './storyTheaterTimeline';

import { orderWorldEpisodes } from './worldHome/episodeOrder';



import {
    CharacterProfile, ChatTheme, Message, UserProfile,
    MountedWorldbook,
    Task, Anniversary, DiaryEntry, RoomTodo, RoomNote, DailySchedule,
    GalleryImage, FullBackupData, GroupProfile, SocialPost, StudyCourse, GameSession, Worldbook, NovelBook, Emoji, EmojiCategory,
    BankTransaction, SavingsGoal, BankFullState, DollhouseState, XhsStockImage, XhsActivityRecord, XhsOwnedPost, SongSheet, QuizSession, GuidebookSession,
    LifeSimState, HandbookEntry, Tracker, TrackerEntry, HotNewsSnapshot,
    LifeRecord, MedPlan, LifeRecordSettings, CharacterGroup,
    VRWorldNovel, VRLibraryCategory, VRNovelAnnotation, CustomCreatorPart, VRMusicRoomState, VRGuestbookState, VRScript, VRStagedPlay, VRLetter,
    WorldProfile, WorldEpisode, StoryTheaterEntry, StoryTheaterPreset, StoryTheaterMask,
    HeartSyncRecord, HeartSyncPsychQuestion, HeartSyncPsychSession, HeartSyncQuestionnaire, HeartSyncQuestionnaireSession,
    DebateSession, BoardGameSession, CharacterStudySession, LifeReplayRecord, CommunityCommitteeSession, TaskWorkshopRecord, TaskWorkshopSettings,
    TimeCapsuleRecord, TimeCapsuleSettings, MyScheduleRecord, MyScheduleSettings, MyScheduleEntry, MyScheduleArchive,
    HealingSession, HealingMessage, HealingMemoryNode, HealingMemoryVector,
    OneChangeItem, OneChangeRecord, OneChangeStandardVersion, OneChangeStateEvent, OneChangeSettings,
} from '../types';
import { exportPostOfficeLocal, forgetPublicPostOfficeBase, importPostOfficeLocal } from './vrWorld/postOffice';
import { exportSignalLocal, importSignalLocal } from './vrWorld/signal';
import { exportLuckinLocal, importLuckinLocal } from './luckinMcpClient';
import { exportMcdLocal, importMcdLocal } from './mcdMcpClient';
import { exportMcpLocal, importMcpLocal } from './mcpClient';
import { exportStickerVisionLocal, importStickerVisionLocal } from './stickerVision';
import { exportHome3DLocal, importHome3DLocal, HOME3D_LOCAL_KEYS } from './home3DBackup';
import { exportAmsg2GlobalConfig, importAmsg2GlobalConfig } from './activeMsgStore';
import { exportWorldHomeLocal, importWorldHomeLocal } from './worldHome/localBackup';
import { exportDesktopSkinLocal, importDesktopSkinLocal } from './desktopSkinBackup';
import { loadChatActionOrders, saveChatActionOrders } from './chatActionOrder';
import { editLibrary, VR_LIBRARY_RECORD, type LibraryEdit } from './vrWorld/library';
import type { HtmlRepairPlan } from './htmlFormatRepair';

const DB_NAME = 'AetherOS_Data';
// v67：两条并行线各自用掉了 v65/v66（A线: blob_assets + 生活记录；B线: room_plates 门牌 + digest_reports 消化日志），
// 合并后统一推到 67——建表全部走幂等的 if(!contains)，任一侧的 v66 老库升级时都会补齐缺的那组表。
// v68：character_groups 角色分组（神经链接"文件夹"，见 types.ts CharacterGroup）。
// v69：见面·剧情条目与糯米机原生预设。正文继续复用 messages 表，避免再造会话存储。
// v70：剧场面具箱（原创人物面具）；角色面具仍只存 characterId，不复制神经链接资料。
// 上游与本地各占过 v71—v74：上游那几次只加只读游标 helper（readLocalCursor）与 messages 索引，
// 没有新增 object store；本地线从 v71 起排的是自己的一串私密表，编号互不相通。
// v71：心心相印私密测试记录与题库设置。
// v72：辩论赛私密赛程、观点召回与结果记录。
// v73：角色自习室私密课堂、Markdown 笔记与逐轮提问记录。
// v74：人生重映私密事件预设、角色同行演绎与可续玩会话。
// v75：任务工坊任务盒、工具箱、有限角色来访便签与前台轮转设置。
// v78：时间胶囊本机胶囊、开启状态与前台角色来访设置。
// v80：我的日程现实时间轴与角色收件设置。
// v81：居委会现实两难、逐轮倾诉、议事总结与写回进度。
// v82：小红书公开笔记、收藏索引与本机私密讨论。
// v83：角色小红书伪主页；发帖归属与可删除的自由活动日志分离。
// v86：聊愈独立会话、完整原文与仅聊愈可读的用户中心向量记忆。
// v87：桌游独立会话；TRPG 的 games store 保持不变。
// v88：「只做一个改变」独立改变、日记录、标准版本、状态事件与系统设置。
// v90：曾建 online_prompt_presets（线上聊天输出风格预设）。该软件已删除。
// 表仍创建，避免旧库缺表时 transaction() 抛 NotFoundError；打开时清空，不再导出或恢复。
// v91：当时为补建碰撞旧库升过一版。不要为了删这张表再升 DB_VERSION。
// v95：上游 3D 家园在 messages 上加 charId_source / charId_homeTurn 两条索引，家园投影与增量日记
// 按 source、homeTurnId 直查，不再扫整段私聊。建索引本身是幂等的 contains 判断，但老库停在 v94
// 时不会触发 upgrade，必须占一个版本号才真正建得出来。
// v96: 每角色实际生活状态与自动回复 episode；习惯仍保存在角色资料。
export const DB_VERSION = 98;

const STORE_CHARACTERS = 'characters';
const STORE_CHAR_GROUPS = 'character_groups'; // 角色分组定义（角色通过 groupId 指向；与群聊 groups 无关）
const STORE_MESSAGES = 'messages';
const STORE_EMOJIS = 'emojis';
const STORE_EMOJI_CATEGORIES = 'emoji_categories'; 
const STORE_THEMES = 'themes';
const STORE_ASSETS = 'assets';
const STORE_BLOB_ASSETS = 'blob_assets'; // 图片二进制 Blob 存储（key=生成 id，value={id, blob}）；壁纸/小屋等图片改存 Blob 而非 base64，省 ~33% 空间且不占 JS 堆。见 utils/blobRef.ts
const STORE_SCHEDULED = 'scheduled_messages'; 
const STORE_GALLERY = 'gallery';
const STORE_USER = 'user_profile'; 
const STORE_DIARIES = 'diaries';
const STORE_TASKS = 'tasks'; 
const STORE_ANNIVERSARIES = 'anniversaries';
const STORE_ROOM_TODOS = 'room_todos'; 
const STORE_ROOM_NOTES = 'room_notes'; 
const STORE_GROUPS = 'groups'; 
const STORE_JOURNAL_STICKERS = 'journal_stickers';
const STORE_SOCIAL_POSTS = 'social_posts';
const STORE_COURSES = 'courses';
const STORE_CHARACTER_STUDY = 'character_study_sessions';
const STORE_GAMES = 'games';
const STORE_WORLDBOOKS = 'worldbooks';
const STORE_ONLINE_PROMPT_PRESETS = 'online_prompt_presets'; // v90：表保留并在打开时清空
const STORE_NOVELS = 'novels'; 
const STORE_BANK_TX = 'bank_transactions';
const STORE_BANK_DATA = 'bank_data';
const STORE_XHS_STOCK = 'xhs_stock';
const STORE_XHS_ACTIVITIES = 'xhs_activities';
const STORE_XHS_OWNED_POSTS = 'xhs_owned_posts';
const STORE_SONGS = 'songs';
const STORE_QUIZZES = 'quizzes';
const STORE_GUIDEBOOK = 'guidebook';
const STORE_LIFE_SIM = 'life_sim';
const STORE_DAILY_SCHEDULE = 'daily_schedule';
const STORE_CHARACTER_LIFE = 'character_life';
const STORE_HANDBOOK = 'handbook'; // 跨角色聚合手账，每天一条 entry，id = 'YYYY-MM-DD'
const STORE_TRACKERS = 'trackers';                // 手账打卡 tracker 定义
const STORE_TRACKER_ENTRIES = 'tracker_entries';  // tracker 每日打卡数据
const STORE_HOTNEWS = 'hotnews_snapshots';        // 分时段热点快照（全角色共享，key=日期#时段）
const STORE_VR_NOVELS = 'vr_novels';              // 虚拟世界「彼方」全局小说库（所有角色共享原文）
const STORE_VR_ANNOTATIONS = 'vr_annotations';    // 虚拟世界小说批注（per-segment per-char，可互相吐槽）
const STORE_CC_PARTS = 'cc_custom_parts';         // 捏脸系统自定义部件（开发模式追加，注入捏人器）
const STORE_VR_MUSIC = 'vr_music';                // 听歌房共享状态（单例 nowPlaying + 循环队列）
const STORE_VR_GUESTBOOK = 'vr_guestbook';        // 留言簿共享版聊墙（单例 messages）
const STORE_VR_SCRIPTS = 'vr_scripts';            // 剧院·投稿剧本库（每份剧本一条）
const STORE_VR_PLAYS = 'vr_plays';                // 剧院·历史舞台剧（每场演出一条）
const STORE_VR_PRESETS = 'vr_presets';            // 剧院·用户自定义写作风格预设（key 为主键）
const STORE_VR_LETTERS = 'vr_letters';            // 邮局信件（本地存档 + 待寄出/待回复队列）
const STORE_VR_SETTINGS = 'vr_settings';          // 彼方设置单例：独立 API（id='api'）+ 调用记录（id='apilog'）
const STORE_API_CALL_LOG = 'api_call_log';        // 全局 API 调用记录单例（id='log'，保留近 5 天）
const STORE_WORLDS = 'worlds';                    // 家园·世界定义（成员/NPC/居住/关系/模式）
const STORE_WORLD_EPISODES = 'world_episodes';    // 家园·演绎历史（每轮一条，index worldId）
const STORE_LIFE_RECORDS = 'life_records';        // 生活记录：生理期/药盒打卡/锻炼（记账走 bank_transactions）
const STORE_MED_PLANS = 'med_plans';              // 药盒计划（每天几点吃什么药）
const STORE_LIFE_SETTINGS = 'life_record_settings'; // 生活记录设置单例（id='main'：周期长度等）
const STORE_STORY_THEATERS = 'story_theaters';       // 见面·剧情条目（消息用 story-theater:${id}）
const STORE_STORY_THEATER_PRESETS = 'story_theater_presets'; // 糯米机原生剧情预设
const STORE_STORY_THEATER_MASKS = 'story_theater_masks'; // 剧场原创人物面具
const STORE_HEART_SYNC = 'heart_sync';                   // 心心相印：心理测试与问卷；旧伴侣 settings/session 会清除且不再导出
const STORE_DEBATE = 'debate_sessions';                  // 辩论赛：召回、阵容、发言与裁判结果
const STORE_MURDER_MYSTERY_SCRIPTS = 'murder_mystery_scripts';
const STORE_MURDER_MYSTERY_SESSIONS = 'murder_mystery_sessions';
const STORE_MURDER_MYSTERY_EVENTS = 'murder_mystery_events';
const STORE_BOARD_GAME_SESSIONS = 'board_game_sessions'; // 桌游：共享 session 外壳与各游戏独立状态
const STORE_LIFE_REPLAY = 'life_replay';                 // 人生重映：私密事件预设 + 演绎 session
const STORE_COMMUNITY_COMMITTEE = 'community_committee'; // 居委会：现实两难、倾诉 turns 与总结
const STORE_TASK_WORKSHOP = 'task_workshop';             // 任务工坊：任务/工具/来访便签/设置
const STORE_TIME_CAPSULE = 'time_capsule';               // 时间胶囊：用户/角色胶囊与前台来访设置
const STORE_MY_SCHEDULE = 'my_schedule';                   // 我的日程：用户现实时间轴与角色收件设置
const STORE_XIAOHONGSHU = 'xiaohongshu_library';            // 已停用的自建小红书库；保留空表，启动时清空且不再导出
const STORE_HEALING_SESSIONS = 'healing_sessions';           // 聊愈：一次进入对应一段独立会话
const STORE_HEALING_MESSAGES = 'healing_messages';           // 聊愈：完整原始文字/图片消息
const STORE_HEALING_MEMORY_NODES = 'healing_memory_nodes';   // 聊愈：跨角色共享的用户中心记忆
const STORE_HEALING_MEMORY_VECTORS = 'healing_memory_vectors'; // 聊愈：无 charId owner 的记忆向量
const STORE_ONE_CHANGE_CHANGES = 'one_change_changes';
const STORE_ONE_CHANGE_RECORDS = 'one_change_records';
const STORE_ONE_CHANGE_STANDARD_VERSIONS = 'one_change_standard_versions';
const STORE_ONE_CHANGE_STATE_EVENTS = 'one_change_state_events';
const STORE_ONE_CHANGE_SETTINGS = 'one_change_settings';

// API 调用记录：保留近 5 天，超期丢弃；再加一个硬上限防止异常情况撑爆
const API_CALL_LOG_MAX_AGE_MS = 5 * 24 * 60 * 60 * 1000;
const API_CALL_LOG_MAX_ENTRIES = 2000;

export interface ScheduledMessage {
    id: string;
    charId: string;
    content: string;
    dueAt: number;
    createdAt: number;
}

// Built-in Presets
const SULLY_CATEGORY_ID = 'cat_sully_exclusive';
const SULLY_PRESET_EMOJIS = [
    { name: 'Sully晚安', url: 'https://cdn.jsdelivr.net/gh/qegj567-cloud/SullyOS-assets@main/bgm/SULLY/night.png', categoryId: SULLY_CATEGORY_ID },
    { name: 'Sully无语', url: 'https://cdn.jsdelivr.net/gh/qegj567-cloud/SullyOS-assets@main/bgm/SULLY/w.png', categoryId: SULLY_CATEGORY_ID },
    { name: 'Sully偷看', url: 'https://cdn.jsdelivr.net/gh/qegj567-cloud/SullyOS-assets@main/bgm/SULLY/see.png', categoryId: SULLY_CATEGORY_ID },
    { name: 'Sully打气', url: 'https://cdn.jsdelivr.net/gh/qegj567-cloud/SullyOS-assets@main/bgm/SULLY/fight.png', categoryId: SULLY_CATEGORY_ID },
    { name: 'Sully生气', url: 'https://cdn.jsdelivr.net/gh/qegj567-cloud/SullyOS-assets@main/bgm/SULLY/an.png', categoryId: SULLY_CATEGORY_ID },
    { name: 'Sully疑惑', url: 'https://cdn.jsdelivr.net/gh/qegj567-cloud/SullyOS-assets@main/bgm/SULLY/sDN.png', categoryId: SULLY_CATEGORY_ID },
    { name: 'Sully道歉', url: 'https://cdn.jsdelivr.net/gh/qegj567-cloud/SullyOS-assets@main/bgm/SULLY/sorry.png', categoryId: SULLY_CATEGORY_ID },
    { name: 'Sully等你消息', url: 'https://cdn.jsdelivr.net/gh/qegj567-cloud/SullyOS-assets@main/bgm/SULLY/wait.png', categoryId: SULLY_CATEGORY_ID },
];

// 单例连接缓存。openDB 原本每次调用都新开一条 IDB 连接, 既不复用也不 close ——
// 在记忆管线 (hybridSearch / touchAccess 等) 并发读写下会瞬间堆出几十条 AetherOS_Data
// 连接, 撑爆 Chromium 底层 backing store; 一旦底层报错, 整个 origin 的 IndexedDB
// (含 Service Worker 的 dedupe / inbox 库) 可能跟着开不了或被强关, 推送消息因此确认超时。
// 改成复用同一条连接, 并在连接被外部失效 (另一 tab 升级版本 / 浏览器强制关闭) 时
// 清掉缓存, 下次 openDB 自动重开 —— 一处改, 全部 ~165 个调用点受益。
let dbPromise: Promise<IDBDatabase> | null = null;
const REMOVED_XHS_CREDENTIAL_KEY = 'os_xiaohongshu_protected_bridge_v1';
const REMOVED_ONLINE_PROMPT_ACTIVE_KEY = 'online_prompt_active_v1';
let removedPrivateDataSweep: Promise<void> | null = null;

function isRetiredHeartSyncRecord(record: { kind?: string } | null | undefined): boolean {
    return record?.kind === 'settings' || record?.kind === 'session';
}

function clearStoreIfPresent(db: IDBDatabase, name: string): Promise<void> {
    if (!db.objectStoreNames.contains(name)) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(name, 'readwrite');
        tx.objectStore(name).clear();
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

function deleteRetiredHeartSyncRecords(db: IDBDatabase): Promise<void> {
    if (!db.objectStoreNames.contains(STORE_HEART_SYNC)) return Promise.resolve();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(STORE_HEART_SYNC, 'readwrite');
        const request = tx.objectStore(STORE_HEART_SYNC).openCursor();
        request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) return;
            if (isRetiredHeartSyncRecord(cursor.value)) cursor.delete();
            cursor.continue();
        };
        request.onerror = () => reject(request.error || tx.error);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
    });
}

async function sweepRemovedPrivateData(db: IDBDatabase): Promise<void> {
    try {
        if (typeof localStorage !== 'undefined') {
            localStorage.removeItem(REMOVED_XHS_CREDENTIAL_KEY);
            localStorage.removeItem(REMOVED_ONLINE_PROMPT_ACTIVE_KEY);
            forgetPublicPostOfficeBase();
        }
    } catch { /* 私密模式或无本地存储时忽略 */ }
    await clearStoreIfPresent(db, STORE_XIAOHONGSHU);
    await clearStoreIfPresent(db, STORE_ONLINE_PROMPT_PRESETS);
    await deleteRetiredHeartSyncRecords(db);
}

async function finishDatabaseOpen(db: IDBDatabase): Promise<void> {
    if (!removedPrivateDataSweep) {
        removedPrivateDataSweep = sweepRemovedPrivateData(db).catch((error) => {
            removedPrivateDataSweep = null;
            console.warn('[DB] 清理已删除功能的本机数据失败', error);
        });
    }
    await removedPrivateDataSweep;
}

/** 和新消息同事务失效镜像，防止后台把刚清掉的旧水位重新恢复。 */
function clearStaleMemoryMirror(transaction: IDBTransaction, charId: string, newId: number): void {
    const assets = transaction.objectStore(STORE_ASSETS);
    const key = `mp_hwm_v1_${charId}`;
    const request = assets.get(key);
    request.onsuccess = () => {
        const mirror = request.result?.data;
        const hwm = typeof mirror === 'number' ? mirror : Number(mirror?.msgId);
        if (Number.isFinite(hwm) && hwm >= newId) assets.delete(key);
    };
}

export const openDB = (): Promise<IDBDatabase> => {
  if (dbPromise) return dbPromise;

  const promise = new Promise<IDBDatabase>((resolve, reject) => {
    const diagnosticRequest = beginDatabaseOpen(DB_VERSION);
    const openVersions = { requestedVersion: DB_VERSION, requestId: diagnosticRequest };
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    // onblocked 不是终态: 它先 reject, 但底层 open request 还活着, 等占用方关闭后仍会
    // 触发 onsuccess。用 settled 标记 promise 已 settle, 让那条迟到的连接被 close 掉而
    // 不是泄漏成一条没人持有、却能 block 后续升级/删库的孤儿连接。
    // 清缓存一律先比对 dbPromise === promise: onclose/onerror 等都是异步回调, 期间若已
    // 重开并缓存了新 promise, 陈旧连接的回调不能误清新单例 (否则又凭空多开一条连接)。
    let settled = false;
    const openTimer = setTimeout(() => {
        recordDatabaseOpen('open-timeout', openVersions);
        settled = true;
        if (dbPromise === promise) dbPromise = null;
        reject(new Error('本地数据库连接超时，请关闭其他糯米机页面后重试；无需清理数据'));
    }, 20_000);

    request.onerror = () => {
        if (settled) return;
        const err = request.error;
        // 版本回退兜底: 浏览器里已存在「比当前 build 的 DB_VERSION 更高」的版本时
        // (用户先跑过更新的 build / 另一个 tab 升过级 / SW 缓存了更新的 bundle),
        // 带 DB_VERSION 打开会抛 VersionError("lower version than existing")。
        // 旧逻辑直接 reject → 整个 origin 的 IndexedDB 读写全挂: SYSTEM ERROR、
        // 美化(themes 存在库里)读不出来、线下(LifeSim)进不去。其实更高版本的 store
        // 只是当前 schema 的超集, 不带版本号打开就能连到现有版本、读写完全兼容,
        // 不需要也不能降级建表。所以这里回退到「不带版本号 open」一次而不是报死。
        if (err?.name === 'VersionError') {
            recordDatabaseOpen('versionless-fallback', openVersions, err);
            console.warn('[DB] open VersionError —— 现有版本高于当前 build, 回退到不带版本号打开');
            // Keep the timeout active until the versionless request settles.
            // 原 request 已终结 (VersionError 后不会再 onsuccess)，由 fallback 负责结算。
            const fb = indexedDB.open(DB_NAME); // 不带版本号 = 连到现有(更高)版本, 不触发 upgrade
            fb.onsuccess = () => {
                const db = fb.result;
                if (settled) { db.close(); return; }
                clearTimeout(openTimer);
                associateDatabaseOpen(db, diagnosticRequest, DB_VERSION);
                recordDatabaseOpen('open-ready', { ...openVersions, actualVersion: db.version });
                // 与正常路径一致地挂上失效自愈回调 (另一 tab 升级 / 浏览器强关连接)。
                db.onversionchange = () => {
                    recordDatabaseOpen('version-change', { ...openVersions, actualVersion: db.version });
                    db.close();
                    if (dbPromise === promise) dbPromise = null;
                };
                db.onclose = () => {
                    recordDatabaseOpen('connection-closed', { ...openVersions, actualVersion: db.version });
                    if (dbPromise === promise) dbPromise = null;
                };
                void finishDatabaseOpen(db).finally(() => {
                    if (settled) { try { db.close(); } catch { /* ignore */ } return; }
                    resolve(db);
                });
            };
            fb.onerror = () => {
                if (settled) return;
                clearTimeout(openTimer);
                recordDatabaseOpen('open-error', openVersions, fb.error);
                settled = true;
                console.error("DB Open Error (versionless fallback):", fb.error);
                if (dbPromise === promise) dbPromise = null;
                reject(fb.error);
            };
            return;
        }
        clearTimeout(openTimer);
        recordDatabaseOpen('open-error', openVersions, err);
        console.error("DB Open Error:", err);
        if (dbPromise === promise) dbPromise = null; // 打开失败别把 rejected promise 缓存住
        settled = true;
        reject(err);
    };

    request.onsuccess = () => {
        clearTimeout(openTimer);
        const db = request.result;
        // 已经 reject 过 (onblocked / onerror): 这条迟到的连接没人接收, 直接 close,
        // 否则它开着会 block 后续的版本升级 / deleteDatabase。
        if (settled) {
            try { db.close(); } catch { /* ignore */ }
            return;
        }
        associateDatabaseOpen(db, diagnosticRequest, DB_VERSION);
        recordDatabaseOpen('open-ready', { ...openVersions, actualVersion: db.version });
        // 另一个 tab 触发版本升级时必须主动 close 让位, 否则对方 open 会被 block;
        // 顺手清缓存, 下次 openDB 重开到新版本。
        db.onversionchange = () => {
            recordDatabaseOpen('version-change', { ...openVersions, actualVersion: db.version });
            db.close();
            if (dbPromise === promise) dbPromise = null;
        };
        // Chromium 因 backing store 出错等原因强制关闭连接时触发 —— 清缓存自愈,
        // 避免后续操作一直复用一条已死的连接。
        //
        // 已知残余 (有意不修): onclose 是异步派发的, 强关到回调跑之间, 命中这条 fast-path
        // 的调用方会拿到将死连接, 其 db.transaction() 同步抛 InvalidStateError —— 当次操作
        // 失败, 但下一次调用就自愈。主库这 ~165 个调用点全是记忆管线 / UI 读写, 失败是
        // 瞬时且会自然重试的 (不丢数据), 不值得为它给每个调用点铺事务级重试 (要全覆盖得上
        // 共享 runTx 层并迁移所有 DB.* 方法, 是独立大重构)。SW inbox 那条路径不一样: 同样
        // 的竞态会让 push 静默丢失 → 主线程超时, 所以那边 (worker/sw-keep-alive.ts 的
        // withInboxTx) 单独补了「InvalidStateError 清缓存重开一次」的事务级兜底。
        db.onclose = () => {
            recordDatabaseOpen('connection-closed', { ...openVersions, actualVersion: db.version });
            if (dbPromise === promise) dbPromise = null;
        };
        void finishDatabaseOpen(db).finally(() => {
            if (settled) { try { db.close(); } catch { /* ignore */ } return; }
            resolve(db);
        });
    };

    request.onblocked = () => {
        clearTimeout(openTimer);
        recordDatabaseOpen('open-blocked', openVersions);
        // 另一个 tab 仍持有旧版本连接, 升级被挡。清缓存 + reject, 别让调用方无限挂着;
        // 与 activeMsgStore / sw-keep-alive 的 openDB 一致, 对方 tab 关闭后下次调用可重试。
        console.warn('[DB] open blocked —— 另一个 tab 仍持有旧版本连接未关闭');
        if (dbPromise === promise) dbPromise = null;
        settled = true;
        reject(new Error('IndexedDB open blocked —— 关闭其它标签页后重试'));
    };

    request.onupgradeneeded = (event) => {
      // A legitimate schema migration may be slow; never cancel it halfway.
      clearTimeout(openTimer);
      const db = (event.target as IDBOpenDBRequest).result;
      const upgradeVersions = { ...openVersions, fromVersion: event.oldVersion, actualVersion: db.version };
      recordDatabaseOpen('upgrade-started', upgradeVersions);
      const upgradeTransaction = request.transaction!;
      upgradeTransaction.addEventListener('complete', () => recordDatabaseOpen('upgrade-committed', upgradeVersions));
      upgradeTransaction.addEventListener('abort', () => recordDatabaseOpen('upgrade-aborted', upgradeVersions, upgradeTransaction.error));

      const createStore = (name: string, options?: IDBObjectStoreParameters) => {
          if (!db.objectStoreNames.contains(name)) {
              db.createObjectStore(name, options);
          }
      };

      createStore(STORE_CHARACTERS, { keyPath: 'id' });
      createStore(STORE_CHARACTER_LIFE, { keyPath: 'charId' });
      createStore(STORE_CHAR_GROUPS, { keyPath: 'id' }); // v68: 角色分组

      if (!db.objectStoreNames.contains(STORE_MESSAGES)) {
        const msgStore = db.createObjectStore(STORE_MESSAGES, { keyPath: 'id', autoIncrement: true });
        msgStore.createIndex('charId', 'charId', { unique: false });
        msgStore.createIndex('groupId', 'groupId', { unique: false }); 
      } else {
          const msgStore = (event.target as IDBOpenDBRequest).transaction?.objectStore(STORE_MESSAGES);
          if (msgStore && !msgStore.indexNames.contains(STORE_MESSAGES) && !msgStore.indexNames.contains('groupId')) {
              try {
                  msgStore.createIndex('groupId', 'groupId', { unique: false });
              } catch (e) { console.log('Index already exists'); }
          }
      }

      // v62: messages 加 [charId, type] 复合索引。彼方动态按 (charId, 'vr_card') 直取 vr_card，
      // 成本只跟 vr_card 条数相关，跟总消息量无关——上万条聊天的用户也不必把整段历史 getAll
      // 进内存再筛。没有 type 字段的老消息不会进此索引，正好不影响（我们只查 vr_card）。
      try {
          const msgStore = (event.target as IDBOpenDBRequest).transaction?.objectStore(STORE_MESSAGES);
          if (msgStore && !msgStore.indexNames.contains('charId_type')) {
              msgStore.createIndex('charId_type', ['charId', 'type'], { unique: false });
          }
      } catch (e) { console.log('charId_type index migration skipped', e); }

      const messageStore = (event.target as IDBOpenDBRequest).transaction!.objectStore(STORE_MESSAGES);
      if (!messageStore.indexNames.contains('charId_source')) {
          messageStore.createIndex('charId_source', ['charId', 'metadata.source'], { unique: false });
      }

      if (!messageStore.indexNames.contains('charId_homeTurn')) {
          messageStore.createIndex('charId_homeTurn', ['charId', 'metadata.homeTurnId'], { unique: false });
      }

      const deliveryStore = (event.target as IDBOpenDBRequest).transaction!.objectStore(STORE_MESSAGES);
      if (!deliveryStore.indexNames.contains('charId_deliveryId')) {
          deliveryStore.createIndex('charId_deliveryId', ['charId', 'metadata.deliveryId'], { unique: false });
      }

      createStore(STORE_EMOJIS, { keyPath: 'name' });
      createStore(STORE_EMOJI_CATEGORIES, { keyPath: 'id' });

      createStore(STORE_THEMES, { keyPath: 'id' });
      createStore(STORE_ASSETS, { keyPath: 'id' });
      createStore(STORE_BLOB_ASSETS, { keyPath: 'id' }); // v65: 图片二进制 Blob 存储
      
      if (!db.objectStoreNames.contains(STORE_SCHEDULED)) {
        const schedStore = db.createObjectStore(STORE_SCHEDULED, { keyPath: 'id' });
        schedStore.createIndex('charId', 'charId', { unique: false });
      }

      if (!db.objectStoreNames.contains(STORE_GALLERY)) {
          const galleryStore = db.createObjectStore(STORE_GALLERY, { keyPath: 'id' });
          galleryStore.createIndex('charId', 'charId', { unique: false });
      }

      createStore(STORE_USER, { keyPath: 'id' });
      
      if (!db.objectStoreNames.contains(STORE_DIARIES)) {
          const diaryStore = db.createObjectStore(STORE_DIARIES, { keyPath: 'id' });
          diaryStore.createIndex('charId', 'charId', { unique: false });
      }
      
      createStore(STORE_TASKS, { keyPath: 'id' });
      createStore(STORE_ANNIVERSARIES, { keyPath: 'id' });

      if (!db.objectStoreNames.contains(STORE_ROOM_TODOS)) {
          db.createObjectStore(STORE_ROOM_TODOS, { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(STORE_ROOM_NOTES)) {
          const notesStore = db.createObjectStore(STORE_ROOM_NOTES, { keyPath: 'id' });
          notesStore.createIndex('charId', 'charId', { unique: false });
      }

      createStore(STORE_GROUPS, { keyPath: 'id' });
      createStore(STORE_JOURNAL_STICKERS, { keyPath: 'name' });
      createStore(STORE_SOCIAL_POSTS, { keyPath: 'id' });
      createStore(STORE_COURSES, { keyPath: 'id' });
      createStore(STORE_CHARACTER_STUDY, { keyPath: 'id' });
      createStore(STORE_GAMES, { keyPath: 'id' }); 
      createStore(STORE_WORLDBOOKS, { keyPath: 'id' });
      createStore(STORE_ONLINE_PROMPT_PRESETS, { keyPath: 'id' }); // v90 新增；v91 为碰撞旧库补建
      createStore(STORE_NOVELS, { keyPath: 'id' });

      createStore(STORE_VR_NOVELS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_VR_ANNOTATIONS)) {
          const vrAnnStore = db.createObjectStore(STORE_VR_ANNOTATIONS, { keyPath: 'id' });
          vrAnnStore.createIndex('novelId', 'novelId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_CC_PARTS)) {
          const ccStore = db.createObjectStore(STORE_CC_PARTS, { keyPath: 'id' });
          ccStore.createIndex('categoryKey', 'categoryKey', { unique: false });
      }
      createStore(STORE_VR_MUSIC, { keyPath: 'id' });
      createStore(STORE_VR_GUESTBOOK, { keyPath: 'id' });
      createStore(STORE_VR_SCRIPTS, { keyPath: 'id' });
      createStore(STORE_VR_PLAYS, { keyPath: 'id' });
      createStore(STORE_VR_PRESETS, { keyPath: 'key' });
      if (!db.objectStoreNames.contains(STORE_VR_LETTERS)) {
          const ltStore = db.createObjectStore(STORE_VR_LETTERS, { keyPath: 'id' });
          ltStore.createIndex('box', 'box', { unique: false });
      }
      createStore(STORE_VR_SETTINGS, { keyPath: 'id' });
      createStore(STORE_HEART_SYNC, { keyPath: 'id' });
      createStore(STORE_DEBATE, { keyPath: 'id' });
      createStore(STORE_BOARD_GAME_SESSIONS, { keyPath: 'id' });
      createStore(STORE_MURDER_MYSTERY_SCRIPTS, { keyPath: 'id' });
      createStore(STORE_MURDER_MYSTERY_SESSIONS, { keyPath: 'id' });
      createStore(STORE_MURDER_MYSTERY_EVENTS, { keyPath: 'id' });
      const mysteryEvents = upgradeTransaction.objectStore(STORE_MURDER_MYSTERY_EVENTS);
      if (!mysteryEvents.indexNames.contains('sessionId')) mysteryEvents.createIndex('sessionId', 'sessionId', { unique: false });

      createStore(STORE_LIFE_REPLAY, { keyPath: 'id' });
      createStore(STORE_COMMUNITY_COMMITTEE, { keyPath: 'id' });
      createStore(STORE_TASK_WORKSHOP, { keyPath: 'id' });
      createStore(STORE_TIME_CAPSULE, { keyPath: 'id' });
      createStore(STORE_MY_SCHEDULE, { keyPath: 'id' });
      createStore(STORE_XIAOHONGSHU, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_HEALING_SESSIONS)) {
          const store = db.createObjectStore(STORE_HEALING_SESSIONS, { keyPath: 'id' });
          store.createIndex('charId', 'charId', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_HEALING_MESSAGES)) {
          const store = db.createObjectStore(STORE_HEALING_MESSAGES, { keyPath: 'id', autoIncrement: true });
          store.createIndex('sessionId', 'sessionId', { unique: false });
          store.createIndex('timestamp', 'timestamp', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_HEALING_MEMORY_NODES)) {
          const store = db.createObjectStore(STORE_HEALING_MEMORY_NODES, { keyPath: 'id' });
          store.createIndex('createdAt', 'createdAt', { unique: false });
          store.createIndex('sourceSessionId', 'sourceSessionId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_HEALING_MEMORY_VECTORS)) {
          const store = db.createObjectStore(STORE_HEALING_MEMORY_VECTORS, { keyPath: 'memoryId' });
          store.createIndex('memoryId', 'memoryId', { unique: true });
      }
      createStore(STORE_ONE_CHANGE_CHANGES, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_ONE_CHANGE_RECORDS)) {
          const store = db.createObjectStore(STORE_ONE_CHANGE_RECORDS, { keyPath: 'id' });
          store.createIndex('changeId', 'changeId', { unique: false });
          store.createIndex('date', 'date', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_ONE_CHANGE_STANDARD_VERSIONS)) {
          const store = db.createObjectStore(STORE_ONE_CHANGE_STANDARD_VERSIONS, { keyPath: 'id' });
          store.createIndex('changeId', 'changeId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_ONE_CHANGE_STATE_EVENTS)) {
          const store = db.createObjectStore(STORE_ONE_CHANGE_STATE_EVENTS, { keyPath: 'id' });
          store.createIndex('changeId', 'changeId', { unique: false });
          store.createIndex('effectiveDate', 'effectiveDate', { unique: false });
      }
      createStore(STORE_ONE_CHANGE_SETTINGS, { keyPath: 'id' });
      createStore(STORE_API_CALL_LOG, { keyPath: 'id' });

      // v63: 家园（同世界观多角色大世界）
      createStore(STORE_WORLDS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_WORLD_EPISODES)) {
          const weStore = db.createObjectStore(STORE_WORLD_EPISODES, { keyPath: 'id' });
          weStore.createIndex('worldId', 'worldId', { unique: false });
      }

      createStore(STORE_BANK_TX, { keyPath: 'id' });
      createStore(STORE_BANK_DATA, { keyPath: 'id' });
      createStore(STORE_XHS_STOCK, { keyPath: 'id' });

      if (!db.objectStoreNames.contains(STORE_XHS_ACTIVITIES)) {
          const xhsActStore = db.createObjectStore(STORE_XHS_ACTIVITIES, { keyPath: 'id' });
          xhsActStore.createIndex('characterId', 'characterId', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_XHS_OWNED_POSTS)) {
          const ownedPostStore = db.createObjectStore(STORE_XHS_OWNED_POSTS, { keyPath: 'id' });
          ownedPostStore.createIndex('characterId', 'characterId', { unique: false });
          ownedPostStore.createIndex('noteId', 'noteId', { unique: false });
      }

      createStore(STORE_SONGS, { keyPath: 'id' });
      createStore(STORE_QUIZZES, { keyPath: 'id' });
      createStore(STORE_GUIDEBOOK, { keyPath: 'id' });
      createStore(STORE_LIFE_SIM, { keyPath: 'id' });
      createStore(STORE_DAILY_SCHEDULE, { keyPath: 'id' });
      createStore(STORE_HANDBOOK, { keyPath: 'id' });

      createStore(STORE_TRACKERS, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(STORE_TRACKER_ENTRIES)) {
          const teStore = db.createObjectStore(STORE_TRACKER_ENTRIES, { keyPath: 'id' });
          teStore.createIndex('trackerId', 'trackerId', { unique: false });
          teStore.createIndex('date', 'date', { unique: false });
      }

      // v65: 生活记录（档案 App）
      if (!db.objectStoreNames.contains(STORE_LIFE_RECORDS)) {
          const lrStore = db.createObjectStore(STORE_LIFE_RECORDS, { keyPath: 'id' });
          lrStore.createIndex('date', 'date', { unique: false });
          lrStore.createIndex('module', 'module', { unique: false });
      }
      createStore(STORE_MED_PLANS, { keyPath: 'id' });
      createStore(STORE_LIFE_SETTINGS, { keyPath: 'id' });
      createStore(STORE_STORY_THEATERS, { keyPath: 'id' });
      createStore(STORE_STORY_THEATER_PRESETS, { keyPath: 'id' });
      createStore(STORE_STORY_THEATER_MASKS, { keyPath: 'id' });

      createStore(STORE_HOTNEWS, { keyPath: 'id' });

      // ─── Memory Palace (记忆宫殿) stores ───
      if (!db.objectStoreNames.contains('memory_nodes')) {
          const mnStore = db.createObjectStore('memory_nodes', { keyPath: 'id' });
          mnStore.createIndex('charId', 'charId', { unique: false });
          mnStore.createIndex('room', 'room', { unique: false });
          mnStore.createIndex('embedded', 'embedded', { unique: false });
          mnStore.createIndex('boxId', 'boxId', { unique: false }); // deprecated，保留索引兼容旧数据
          mnStore.createIndex('eventBoxId', 'eventBoxId', { unique: false });
      } else {
          // Migration: 为已有 memory_nodes 表补建 eventBoxId 索引（v47 新增）
          const mnStore = (event.target as IDBOpenDBRequest).transaction?.objectStore('memory_nodes');
          if (mnStore && !mnStore.indexNames.contains('eventBoxId')) {
              try { mnStore.createIndex('eventBoxId', 'eventBoxId', { unique: false }); }
              catch (e) { console.log('memory_nodes eventBoxId index migration skipped'); }
          }
      }

      if (!db.objectStoreNames.contains('memory_vectors')) {
          const mvStore = db.createObjectStore('memory_vectors', { keyPath: 'memoryId' });
          mvStore.createIndex('charId', 'charId', { unique: false });
      } else {
          // Migration: add charId index to existing memory_vectors store
          const mvStore = (event.target as IDBOpenDBRequest).transaction?.objectStore('memory_vectors');
          if (mvStore && !mvStore.indexNames.contains('charId')) {
              try { mvStore.createIndex('charId', 'charId', { unique: false }); } catch (e) { console.log('memory_vectors charId index migration skipped'); }
          }
      }

      if (!db.objectStoreNames.contains('memory_links')) {
          const mlStore = db.createObjectStore('memory_links', { keyPath: 'id' });
          mlStore.createIndex('sourceId', 'sourceId', { unique: false });
          mlStore.createIndex('targetId', 'targetId', { unique: false });
      }

      if (!db.objectStoreNames.contains('memory_batches')) {
          const mbStore = db.createObjectStore('memory_batches', { keyPath: 'id' });
          mbStore.createIndex('charId', 'charId', { unique: false });
      }

      if (!db.objectStoreNames.contains('topic_boxes')) {
          const tbStore = db.createObjectStore('topic_boxes', { keyPath: 'id' });
          tbStore.createIndex('charId', 'charId', { unique: false });
          tbStore.createIndex('status', 'status', { unique: false });
      }

      if (!db.objectStoreNames.contains('anticipations')) {
          const antStore = db.createObjectStore('anticipations', { keyPath: 'id' });
          antStore.createIndex('charId', 'charId', { unique: false });
          antStore.createIndex('status', 'status', { unique: false });
      }

      // ─── EventBox（事件盒，v47 新增） ───────────────
      if (!db.objectStoreNames.contains('event_boxes')) {
          const ebStore = db.createObjectStore('event_boxes', { keyPath: 'id' });
          ebStore.createIndex('charId', 'charId', { unique: false });
      }

      // ─── 房间门牌（v65 新增，情景→语义固化层） ───────
      if (!db.objectStoreNames.contains('room_plates')) {
          const rpStore = db.createObjectStore('room_plates', { keyPath: 'id' });
          rpStore.createIndex('charId', 'charId', { unique: false });
      }

      // ─── 消化日志（v66 新增，认知消化可回看记录） ─────
      if (!db.objectStoreNames.contains('digest_reports')) {
          const drStore = db.createObjectStore('digest_reports', { keyPath: 'id' });
          drStore.createIndex('charId', 'charId', { unique: false });
      }

      // ─── v48 一次性强制清空记忆宫殿（EventBox 体系，旧 boxId 数据不兼容） ───
      //     oldVersion === 0 = 全新安装，没东西可清
      //     oldVersion >= 48 = 已经清过，跳过
      //     0 < oldVersion < 48 = 现有用户升级 → 清一次
      const oldVersion = event.oldVersion || 0;
      if (oldVersion > 0 && oldVersion < 48) {
          const upgradeTx = (event.target as IDBOpenDBRequest).transaction;
          const MP_STORES_TO_CLEAR = [
              'memory_nodes', 'memory_vectors', 'memory_links',
              'memory_batches', 'topic_boxes', 'anticipations', 'event_boxes',
          ];
          let cleared = 0;
          for (const name of MP_STORES_TO_CLEAR) {
              if (db.objectStoreNames.contains(name) && upgradeTx) {
                  try {
                      upgradeTx.objectStore(name).clear();
                      cleared++;
                  } catch (e) {
                      console.warn(`[DB v48 wipe] skip ${name}:`, e);
                  }
              }
          }
          // 同步清理 localStorage 里的高水位标记
          let hwmCleared = 0;
          try {
              const toRemove: string[] = [];
              for (let i = 0; i < localStorage.length; i++) {
                  const key = localStorage.key(i);
                  if (key && key.startsWith('mp_lastMsgId_')) toRemove.push(key);
              }
              for (const key of toRemove) { localStorage.removeItem(key); hwmCleared++; }
          } catch { /* ignore */ }
          console.log(`🗑️ [DB v48] 一次性清空完成：${cleared} 个 store，${hwmCleared} 个高水位（oldVersion=${oldVersion}）`);
      }

      // ─── Pixel Home（像素家园）stores ───────────────
      if (!db.objectStoreNames.contains('pixel_home_assets')) {
          const phaStore = db.createObjectStore('pixel_home_assets', { keyPath: 'id' });
          phaStore.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains('pixel_home_layouts')) {
          const phlStore = db.createObjectStore('pixel_home_layouts', { keyPath: ['charId', 'roomId'] });
          phlStore.createIndex('charId', 'charId', { unique: false });
      }
    };
  });

  dbPromise = promise;
  // Notify the app guard even when a background caller catches the rejection.
  void promise.catch(reportDatabaseFailure);
  return promise;
};

/**
 * 家园关系条读时迁移：早期格式是无序对 {aId,bId}（双方共用一个数值），
 * 现为有向 {fromId,toId}（你对ta ≠ ta对你）。旧边拆成两条对称有向边，数值/关系名照抄，
 * 之后各自的演绎会让两边自然分化。
 */
const normalizeWorldRelationships = (world: WorldProfile): WorldProfile => {
    const rels = world.relationships || [];
    if (!rels.some((r: any) => r.aId !== undefined)) return world;
    const out: WorldProfile['relationships'] = [];
    const has = (fromId: string, toId: string) => out.some(r => r.fromId === fromId && r.toId === toId);
    for (const r of rels as any[]) {
        if (r.aId !== undefined && r.bId !== undefined) {
            if (!has(r.aId, r.bId)) out.push({ fromId: r.aId, toId: r.bId, label: r.label, value: r.value ?? 50 });
            if (!has(r.bId, r.aId)) out.push({ fromId: r.bId, toId: r.aId, label: r.label, value: r.value ?? 50 });
        } else if (r.fromId !== undefined && r.toId !== undefined && !has(r.fromId, r.toId)) {
            out.push(r);
        }
    }
    return { ...world, relationships: out };
};

const idbRequest = <T,>(request: IDBRequest<T>): Promise<T> => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
});

const idbTransaction = (transaction: IDBTransaction): Promise<void> => new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
});

export const DB = {
  deleteDB: async (): Promise<void> => {
      // 删库前先关掉单例连接, 否则这条还开着的连接会 block 掉 deleteDatabase。
      if (dbPromise) {
          try { (await dbPromise).close(); } catch { /* ignore */ }
          dbPromise = null;
      }
      return new Promise((resolve, reject) => {
          const req = indexedDB.deleteDatabase(DB_NAME);
          req.onsuccess = () => resolve();
          req.onerror = () => reject(req.error);
          req.onblocked = () => console.warn('Delete blocked');
      });
  },

  getCharacter: async (id: string): Promise<CharacterProfile | undefined> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE_CHARACTERS, 'readonly').objectStore(STORE_CHARACTERS).get(id);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  },

  getAllCharacters: async (): Promise<CharacterProfile[]> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_CHARACTERS, 'readonly');
      const store = transaction.objectStore(STORE_CHARACTERS);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  },

  saveCharacter: async (character: CharacterProfile): Promise<void> => {
    const db = await openDB();
    return persistCharacterWithHomeMessages(db, character, clearStaleMemoryMirror);
  },

  /** An asynchronous evaluation updates only emotion fields, never its stale home/history snapshot. */
  saveCharacterEmotion: async (charId: string, activeBuffs: CharacterProfile['activeBuffs'], buffInjection: string): Promise<void> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CHARACTERS, 'readwrite');
      const store = tx.objectStore(STORE_CHARACTERS), get = store.get(charId);
      get.onsuccess = () => {if (get.result) store.put({...get.result, activeBuffs, buffInjection});};
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('情绪保存失败'));
    });
  },

  ensureStoryTheaterTimestamps: async () => ensureStoryTimelineRepair(await openDB()),

  ensureHomeContextMessages: async (charId: string): Promise<void> => {
    const db = await openDB();
    const migrated = await new Promise<boolean>((resolve, reject) => {
      const request = db.transaction(STORE_CHARACTERS, 'readonly').objectStore(STORE_CHARACTERS).get(charId);
      request.onsuccess = () => resolve(!request.result || request.result.homeContextBridgeVersion === 3);
      request.onerror = () => reject(request.error);
    });
    if (!migrated) await persistCharacterWithHomeMessages(db, charId, clearStaleMemoryMirror);
  },


  deleteCharacter: async (id: string): Promise<void> => {
    const db = await openDB();
    const transaction = db.transaction([STORE_CHARACTERS, STORE_CHARACTER_LIFE], 'readwrite');
    transaction.objectStore(STORE_CHARACTERS).delete(id);
    transaction.objectStore(STORE_CHARACTER_LIFE).delete(id);
  },

  getCharacterLife: async (charId: string): Promise<LifeState | null> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const request = db.transaction(STORE_CHARACTER_LIFE, 'readonly').objectStore(STORE_CHARACTER_LIFE).get(charId);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  },

  saveCharacterLife: async (state: LifeState): Promise<void> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_CHARACTER_LIFE, 'readwrite');
      tx.objectStore(STORE_CHARACTER_LIFE).put(state);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('角色生活状态保存中止'));
    });
  },

  // ---- 角色分组（神经链接"文件夹"，与群聊 groups 无关）----

  getCharacterGroups: async (): Promise<CharacterGroup[]> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      if (!db.objectStoreNames.contains(STORE_CHAR_GROUPS)) {
        resolve([]);
        return;
      }
      const transaction = db.transaction(STORE_CHAR_GROUPS, 'readonly');
      const request = transaction.objectStore(STORE_CHAR_GROUPS).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  },

  saveCharacterGroup: async (group: CharacterGroup): Promise<void> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_CHAR_GROUPS, 'readwrite');
      transaction.objectStore(STORE_CHAR_GROUPS).put(group);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('saveCharacterGroup aborted'));
    });
  },

  // 只删分组定义。组内角色的 groupId 回落由 OSContext.deleteCharacterGroup 负责
  // （角色 state 在 context 里，这里改了 DB 不改 state 会出现"删组后角色还挂在幽灵组里"）。
  deleteCharacterGroup: async (id: string): Promise<void> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_CHAR_GROUPS, 'readwrite');
      transaction.objectStore(STORE_CHAR_GROUPS).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  },

  /**
   * 获取角色的私聊消息。
   * @param includeProcessed 是否包含已被记忆宫殿处理的消息（默认 false，即自动过滤）。
   *                         记忆归档、批量总结等需要完整历史的场景应传 true。
   */
  getMessagesByCharId: async (charId: string, includeProcessed: boolean = false, sealHomeActions: boolean = false): Promise<Message[]> => {
    const db = await openDB();
    await ensureStoryTimelineRepair(db);
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_MESSAGES, sealHomeActions ? 'readwrite' : 'readonly');
      const store = transaction.objectStore(STORE_MESSAGES);
      const index = store.index('charId');
      const request = index.getAll(IDBKeyRange.only(charId));
      let snapshot: Message[] = [];
      request.onsuccess = () => {
          let results = (request.result || []).filter((m: Message) => !m.groupId);
          // A one-shot archive includes the tail. Freeze its home action segments
          // in the same transaction as the snapshot, before any LLM/network wait.
          if (sealHomeActions) for (const message of results) {
              if (message.metadata?.source === 'home' && message.metadata?.homeContextKind === 'actions' && !message.metadata.homeContextSealed) {
                  message.metadata = { ...message.metadata, homeContextSealed: true };
                  store.put(message);
              }
          }
          // 记忆宫殿：过滤已处理的消息（高水位标记之前的），用向量记忆替代
          if (!includeProcessed) {
              try {
                  const hwm = parseInt(localStorage.getItem(`mp_lastMsgId_${charId}`) || '0', 10);
                  if (hwm > 0) {
                      results = results.filter((m: Message) => m.id > hwm);
                  }
              } catch {}
          }
          snapshot = results;
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve(snapshot);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('聊天历史快照未能完成'));
    });
  },

  /** Strictly read-only private-chat snapshot for disposable generators. No timeline repair or sealing. */
  peekMessagesByCharId: async (charId: string): Promise<Message[]> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_MESSAGES, 'readonly');
      const request = transaction.objectStore(STORE_MESSAGES).index('charId').getAll(IDBKeyRange.only(charId));
      request.onsuccess = () => resolve((request.result as Message[]).filter(message => !message.groupId));
      request.onerror = () => reject(request.error);
    });
  },

  /** Recheck every source inside the same transaction before replacing the anchor and deleting fragments. */
  applyHtmlFormatRepair: async (plan: HtmlRepairPlan): Promise<Message> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_MESSAGES, 'readwrite');
      const store = transaction.objectStore(STORE_MESSAGES);
      const current: Message[] = [];
      let updated: Message | undefined;
      const fail = () => { try { transaction.abort(); } catch {} };
      const readNext = (index: number) => {
        if (index >= plan.sources.length) {
          const anchor = current[0];
          const pure = plan.segments.length === 1 && plan.segments[0].kind === 'html';
          const card = pure ? plan.segments[0] : undefined;
          updated = {
            ...anchor,
            type: 'html_card',
            content: plan.content,
            metadata: {
              ...anchor.metadata,
              ...(card?.kind === 'html' ? { htmlSource: card.html, htmlTextPreview: card.textPreview } : {}),
              ...(pure ? {} : { htmlRepairSegments: plan.segments }),
              htmlFormatRepair: {
                version: 1, repairedAt: Date.now(),
                sourceMessageIds: current.map(m => m.id),
                originalContents: current.map(m => ({ id: m.id, content: m.content, timestamp: m.timestamp })),
              },
            },
          };
          store.put(updated);
          for (const fragment of current.slice(1)) store.delete(fragment.id);
          return;
        }
        const expected = plan.sources[index];
        const request = store.get(expected.id);
        request.onsuccess = () => {
          const actual = request.result as Message | undefined;
          if (!actual || actual.content !== expected.content || actual.type !== 'text' ||
              actual.charId !== expected.charId || actual.role !== expected.role || actual.groupId ||
              actual.metadata?.withdrawal || actual.metadata?.htmlRepairSegments) { fail(); return; }
          current.push(actual);
          readNext(index + 1);
        };
      };
      readNext(0);
      transaction.oncomplete = () => updated ? resolve(updated) : reject(new Error('HTML repair was not applied'));
      transaction.onerror = () => reject(transaction.error || new Error('HTML repair failed'));
      transaction.onabort = () => reject(transaction.error || new Error('HTML repair aborted'));
    });
  },

  /**
   * 某个角色的聊天条数。走 charId 索引的 count()，**一条消息都不会被读出来**，
   * IndexedDB 只回一个数字。使用统计的规模档位用它，别拿 getMessagesByCharId
   * 去 length ——那会把整段聊天记录读进内存。
   */
  countMessagesByCharId: async (charId: string): Promise<number> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_MESSAGES, 'readonly');
      const request = transaction.objectStore(STORE_MESSAGES).index('charId').count(IDBKeyRange.only(charId));
      request.onsuccess = () => resolve(request.result || 0);
      request.onerror = () => reject(request.error);
    });
  },

  // Performance: Load only the most recent N messages for a character
  getRecentMessagesByCharId: async (charId: string, limit: number, includeProcessed: boolean = false): Promise<Message[]> => {
    const db = await openDB();
    await ensureStoryTimelineRepair(db);
    const hwm = includeProcessed ? 0 : (() => {
        try { return parseInt(localStorage.getItem(`mp_lastMsgId_${charId}`) || '0', 10) || 0; } catch { return 0; }
    })();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_MESSAGES, 'readonly');
      const store = transaction.objectStore(STORE_MESSAGES);
      const index = store.index('charId');
      const collected: Message[] = [];
      const cursorReq = index.openCursor(IDBKeyRange.only(charId), 'prev');
      cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor && collected.length < limit) {
              const m = cursor.value as Message;
              if (!m.groupId && (includeProcessed || m.id > hwm)) collected.push(m);
              cursor.continue();
          } else {
              resolve(collected.reverse());
          }
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
  },

  /** 倒序游标找到该角色最后一条符合会话列表口径的私聊消息；不会加载完整历史。 */
  getLatestPrivateMessageByCharId: async (
    charId: string,
    accept?: (message: Message) => boolean,
  ): Promise<Message | undefined> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_MESSAGES, 'readonly');
      const cursorReq = transaction.objectStore(STORE_MESSAGES).index('charId').openCursor(IDBKeyRange.only(charId), 'prev');
      cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) { resolve(undefined); return; }
          const message = cursor.value as Message;
          if (!message.groupId && (!accept || accept(message))) { resolve(message); return; }
          cursor.continue();
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
  },

  // DateApp 等按来源展示的轻量历史读取：用 charId 索引倒序扫，只收集目标 source 的最近 N 条。
  // 这样不会为了渲染见面阅读模式，把该角色全量聊天（含图片/base64消息）一次性 getAll 进内存。
  getRecentMessagesByCharIdAndSource: async (charId: string, source: string, limit: number, beforeId?: number): Promise<Message[]> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_MESSAGES, 'readonly');
      const store = transaction.objectStore(STORE_MESSAGES);
      const index = store.index('charId');
      const collected: Message[] = [];
      const cursorReq = index.openCursor(IDBKeyRange.only(charId), 'prev');
      cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor && collected.length < limit) {
              // Index duplicates are ordered by message primary key. Seek straight to
              // the page boundary instead of deserializing every newer message again.
              if (beforeId !== undefined && Number(cursor.primaryKey) >= beforeId) {
                  if (Number(cursor.primaryKey) > beforeId) cursor.continuePrimaryKey(charId, beforeId);
                  else cursor.continue();
                  return;
              }
              const m = cursor.value as Message;
              if (!m.groupId && m.metadata?.source === source) collected.push(m);
              cursor.continue();
          } else {
              resolve(collected.reverse());
          }
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
  },

  // 彼方动态专用：捞某角色全部 vr_card，不受"最近 N 条窗口"、记忆宫殿高水位
  // （mp_lastMsgId）、归档隐藏起点（char.hideBeforeMessageId）影响。
  // 这些机制只管「LLM 上下文能否看到」；彼方动态是用户自己的浏览界面，
  // 只要消息还在 IndexedDB 里就应当永远可见——哪怕它早被新聊天挤出聊天取数窗口、
  // 或被归档标记为「对 AI 隐藏」。（清空聊天会真删消息，删掉就没了——那是预期行为。）
  //
  // 性能：走 [charId, type] 复合索引直取 vr_card，成本只跟该角色 vr_card 条数相关，
  // 跟总消息量无关——上万条聊天的用户也不会把整段历史读进内存。
  getVRCardsByCharId: async (charId: string, limit?: number, accept: (message: Message) => boolean = () => true): Promise<Message[]> => {
    const db = await openDB();
    const indexed = db.transaction(STORE_MESSAGES, 'readonly').objectStore(STORE_MESSAGES).indexNames.contains('charId_type');
    return readLocalCursor<Message>(db, STORE_MESSAGES, {
      index: indexed ? 'charId_type' : 'charId',
      query: IDBKeyRange.only(indexed ? [charId, 'vr_card'] : charId),
      direction: limit === undefined && indexed ? 'next' : 'prev',
      limit: limit ?? (indexed ? undefined : 80),
      accept: m => !m.groupId && m.type === 'vr_card' && m.metadata?.vrCard && accept(m),
    });
  },

  /** Legacy market deduplication only needs IDs, never retain every card body. */
  getVRMarketEventIds: async (charId: string): Promise<string[]> => {
    const db = await openDB();
    const indexed = db.transaction(STORE_MESSAGES, 'readonly').objectStore(STORE_MESSAGES).indexNames.contains('charId_type');
    return readLocalCursor<string>(db, STORE_MESSAGES, {
      index: indexed ? 'charId_type' : 'charId',
      query: IDBKeyRange.only(indexed ? [charId, 'vr_card'] : charId),
      accept: m => !m.groupId && m.type === 'vr_card' && m.metadata?.vrCard && typeof m.metadata.marketEventId === 'string',
      map: m => m.metadata.marketEventId,
    });
  },

  // UI 的可见性判断只需要 ID；游标逐条丢弃正文，避免把图片和全量聊天留在内存。
  getPrivateMessageRefs: async (charId: string, limit: number, afterId = 0): Promise<Pick<Message, 'id' | 'groupId'>[]> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_MESSAGES, 'readonly');
      const refs: Pick<Message, 'id' | 'groupId'>[] = [];
      const req = tx.objectStore(STORE_MESSAGES).index('charId').openCursor(IDBKeyRange.only(charId), 'prev');
      req.onsuccess = () => {
        const cursor = req.result;
        if (!cursor || Number(cursor.primaryKey) <= afterId || refs.length >= limit) {
          resolve(refs.reverse());
          return;
        }
        const message = cursor.value as Message;
        if (!message.groupId) refs.push({ id: message.id });
        cursor.continue();
      };
      req.onerror = () => reject(req.error);
      tx.onabort = () => reject(tx.error || new Error('消息读取中断'));
    });
  },

  // UI 读取不受记忆水位影响。先按展示范围筛选，再凑满 N 条，避免见面/通话占满窗口。
  // totalCount 仍是廉价的索引计数上限；游标已取尽时，调用方用实际展示条数替代它。
  // keepFromId 保留正在阅读的起点，追加新消息不会把窗口顶部旧气泡裁掉。
  getRecentMessagesWithCount: async (charId: string, limit: number, accept?: (message: Message) => boolean, keepFromId?: number): Promise<{ messages: Message[], totalCount: number }> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_MESSAGES, 'readonly');
      const store = transaction.objectStore(STORE_MESSAGES);
      const index = store.index('charId');
      const countReq = index.count(IDBKeyRange.only(charId));
      countReq.onsuccess = () => {
          const totalCount = countReq.result;
          // Use reverse cursor to only collect the last N messages
          const collected: Message[] = [];
          const cursorReq = index.openCursor(IDBKeyRange.only(charId), 'prev');
          cursorReq.onsuccess = () => {
              const cursor = cursorReq.result;
              if (cursor && (collected.length < limit || (keepFromId !== undefined && Number(cursor.primaryKey) >= keepFromId))) {
                  const m = cursor.value as Message;
                  if (!m.groupId && (!accept || accept(m))) collected.push(m);
                  cursor.continue();
              } else {
                  resolve({ messages: collected.reverse(), totalCount });
              }
          };
          cursorReq.onerror = () => reject(cursorReq.error);
      };
      countReq.onerror = () => reject(countReq.error);
    });
  },

  // Get all messages for a character from a given message ID onward (for hideBeforeMessageId)
  getMessagesFromId: async (charId: string, fromId: number): Promise<{ messages: Message[], totalCount: number }> => {
    const db = await openDB();
    await ensureStoryTimelineRepair(db);
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_MESSAGES, 'readonly');
      const store = transaction.objectStore(STORE_MESSAGES);
      const index = store.index('charId');
      const collected: Message[] = [];
      const cursorReq = index.openCursor(IDBKeyRange.only(charId), 'prev');
      cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor && Number(cursor.primaryKey) >= fromId) {
              const m = cursor.value as Message;
              if (!m.groupId && m.id >= fromId) {
                  collected.push(m);
              }
              cursor.continue();
          } else {
              resolve({ messages: collected.reverse(), totalCount: collected.length });
          }
      };
      cursorReq.onerror = () => reject(cursorReq.error);
    });
  },

  saveMessage: async (msg: Omit<Message, 'id' | 'timestamp'> & { timestamp?: number }): Promise<number> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
        const transaction = db.transaction([STORE_MESSAGES, STORE_ASSETS], 'readwrite');
        const store = transaction.objectStore(STORE_MESSAGES);
        const timestamp = typeof msg.timestamp === 'number' ? msg.timestamp : Date.now();
        const { timestamp: _ignored, ...payload } = msg;
        const request = store.add({ ...payload, timestamp });
        request.onsuccess = () => clearStaleMemoryMirror(transaction, msg.charId, request.result as number);
        // request 成功后事务仍可能回滚。主动消息通知和定时任务销账都必须等提交。
        transaction.oncomplete = () => {
            const newId = request.result as number;
            if (msg.metadata?.source === 'story_theater_memory' && msg.metadata.theaterTimestampVersion !== 1) invalidateStoryTimelineRepair(db);
            // 水位线自愈：新消息的自增 id 必然大于既有一切消息 id，也就必然大于水位线
            // （水位线本身是某条旧消息的 id）。出现 newId ≤ 水位线，说明水位与消息
            // ID 序列不一致（例如清库/恢复后的残留）。镜像已在同事务内清理，提交后
            // 再清本地值，避免新消息从 AI 上下文消失（请求只剩 system → 上游 400）。
            try {
                const staleKeys = [`mp_lastMsgId_${msg.charId}`];
                if (msg.groupId) staleKeys.push(`mp_lastMsgId_group_${msg.groupId}`);
                for (const key of staleKeys) {
                    const hwm = parseInt(localStorage.getItem(key) || '0', 10) || 0;
                    if (hwm >= newId) localStorage.removeItem(key);
                }
            } catch { /* localStorage 不可用时静默跳过 */ }
            resolve(newId);
        };
        request.onerror = () => reject(request.error);
        transaction.onerror = () => reject(transaction.error || new Error('消息未能保存'));
        transaction.onabort = () => reject(transaction.error || new Error('消息未能保存'));
    });
  },

  /** Commit a single character's messages together, or leave the conversation unchanged. */
  saveMessagesAtomic: async (messages: Array<Omit<Message, 'id' | 'timestamp'> & { timestamp?: number }>): Promise<number[]> => {
    if (!messages.length) return [];
    const charId = messages[0].charId;
    if (!charId || messages.some(message => message.charId !== charId || 'id' in message)) {
      throw new Error('批量消息必须属于同一角色且不能复用旧 ID');
    }
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_MESSAGES, STORE_ASSETS], 'readwrite');
      const store = transaction.objectStore(STORE_MESSAGES);
      const ids: number[] = [];
      try {
        for (const message of messages) {
          const request = store.add({ ...message, timestamp: message.timestamp ?? Date.now() });
          request.onsuccess = () => {
            const id = request.result as number;
            ids.push(id);
            clearStaleMemoryMirror(transaction, charId, id);
          };
        }
      } catch (error) {
        transaction.abort();
        reject(error);
        return;
      }
      transaction.oncomplete = () => {
        try {
          const key = `mp_lastMsgId_${charId}`;
          if (parseInt(localStorage.getItem(key) || '0', 10) >= ids[0]) localStorage.removeItem(key);
        } catch { /* localStorage may be unavailable */ }
        resolve(ids);
      };
      transaction.onerror = () => reject(transaction.error || new Error('批量消息未能保存'));
      transaction.onabort = () => reject(transaction.error || new Error('批量消息已回滚'));
    });
  },

  /** One persisted message per logical delivery, including retries after a tab closes. */
  saveMessageOnce: async (deliveryId: string, msg: Omit<Message, 'id' | 'timestamp'> & { timestamp?: number }): Promise<number> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction([STORE_MESSAGES, STORE_ASSETS], 'readwrite');
      const store = tx.objectStore(STORE_MESSAGES);
      let savedId = 0;
      let inserted = false;
      const indexed = store.indexNames.contains('charId_deliveryId');
      const cursorRequest = store.index(indexed ? 'charId_deliveryId' : 'charId').openCursor(
        IDBKeyRange.only(indexed ? [msg.charId, deliveryId] : msg.charId), 'prev',
      );
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (cursor) {
          if (cursor.value.metadata?.deliveryId === deliveryId) { savedId = cursor.value.id; return; }
          cursor.continue(); return;
        }
        const request = store.add({ ...msg, timestamp: msg.timestamp ?? Date.now(), metadata: { ...msg.metadata, deliveryId } });
        request.onsuccess = () => {
          savedId = request.result as number;
          inserted = true;
          clearStaleMemoryMirror(tx, msg.charId, savedId);
        };
      };
      tx.oncomplete = () => {
        if (inserted) {
          try {
            for (const key of [`mp_lastMsgId_${msg.charId}`, ...(msg.groupId ? [`mp_lastMsgId_group_${msg.groupId}`] : [])]) {
              if (parseInt(localStorage.getItem(key) || '0', 10) >= savedId) localStorage.removeItem(key);
            }
          } catch { /* message was committed even if browser preferences are unavailable */ }
        }
        resolve(savedId);
      };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('消息未能保存'));
    });
  },

  updateMessage: async (id: number, content: string): Promise<void> => {
    const db = await openDB();
    const transaction = db.transaction(STORE_MESSAGES, 'readwrite');
    const store = transaction.objectStore(STORE_MESSAGES);
    
    // 同 saveAsset：等事务落盘再 resolve。put 发完就 resolve 的话，配额不足
    // （iOS Safari 常见）时改写静默丢失，界面上还是新内容、库里却是旧的。
    return new Promise((resolve, reject) => {
        const req = store.get(id);
        req.onsuccess = () => {
            const data = req.result as Message;
            if (data) {
                data.content = content;
                store.put(data);
            } else {
                reject(new Error('Message not found'));
            }
        };
        req.onerror = () => reject(req.error);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error('updateMessage transaction aborted'));
    });
  },

  // 历史裸状态回填用：content 与 metadata 在同一消息事务内同时更新，不出现
  // 「正文已剥、metadata 没写上」的半状态。不碰 id / timestamp / 其它字段。
  updateMessageContentAndMetadata: async (
    id: number,
    content: string,
    metadataUpdater: (prev: any) => any,
  ): Promise<void> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_MESSAGES, 'readwrite');
      const store = transaction.objectStore(STORE_MESSAGES);
      const req = store.get(id);
      req.onsuccess = () => {
        const data = req.result as Message | undefined;
        if (!data) {
          reject(new Error('Message not found'));
          return;
        }
        data.content = content;
        (data as any).metadata = metadataUpdater((data as any).metadata);
        store.put(data);
      };
      req.onerror = () => reject(req.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error || new Error('消息更新失败'));
      transaction.onabort = () => reject(transaction.error || new Error('消息更新已回滚'));
    });
  },

  getMessageById: async (id: number): Promise<Message | null> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_MESSAGES, 'readonly');
      const request = transaction.objectStore(STORE_MESSAGES).get(id);
      request.onsuccess = () => resolve((request.result as Message | undefined) || null);
      request.onerror = () => reject(request.error);
    });
  },

  findImageMessageByUrl: async (charId: string, url: string): Promise<Message | null> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_MESSAGES, 'readonly');
      const request = transaction.objectStore(STORE_MESSAGES).index('charId').openCursor(IDBKeyRange.only(charId));
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          resolve(null);
          return;
        }
        const message = cursor.value as Message;
        if (!message.groupId && message.type === 'image' && message.content === url) {
          resolve(message);
          return;
        }
        cursor.continue();
      };
      request.onerror = () => reject(request.error);
    });
  },

  updateMessageMetadata: async (id: number, updater: (prev: any, message: Message) => any): Promise<void> => {
    const db = await openDB();
    const transaction = db.transaction(STORE_MESSAGES, 'readwrite');
    const store = transaction.objectStore(STORE_MESSAGES);

    return new Promise((resolve, reject) => {
        const req = store.get(id);
        req.onsuccess = () => {
            const data = req.result as Message | undefined;
            if (data) {
                (data as any).metadata = updater((data as any).metadata, data);
                store.put(data);
            } else {
                reject(new Error('Message not found'));
            }
        };
        req.onerror = () => reject(req.error);
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error || new Error('消息更新失败'));
        transaction.onabort = () => reject(transaction.error || new Error('消息更新已回滚'));
    });
  },

  deleteMessage: async (id: number): Promise<void> => {
    const { preserveContentFavoritesBeforeMessageDeletion } = await import('./contentFavorites');
    await preserveContentFavoritesBeforeMessageDeletion({ ids: [id] });
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_MESSAGES, 'readwrite');
      deleteSecretNotesForIds(transaction.objectStore(STORE_MESSAGES), [id]);
      transaction.objectStore(STORE_MESSAGES).delete(id);
      transaction.oncomplete = () => {announceSecretNotesChanged(); resolve();};
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('deleteMessage aborted'));
    });
  },

  deleteMessages: async (ids: number[]): Promise<void> => {
      if (!ids.length) return;
      const { preserveContentFavoritesBeforeMessageDeletion } = await import('./contentFavorites');
      await preserveContentFavoritesBeforeMessageDeletion({ ids });
      const db = await openDB();
      const transaction = db.transaction(STORE_MESSAGES, 'readwrite');
      const store = transaction.objectStore(STORE_MESSAGES);
      deleteSecretNotesForIds(store, ids);
      ids.forEach(id => store.delete(id));
      return new Promise((resolve, reject) => {
          transaction.oncomplete = () => {announceSecretNotesChanged(); resolve();};
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error || new Error('deleteMessages aborted'));
      });
  },

  clearMessages: async (charId: string): Promise<void> => {
    const { preserveContentFavoritesBeforeMessageDeletion } = await import('./contentFavorites');
    await preserveContentFavoritesBeforeMessageDeletion({ charId });
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_MESSAGES, 'readwrite');
      const store = transaction.objectStore(STORE_MESSAGES);
      const index = store.index('charId');
      const request = index.openCursor(IDBKeyRange.only(charId));

      request.onsuccess = () => {
        const cursor = request.result;
        if (cursor) {
            const m = cursor.value as Message;
            if (!m.groupId) {
                store.delete(cursor.primaryKey);
            }
            cursor.continue();
        }
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => {announceSecretNotesChanged(charId); resolve();};
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('clearMessages aborted'));
    });
  },

  getGroups: async (): Promise<GroupProfile[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_GROUPS)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_GROUPS, 'readonly');
          const store = transaction.objectStore(STORE_GROUPS);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveGroup: async (group: GroupProfile): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_GROUPS, 'readwrite');
      transaction.objectStore(STORE_GROUPS).put(group);
  },

  deleteGroup: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_GROUPS, 'readwrite');
      transaction.objectStore(STORE_GROUPS).delete(id);
  },

  getGroupMessages: async (groupId: string): Promise<Message[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_MESSAGES, 'readonly');
          const store = transaction.objectStore(STORE_MESSAGES);
          const index = store.index('groupId');
          const request = index.getAll(IDBKeyRange.only(groupId));
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  // 阅读历史时允许窗口随新消息增长；未传 keepFromId 的调用继续只取最近 limit 条。
  getRecentGroupMessagesWithCount: async (groupId: string, limit: number, keepFromId?: number): Promise<{ messages: Message[], totalCount: number }> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_MESSAGES, 'readonly');
          const store = transaction.objectStore(STORE_MESSAGES);
          const index = store.index('groupId');
          const countReq = index.count(IDBKeyRange.only(groupId));
          countReq.onsuccess = () => {
              const totalCount = countReq.result;
              const collected: Message[] = [];
              const cursorReq = index.openCursor(IDBKeyRange.only(groupId), 'prev');
              cursorReq.onsuccess = () => {
                  const cursor = cursorReq.result;
                  if (cursor && (collected.length < limit || (keepFromId !== undefined && Number(cursor.primaryKey) >= keepFromId))) {
                      collected.push(cursor.value as Message);
                      cursor.continue();
                  } else {
                      resolve({ messages: collected.reverse(), totalCount });
                  }
              };
              cursorReq.onerror = () => reject(cursorReq.error);
          };
          countReq.onerror = () => reject(countReq.error);
      });
  },

  /** 倒序游标读取群的最后一条消息；不会加载完整群史。 */
  getLatestGroupMessageByGroupId: async (
    groupId: string,
    accept?: (message: Message) => boolean,
  ): Promise<Message | undefined> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_MESSAGES, 'readonly');
          const cursorReq = transaction.objectStore(STORE_MESSAGES).index('groupId').openCursor(IDBKeyRange.only(groupId), 'prev');
          cursorReq.onsuccess = () => {
              const cursor = cursorReq.result;
              if (!cursor) { resolve(undefined); return; }
              const message = cursor.value as Message;
              if (!accept || accept(message)) { resolve(message); return; }
              cursor.continue();
          };
          cursorReq.onerror = () => reject(cursorReq.error);
      });
  },

  getLatestGroupMessageId: async (groupId: string): Promise<number> =>
      (await DB.getLatestGroupMessageByGroupId(groupId))?.id || 0,

  getSocialPosts: async (): Promise<SocialPost[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_SOCIAL_POSTS)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_SOCIAL_POSTS, 'readonly');
          const store = transaction.objectStore(STORE_SOCIAL_POSTS);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveSocialPost: async (post: SocialPost): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_SOCIAL_POSTS, 'readwrite');
      transaction.objectStore(STORE_SOCIAL_POSTS).put(post);
  },

  deleteSocialPost: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_SOCIAL_POSTS, 'readwrite');
      transaction.objectStore(STORE_SOCIAL_POSTS).delete(id);
  },

  clearSocialPosts: async (): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_SOCIAL_POSTS, 'readwrite');
      transaction.objectStore(STORE_SOCIAL_POSTS).clear();
  },

  getEmojis: async (): Promise<Emoji[]> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_EMOJIS, 'readonly');
      const store = transaction.objectStore(STORE_EMOJIS);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  },

  saveEmoji: async (name: string, url: string, categoryId?: string): Promise<void> => {
    const db = await openDB();
    // 同 saveAsset：等事务真正落盘并把失败抛出去。发完 put 就返回的话，配额不足
    // （iOS Safari 常见）时写入静默丢失，「一键优化」还会照报「已转 N 张」。
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_EMOJIS, 'readwrite');
      transaction.objectStore(STORE_EMOJIS).put({ name, url, categoryId });
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('saveEmoji transaction aborted'));
    });
  },

  touchEmoji: async (name: string, lastUsedAt = Date.now()): Promise<void> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_EMOJIS, 'readwrite');
      const store = transaction.objectStore(STORE_EMOJIS);
      const request = store.get(name);
      request.onsuccess = () => {
        const emoji = request.result as Emoji | undefined;
        if (emoji) store.put({ ...emoji, lastUsedAt });
      };
      request.onerror = () => reject(request.error);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  },

  deleteEmoji: async (name: string): Promise<void> => {
    const db = await openDB();
    const transaction = db.transaction(STORE_EMOJIS, 'readwrite');
    transaction.objectStore(STORE_EMOJIS).delete(name);
  },

  // 表情包重命名: name 是主键, 改名 = 删旧键 + 写新键 (保留 url / categoryId)。
  // 新名为空、与旧名相同、或已被占用都会抛错, 让调用方提示用户。
  renameEmoji: async (oldName: string, newName: string): Promise<void> => {
    const trimmed = newName.trim();
    if (!trimmed) throw new Error('表情包名称不能为空');
    if (trimmed === oldName) return;
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_EMOJIS, 'readwrite');
      const store = tx.objectStore(STORE_EMOJIS);
      const getReq = store.get(oldName);
      getReq.onsuccess = () => {
        const record = getReq.result as Emoji | undefined;
        if (!record) { reject(new Error('未找到要重命名的表情包')); return; }
        const dupReq = store.get(trimmed);
        dupReq.onsuccess = () => {
          if (dupReq.result) { reject(new Error('已存在同名表情包')); return; }
          store.delete(oldName);
          store.put({ ...record, name: trimmed });
        };
        dupReq.onerror = () => reject(dupReq.error);
      };
      getReq.onerror = () => reject(getReq.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  },

  getEmojiCategories: async (): Promise<EmojiCategory[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          if (!db.objectStoreNames.contains(STORE_EMOJI_CATEGORIES)) {
              resolve([]);
              return;
          }
          const transaction = db.transaction(STORE_EMOJI_CATEGORIES, 'readonly');
          const store = transaction.objectStore(STORE_EMOJI_CATEGORIES);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveEmojiCategory: async (category: EmojiCategory): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_EMOJI_CATEGORIES, 'readwrite');
      transaction.objectStore(STORE_EMOJI_CATEGORIES).put(category);
  },

  deleteEmojiCategory: async (id: string): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction([STORE_EMOJI_CATEGORIES, STORE_EMOJIS], 'readwrite');
      tx.objectStore(STORE_EMOJI_CATEGORIES).delete(id);
      const emojiStore = tx.objectStore(STORE_EMOJIS);
      const request = emojiStore.getAll();
      request.onsuccess = () => {
          const allEmojis = request.result as Emoji[];
          allEmojis.forEach(e => {
              if (e.categoryId === id) {
                  emojiStore.delete(e.name);
              }
          });
      };
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
      });
  },

  // 「幽灵表情包」清理：删角色不会级联清理表情分类，导致只对已删角色可见的
  // 专属分类在单聊面板里被过滤掉（看不到也删不掉），却仍会出现在群聊表情面板
  // 和 AI 提示词里。按「现存角色 id 白名单」做三件事：
  //   1. 分类绑定里指向已删角色的 id → 剔除（部分失效只修绑定，不动表情）
  //   2. 剔除后一个角色都不剩的非系统分类 → 整个删除，连同分类下所有表情
  //   3. categoryId 指向已不存在分类的表情 → 删除（无主表情）
  // dryRun=true 只扫描统计、不落库，供 UI 做「先扫描再确认」。
  cleanupEmojiResidue: async (
      validCharacterIds: string[],
      options: { dryRun?: boolean } = {}
  ): Promise<{
      removedCategories: { id: string; name: string }[];
      fixedCategories: { id: string; name: string }[];
      removedEmojiCount: number;
  }> => {
      const validIds = new Set(validCharacterIds);
      const [categories, emojis] = await Promise.all([DB.getEmojiCategories(), DB.getEmojis()]);

      const removedCategories: { id: string; name: string }[] = [];
      const fixedCategories: EmojiCategory[] = [];
      for (const cat of categories) {
          if (!cat.allowedCharacterIds || cat.allowedCharacterIds.length === 0) continue; // 全员可见，不动
          const alive = cat.allowedCharacterIds.filter(cid => validIds.has(cid));
          if (alive.length === cat.allowedCharacterIds.length) continue; // 绑定全部有效
          if (alive.length === 0 && !cat.isSystem) {
              removedCategories.push({ id: cat.id, name: cat.name });
          } else {
              // 系统分类绑定全失效时也走这里：清空绑定回落「全员可见」，绝不删系统分类
              fixedCategories.push({ ...cat, allowedCharacterIds: alive });
          }
      }

      const removedCatIds = new Set(removedCategories.map(c => c.id));
      const remainingCatIds = new Set(categories.map(c => c.id).filter(id => !removedCatIds.has(id)));
      const emojisToDelete = emojis.filter(e => e.categoryId && !remainingCatIds.has(e.categoryId));

      if (!options.dryRun && (removedCategories.length || fixedCategories.length || emojisToDelete.length)) {
          const db = await openDB();
          const tx = db.transaction([STORE_EMOJI_CATEGORIES, STORE_EMOJIS], 'readwrite');
          const catStore = tx.objectStore(STORE_EMOJI_CATEGORIES);
          const emojiStore = tx.objectStore(STORE_EMOJIS);
          removedCategories.forEach(c => catStore.delete(c.id));
          fixedCategories.forEach(c => catStore.put(c));
          emojisToDelete.forEach(e => emojiStore.delete(e.name));
          await new Promise<void>((resolve, reject) => {
              tx.oncomplete = () => resolve();
              tx.onerror = () => reject(tx.error);
              tx.onabort = () => reject(tx.error);
          });
      }

      return {
          removedCategories,
          fixedCategories: fixedCategories.map(c => ({ id: c.id, name: c.name })),
          removedEmojiCount: emojisToDelete.length,
      };
  },

  initializeEmojiData: async (): Promise<void> => {
      const cats = await DB.getEmojiCategories();
      // 巧妙利用 UI 强制保留 default 分类的特性：
      // 只要初始化过一次，cats.length 至少为 1（必然包含 default）。
      // 只有全量清空的首次安装，cats.length 才为 0。这样无需 localStorage 即可避免内置分类无限复活。
      if (cats.length === 0) {
          await DB.saveEmojiCategory({ id: 'default', name: '默认', isSystem: true });
          // 去掉 isSystem 标记，允许用户在 UI 里直接删除此分类
          await DB.saveEmojiCategory({ id: SULLY_CATEGORY_ID, name: 'Sully 专属', isSystem: false });
          const db = await openDB();
          const tx = db.transaction(STORE_EMOJIS, 'readwrite');
          const store = tx.objectStore(STORE_EMOJIS);
          SULLY_PRESET_EMOJIS.forEach(emoji => store.put(emoji));
          await new Promise(resolve => { tx.oncomplete = resolve; });
      }
  },

  getThemes: async (): Promise<ChatTheme[]> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_THEMES, 'readonly');
      const store = transaction.objectStore(STORE_THEMES);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  },

  saveTheme: async (theme: ChatTheme): Promise<void> => {
    const db = await openDB();
    // 同 saveAsset：等事务落盘，配额不足时把错误抛给调用方，别让主题「保存成功」是假的。
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_THEMES, 'readwrite');
      transaction.objectStore(STORE_THEMES).put(theme);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('saveTheme transaction aborted'));
    });
  },

  deleteTheme: async (id: string): Promise<void> => {
    const db = await openDB();
    const transaction = db.transaction(STORE_THEMES, 'readwrite');
    transaction.objectStore(STORE_THEMES).delete(id);
  },

  getAllAssets: async (): Promise<{id: string, data: string}[]> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_ASSETS, 'readonly');
      const store = transaction.objectStore(STORE_ASSETS);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  },

  getAsset: async (id: string): Promise<string | null> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_ASSETS, 'readonly');
          const store = transaction.objectStore(STORE_ASSETS);
          const request = store.get(id);
          request.onsuccess = () => resolve(request.result?.data || null);
          request.onerror = () => reject(request.error);
      });
  },

  saveAsset: async (id: string, data: string): Promise<void> => {
    const db = await openDB();
    // 等事务真正落盘并把失败抛出去：旧实现发完 put 就返回，配额不足（iOS Safari 常见）
    // 时写入静默丢失，调用方还以为保存成功了。
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(STORE_ASSETS, 'readwrite');
        transaction.objectStore(STORE_ASSETS).put({ id, data });
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
    });
  },

  // Commit a preset together with its provenance so a failed save cannot advance its version.
  saveAssetBatch: async (entries: Array<{id:string;data:string}>): Promise<void> => {
    const db=await openDB();
    return new Promise((resolve,reject)=>{
      const transaction=db.transaction(STORE_ASSETS,'readwrite');
      const store=transaction.objectStore(STORE_ASSETS);
      for(const entry of entries)store.put(entry);
      transaction.oncomplete=()=>resolve();
      transaction.onerror=()=>reject(transaction.error);
      transaction.onabort=()=>reject(transaction.error||new Error('Asset batch aborted'));
    });
  },

  getAssetRaw: async (id: string): Promise<any | null> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_ASSETS, 'readonly');
          const store = transaction.objectStore(STORE_ASSETS);
          const request = store.get(id);
          request.onsuccess = () => resolve(request.result?.data ?? null);
          request.onerror = () => reject(request.error);
      });
  },

  saveAssetRaw: async (id: string, data: any): Promise<void> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_ASSETS, 'readwrite');
          transaction.objectStore(STORE_ASSETS).put({ id, data });
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error || new Error('saveAssetRaw transaction aborted'));
      });
  },

  deleteAsset: async (id: string): Promise<void> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_ASSETS, 'readwrite');
      transaction.objectStore(STORE_ASSETS).delete(id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('deleteAsset aborted'));
    });
  },

  // ─── Blob 资源（图片二进制，见 utils/blobRef.ts）───────────────
  // IndexedDB 原生支持存 Blob（结构化克隆），比 base64 省 ~33% 空间、不占 JS 堆，
  // 读出后用 URL.createObjectURL 渲染即可。旧库（<v65）可能还没有此 store，读操作做空兜底。
  getBlobAsset: async (id: string): Promise<Blob | null> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_BLOB_ASSETS)) return null;
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_BLOB_ASSETS, 'readonly');
          const store = transaction.objectStore(STORE_BLOB_ASSETS);
          const request = store.get(id);
          request.onsuccess = () => resolve((request.result?.blob as Blob) ?? null);
          request.onerror = () => reject(request.error);
      });
  },

  putBlobAsset: async (id: string, blob: Blob): Promise<void> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_BLOB_ASSETS, 'readwrite');
          transaction.objectStore(STORE_BLOB_ASSETS).put({ id, blob });
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error || new Error('putBlobAsset aborted'));
      });
  },

  deleteBlobAsset: async (id: string): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_BLOB_ASSETS)) return;
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_BLOB_ASSETS, 'readwrite');
          transaction.objectStore(STORE_BLOB_ASSETS).delete(id);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error || new Error('deleteBlobAsset aborted'));
      });
  },

  // 只列 blobRef 命名空间的 id（img_ 存量 / b_ SDK 新生成）。blob_assets 是混用表，
  // GC 的世界观必须限制在自己的前缀内；今后往这张表加新 id 族时不得使用这两个前缀。
  listBlobAssetIds: async (): Promise<string[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_BLOB_ASSETS)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_BLOB_ASSETS, 'readonly');
          const store = transaction.objectStore(STORE_BLOB_ASSETS);
          const request = store.getAllKeys();
          request.onsuccess = () => {
              const keys = request.result || [];
              resolve(keys.filter((k): k is string =>
                  typeof k === 'string' && (k.startsWith('img_') || k.startsWith('b_'))
              ));
          };
          request.onerror = () => reject(request.error);
      });
  },

  // 按主键升序分页读一个 store 的行（afterKey 传 null 从头开始）。给 GC 的引用面
  // 枚举用（utils/blobGc.ts）：async generator 每次 yield 都会挂起、IDB 事务撑不过
  // 挂起，游标没法跨 yield 拿着用，只能每批开一个新的 readonly 事务。
  // 注意：枚举失败必须把错误抛出去——GC 的安全阀靠它整轮放弃，吞错静默返回空
  // 等于「这张表没有引用」，会把活图当孤儿删掉。
  getStoreRowsPage: async (
      storeName: string,
      afterKey: IDBValidKey | null,
      limit: number,
  ): Promise<{ rows: unknown[]; lastKey: IDBValidKey | null }> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(storeName)) return { rows: [], lastKey: null };
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(storeName, 'readonly');
          const store = transaction.objectStore(storeName);
          const range = afterKey === null ? undefined : IDBKeyRange.lowerBound(afterKey, true);
          // 同一事务里 getAll + getAllKeys：行给引用扫描，键尾巴当下一页的起点。
          const rowsRequest = store.getAll(range, limit);
          const keysRequest = store.getAllKeys(range, limit);
          let rows: unknown[] | null = null;
          let keys: IDBValidKey[] | null = null;
          const maybeResolve = () => {
              if (rows !== null && keys !== null) {
                  resolve({ rows, lastKey: keys.at(-1) ?? null });
              }
          };
          rowsRequest.onsuccess = () => { rows = rowsRequest.result || []; maybeResolve(); };
          keysRequest.onsuccess = () => { keys = keysRequest.result || []; maybeResolve(); };
          rowsRequest.onerror = () => reject(rowsRequest.error);
          keysRequest.onerror = () => reject(keysRequest.error);
          transaction.onabort = () => reject(transaction.error || new Error('getStoreRowsPage aborted'));
      });
  },

  // 数一张表有多少行，不读行里的内容。给「优化资源存储」算进度条总数用
  // （utils/storageOptimize.ts）：那几张表加起来能有几十 MB，只为算个总数就整表读进内存太亏，
  // count() 只回行数，代价跟表里存了多大的图基本无关。
  // 表不存在时返回 0，跟 getStoreRowsPage 的空页兜底一个口径：没有这张表 = 没有行。
  countStoreRows: async (storeName: string): Promise<number> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(storeName)) return 0;
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(storeName, 'readonly');
          const request = transaction.objectStore(storeName).count();
          request.onsuccess = () => resolve(request.result || 0);
          request.onerror = () => reject(request.error);
          transaction.onabort = () => reject(transaction.error || new Error('countStoreRows aborted'));
      });
  },

  /**
   * 通用整行写回（引用改写用，见 utils/blobDedupe.ts）。传进来的必须是从同一张表读出、
   * 原地改过的行——引用面那 7 张表都是 inline keyPath，put(row) 自带主键，不会另起新行。
   * 一页一个事务：中途失败时先前提交的页不回滚，但引用改写是幂等的（同一份 mapping
   * 再跑一遍结果相同），重跑即可补齐。
   */
  putStoreRows: async (storeName: string, rows: unknown[]): Promise<void> => {
      if (rows.length === 0) return;
      const db = await openDB();
      if (!db.objectStoreNames.contains(storeName)) return;
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(storeName, 'readwrite');
          const store = transaction.objectStore(storeName);
          for (const row of rows) store.put(row as any);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error || new Error(`putStoreRows(${storeName}) aborted`));
      });
  },

  getJournalStickers: async (): Promise<{name: string, url: string}[]> => {
    const db = await openDB();
    if (!db.objectStoreNames.contains(STORE_JOURNAL_STICKERS)) return [];
    return new Promise((resolve, reject) => {
      const transaction = db.transaction(STORE_JOURNAL_STICKERS, 'readonly');
      const store = transaction.objectStore(STORE_JOURNAL_STICKERS);
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error);
    });
  },

  saveJournalSticker: async (name: string, url: string): Promise<void> => {
    const db = await openDB();
    const transaction = db.transaction(STORE_JOURNAL_STICKERS, 'readwrite');
    transaction.objectStore(STORE_JOURNAL_STICKERS).put({ name, url });
  },

  deleteJournalSticker: async (name: string): Promise<void> => {
    const db = await openDB();
    const transaction = db.transaction(STORE_JOURNAL_STICKERS, 'readwrite');
    transaction.objectStore(STORE_JOURNAL_STICKERS).delete(name);
  },

  saveGalleryImage: async (img: GalleryImage): Promise<void> => {
      const db = await openDB();
      // 同 saveAsset：等事务落盘并把失败抛出去，配额不足时不再静默丢图。
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_GALLERY, 'readwrite');
          transaction.objectStore(STORE_GALLERY).put(img);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error || new Error('saveGalleryImage transaction aborted'));
      });
  },

  getGalleryImages: async (charId?: string): Promise<GalleryImage[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_GALLERY, 'readonly');
          const store = transaction.objectStore(STORE_GALLERY);
          let request;
          if (charId) {
              const index = store.index('charId');
              request = index.getAll(IDBKeyRange.only(charId));
          } else {
              request = store.getAll();
          }
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  getGalleryImageById: async (id: string): Promise<GalleryImage | null> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_GALLERY, 'readonly');
          const request = transaction.objectStore(STORE_GALLERY).get(id);
          request.onsuccess = () => resolve((request.result as GalleryImage | undefined) || null);
          request.onerror = () => reject(request.error);
      });
  },

  findGalleryImageBySourceMessageId: async (charId: string, messageId: number): Promise<GalleryImage | null> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_GALLERY, 'readonly');
          const request = transaction.objectStore(STORE_GALLERY).index('charId').openCursor(IDBKeyRange.only(charId));
          request.onsuccess = () => {
              const cursor = request.result;
              if (!cursor) {
                  resolve(null);
                  return;
              }
              const image = cursor.value as GalleryImage;
              if (image.sourceMessageId === messageId) {
                  resolve(image);
                  return;
              }
              cursor.continue();
          };
          request.onerror = () => reject(request.error);
      });
  },

  findGalleryImageByUrl: async (charId: string, url: string): Promise<GalleryImage | null> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_GALLERY, 'readonly');
          const request = transaction.objectStore(STORE_GALLERY).index('charId').openCursor(IDBKeyRange.only(charId));
          request.onsuccess = () => {
              const cursor = request.result;
              if (!cursor) {
                  resolve(null);
                  return;
              }
              const image = cursor.value as GalleryImage;
              if (image.url === url) {
                  resolve(image);
                  return;
              }
              cursor.continue();
          };
          request.onerror = () => reject(request.error);
      });
  },

  updateGalleryImageReview: async (id: string, review: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_GALLERY, 'readwrite');
      const store = transaction.objectStore(STORE_GALLERY);
      return new Promise((resolve, reject) => {
          const req = store.get(id);
          req.onsuccess = () => {
              const data = req.result as GalleryImage;
              if (data) {
                  data.review = review;
                  data.reviewTimestamp = Date.now();
                  store.put(data);
                  resolve();
              } else reject(new Error('Image not found'));
          };
          req.onerror = () => reject(req.error);
      });
  },

  deleteGalleryImage: async (id: string): Promise<void> => {
      const { preserveContentFavoritesBeforeGalleryDeletion } = await import('./contentFavorites');
      await preserveContentFavoritesBeforeGalleryDeletion({ ids: [id] });
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_GALLERY, 'readwrite');
          transaction.objectStore(STORE_GALLERY).delete(id);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error || new Error('deleteGalleryImage aborted'));
      });
  },

  // --- XHS Stock Images ---
  getXhsStockImages: async (): Promise<XhsStockImage[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_XHS_STOCK, 'readonly');
          const request = transaction.objectStore(STORE_XHS_STOCK).getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveXhsStockImage: async (img: XhsStockImage): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_XHS_STOCK, 'readwrite');
      transaction.objectStore(STORE_XHS_STOCK).put(img);
  },

  deleteXhsStockImage: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_XHS_STOCK, 'readwrite');
      transaction.objectStore(STORE_XHS_STOCK).delete(id);
  },

  updateXhsStockImageUsage: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_XHS_STOCK, 'readwrite');
      const store = transaction.objectStore(STORE_XHS_STOCK);
      return new Promise((resolve, reject) => {
          const req = store.get(id);
          req.onsuccess = () => {
              const data = req.result as XhsStockImage;
              if (data) {
                  data.usedCount = (data.usedCount || 0) + 1;
                  data.lastUsedAt = Date.now();
                  store.put(data);
                  resolve();
              } else reject(new Error('Stock image not found'));
          };
          req.onerror = () => reject(req.error);
      });
  },

  // --- XHS Activities (Free Roam) ---
  saveXhsActivity: async (activity: XhsActivityRecord): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_XHS_ACTIVITIES, 'readwrite');
      transaction.objectStore(STORE_XHS_ACTIVITIES).put(activity);
  },

  getXhsActivities: async (characterId: string, limit?: number): Promise<XhsActivityRecord[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_XHS_ACTIVITIES, 'readonly');
          const store = transaction.objectStore(STORE_XHS_ACTIVITIES);
          const index = store.index('characterId');
          const request = index.getAll(IDBKeyRange.only(characterId));
          request.onsuccess = () => {
              let results = (request.result || []) as XhsActivityRecord[];
              results.sort((a, b) => b.timestamp - a.timestamp);
              if (limit) results = results.slice(0, limit);
              resolve(results);
          };
          request.onerror = () => reject(request.error);
      });
  },

  getAllXhsActivities: async (): Promise<XhsActivityRecord[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_XHS_ACTIVITIES, 'readonly');
          const request = transaction.objectStore(STORE_XHS_ACTIVITIES).getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  deleteXhsActivity: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_XHS_ACTIVITIES, 'readwrite');
      transaction.objectStore(STORE_XHS_ACTIVITIES).delete(id);
  },

  clearXhsActivities: async (characterId: string): Promise<void> => {
      const activities = await DB.getXhsActivities(characterId);
      const db = await openDB();
      const transaction = db.transaction(STORE_XHS_ACTIVITIES, 'readwrite');
      const store = transaction.objectStore(STORE_XHS_ACTIVITIES);
      for (const a of activities) {
          store.delete(a.id);
      }
  },

  // --- XHS Character Profiles (durable ownership, independent from activity history) ---
  saveXhsOwnedPost: async (post: XhsOwnedPost): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_XHS_OWNED_POSTS)) return;
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_XHS_OWNED_POSTS, 'readwrite');
          tx.objectStore(STORE_XHS_OWNED_POSTS).put(post);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('保存角色小红书帖子失败'));
          tx.onabort = () => reject(tx.error || new Error('保存角色小红书帖子被中止'));
      });
  },

  getXhsOwnedPosts: async (characterId: string): Promise<XhsOwnedPost[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_XHS_OWNED_POSTS)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_XHS_OWNED_POSTS, 'readonly');
          const request = tx.objectStore(STORE_XHS_OWNED_POSTS).index('characterId').getAll(IDBKeyRange.only(characterId));
          request.onsuccess = () => {
              const posts = (request.result || []) as XhsOwnedPost[];
              posts.sort((a, b) => b.publishedAt - a.publishedAt);
              resolve(posts);
          };
          request.onerror = () => reject(request.error || tx.error);
      });
  },

  getAllXhsOwnedPosts: async (): Promise<XhsOwnedPost[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_XHS_OWNED_POSTS)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_XHS_OWNED_POSTS, 'readonly');
          const request = tx.objectStore(STORE_XHS_OWNED_POSTS).getAll();
          request.onsuccess = () => resolve((request.result || []) as XhsOwnedPost[]);
          request.onerror = () => reject(request.error || tx.error);
      });
  },

  saveScheduledMessage: async (msg: ScheduledMessage): Promise<void> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_SCHEDULED, 'readwrite');
          transaction.objectStore(STORE_SCHEDULED).put(msg);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error || new Error('定时消息未能保存'));
          transaction.onabort = () => reject(transaction.error || new Error('定时消息未能保存'));
      });
  },

  getDueScheduledMessages: async (charId: string): Promise<ScheduledMessage[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_SCHEDULED, 'readonly');
          const store = transaction.objectStore(STORE_SCHEDULED);
          const index = store.index('charId');
          const request = index.getAll(IDBKeyRange.only(charId));
          request.onsuccess = () => {
              const all = request.result as ScheduledMessage[];
              const now = Date.now();
              const due = all.filter(m => m.dueAt <= now);
              resolve(due);
          };
          request.onerror = () => reject(request.error);
      });
  },

  deleteScheduledMessage: async (id: string): Promise<void> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_SCHEDULED, 'readwrite');
          transaction.objectStore(STORE_SCHEDULED).delete(id);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error || new Error('定时消息未能删除'));
          transaction.onabort = () => reject(transaction.error || new Error('定时消息未能删除'));
      });
  },

  saveUserProfile: async (profile: UserProfile): Promise<void> => {
      const db = await openDB();
      return new Promise((resolve,reject)=>{
          const transaction=db.transaction(STORE_USER,'readwrite'),store=transaction.objectStore(STORE_USER),request=store.get('me');
          request.onsuccess=()=>store.put({...profile,wardrobeOutfits:request.result?.wardrobeOutfits??profile.wardrobeOutfits,id:'me'});
          transaction.oncomplete=()=>resolve();transaction.onerror=transaction.onabort=()=>reject(transaction.error);
      });
  },

  /** Wardrobe is edited independently of profile forms; merge within one transaction. */
  updateWardrobeOutfits: async (update:(items:NonNullable<UserProfile['wardrobeOutfits']>)=>NonNullable<UserProfile['wardrobeOutfits']>):Promise<NonNullable<UserProfile['wardrobeOutfits']>> => {
      const db=await openDB();
      return new Promise((resolve,reject)=>{
          const tx=db.transaction(STORE_USER,'readwrite'),store=tx.objectStore(STORE_USER),request=store.get('me');
          let items:NonNullable<UserProfile['wardrobeOutfits']>=[],failure:unknown;
          request.onsuccess=()=>{try{const profile=request.result??{id:'me',name:'我',avatar:'',bio:''};items=update(profile.wardrobeOutfits??[]);store.put({...profile,wardrobeOutfits:items});}catch(e){failure=e;tx.abort();}};
          tx.oncomplete=()=>resolve(items);tx.onerror=tx.onabort=()=>reject(failure??tx.error);
      });
  },

  getUserProfile: async (): Promise<UserProfile | null> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_USER, 'readonly');
          const store = transaction.objectStore(STORE_USER);
          const request = store.get('me');
          request.onsuccess = () => {
              if (request.result) {
                  const { id, ...profile } = request.result;
                  resolve(profile as UserProfile);
              } else {
                  resolve(null);
              }
          };
          request.onerror = () => reject(request.error);
      });
  },

  getDiariesByCharId: async (charId: string): Promise<DiaryEntry[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_DIARIES, 'readonly');
          const store = transaction.objectStore(STORE_DIARIES);
          const index = store.index('charId');
          const request = index.getAll(IDBKeyRange.only(charId));
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveDiary: async (diary: DiaryEntry): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_DIARIES, 'readwrite');
      transaction.objectStore(STORE_DIARIES).put(diary);
  },

  deleteDiary: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_DIARIES, 'readwrite');
      transaction.objectStore(STORE_DIARIES).delete(id);
  },

  getAllTasks: async (): Promise<Task[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_TASKS)) return [];
      
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_TASKS, 'readonly');
          const store = transaction.objectStore(STORE_TASKS);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveTask: async (task: Task): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_TASKS, 'readwrite');
      transaction.objectStore(STORE_TASKS).put(task);
  },

  deleteTask: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_TASKS, 'readwrite');
      transaction.objectStore(STORE_TASKS).delete(id);
  },

  getAllAnniversaries: async (): Promise<Anniversary[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_ANNIVERSARIES)) return [];

      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_ANNIVERSARIES, 'readonly');
          const store = transaction.objectStore(STORE_ANNIVERSARIES);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveAnniversary: async (anniversary: Anniversary): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_ANNIVERSARIES, 'readwrite');
      transaction.objectStore(STORE_ANNIVERSARIES).put(anniversary);
  },

  deleteAnniversary: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_ANNIVERSARIES, 'readwrite');
      transaction.objectStore(STORE_ANNIVERSARIES).delete(id);
  },

  getRoomTodo: async (charId: string, date: string): Promise<RoomTodo | null> => {
      const db = await openDB();
      const id = `${charId}_${date}`;
      return new Promise((resolve, reject) => {
          if (!db.objectStoreNames.contains(STORE_ROOM_TODOS)) { resolve(null); return; }
          const transaction = db.transaction(STORE_ROOM_TODOS, 'readonly');
          const store = transaction.objectStore(STORE_ROOM_TODOS);
          const req = store.get(id);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
      });
  },

  saveRoomTodo: async (todo: RoomTodo): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_ROOM_TODOS, 'readwrite');
      transaction.objectStore(STORE_ROOM_TODOS).put(todo);
  },

  getRoomNotes: async (charId: string): Promise<RoomNote[]> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          if (!db.objectStoreNames.contains(STORE_ROOM_NOTES)) { resolve([]); return; }
          const transaction = db.transaction(STORE_ROOM_NOTES, 'readonly');
          const store = transaction.objectStore(STORE_ROOM_NOTES);
          const index = store.index('charId');
          const request = index.getAll(IDBKeyRange.only(charId));
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveRoomNote: async (note: RoomNote): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_ROOM_NOTES, 'readwrite');
      transaction.objectStore(STORE_ROOM_NOTES).put(note);
  },

  deleteRoomNote: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_ROOM_NOTES, 'readwrite');
      transaction.objectStore(STORE_ROOM_NOTES).delete(id);
  },

  // ─── Daily Schedule (角色日程表) ───
  getDailySchedule: async (charId: string, date: string): Promise<DailySchedule | null> => {
      const db = await openDB();
      const id = `${charId}_${date}`;
      return new Promise((resolve, reject) => {
          if (!db.objectStoreNames.contains(STORE_DAILY_SCHEDULE)) { resolve(null); return; }
          const transaction = db.transaction(STORE_DAILY_SCHEDULE, 'readonly');
          const store = transaction.objectStore(STORE_DAILY_SCHEDULE);
          const req = store.get(id);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
      });
  },

  saveDailySchedule: async (schedule: DailySchedule): Promise<void> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_DAILY_SCHEDULE, 'readwrite');
          const store = transaction.objectStore(STORE_DAILY_SCHEDULE);
          // Generated schedules (including background results) may omit the local cover.
          // Read and inherit in the same transaction so a concurrent upload is retained.
          if (schedule.coverImage !== undefined) store.put(schedule);
          else {
              const range = IDBKeyRange.bound(`${schedule.charId}_`, `${schedule.charId}_\uffff`);
              const request = store.openCursor(range, 'prev');
              request.onsuccess = () => {
                  const cursor = request.result;
                  if (!cursor) store.put(schedule);
                  else if (cursor.value.charId === schedule.charId && cursor.value.coverImage) {
                      store.put({ ...schedule, coverImage: cursor.value.coverImage });
                  } else cursor.continue();
              };
          }
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
      });
  },

  deleteDailySchedule: async (charId: string, date: string): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_DAILY_SCHEDULE)) return;
      const transaction = db.transaction(STORE_DAILY_SCHEDULE, 'readwrite');
      transaction.objectStore(STORE_DAILY_SCHEDULE).delete(`${charId}_${date}`);
  },

  // ─── 热点快照 (分时段，全角色共享) ───
  getHotNewsSnapshot: async (id: string): Promise<HotNewsSnapshot | null> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          if (!db.objectStoreNames.contains(STORE_HOTNEWS)) { resolve(null); return; }
          const transaction = db.transaction(STORE_HOTNEWS, 'readonly');
          const req = transaction.objectStore(STORE_HOTNEWS).get(id);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
      });
  },

  saveHotNewsSnapshot: async (snapshot: HotNewsSnapshot): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_HOTNEWS, 'readwrite');
      transaction.objectStore(STORE_HOTNEWS).put(snapshot);
  },

  // 拿最近一次快照（按 fetchedAt 倒序），失败兜底与 App 展示用
  getLatestHotNewsSnapshot: async (): Promise<HotNewsSnapshot | null> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          if (!db.objectStoreNames.contains(STORE_HOTNEWS)) { resolve(null); return; }
          const transaction = db.transaction(STORE_HOTNEWS, 'readonly');
          const req = transaction.objectStore(STORE_HOTNEWS).getAll();
          req.onsuccess = () => {
              const all = (req.result || []) as HotNewsSnapshot[];
              if (all.length === 0) { resolve(null); return; }
              all.sort((a, b) => b.fetchedAt - a.fetchedAt);
              resolve(all[0]);
          };
          req.onerror = () => reject(req.error);
      });
  },

  // 清理过期快照（保留最近 N 条），避免无限堆积
  pruneHotNewsSnapshots: async (keep = 12): Promise<void> => {
      const db = await openDB();
      return new Promise((resolve) => {
          if (!db.objectStoreNames.contains(STORE_HOTNEWS)) { resolve(); return; }
          const transaction = db.transaction(STORE_HOTNEWS, 'readwrite');
          const store = transaction.objectStore(STORE_HOTNEWS);
          const req = store.getAll();
          req.onsuccess = () => {
              const all = (req.result || []) as HotNewsSnapshot[];
              all.sort((a, b) => b.fetchedAt - a.fetchedAt);
              all.slice(keep).forEach(s => store.delete(s.id));
              resolve();
          };
          req.onerror = () => resolve();
      });
  },

  getScheduleCoverImage: async (charId: string): Promise<string | null> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          if (!db.objectStoreNames.contains(STORE_DAILY_SCHEDULE)) { resolve(null); return; }
          const transaction = db.transaction(STORE_DAILY_SCHEDULE, 'readonly');
          const store = transaction.objectStore(STORE_DAILY_SCHEDULE);
          const req = store.openCursor(null, 'prev');
          req.onsuccess = () => {
              const cursor = req.result;
              if (cursor) {
                  const val = cursor.value as DailySchedule;
                  if (val.charId === charId && val.coverImage) {
                      resolve(val.coverImage);
                      return;
                  }
                  cursor.continue();
              } else {
                  resolve(null);
              }
          };
          req.onerror = () => reject(req.error);
      });
  },

  // ─── Handbook (手账) ───
  getHandbook: async (date: string): Promise<HandbookEntry | null> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          if (!db.objectStoreNames.contains(STORE_HANDBOOK)) { resolve(null); return; }
          const transaction = db.transaction(STORE_HANDBOOK, 'readonly');
          const store = transaction.objectStore(STORE_HANDBOOK);
          const req = store.get(date);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
      });
  },

  getAllHandbooks: async (): Promise<HandbookEntry[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_HANDBOOK)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_HANDBOOK, 'readonly');
          const store = transaction.objectStore(STORE_HANDBOOK);
          const req = store.getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error);
      });
  },

  saveHandbook: async (entry: HandbookEntry): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_HANDBOOK, 'readwrite');
      transaction.objectStore(STORE_HANDBOOK).put(entry);
  },

  deleteHandbook: async (date: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_HANDBOOK, 'readwrite');
      transaction.objectStore(STORE_HANDBOOK).delete(date);
  },

  // ─── Trackers (手账打卡引擎) ───
  getAllTrackers: async (): Promise<Tracker[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_TRACKERS)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_TRACKERS, 'readonly');
          const req = tx.objectStore(STORE_TRACKERS).getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error);
      });
  },

  saveTracker: async (tracker: Tracker): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_TRACKERS, 'readwrite');
      tx.objectStore(STORE_TRACKERS).put(tracker);
  },

  deleteTracker: async (id: string): Promise<void> => {
      const db = await openDB();
      // 同时删掉该 tracker 的所有 entries
      const tx = db.transaction([STORE_TRACKERS, STORE_TRACKER_ENTRIES], 'readwrite');
      tx.objectStore(STORE_TRACKERS).delete(id);
      const teStore = tx.objectStore(STORE_TRACKER_ENTRIES);
      const idx = teStore.index('trackerId');
      const req = idx.openCursor(IDBKeyRange.only(id));
      req.onsuccess = () => {
          const cursor = req.result;
          if (cursor) { cursor.delete(); cursor.continue(); }
      };
  },

  getTrackerEntriesByTracker: async (trackerId: string): Promise<TrackerEntry[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_TRACKER_ENTRIES)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_TRACKER_ENTRIES, 'readonly');
          const idx = tx.objectStore(STORE_TRACKER_ENTRIES).index('trackerId');
          const req = idx.getAll(IDBKeyRange.only(trackerId));
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error);
      });
  },

  getTrackerEntry: async (trackerId: string, date: string): Promise<TrackerEntry | null> => {
      // 复合查询:用 tracker 索引,客户端再过滤 date(简单且足够快)
      const all = await DB.getTrackerEntriesByTracker(trackerId);
      return all.find(e => e.date === date) || null;
  },

  saveTrackerEntry: async (entry: TrackerEntry): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_TRACKER_ENTRIES, 'readwrite');
      tx.objectStore(STORE_TRACKER_ENTRIES).put(entry);
  },

  deleteTrackerEntry: async (id: string): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_TRACKER_ENTRIES, 'readwrite');
      tx.objectStore(STORE_TRACKER_ENTRIES).delete(id);
  },

  // ─── 生活记录（档案 App：生理期 / 药盒 / 锻炼；记账走 bank_transactions） ───
  getAllLifeRecords: async (): Promise<LifeRecord[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_LIFE_RECORDS)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_LIFE_RECORDS, 'readonly');
          const req = tx.objectStore(STORE_LIFE_RECORDS).getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error);
      });
  },

  getLifeRecordById: async (id: string): Promise<LifeRecord | null> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_LIFE_RECORDS)) return null;
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_LIFE_RECORDS, 'readonly');
          const req = tx.objectStore(STORE_LIFE_RECORDS).get(id);
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
      });
  },

  saveLifeRecord: async (record: LifeRecord): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_LIFE_RECORDS, 'readwrite');
      tx.objectStore(STORE_LIFE_RECORDS).put(record);
  },

  deleteLifeRecord: async (id: string): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_LIFE_RECORDS, 'readwrite');
      tx.objectStore(STORE_LIFE_RECORDS).delete(id);
  },

  getAllMedPlans: async (): Promise<MedPlan[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_MED_PLANS)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_MED_PLANS, 'readonly');
          const req = tx.objectStore(STORE_MED_PLANS).getAll();
          req.onsuccess = () => resolve(req.result || []);
          req.onerror = () => reject(req.error);
      });
  },

  saveMedPlan: async (plan: MedPlan): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_MED_PLANS, 'readwrite');
      tx.objectStore(STORE_MED_PLANS).put(plan);
  },

  deleteMedPlan: async (id: string): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_MED_PLANS, 'readwrite');
      tx.objectStore(STORE_MED_PLANS).delete(id);
  },

  getLifeRecordSettings: async (): Promise<LifeRecordSettings | null> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_LIFE_SETTINGS)) return null;
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_LIFE_SETTINGS, 'readonly');
          const req = tx.objectStore(STORE_LIFE_SETTINGS).get('main');
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
      });
  },

  saveLifeRecordSettings: async (settings: LifeRecordSettings): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_LIFE_SETTINGS, 'readwrite');
      tx.objectStore(STORE_LIFE_SETTINGS).put({ ...settings, id: 'main' });
  },

  getAllCourses: async (): Promise<StudyCourse[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_COURSES)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_COURSES, 'readonly');
          const store = transaction.objectStore(STORE_COURSES);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveCourse: async (course: StudyCourse): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_COURSES, 'readwrite');
      transaction.objectStore(STORE_COURSES).put(course);
  },

  saveCourses: async (courses: StudyCourse[]): Promise<void> => {
      if (courses.length === 0) return;
      const db = await openDB();
      const transaction = db.transaction(STORE_COURSES, 'readwrite');
      const store = transaction.objectStore(STORE_COURSES);
      courses.forEach(course => store.put(course));
      return new Promise((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error);
      });
  },

  deleteCourse: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_COURSES, 'readwrite');
      transaction.objectStore(STORE_COURSES).delete(id);
  },

  getCharacterStudySessions: async (): Promise<CharacterStudySession[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_CHARACTER_STUDY)) return [];
      return new Promise((resolve, reject) => {
          const request = db.transaction(STORE_CHARACTER_STUDY, 'readonly').objectStore(STORE_CHARACTER_STUDY).getAll();
          request.onsuccess = () => resolve((request.result || []).sort((a: CharacterStudySession, b: CharacterStudySession) => b.updatedAt - a.updatedAt));
          request.onerror = () => reject(request.error);
      });
  },

  saveCharacterStudySession: async (session: CharacterStudySession): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_CHARACTER_STUDY, 'readwrite');
      transaction.objectStore(STORE_CHARACTER_STUDY).put(session);
      return new Promise((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
      });
  },

  deleteCharacterStudySession: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_CHARACTER_STUDY, 'readwrite');
      transaction.objectStore(STORE_CHARACTER_STUDY).delete(id);
      return new Promise((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
      });
  },

  // --- Quiz / Practice Book ---
  getAllQuizzes: async (): Promise<QuizSession[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_QUIZZES)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_QUIZZES, 'readonly');
          const store = transaction.objectStore(STORE_QUIZZES);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveQuiz: async (quiz: QuizSession): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_QUIZZES, 'readwrite');
      transaction.objectStore(STORE_QUIZZES).put(quiz);
  },

  deleteQuiz: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_QUIZZES, 'readwrite');
      transaction.objectStore(STORE_QUIZZES).delete(id);
  },

  getAllGames: async (): Promise<GameSession[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_GAMES)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_GAMES, 'readonly');
          const store = transaction.objectStore(STORE_GAMES);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveGame: async (game: GameSession): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_GAMES, 'readwrite');
      transaction.objectStore(STORE_GAMES).put(game);
  },

  deleteGame: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_GAMES, 'readwrite');
      transaction.objectStore(STORE_GAMES).delete(id);
  },

  // --- 剧本杀模板与对局 ---
  getMurderMysteryScripts: async (): Promise<MurderMysteryScript[]> => {
      const db = await openDB();
      return idbRequest(db.transaction(STORE_MURDER_MYSTERY_SCRIPTS, 'readonly').objectStore(STORE_MURDER_MYSTERY_SCRIPTS).getAll());
  },
  saveMurderMysteryScript: async (script: MurderMysteryScript): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_MURDER_MYSTERY_SCRIPTS, 'readwrite');
      tx.objectStore(STORE_MURDER_MYSTERY_SCRIPTS).put(script);
      await idbTransaction(tx);
  },
  deleteMurderMysteryScript: async (id: string): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_MURDER_MYSTERY_SCRIPTS, 'readwrite');
      tx.objectStore(STORE_MURDER_MYSTERY_SCRIPTS).delete(id);
      await idbTransaction(tx);
  },
  getMurderMysterySessions: async (): Promise<MurderMysterySession[]> => {
      const db = await openDB();
      return (await idbRequest<MurderMysterySession[]>(db.transaction(STORE_MURDER_MYSTERY_SESSIONS, 'readonly').objectStore(STORE_MURDER_MYSTERY_SESSIONS).getAll())).map(normalizeMurderMysterySession);
  },
  getMurderMysterySession: async (id: string): Promise<MurderMysterySession | undefined> => {
      const db = await openDB();
      const session = await idbRequest<MurderMysterySession | undefined>(db.transaction(STORE_MURDER_MYSTERY_SESSIONS, 'readonly').objectStore(STORE_MURDER_MYSTERY_SESSIONS).get(id));
      return session ? normalizeMurderMysterySession(session) : undefined;
  },
  getMurderMysteryEvents: async (sessionId: string): Promise<MurderMysteryEvent[]> => {
      const db = await openDB();
      const events = await idbRequest<MurderMysteryEvent[]>(db.transaction(STORE_MURDER_MYSTERY_EVENTS, 'readonly').objectStore(STORE_MURDER_MYSTERY_EVENTS).index('sessionId').getAll(sessionId));
      return events.sort((a, b) => a.revision - b.revision);
  },
  createMurderMysterySession: async (session: MurderMysterySession, initial: Array<Pick<MurderMysteryEvent, 'channel' | 'audienceIds' | 'speechMode' | 'content' | 'action' | 'grantId'>>): Promise<MurderMysterySession> => {
      const db = await openDB();
      const tx = db.transaction([STORE_MURDER_MYSTERY_SESSIONS, STORE_MURDER_MYSTERY_EVENTS], 'readwrite');
      const events = tx.objectStore(STORE_MURDER_MYSTERY_EVENTS);
      let revision = 0;
      for (const grant of initial) events.add({ ...grant, id: crypto.randomUUID(), sessionId: session.id, revision: ++revision, timestamp: Date.now() } satisfies MurderMysteryEvent);
      const saved = { ...session, revision, updatedAt: Date.now(),
          grantedClueIds: initial.filter(item => item.action === 'grant_clue').map(item => item.grantId!),
          grantedDeliverableIds: initial.filter(item => item.action === 'grant_deliverable').map(item => item.grantId!),
          grantedAbilityIds: initial.filter(item => item.action === 'grant_ability').map(item => item.grantId!) };
      tx.objectStore(STORE_MURDER_MYSTERY_SESSIONS).add(saved);
      await idbTransaction(tx);
      return saved;
  },
  appendMurderMysteryEvent: async (sessionId: string, expectedRevision: number, draft: Omit<MurderMysteryEvent, 'id' | 'sessionId' | 'revision' | 'timestamp'>, strategyNote?: { charId: string; text: string }): Promise<MurderMysterySession> => {
      const db = await openDB();
      const tx = db.transaction([STORE_MURDER_MYSTERY_SESSIONS, STORE_MURDER_MYSTERY_EVENTS], 'readwrite');
      const sessions = tx.objectStore(STORE_MURDER_MYSTERY_SESSIONS);
      const current = await idbRequest<MurderMysterySession | undefined>(sessions.get(sessionId));
      if (!current || current.revision !== expectedRevision || current.status === 'ended' || (current.participation && current.status === 'preparation' && draft.channel === 'public_table')) { tx.abort(); throw new Error('对局已经变化、尚未正式开始或已结束，请刷新后重试'); }
      const revision = current.revision + 1;
      tx.objectStore(STORE_MURDER_MYSTERY_EVENTS).add({ ...draft, id: crypto.randomUUID(), sessionId, revision, timestamp: Date.now() } satisfies MurderMysteryEvent);
      const next = { ...current, revision, updatedAt: Date.now(),
          status: !current.participation && draft.channel === 'public_table' && current.status === 'preparation' ? 'playing' as const : current.status,
          strategyNotes: strategyNote ? { ...current.strategyNotes, [strategyNote.charId]: strategyNote.text } : current.strategyNotes };
      sessions.put(next);
      await idbTransaction(tx);
      return next;
  },
  applyMurderMysteryCommand: async (sessionId: string, expectedRevision: number, command: MurderMysteryCommand): Promise<MurderMysterySession> => {
      const db = await openDB();
      const tx = db.transaction([STORE_MURDER_MYSTERY_SESSIONS, STORE_MURDER_MYSTERY_EVENTS], 'readwrite');
      const sessions = tx.objectStore(STORE_MURDER_MYSTERY_SESSIONS);
      const current = await idbRequest<MurderMysterySession | undefined>(sessions.get(sessionId));
      if (!current || current.revision !== expectedRevision) { tx.abort(); throw new Error('对局已经变化，请刷新后重试'); }
      let planned: ReturnType<typeof planMurderMysteryCommand>;
      const correctionTarget = command.type === 'correct_speech_mode'
          ? await idbRequest<MurderMysteryEvent | undefined>(tx.objectStore(STORE_MURDER_MYSTERY_EVENTS).get(command.eventId)) : undefined;
      try { planned = planMurderMysteryCommand(current, command, correctionTarget ? [correctionTarget] : []); }
      catch (error) { tx.abort(); throw error; }
      const store = tx.objectStore(STORE_MURDER_MYSTERY_EVENTS);
      let revision = current.revision;
      const now = Date.now();
      for (const event of planned.events) store.add({ ...event, id: crypto.randomUUID(), sessionId, revision: ++revision, timestamp: now } satisfies MurderMysteryEvent);
      const next = { ...planned.session, revision, updatedAt: now };
      sessions.put(next);
      await idbTransaction(tx);
      return next;
  },
  writebackMurderMysteryReality: async (sessionId: string, charId: string): Promise<{ written: boolean; character: CharacterProfile }> => {
      const db = await openDB();
      const tx = db.transaction([STORE_MURDER_MYSTERY_SESSIONS, STORE_MURDER_MYSTERY_EVENTS, STORE_CHARACTERS, STORE_MESSAGES], 'readwrite');
      const done = idbTransaction(tx);
      const sessionStore = tx.objectStore(STORE_MURDER_MYSTERY_SESSIONS);
      const characterStore = tx.objectStore(STORE_CHARACTERS);
      const messageStore = tx.objectStore(STORE_MESSAGES);
      const session = await idbRequest<MurderMysterySession | undefined>(sessionStore.get(sessionId));
      const character = await idbRequest<CharacterProfile | undefined>(characterStore.get(charId));
      if (!session || session.status !== 'ended' || ![...Object.values(session.seats), ...(session.participation?.investigatorCharId ? [session.participation.investigatorCharId] : [])].includes(charId) || !character) {
          tx.abort(); void done.catch(() => undefined); throw new Error('仅已结算对局中的现有玩家可写回现实');
      }
      if (session.realityWritebackCharIds?.includes(charId)) { await done; return { written: false, character }; }
      const summary = buildMysteryRealitySummary(session, charId);
      const memoryId = `mem-murder-mystery-${sessionId}-${charId}`;
      const memories = [...(character.memories || []).filter(memory => memory.id !== memoryId),
          { id: memoryId, date: getLocalDateKey(new Date()), summary, mood: 'playful' }];
      const existing = await idbRequest<Message[]>(messageStore.index('charId').getAll(charId));
      if (!existing.some(message => message.metadata?.source === 'murder_mystery' && message.metadata?.murderMysterySessionId === sessionId)) {
          messageStore.add({ charId, role: 'assistant', type: 'text', content: summary, timestamp: Date.now(),
              metadata: { source: 'murder_mystery', murderMysterySessionId: sessionId } });
      }
      const updated = { ...character, memories };
      characterStore.put(updated);
      const revision = session.revision + 1;
      sessionStore.put({ ...session, revision, updatedAt: Date.now(),
          realityWritebackCharIds: [...(session.realityWritebackCharIds || []), charId] });
      tx.objectStore(STORE_MURDER_MYSTERY_EVENTS).add({ id: crypto.randomUUID(), sessionId, revision,
          timestamp: Date.now(), channel: 'host_system', audienceIds: [], speechMode: 'system',
          content: `主持人已明确选择为玩家 ${charId} 写回共同游戏经历。`, action: 'reality_writeback' } satisfies MurderMysteryEvent);
      await done;
      return { written: true, character: updated };
  },

  // --- 聊愈：独立会话与用户中心共享记忆 ---
  getHealingSessions: async (): Promise<HealingSession[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_HEALING_SESSIONS)) return [];
      const rows = await idbRequest(db.transaction(STORE_HEALING_SESSIONS, 'readonly').objectStore(STORE_HEALING_SESSIONS).getAll()) as HealingSession[];
      return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  },

  getHealingSession: async (id: string): Promise<HealingSession | undefined> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_HEALING_SESSIONS)) return undefined;
      return idbRequest(db.transaction(STORE_HEALING_SESSIONS, 'readonly').objectStore(STORE_HEALING_SESSIONS).get(id));
  },

  saveHealingSession: async (session: HealingSession): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_HEALING_SESSIONS, 'readwrite');
      tx.objectStore(STORE_HEALING_SESSIONS).put(session);
      await idbTransaction(tx);
  },

  saveHealingMessage: async (
      message: Omit<HealingMessage, 'id' | 'timestamp'> & { id?: number; timestamp?: number },
  ): Promise<number> => {
      const db = await openDB();
      const tx = db.transaction(STORE_HEALING_MESSAGES, 'readwrite');
      const record = { ...message, timestamp: message.timestamp ?? Date.now() };
      const request = message.id === undefined
          ? tx.objectStore(STORE_HEALING_MESSAGES).add(record)
          : tx.objectStore(STORE_HEALING_MESSAGES).put(record);
      const done = idbTransaction(tx);
      const id = Number(await idbRequest(request));
      await done;
      return id;
  },

  getHealingMessages: async (sessionId: string): Promise<HealingMessage[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_HEALING_MESSAGES)) return [];
      const store = db.transaction(STORE_HEALING_MESSAGES, 'readonly').objectStore(STORE_HEALING_MESSAGES);
      const rows = await idbRequest(store.index('sessionId').getAll(IDBKeyRange.only(sessionId))) as HealingMessage[];
      return rows.sort((a, b) => a.timestamp - b.timestamp || a.id - b.id);
  },

  getHealingMemoryNodes: async (): Promise<HealingMemoryNode[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_HEALING_MEMORY_NODES)) return [];
      return idbRequest(db.transaction(STORE_HEALING_MEMORY_NODES, 'readonly').objectStore(STORE_HEALING_MEMORY_NODES).getAll());
  },

  getHealingMemoryNode: async (id: string): Promise<HealingMemoryNode | undefined> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_HEALING_MEMORY_NODES)) return undefined;
      return idbRequest(db.transaction(STORE_HEALING_MEMORY_NODES, 'readonly').objectStore(STORE_HEALING_MEMORY_NODES).get(id));
  },

  saveHealingMemoryNode: async (node: HealingMemoryNode): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_HEALING_MEMORY_NODES, 'readwrite');
      tx.objectStore(STORE_HEALING_MEMORY_NODES).put(node);
      await idbTransaction(tx);
  },

  getHealingMemoryVectors: async (): Promise<HealingMemoryVector[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_HEALING_MEMORY_VECTORS)) return [];
      return idbRequest(db.transaction(STORE_HEALING_MEMORY_VECTORS, 'readonly').objectStore(STORE_HEALING_MEMORY_VECTORS).getAll());
  },

  saveHealingMemoryVector: async (row: HealingMemoryVector): Promise<void> => {
      const db = await openDB();
      const source = row.vector instanceof Float32Array
          ? row.vector
          : row.vector instanceof Uint8Array
              ? new Float32Array(row.vector.buffer.slice(row.vector.byteOffset, row.vector.byteOffset + row.vector.byteLength))
              : new Float32Array(row.vector);
      const vector = new Uint8Array(source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength));
      const tx = db.transaction(STORE_HEALING_MEMORY_VECTORS, 'readwrite');
      tx.objectStore(STORE_HEALING_MEMORY_VECTORS).put({ ...row, dimensions: source.length, vector });
      await idbTransaction(tx);
  },

  deleteHealingMemory: async (memoryId: string): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction([STORE_HEALING_MEMORY_NODES, STORE_HEALING_MEMORY_VECTORS], 'readwrite');
      tx.objectStore(STORE_HEALING_MEMORY_NODES).delete(memoryId);
      tx.objectStore(STORE_HEALING_MEMORY_VECTORS).delete(memoryId);
      await idbTransaction(tx);
  },

  // --- 只做一个改变：五表快照在同一个事务里读写 ---
  getOneChangeSnapshotData: async (): Promise<{
      changes: OneChangeItem[];
      records: OneChangeRecord[];
      standardVersions: OneChangeStandardVersion[];
      stateEvents: OneChangeStateEvent[];
      settings?: OneChangeSettings;
  }> => {
      const db = await openDB();
      const names = [
          STORE_ONE_CHANGE_CHANGES,
          STORE_ONE_CHANGE_RECORDS,
          STORE_ONE_CHANGE_STANDARD_VERSIONS,
          STORE_ONE_CHANGE_STATE_EVENTS,
          STORE_ONE_CHANGE_SETTINGS,
      ].filter(name => db.objectStoreNames.contains(name));
      if (names.length < 5) return { changes: [], records: [], standardVersions: [], stateEvents: [] };
      const tx = db.transaction(names, 'readonly');
      const [changes, records, standardVersions, stateEvents, settings] = await Promise.all([
          idbRequest(tx.objectStore(STORE_ONE_CHANGE_CHANGES).getAll()) as Promise<OneChangeItem[]>,
          idbRequest(tx.objectStore(STORE_ONE_CHANGE_RECORDS).getAll()) as Promise<OneChangeRecord[]>,
          idbRequest(tx.objectStore(STORE_ONE_CHANGE_STANDARD_VERSIONS).getAll()) as Promise<OneChangeStandardVersion[]>,
          idbRequest(tx.objectStore(STORE_ONE_CHANGE_STATE_EVENTS).getAll()) as Promise<OneChangeStateEvent[]>,
          idbRequest(tx.objectStore(STORE_ONE_CHANGE_SETTINGS).get('main')) as Promise<OneChangeSettings | undefined>,
      ]);
      return { changes, records, standardVersions, stateEvents, settings };
  },

  saveOneChangeSnapshotData: async (snapshot: {
      changes: OneChangeItem[];
      records: OneChangeRecord[];
      standardVersions: OneChangeStandardVersion[];
      stateEvents: OneChangeStateEvent[];
      settings: OneChangeSettings;
  }): Promise<void> => {
      const db = await openDB();
      const names = [
          STORE_ONE_CHANGE_CHANGES,
          STORE_ONE_CHANGE_RECORDS,
          STORE_ONE_CHANGE_STANDARD_VERSIONS,
          STORE_ONE_CHANGE_STATE_EVENTS,
          STORE_ONE_CHANGE_SETTINGS,
      ];
      const tx = db.transaction(names, 'readwrite');
      for (const name of names) tx.objectStore(name).clear();
      for (const row of snapshot.changes) tx.objectStore(STORE_ONE_CHANGE_CHANGES).put(row);
      for (const row of snapshot.records) tx.objectStore(STORE_ONE_CHANGE_RECORDS).put(row);
      for (const row of snapshot.standardVersions) tx.objectStore(STORE_ONE_CHANGE_STANDARD_VERSIONS).put(row);
      for (const row of snapshot.stateEvents) tx.objectStore(STORE_ONE_CHANGE_STATE_EVENTS).put(row);
      tx.objectStore(STORE_ONE_CHANGE_SETTINGS).put(snapshot.settings);
      await idbTransaction(tx);
  },

  getAllWorldbooks: async (): Promise<Worldbook[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_WORLDBOOKS)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_WORLDBOOKS, 'readonly');
          const store = transaction.objectStore(STORE_WORLDBOOKS);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveWorldbook: async (book: Worldbook): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_WORLDBOOKS, 'readwrite');
      transaction.objectStore(STORE_WORLDBOOKS).put(book);
  },

  deleteWorldbook: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_WORLDBOOKS, 'readwrite');
      transaction.objectStore(STORE_WORLDBOOKS).delete(id);
  },

  // Read current records and update the library + mounted caches atomically.
  // Never loop updateWorldbook with a captured React character snapshot.
  mutateWorldbooks: async (ids: string[], updates: Partial<Worldbook> | null): Promise<{ books: Worldbook[]; characters: CharacterProfile[] }> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction([STORE_WORLDBOOKS, STORE_CHARACTERS], 'readwrite');
          const library = tx.objectStore(STORE_WORLDBOOKS);
          const charactersStore = tx.objectStore(STORE_CHARACTERS);
          const targets = new Set(ids);
          const books: Worldbook[] = [];
          const changedCharacters: CharacterProfile[] = [];
          const request = library.getAll();
          request.onsuccess = () => {
              for (const book of request.result as Worldbook[]) {
                  if (!targets.has(book.id)) continue;
                  if (updates === null) library.delete(book.id);
                  else {
                      const next = { ...book, ...updates, id: book.id, createdAt: book.createdAt, updatedAt: Date.now() };
                      books.push(next);
                      library.put(next);
                  }
              }
              const replacements = new Map(books.map(book => [book.id, toMountedWorldbook(book)]));
              const chars = charactersStore.getAll();
              chars.onsuccess = () => {
                  for (const char of chars.result as CharacterProfile[]) {
                      const mounted = char.mountedWorldbooks || [];
                      if (!mounted.some(book => updates === null ? targets.has(book.id) : replacements.has(book.id))) continue;
                      const next = { ...char, mountedWorldbooks: updates === null
                          ? mounted.filter(book => !targets.has(book.id))
                          : mounted.map(book => {
                              const replacement = replacements.get(book.id);
                              return replacement ? { ...replacement, ...(book.mountPaused === true ? { mountPaused: true } : {}) } : book;
                          }) };
                      changedCharacters.push(next);
                      charactersStore.put(next);
                  }
              };
          };
          tx.oncomplete = () => resolve({ books, characters: changedCharacters });
          tx.onerror = () => reject(tx.error || new Error('世界书保存失败'));
          tx.onabort = () => reject(tx.error || new Error('世界书保存已撤销'));
      });
  },

  // --- 见面 · 剧情剧场 ---
  getStoryTheaters: async (): Promise<StoryTheaterEntry[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_STORY_THEATERS)) return [];
      return new Promise((resolve, reject) => {
          const request = db.transaction(STORE_STORY_THEATERS, 'readonly').objectStore(STORE_STORY_THEATERS).getAll();
          request.onsuccess = () => resolve((request.result || []).sort((a: StoryTheaterEntry, b: StoryTheaterEntry) => b.updatedAt - a.updatedAt));
          request.onerror = () => reject(request.error);
      });
  },

  saveStoryTheater: async (entry: StoryTheaterEntry): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_STORY_THEATERS, 'readwrite');
      transaction.objectStore(STORE_STORY_THEATERS).put(entry);
      return new Promise((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error || new Error('saveStoryTheater aborted'));
      });
  },

  deleteStoryTheater: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_STORY_THEATERS, 'readwrite');
      transaction.objectStore(STORE_STORY_THEATERS).delete(id);
      return new Promise((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error || new Error('deleteStoryTheater aborted'));
      });
  },

  getStoryTheaterPresets: async (): Promise<StoryTheaterPreset[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_STORY_THEATER_PRESETS)) return [];
      return new Promise((resolve, reject) => {
          const request = db.transaction(STORE_STORY_THEATER_PRESETS, 'readonly').objectStore(STORE_STORY_THEATER_PRESETS).getAll();
          request.onsuccess = () => resolve((request.result || []).sort((a: StoryTheaterPreset, b: StoryTheaterPreset) => b.updatedAt - a.updatedAt));
          request.onerror = () => reject(request.error);
      });
  },

  saveStoryTheaterPreset: async (preset: StoryTheaterPreset): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_STORY_THEATER_PRESETS, 'readwrite');
      transaction.objectStore(STORE_STORY_THEATER_PRESETS).put(preset);
      return new Promise((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error || new Error('saveStoryTheaterPreset aborted'));
      });
  },

  deleteStoryTheaterPreset: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_STORY_THEATER_PRESETS, 'readwrite');
      transaction.objectStore(STORE_STORY_THEATER_PRESETS).delete(id);
  },

  getStoryTheaterMasks: async (): Promise<StoryTheaterMask[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_STORY_THEATER_MASKS)) return [];
      return new Promise((resolve, reject) => {
          const request = db.transaction(STORE_STORY_THEATER_MASKS, 'readonly').objectStore(STORE_STORY_THEATER_MASKS).getAll();
          request.onsuccess = () => resolve((request.result || []).sort((a: StoryTheaterMask, b: StoryTheaterMask) => b.updatedAt - a.updatedAt));
          request.onerror = () => reject(request.error);
      });
  },

  saveStoryTheaterMask: async (mask: StoryTheaterMask): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_STORY_THEATER_MASKS, 'readwrite');
      transaction.objectStore(STORE_STORY_THEATER_MASKS).put(mask);
      return new Promise((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error || new Error('saveStoryTheaterMask aborted'));
      });
  },

  deleteStoryTheaterMask: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_STORY_THEATER_MASKS, 'readwrite');
      transaction.objectStore(STORE_STORY_THEATER_MASKS).delete(id);
  },

  getAllNovels: async (): Promise<NovelBook[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_NOVELS)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_NOVELS, 'readonly');
          const store = transaction.objectStore(STORE_NOVELS);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveNovel: async (novel: NovelBook): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_NOVELS, 'readwrite');
      transaction.objectStore(STORE_NOVELS).put(novel);
  },

  deleteNovel: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_NOVELS, 'readwrite');
      transaction.objectStore(STORE_NOVELS).delete(id);
  },

  // --- VR World 「彼方」 全局小说库 ---
  getVRLibraryCategories: async (): Promise<VRLibraryCategory[]> => {
      const db = await openDB();
      const rows = await readLocalCursor<{ categories?: VRLibraryCategory[] }>(db, STORE_VR_SETTINGS, { query: VR_LIBRARY_RECORD, limit: 1 });
      return rows[0]?.categories || [];
  },

  editVRLibrary: async (edit: LibraryEdit): Promise<void> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction([STORE_VR_SETTINGS, STORE_VR_NOVELS], 'readwrite');
          const settings = tx.objectStore(STORE_VR_SETTINGS), books = tx.objectStore(STORE_VR_NOVELS);
          const categoryRequest = settings.get(VR_LIBRARY_RECORD), novelRequest = books.getAll();
          let ready = 0;
          let failure: unknown;
          const apply = () => {
              if (++ready !== 2) return;
              try {
                  const result = editLibrary(categoryRequest.result?.categories || [], novelRequest.result || [], edit);
                  settings.put({ id: VR_LIBRARY_RECORD, categories: result.categories });
                  for (const novel of result.changed) books.put(novel);
              } catch (error) { failure = error; tx.abort(); }
          };
          categoryRequest.onsuccess = apply;
          novelRequest.onsuccess = apply;
          tx.oncomplete = () => resolve();
          tx.onerror = tx.onabort = () => reject(failure || tx.error || new Error('书库分类保存失败'));
      });
  },

  getVRNovelSummaries: async (): Promise<import('../types').VRWorldNovelSummary[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_VR_NOVELS)) return [];
      return readLocalCursor<import('../types').VRWorldNovelSummary>(db, STORE_VR_NOVELS, {
          map: (book: VRWorldNovel) => {
              if (!book || !Array.isArray(book.segments)) throw new Error('书库中有无法读取的旧书目，请保留备份后重试');
              const { segments, ...metadata } = book;
              return { ...metadata, segmentCount: segments.length };
          },
      });
  },

  getVRNovel: async (id: string): Promise<VRWorldNovel | undefined> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_VR_NOVELS, 'readonly');
          const request = tx.objectStore(STORE_VR_NOVELS).get(id);
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
          tx.onabort = () => reject(tx.error || new Error('书籍读取中断'));
      });
  },

  getVRNovels: async (): Promise<VRWorldNovel[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_VR_NOVELS)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_VR_NOVELS, 'readonly');
          const request = transaction.objectStore(STORE_VR_NOVELS).getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveVRNovel: async (novel: VRWorldNovel): Promise<void> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_VR_NOVELS, 'readwrite');
          transaction.objectStore(STORE_VR_NOVELS).put(novel);
          transaction.oncomplete = () => resolve();
          transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error('书籍保存失败'));
      });
  },

  deleteVRNovel: async (id: string): Promise<void> => {
      const db = await openDB();
      // 删书时连带删掉这本书的全部批注
      const annIds: string[] = await new Promise((resolve) => {
          if (!db.objectStoreNames.contains(STORE_VR_ANNOTATIONS)) return resolve([]);
          const tx = db.transaction(STORE_VR_ANNOTATIONS, 'readonly');
          const idx = tx.objectStore(STORE_VR_ANNOTATIONS).index('novelId');
          const req = idx.getAll(id);
          req.onsuccess = () => resolve((req.result || []).map((a: VRNovelAnnotation) => a.id));
          req.onerror = () => resolve([]);
      });
      const tx = db.transaction([STORE_VR_NOVELS, STORE_VR_ANNOTATIONS], 'readwrite');
      tx.objectStore(STORE_VR_NOVELS).delete(id);
      const annStore = tx.objectStore(STORE_VR_ANNOTATIONS);
      for (const aid of annIds) annStore.delete(aid);
  },

  // --- VR World 小说批注 ---
  getVRAnnotations: async (novelId?: string): Promise<VRNovelAnnotation[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_VR_ANNOTATIONS)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_VR_ANNOTATIONS, 'readonly');
          const store = transaction.objectStore(STORE_VR_ANNOTATIONS);
          const request = novelId ? store.index('novelId').getAll(novelId) : store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveVRAnnotation: async (annotation: VRNovelAnnotation): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_VR_ANNOTATIONS, 'readwrite');
      transaction.objectStore(STORE_VR_ANNOTATIONS).put(annotation);
  },

  deleteVRAnnotation: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_VR_ANNOTATIONS, 'readwrite');
      transaction.objectStore(STORE_VR_ANNOTATIONS).delete(id);
  },

  // --- 捏脸系统自定义部件 ---
  getCustomCreatorParts: async (): Promise<CustomCreatorPart[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_CC_PARTS)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_CC_PARTS, 'readonly');
          const request = transaction.objectStore(STORE_CC_PARTS).getAll();
          request.onsuccess = () => resolve((request.result || []).sort((a: CustomCreatorPart, b: CustomCreatorPart) => a.createdAt - b.createdAt));
          request.onerror = () => reject(request.error);
      });
  },

  saveCustomCreatorPart: async (part: CustomCreatorPart): Promise<void> => {
      const db = await openDB();
      // 同 saveAsset：等事务落盘并把失败抛出去，配额不足时不再静默丢部件。
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_CC_PARTS, 'readwrite');
          transaction.objectStore(STORE_CC_PARTS).put(part);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error || new Error('saveCustomCreatorPart transaction aborted'));
      });
  },

  deleteCustomCreatorPart: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_CC_PARTS, 'readwrite');
      transaction.objectStore(STORE_CC_PARTS).delete(id);
  },

  // --- 听歌房共享状态（单例 id='state'） ---
  getVRMusicRoom: async (): Promise<VRMusicRoomState | null> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_VR_MUSIC)) return null;
      return new Promise((resolve) => {
          const transaction = db.transaction(STORE_VR_MUSIC, 'readonly');
          const request = transaction.objectStore(STORE_VR_MUSIC).get('state');
          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => resolve(null);
      });
  },

  saveVRMusicRoom: async (state: VRMusicRoomState): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_VR_MUSIC, 'readwrite');
      transaction.objectStore(STORE_VR_MUSIC).put({ ...state, id: 'state' });
  },

  // --- 留言簿共享状态（单例 id='board'） ---
  getVRGuestbook: async (): Promise<VRGuestbookState | null> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_VR_GUESTBOOK)) return null;
      return new Promise((resolve) => {
          const transaction = db.transaction(STORE_VR_GUESTBOOK, 'readonly');
          const request = transaction.objectStore(STORE_VR_GUESTBOOK).get('board');
          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => resolve(null);
      });
  },

  saveVRGuestbook: async (state: VRGuestbookState): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_VR_GUESTBOOK, 'readwrite');
      // 不限存储条数：留言墙已支持每 50 条翻页，旧留言全部保留可翻看
      const messages = state.messages || [];
      transaction.objectStore(STORE_VR_GUESTBOOK).put({ ...state, id: 'board', messages });
  },

  /** Atomic append: concurrent visitors and system announcements cannot replace each other. */
  appendVRGuestbookMessages: async (messages: VRGuestbookState['messages']): Promise<void> => {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_VR_GUESTBOOK, 'readwrite');
      const store = tx.objectStore(STORE_VR_GUESTBOOK);
      const request = store.get('board');
      request.onsuccess = () => {
        const board: VRGuestbookState = request.result || { id: 'board', messages: [], updatedAt: 0 };
        const ids = new Set(board.messages.map(m => m.id));
        const fresh = messages.filter(m => { if (ids.has(m.id)) return false; ids.add(m.id); return true; });
        if (fresh.length) store.put({ ...board, messages: [...board.messages, ...fresh], updatedAt: Date.now() });
      };
      tx.oncomplete = () => { if (typeof window !== 'undefined') window.dispatchEvent(new Event('vr-guestbook-updated')); resolve(); };
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('留言未能保存'));
    });
  },

  clearVRGuestbook: async (): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_VR_GUESTBOOK)) return;
      const transaction = db.transaction(STORE_VR_GUESTBOOK, 'readwrite');
      transaction.objectStore(STORE_VR_GUESTBOOK).put({ id: 'board', messages: [], updatedAt: Date.now() });
  },

  /** Edit/delete against the latest board, without replacing concurrent posts. */
  editVRGuestbookMessage: async (id: string, content: string | null): Promise<void> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_VR_GUESTBOOK, 'readwrite');
          const store = tx.objectStore(STORE_VR_GUESTBOOK);
          const request = store.get('board');
          request.onsuccess = () => {
              const board = request.result as VRGuestbookState | undefined;
              if (!board) return;
              const messages = content === null
                  ? board.messages.filter(m => m.id !== id)
                  : board.messages.map(m => m.id === id ? { ...m, content } : m);
              store.put({ ...board, messages, updatedAt: Date.now() });
          };
          tx.oncomplete = () => {
              if (typeof window !== 'undefined') window.dispatchEvent(new Event('vr-guestbook-updated'));
              resolve();
          };
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
      });
  },

  // --- 剧院·投稿剧本库 ---
  getVRScripts: async (): Promise<VRScript[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_VR_SCRIPTS)) return [];
      return new Promise((resolve) => {
          const request = db.transaction(STORE_VR_SCRIPTS, 'readonly').objectStore(STORE_VR_SCRIPTS).getAll();
          request.onsuccess = () => resolve((request.result || []).sort((a: VRScript, b: VRScript) => b.createdAt - a.createdAt));
          request.onerror = () => resolve([]);
      });
  },
  saveVRScript: async (script: VRScript): Promise<void> => {
      const db = await openDB();
      db.transaction(STORE_VR_SCRIPTS, 'readwrite').objectStore(STORE_VR_SCRIPTS).put(script);
  },
  deleteVRScript: async (id: string): Promise<void> => {
      const db = await openDB();
      db.transaction(STORE_VR_SCRIPTS, 'readwrite').objectStore(STORE_VR_SCRIPTS).delete(id);
  },

  // --- 剧院·历史舞台剧 ---
  getVRStagedPlays: async (): Promise<VRStagedPlay[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_VR_PLAYS)) return [];
      return new Promise((resolve) => {
          const request = db.transaction(STORE_VR_PLAYS, 'readonly').objectStore(STORE_VR_PLAYS).getAll();
          request.onsuccess = () => resolve((request.result || []).sort((a: VRStagedPlay, b: VRStagedPlay) => b.createdAt - a.createdAt));
          request.onerror = () => resolve([]);
      });
  },
  saveVRStagedPlay: async (play: VRStagedPlay): Promise<void> => {
      const db = await openDB();
      db.transaction(STORE_VR_PLAYS, 'readwrite').objectStore(STORE_VR_PLAYS).put(play);
  },
  deleteVRStagedPlay: async (id: string): Promise<void> => {
      const db = await openDB();
      db.transaction(STORE_VR_PLAYS, 'readwrite').objectStore(STORE_VR_PLAYS).delete(id);
  },

  // --- 剧院·用户自定义写作风格预设 ---
  getVRPresets: async (): Promise<any[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_VR_PRESETS)) return [];
      return new Promise((resolve) => {
          const request = db.transaction(STORE_VR_PRESETS, 'readonly').objectStore(STORE_VR_PRESETS).getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => resolve([]);
      });
  },
  saveVRPreset: async (preset: { key: string; name: string; prompt: string; blurb?: string }): Promise<void> => {
      const db = await openDB();
      db.transaction(STORE_VR_PRESETS, 'readwrite').objectStore(STORE_VR_PRESETS).put(preset);
  },
  deleteVRPreset: async (key: string): Promise<void> => {
      const db = await openDB();
      db.transaction(STORE_VR_PRESETS, 'readwrite').objectStore(STORE_VR_PRESETS).delete(key);
  },

  // --- 邮局信件 ---
  getVRLetters: async (): Promise<VRLetter[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_VR_LETTERS)) return [];
      const letters = await readLocalCursor<VRLetter>(db, STORE_VR_LETTERS);
      return letters.sort((a, b) => b.createdAt - a.createdAt);
  },

  saveVRLetter: async (letter: VRLetter): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_VR_LETTERS, 'readwrite');
      transaction.objectStore(STORE_VR_LETTERS).put(letter);
  },

  saveVRLetters: async (letters: VRLetter[]): Promise<void> => {
      if (letters.length === 0) return;
      const db = await openDB();
      const transaction = db.transaction(STORE_VR_LETTERS, 'readwrite');
      const store = transaction.objectStore(STORE_VR_LETTERS);
      for (const l of letters) store.put(l);
      return new Promise((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
      });
  },

  deleteVRLetter: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_VR_LETTERS, 'readwrite');
      transaction.objectStore(STORE_VR_LETTERS).delete(id);
  },

  // --- 家园（世界定义 + 演绎历史）---
  getWorlds: async (): Promise<WorldProfile[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_WORLDS)) return [];
      return new Promise((resolve, reject) => {
          const request = db.transaction(STORE_WORLDS, 'readonly').objectStore(STORE_WORLDS).getAll();
          request.onsuccess = () => resolve((request.result || []).map(normalizeWorldRelationships).sort((a: WorldProfile, b: WorldProfile) => b.updatedAt - a.updatedAt));
          request.onerror = () => reject(request.error);
      });
  },

  getWorld: async (id: string): Promise<WorldProfile | null> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_WORLDS)) return null;
      return new Promise((resolve, reject) => {
          const request = db.transaction(STORE_WORLDS, 'readonly').objectStore(STORE_WORLDS).get(id);
          request.onsuccess = () => resolve(request.result ? normalizeWorldRelationships(request.result) : null);
          request.onerror = () => reject(request.error);
      });
  },

  saveWorld: async (world: WorldProfile): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_WORLDS, 'readwrite');
      tx.objectStore(STORE_WORLDS).put(world);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
      });
  },

  /** Apply UI changes against the latest persisted world without rolling back engine progress. */
  updateWorld: async (id: string, patch: Partial<WorldProfile> | ((current: WorldProfile) => Partial<WorldProfile>)): Promise<void> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_WORLDS, 'readwrite');
          const store = tx.objectStore(STORE_WORLDS);
          const request = store.get(id);
          request.onsuccess = () => {
              if (!request.result) return;
              const current = request.result as WorldProfile;
              store.put({ ...current, ...(typeof patch === 'function' ? patch(current) : patch), id });
          };
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
      });
  },

  deleteWorld: async (id: string): Promise<void> => {
      const db = await openDB();
      // 连带删掉该世界的全部演绎历史
      const tx = db.transaction([STORE_WORLDS, STORE_WORLD_EPISODES], 'readwrite');
      tx.objectStore(STORE_WORLDS).delete(id);
      const epStore = tx.objectStore(STORE_WORLD_EPISODES);
      const cursorReq = epStore.index('worldId').openCursor(IDBKeyRange.only(id));
      cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (cursor) { cursor.delete(); cursor.continue(); }
      };
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
      });
  },

  getWorldEpisodes: async (worldId: string, limit: number = 30): Promise<WorldEpisode[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_WORLD_EPISODES)) return [];
      return new Promise((resolve, reject) => {
          const index = db.transaction(STORE_WORLD_EPISODES, 'readonly').objectStore(STORE_WORLD_EPISODES).index('worldId');
          const request = index.getAll(IDBKeyRange.only(worldId));
          request.onsuccess = () => {
              const all = orderWorldEpisodes(request.result || []);
              resolve(all.slice(0, limit));
          };
          request.onerror = () => reject(request.error);
      });
  },

  /** 重演的正文与副作用同事务提交；请求期间的世界编辑不被旧快照覆盖。 */
  replaceWorldBeat: async (
      world: WorldProfile, episode: WorldEpisode, charId: string,
      card: { content: string; metadata: Message['metadata']; insertIfMissing: boolean },
      expectedWorld: WorldProfile, expectedEpisode: WorldEpisode,
  ): Promise<void> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction([STORE_WORLDS, STORE_WORLD_EPISODES, STORE_MESSAGES], 'readwrite');
          const worlds = tx.objectStore(STORE_WORLDS);
          const episodes = tx.objectStore(STORE_WORLD_EPISODES);
          const messages = tx.objectStore(STORE_MESSAGES);
          let failure: Error | undefined;
          const abort = () => { failure = new Error('重演期间家园记录已变化，请重新重演'); tx.abort(); };
          const request = worlds.get(world.id);
          request.onsuccess = () => {
              const current = request.result as WorldProfile | undefined;
              const fields = ['storyClock', 'threads', 'seeds', 'relationships', 'feedReactions'] as const;
              if (!current || fields.some(key => JSON.stringify(current[key]) !== JSON.stringify(expectedWorld[key]))) { abort(); return; }
              worlds.put({ ...current, threads: world.threads, seeds: world.seeds, relationships: world.relationships, feedReactions: world.feedReactions, updatedAt: Date.now() });
          };
          const epRequest = episodes.get(episode.id);
          epRequest.onsuccess = () => {
              if (!epRequest.result || JSON.stringify(epRequest.result.beats) !== JSON.stringify(expectedEpisode.beats)) { abort(); return; }
              const { observationNumber: _display, ...stored } = episode;
              episodes.put(stored);
          };
          let found = false;
          const cursorRequest = messages.index('charId').openCursor(IDBKeyRange.only(charId));
          cursorRequest.onsuccess = () => {
              const cursor = cursorRequest.result;
              if (cursor) {
                  const message = cursor.value as Message;
                  const meta = message.metadata as any;
                  if (message.type === 'world_card' && meta?.worldId === world.id && meta.round === episode.round && meta.storyTime === episode.storyTime) {
                      found = true;
                      cursor.update({ ...message, content: card.content, metadata: card.metadata });
                  }
                  cursor.continue();
              } else if (!found && card.insertIfMissing) {
                  messages.add({ charId, role: 'assistant', type: 'world_card', content: card.content, metadata: card.metadata, timestamp: Date.now() });
              }
          };
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(failure || tx.error);
          tx.onabort = () => reject(failure || tx.error || new Error('重演保存失败'));
      });
  },

  saveWorldEpisode: async (episode: WorldEpisode): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_WORLD_EPISODES, 'readwrite');
      const { observationNumber: _displayOnly, ...stored } = episode;
      tx.objectStore(STORE_WORLD_EPISODES).put(stored);
      return new Promise((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
      });
  },

  // --- 彼方独立 API + 调用记录（vr_settings 单例 store）---
  getVRApiConfig: async (): Promise<any | null> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_VR_SETTINGS)) return null;
      return new Promise((resolve) => {
          const tx = db.transaction(STORE_VR_SETTINGS, 'readonly');
          const req = tx.objectStore(STORE_VR_SETTINGS).get('api');
          req.onsuccess = () => resolve(req.result?.config ?? null);
          req.onerror = () => resolve(null);
      });
  },

  saveVRApiConfig: async (config: any | null): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_VR_SETTINGS, 'readwrite');
      tx.objectStore(STORE_VR_SETTINGS).put({ id: 'api', config: config ?? null });
  },

  getVRApiLog: async (): Promise<any[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_VR_SETTINGS)) return [];
      return new Promise((resolve) => {
          const tx = db.transaction(STORE_VR_SETTINGS, 'readonly');
          const req = tx.objectStore(STORE_VR_SETTINGS).get('apilog');
          req.onsuccess = () => resolve(req.result?.entries ?? []);
          req.onerror = () => resolve([]);
      });
  },

  setVRApiLog: async (entries: any[]): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_VR_SETTINGS, 'readwrite');
      tx.objectStore(STORE_VR_SETTINGS).put({ id: 'apilog', entries: (entries || []).slice(0, 120) });
  },

  appendVRApiLog: async (entry: any): Promise<void> => {
      const db = await openDB();
      const read = (): Promise<any[]> => new Promise((resolve) => {
          const tx = db.transaction(STORE_VR_SETTINGS, 'readonly');
          const req = tx.objectStore(STORE_VR_SETTINGS).get('apilog');
          req.onsuccess = () => resolve(req.result?.entries ?? []);
          req.onerror = () => resolve([]);
      });
      const cur = await read();
      cur.unshift(entry);
      const tx = db.transaction(STORE_VR_SETTINGS, 'readwrite');
      tx.objectStore(STORE_VR_SETTINGS).put({ id: 'apilog', entries: cur.slice(0, 120) });
  },

  clearVRApiLog: async (): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_VR_SETTINGS, 'readwrite');
      tx.objectStore(STORE_VR_SETTINGS).put({ id: 'apilog', entries: [] });
  },

  // --- 全局 API 调用记录（api_call_log 单例 store，id='log'）---
  // 只保留近 5 天的记录，超期在写入时丢弃。读出时再过滤一次兜底。
  getApiCallLog: async (): Promise<any[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_API_CALL_LOG)) return [];
      return new Promise((resolve) => {
          const tx = db.transaction(STORE_API_CALL_LOG, 'readonly');
          const req = tx.objectStore(STORE_API_CALL_LOG).get('log');
          req.onsuccess = () => {
              const entries: any[] = req.result?.entries ?? [];
              const cutoff = Date.now() - API_CALL_LOG_MAX_AGE_MS;
              resolve(entries.filter((e) => (e?.timestamp ?? 0) > cutoff));
          };
          req.onerror = () => resolve([]);
      });
  },

  appendApiCallLog: async (entry: any): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_API_CALL_LOG)) return;
      // 必须在同一个 readwrite 事务里完成“读 → 合并/去重 → 写”。
      // 旧实现先 readonly、再另开 readwrite；两条 API 同时返回时会读到同一旧数组，
      // 后写入者把前一条整笔覆盖，表现为供应商有调用而本地日志随机缺行。
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_API_CALL_LOG, 'readwrite');
          const store = tx.objectStore(STORE_API_CALL_LOG);
          const req = store.get('log');
          req.onsuccess = () => {
              const cur: any[] = req.result?.entries ?? [];
              const duplicateIndex = cur.findIndex((e) => e?.id && e.id === entry?.id);
              if (duplicateIndex >= 0) {
                  // 显式 safeFetch 记录和全局 clone 兜底可能先后抵达；合并非空字段，
                  // 既不重复计费，也能让后到的 usage/backendModel 补齐早到的简版记录。
                  const existing = cur[duplicateIndex];
                  const defined = Object.fromEntries(
                      Object.entries(entry || {}).filter(([, value]) => value !== undefined),
                  );
                  cur[duplicateIndex] = { ...existing, ...defined, id: existing.id };
              } else {
                  cur.unshift(entry);
              }
              const cutoff = Date.now() - API_CALL_LOG_MAX_AGE_MS;
              const pruned = cur
                  .filter((e) => (e?.timestamp ?? 0) > cutoff)
                  .sort((a, b) => (b?.timestamp ?? 0) - (a?.timestamp ?? 0))
                  .slice(0, API_CALL_LOG_MAX_ENTRIES);
              store.put({ id: 'log', entries: pruned });
          };
          req.onerror = () => tx.abort();
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('appendApiCallLog transaction failed'));
          tx.onabort = () => reject(tx.error || new Error('appendApiCallLog transaction aborted'));
      });
  },

  clearApiCallLog: async (): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_API_CALL_LOG)) return;
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_API_CALL_LOG, 'readwrite');
          tx.objectStore(STORE_API_CALL_LOG).put({ id: 'log', entries: [] });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('clearApiCallLog transaction failed'));
          tx.onabort = () => reject(tx.error || new Error('clearApiCallLog transaction aborted'));
      });
  },

  // --- 下一次 LLM 请求完整抓包（同 store 独立单例，永远只保留一份）---
  getApiRequestCapture: async (): Promise<any | null> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_API_CALL_LOG)) return null;
      return new Promise((resolve) => {
          const tx = db.transaction(STORE_API_CALL_LOG, 'readonly');
          const req = tx.objectStore(STORE_API_CALL_LOG).get('one-shot-capture');
          req.onsuccess = () => resolve(req.result?.capture ?? null);
          req.onerror = () => resolve(null);
      });
  },

  saveApiRequestCapture: async (capture: any): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_API_CALL_LOG)) return;
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_API_CALL_LOG, 'readwrite');
          tx.objectStore(STORE_API_CALL_LOG).put({ id: 'one-shot-capture', capture });
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('saveApiRequestCapture transaction failed'));
          tx.onabort = () => reject(tx.error || new Error('saveApiRequestCapture transaction aborted'));
      });
  },

  patchApiRequestCapture: async (captureId: string, patch: Record<string, unknown>): Promise<boolean> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_API_CALL_LOG)) return false;
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_API_CALL_LOG, 'readwrite');
          const store = tx.objectStore(STORE_API_CALL_LOG);
          const req = store.get('one-shot-capture');
          let updated = false;
          req.onsuccess = () => {
              const current = req.result?.capture;
              if (!current || current.id !== captureId) return;
              store.put({ id: 'one-shot-capture', capture: { ...current, ...patch } });
              updated = true;
          };
          req.onerror = () => reject(req.error || new Error('patchApiRequestCapture read failed'));
          tx.oncomplete = () => resolve(updated);
          tx.onerror = () => reject(tx.error || new Error('patchApiRequestCapture transaction failed'));
          tx.onabort = () => reject(tx.error || new Error('patchApiRequestCapture transaction aborted'));
      });
  },

  clearApiRequestCapture: async (): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_API_CALL_LOG)) return;
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_API_CALL_LOG, 'readwrite');
          tx.objectStore(STORE_API_CALL_LOG).delete('one-shot-capture');
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('clearApiRequestCapture transaction failed'));
          tx.onabort = () => reject(tx.error || new Error('clearApiRequestCapture transaction aborted'));
      });
  },

  // 导入备份用：直接写回一条 vr_settings 原始记录（{id, ...}）。
  saveVRSettingRecord: async (record: any): Promise<void> => {
      if (!record || !record.id) return;
      const db = await openDB();
      const tx = db.transaction(STORE_VR_SETTINGS, 'readwrite');
      tx.objectStore(STORE_VR_SETTINGS).put(record);
  },

  getHeartSyncRecords: async (): Promise<HeartSyncRecord[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_HEART_SYNC)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_HEART_SYNC, 'readonly');
          const request = tx.objectStore(STORE_HEART_SYNC).getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error || tx.error);
      });
  },

  saveHeartSyncRecord: async (record: HeartSyncRecord): Promise<void> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_HEART_SYNC, 'readwrite');
          tx.objectStore(STORE_HEART_SYNC).put(record);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
      });
  },

  getHeartSyncPsychQuestions: async (): Promise<HeartSyncPsychQuestion[]> =>
      (await DB.getHeartSyncRecords()).filter((record): record is HeartSyncPsychQuestion => record.kind === 'psych_question'),

  getHeartSyncPsychSessions: async (): Promise<HeartSyncPsychSession[]> =>
      (await DB.getHeartSyncRecords()).filter((record): record is HeartSyncPsychSession => record.kind === 'psych_session'),

  getHeartSyncQuestionnaires: async (): Promise<HeartSyncQuestionnaire[]> =>
      (await DB.getHeartSyncRecords()).filter((record): record is HeartSyncQuestionnaire => record.kind === 'questionnaire'),

  getHeartSyncQuestionnaireSessions: async (): Promise<HeartSyncQuestionnaireSession[]> =>
      (await DB.getHeartSyncRecords()).filter((record): record is HeartSyncQuestionnaireSession => record.kind === 'questionnaire_session'),

  deleteHeartSyncRecord: async (id: string): Promise<void> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_HEART_SYNC, 'readwrite');
          tx.objectStore(STORE_HEART_SYNC).delete(id);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
      });
  },

  getDebateSessions: async (): Promise<DebateSession[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_DEBATE)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_DEBATE, 'readonly');
          const request = tx.objectStore(STORE_DEBATE).getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error || tx.error);
      });
  },

  saveDebateSession: async (session: DebateSession): Promise<void> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_DEBATE, 'readwrite');
          tx.objectStore(STORE_DEBATE).put(session);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
      });
  },

  deleteDebateSession: async (id: string): Promise<void> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_DEBATE, 'readwrite');
          tx.objectStore(STORE_DEBATE).delete(id);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
      });
  },

  getBoardGameSessions: async (): Promise<BoardGameSession[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_BOARD_GAME_SESSIONS)) return [];
      const rows = await idbRequest(db.transaction(STORE_BOARD_GAME_SESSIONS, 'readonly').objectStore(STORE_BOARD_GAME_SESSIONS).getAll()) as BoardGameSession[];
      return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  },

  getBoardGameSession: async (id: string): Promise<BoardGameSession | undefined> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_BOARD_GAME_SESSIONS)) return undefined;
      return idbRequest(db.transaction(STORE_BOARD_GAME_SESSIONS, 'readonly').objectStore(STORE_BOARD_GAME_SESSIONS).get(id));
  },

  saveBoardGameSession: async (session: BoardGameSession): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_BOARD_GAME_SESSIONS, 'readwrite');
      tx.objectStore(STORE_BOARD_GAME_SESSIONS).put(session);
      await idbTransaction(tx);
  },

  deleteBoardGameSession: async (id: string): Promise<void> => {
      const db = await openDB();
      const tx = db.transaction(STORE_BOARD_GAME_SESSIONS, 'readwrite');
      tx.objectStore(STORE_BOARD_GAME_SESSIONS).delete(id);
      await idbTransaction(tx);
  },

  // Compare and write in one transaction: a late response cannot overwrite a newer turn.
  saveBoardGameSessionIfCurrent: async (
      session: BoardGameSession,
      expected: { revision: number; actorId: string },
      isActive: () => boolean = () => true,
  ): Promise<boolean> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_BOARD_GAME_SESSIONS, 'readwrite');
          const store = tx.objectStore(STORE_BOARD_GAME_SESSIONS);
          let saved = false;
          const request = store.get(session.id);
          request.onsuccess = () => {
              const latest = request.result as BoardGameSession | undefined;
              if (!isActive() || !latest || latest.status !== 'in_progress'
                  || latest.revision !== expected.revision
                  || latest.round.currentActorId !== expected.actorId
                  || session.revision <= latest.revision) return;
              store.put(session);
              saved = true;
          };
          tx.oncomplete = () => resolve(saved);
          tx.onabort = () => reject(tx.error || new Error('桌游存档事务已中止'));
          tx.onerror = () => reject(tx.error || new Error('桌游存档失败'));
      });
  },

  getLifeReplayRecords: async (): Promise<LifeReplayRecord[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_LIFE_REPLAY)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_LIFE_REPLAY, 'readonly');
          const request = tx.objectStore(STORE_LIFE_REPLAY).getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error || tx.error);
      });
  },

  saveLifeReplayRecord: async (record: LifeReplayRecord): Promise<void> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_LIFE_REPLAY, 'readwrite');
          tx.objectStore(STORE_LIFE_REPLAY).put(record);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
      });
  },

  deleteLifeReplayRecord: async (id: string): Promise<void> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_LIFE_REPLAY, 'readwrite');
          tx.objectStore(STORE_LIFE_REPLAY).delete(id);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
      });
  },

  getCommunityCommitteeSessions: async (): Promise<CommunityCommitteeSession[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_COMMUNITY_COMMITTEE)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_COMMUNITY_COMMITTEE, 'readonly');
          const request = tx.objectStore(STORE_COMMUNITY_COMMITTEE).getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error || tx.error);
      });
  },

  saveCommunityCommitteeSession: async (session: CommunityCommitteeSession): Promise<void> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_COMMUNITY_COMMITTEE, 'readwrite');
          tx.objectStore(STORE_COMMUNITY_COMMITTEE).put(session);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
      });
  },

  deleteCommunityCommitteeSession: async (id: string): Promise<void> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_COMMUNITY_COMMITTEE, 'readwrite');
          tx.objectStore(STORE_COMMUNITY_COMMITTEE).delete(id);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
      });
  },

  getTaskWorkshopRecords: async (): Promise<TaskWorkshopRecord[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_TASK_WORKSHOP)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_TASK_WORKSHOP, 'readonly');
          const request = tx.objectStore(STORE_TASK_WORKSHOP).getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error || tx.error);
      });
  },

  getTaskWorkshopSettings: async (): Promise<TaskWorkshopSettings> => {
      const fallback: TaskWorkshopSettings = {
          id: 'settings', kind: 'settings', enabled: false, visitorCharIds: [], intervalMinutes: 60, nextVisitorIndex: 0,
      };
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_TASK_WORKSHOP)) return fallback;
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_TASK_WORKSHOP, 'readonly');
          const request = tx.objectStore(STORE_TASK_WORKSHOP).get('settings');
          request.onsuccess = () => resolve({ ...fallback, ...(request.result || {}) });
          request.onerror = () => reject(request.error || tx.error);
      });
  },

  getTaskWorkshopRecord: async (id: string): Promise<TaskWorkshopRecord | null> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_TASK_WORKSHOP)) return null;
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_TASK_WORKSHOP, 'readonly');
          const request = tx.objectStore(STORE_TASK_WORKSHOP).get(id);
          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => reject(request.error || tx.error);
      });
  },

  saveTaskWorkshopRecord: async (record: TaskWorkshopRecord): Promise<void> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_TASK_WORKSHOP, 'readwrite');
          tx.objectStore(STORE_TASK_WORKSHOP).put(record);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
      });
  },

  deleteTaskWorkshopRecord: async (id: string): Promise<void> => {
      if (id === 'settings') return;
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_TASK_WORKSHOP, 'readwrite');
          tx.objectStore(STORE_TASK_WORKSHOP).delete(id);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
      });
  },

  getTimeCapsuleRecords: async (): Promise<TimeCapsuleRecord[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_TIME_CAPSULE)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_TIME_CAPSULE, 'readonly');
          const request = tx.objectStore(STORE_TIME_CAPSULE).getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error || tx.error);
      });
  },

  getTimeCapsuleSettings: async (): Promise<TimeCapsuleSettings> => {
      const fallback: TimeCapsuleSettings = {
          id: 'settings', kind: 'settings', enabled: false, visitorCharIds: [], intervalMinutes: 1440, nextVisitorIndex: 0,
      };
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_TIME_CAPSULE)) return fallback;
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_TIME_CAPSULE, 'readonly');
          const request = tx.objectStore(STORE_TIME_CAPSULE).get('settings');
          request.onsuccess = () => resolve({ ...fallback, ...(request.result || {}) });
          request.onerror = () => reject(request.error || tx.error);
      });
  },

  saveTimeCapsuleRecord: async (record: TimeCapsuleRecord): Promise<void> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_TIME_CAPSULE, 'readwrite');
          tx.objectStore(STORE_TIME_CAPSULE).put(record);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
      });
  },

  deleteTimeCapsuleRecord: async (id: string): Promise<void> => {
      if (id === 'settings') return;
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_TIME_CAPSULE, 'readwrite');
          tx.objectStore(STORE_TIME_CAPSULE).delete(id);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
      });
  },

  getMyScheduleRecords: async (): Promise<MyScheduleRecord[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_MY_SCHEDULE)) return [];
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_MY_SCHEDULE, 'readonly');
          const request = tx.objectStore(STORE_MY_SCHEDULE).getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error || tx.error);
      });
  },

  getMyScheduleSettings: async (): Promise<MyScheduleSettings> => {
      const fallback: MyScheduleSettings = { id: 'settings', kind: 'settings', selectedCharIds: [] };
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_MY_SCHEDULE)) return fallback;
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_MY_SCHEDULE, 'readonly');
          const request = tx.objectStore(STORE_MY_SCHEDULE).get('settings');
          request.onsuccess = () => resolve({ ...fallback, ...(request.result || {}) });
          request.onerror = () => reject(request.error || tx.error);
      });
  },

  saveMyScheduleRecord: async (record: MyScheduleRecord): Promise<void> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_MY_SCHEDULE, 'readwrite');
          tx.objectStore(STORE_MY_SCHEDULE).put(record);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
      });
  },
  saveMyScheduleRecordsAtomically: async (records: MyScheduleRecord[]): Promise<void> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_MY_SCHEDULE, 'readwrite');
          const store = tx.objectStore(STORE_MY_SCHEDULE);
          for (const record of records) store.put(record);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
      });
  },

  deleteMyScheduleEntry: async (id: string): Promise<void> => {
      if (id === 'settings') return;
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const tx = db.transaction(STORE_MY_SCHEDULE, 'readwrite');
          tx.objectStore(STORE_MY_SCHEDULE).delete(id);
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error);
      });
  },

  // --- BANK / PET APP LOGIC ---
  getBankState: async (): Promise<BankFullState | null> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          if (!db.objectStoreNames.contains(STORE_BANK_DATA)) { resolve(null); return; }
          const transaction = db.transaction(STORE_BANK_DATA, 'readonly');
          const store = transaction.objectStore(STORE_BANK_DATA);
          const req = store.get('main_state');
          req.onsuccess = () => resolve(req.result || null);
          req.onerror = () => reject(req.error);
      });
  },

  saveBankState: async (state: BankFullState): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_BANK_DATA, 'readwrite');
      // Strip dollhouse from the main state save (dollhouse is saved separately)
      const { dollhouse: _dh, ...shopWithoutDollhouse } = (state.shop || {}) as any;
      const cleanState = { ...state, shop: shopWithoutDollhouse };
      transaction.objectStore(STORE_BANK_DATA).put({ ...cleanState, id: 'main_state' });
      return new Promise((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
      });
  },

  // Dollhouse state saved separately (same pattern as RoomApp's per-character roomConfig)
  getBankDollhouse: async (): Promise<DollhouseState | null> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          if (!db.objectStoreNames.contains(STORE_BANK_DATA)) { resolve(null); return; }
          const transaction = db.transaction(STORE_BANK_DATA, 'readonly');
          const store = transaction.objectStore(STORE_BANK_DATA);
          const req = store.get('dollhouse_state');
          req.onsuccess = () => resolve(req.result?.data || null);
          req.onerror = () => reject(req.error);
      });
  },

  saveBankDollhouse: async (state: DollhouseState): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_BANK_DATA, 'readwrite');
      transaction.objectStore(STORE_BANK_DATA).put({ id: 'dollhouse_state', data: state });
      return new Promise((resolve, reject) => {
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
      });
  },

  getAllTransactions: async (): Promise<BankTransaction[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_BANK_TX)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_BANK_TX, 'readonly');
          const store = transaction.objectStore(STORE_BANK_TX);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveTransaction: async (txData: BankTransaction): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_BANK_TX, 'readwrite');
      transaction.objectStore(STORE_BANK_TX).put(txData);
  },

  deleteTransaction: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_BANK_TX, 'readwrite');
      transaction.objectStore(STORE_BANK_TX).delete(id);
  },

  // --- Songs (Songwriting App) ---
  getAllSongs: async (): Promise<SongSheet[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_SONGS)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_SONGS, 'readonly');
          const store = transaction.objectStore(STORE_SONGS);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveSong: async (song: SongSheet): Promise<void> => {
      const db = await openDB();
      // 同 saveAsset：等事务落盘并把失败抛出去，配额不足时不再静默丢歌。
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_SONGS, 'readwrite');
          transaction.objectStore(STORE_SONGS).put(song);
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
          transaction.onabort = () => reject(transaction.error || new Error('saveSong transaction aborted'));
      });
  },

  deleteSong: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_SONGS, 'readwrite');
      transaction.objectStore(STORE_SONGS).delete(id);
  },

  // --- Guidebook (攻略本) ---
  getAllGuidebookSessions: async (): Promise<GuidebookSession[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_GUIDEBOOK)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_GUIDEBOOK, 'readonly');
          const store = transaction.objectStore(STORE_GUIDEBOOK);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  saveGuidebookSession: async (session: GuidebookSession): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_GUIDEBOOK, 'readwrite');
      transaction.objectStore(STORE_GUIDEBOOK).put(session);
  },

  deleteGuidebookSession: async (id: string): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_GUIDEBOOK, 'readwrite');
      transaction.objectStore(STORE_GUIDEBOOK).delete(id);
  },

  // ── LifeSim (模拟人生) ────────────────────────────────────
  getLifeSimState: async (): Promise<LifeSimState | null> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(STORE_LIFE_SIM)) return null;
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_LIFE_SIM, 'readonly');
          const request = transaction.objectStore(STORE_LIFE_SIM).get('main');
          request.onsuccess = () => resolve(request.result || null);
          request.onerror = () => reject(request.error);
      });
  },

  saveLifeSimState: async (state: LifeSimState): Promise<void> => {
      const db = await openDB();
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(STORE_LIFE_SIM, 'readwrite');
          transaction.objectStore(STORE_LIFE_SIM).put({ ...state, id: 'main' });
          transaction.oncomplete = () => resolve();
          transaction.onerror = () => reject(transaction.error);
      });
  },

  clearLifeSimState: async (): Promise<void> => {
      const db = await openDB();
      const transaction = db.transaction(STORE_LIFE_SIM, 'readwrite');
      transaction.objectStore(STORE_LIFE_SIM).clear();
  },

  getRawStoreData: async (storeName: string): Promise<any[]> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(storeName)) return [];
      return new Promise((resolve, reject) => {
          const transaction = db.transaction(storeName, 'readonly');
          const store = transaction.objectStore(storeName);
          const request = store.getAll();
          request.onsuccess = () => resolve(request.result || []);
          request.onerror = () => reject(request.error);
      });
  },

  /**
   * 在单个 readonly 事务里用游标逐条同步消费整表。onItem 不能返回 Promise；每次 cursor
   * success 都只持有当前记录，适合边剥图边写备份分片，同时保留 getAll 的单事务快照语义。
   */
  streamRawStoreData: async (
      storeName: string,
      onItem: (item: any) => void,
  ): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(storeName)) return;
      return new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, 'readonly');
          const req = tx.objectStore(storeName).openCursor();
          let callbackError: unknown;

          req.onsuccess = () => {
              const cursor = req.result;
              if (!cursor || callbackError) return;
              try {
                  onItem(cursor.value);
                  cursor.continue();
              } catch (error) {
                  callbackError = error;
                  try { tx.abort(); } catch { /* transaction may already be closing */ }
              }
          };
          req.onerror = () => reject(req.error || tx.error || new Error('streamRawStoreData cursor failed'));
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(callbackError || tx.error || new Error('streamRawStoreData tx failed'));
          tx.onabort = () => reject(callbackError || tx.error || new Error('streamRawStoreData tx aborted'));
      });
  },

  /**
   * 游标分批读整表：每攒够 batchSize 条回调一次 onBatch(batch)，回调内消费完即释放，
   * 绝不像 getRawStoreData 那样把整表一次性 getAll 进内存。导出大 store 时用它，把读取
   * 峰值从「整个 store」降到「一个 batch」。
   *
   * 实现要点——每批一个独立 readonly 事务，按主键升序续读（顺序与 getAll 完全一致）：
   * IDB 事务在控制权回到事件循环、且没有挂起请求时会自动提交关闭。onBatch 可能是 async
   * （要 await 写分片 / 让出主线程），await 必然跨过这个提交点把事务关掉，之后再 cursor
   * .continue() 就会抛 TransactionInactiveError。所以这里先在一个事务内用游标攒满一批、
   * 让事务自然关闭，await onBatch 消费完，再用 lowerBound(lastKey, true) 开下一个事务从
   * 断点续读。这是 memoryPalace/db.ts 的 scanAndMigrateLegacy 同款分批事务做法。
   *
   * ⚠ 一致性语义（接进导出前必读）：分批跨多个事务 ≠ getAll 的单事务快照。store 静止时
   * 两者结果一致；但若批次之间有并发写入，key 大于断点的新记录会被带进来、已扫过 key 上的
   * 增删改会漏掉或读到陈旧值——拼出来的可能是内部不一致的 store。getRawStoreData 的单次
   * getAll 至少是「每个 store 自带一致快照」。所以把本函数接进备份导出时，必须先保证导出
   * 期间 store 静止（暂停写入 / 加导出锁），否则要接受「活动中导出 = 尽力而为快照」并补一条
   * 批间改动的回归测试。当前备份导出仍走 getRawStoreData，未用本函数，此约束留给后续接入时兑现。
   */
  getStoreDataChunked: async (
      storeName: string,
      onBatch: (batch: any[]) => void | Promise<void>,
      batchSize = 200,
  ): Promise<void> => {
      const db = await openDB();
      if (!db.objectStoreNames.contains(storeName)) return;

      let lastKey: IDBValidKey | null = null;
      for (;;) {
          const { batch, newLastKey, done } = await new Promise<{
              batch: any[]; newLastKey: IDBValidKey | null; done: boolean;
          }>((resolve, reject) => {
              const tx = db.transaction(storeName, 'readonly');
              const store = tx.objectStore(storeName);
              const range = lastKey !== null ? IDBKeyRange.lowerBound(lastKey, true) : undefined;
              const req = store.openCursor(range);
              const collected: any[] = [];
              let bLast: IDBValidKey | null = lastKey;
              let bDone = false;
              req.onsuccess = () => {
                  const cursor = req.result;
                  if (!cursor) { bDone = true; return; } // 走到末尾
                  if (collected.length >= batchSize) return; // 攒够这批，停 continue 等事务关闭
                  collected.push(cursor.value);
                  bLast = cursor.primaryKey;
                  cursor.continue();
              };
              req.onerror = () => reject(req.error);
              tx.oncomplete = () => resolve({ batch: collected, newLastKey: bLast, done: bDone });
              tx.onerror = () => reject(tx.error || new Error('getStoreDataChunked tx failed'));
              tx.onabort = () => reject(tx.error || new Error('getStoreDataChunked tx aborted'));
          });

          if (batch.length > 0) await onBatch(batch);
          lastKey = newLastKey;
          if (done) break;
      }
  },

  exportFullData: async (
      options: { includeBackendConnection?: boolean } = {},
  ): Promise<Partial<FullBackupData>> => {
      await migrateLegacyWhiteboxPresets(DB);
      const db = await openDB();
      await ensureStoryTimelineRepair(db);
      
      const getAllFromStore = (storeName: string): Promise<any[]> => {
          if (!db.objectStoreNames.contains(storeName)) {
              return Promise.resolve([]);
          }
          return new Promise((resolve) => {
              const tx = db.transaction(storeName, 'readonly');
              const store = tx.objectStore(storeName);
              const req = store.getAll();
              req.onsuccess = () => resolve(req.result || []);
              req.onerror = () => resolve([]); 
          });
      };

      const [characters, characterGroups, messages, themes, emojis, emojiCategories, assets, galleryImages, userProfiles, diaries, tasks, anniversaries, roomTodos, roomNotes, groups, journalStickers, socialPosts, courses, characterStudySessions, games, worldbooks, storyTheaters, storyTheaterPresets, storyTheaterMasks, novels, bankTx, bankData, xhsActivities, xhsOwnedPosts, xhsStockImages, songs, quizzes, guidebookSessions, scheduledMessages, lifeSimStates, handbooks, trackers, trackerEntries, hotNewsSnapshots, vrNovels, vrAnnotations, customCreatorParts, vrMusic, vrGuestbook, vrScripts, vrStagedPlays, vrPresets, vrLetters, vrSettings, heartSyncRecords, debateSessions, boardGameSessions, murderMysteryScripts, murderMysterySessions, murderMysteryEvents, lifeReplayRecords, communityCommitteeSessions, taskWorkshopRecords, timeCapsuleRecords, myScheduleRecords, worlds, worldEpisodes, lifeRecords, medPlans, lifeRecordSettings] = await Promise.all([
          getAllFromStore(STORE_CHARACTERS),
          getAllFromStore(STORE_CHAR_GROUPS),
          getAllFromStore(STORE_MESSAGES),
          getAllFromStore(STORE_THEMES),
          getAllFromStore(STORE_EMOJIS),
          getAllFromStore(STORE_EMOJI_CATEGORIES),
          getAllFromStore(STORE_ASSETS),
          getAllFromStore(STORE_GALLERY),
          getAllFromStore(STORE_USER),
          getAllFromStore(STORE_DIARIES),
          getAllFromStore(STORE_TASKS),
          getAllFromStore(STORE_ANNIVERSARIES),
          getAllFromStore(STORE_ROOM_TODOS),
          getAllFromStore(STORE_ROOM_NOTES),
          getAllFromStore(STORE_GROUPS),
          getAllFromStore(STORE_JOURNAL_STICKERS),
          getAllFromStore(STORE_SOCIAL_POSTS),
          getAllFromStore(STORE_COURSES),
          getAllFromStore(STORE_CHARACTER_STUDY),
          getAllFromStore(STORE_GAMES),
          getAllFromStore(STORE_WORLDBOOKS),
          getAllFromStore(STORE_STORY_THEATERS),
          getAllFromStore(STORE_STORY_THEATER_PRESETS),
          getAllFromStore(STORE_STORY_THEATER_MASKS),
          getAllFromStore(STORE_NOVELS),
          getAllFromStore(STORE_BANK_TX),
          getAllFromStore(STORE_BANK_DATA),
          getAllFromStore(STORE_XHS_ACTIVITIES),
          getAllFromStore(STORE_XHS_OWNED_POSTS),
          getAllFromStore(STORE_XHS_STOCK),
          getAllFromStore(STORE_SONGS),
          getAllFromStore(STORE_QUIZZES),
          getAllFromStore(STORE_GUIDEBOOK),
          getAllFromStore(STORE_SCHEDULED),
          getAllFromStore(STORE_LIFE_SIM),
          getAllFromStore(STORE_HANDBOOK),
          getAllFromStore(STORE_TRACKERS),
          getAllFromStore(STORE_TRACKER_ENTRIES),
          getAllFromStore(STORE_HOTNEWS),
          getAllFromStore(STORE_VR_NOVELS),
          getAllFromStore(STORE_VR_ANNOTATIONS),
          getAllFromStore(STORE_CC_PARTS),
          getAllFromStore(STORE_VR_MUSIC),
          getAllFromStore(STORE_VR_GUESTBOOK),
          getAllFromStore(STORE_VR_SCRIPTS),
          getAllFromStore(STORE_VR_PLAYS),
          getAllFromStore(STORE_VR_PRESETS),
          getAllFromStore(STORE_VR_LETTERS),
          getAllFromStore(STORE_VR_SETTINGS),
          getAllFromStore(STORE_HEART_SYNC),
          getAllFromStore(STORE_DEBATE),
          getAllFromStore(STORE_BOARD_GAME_SESSIONS),
          getAllFromStore(STORE_MURDER_MYSTERY_SCRIPTS),
          getAllFromStore(STORE_MURDER_MYSTERY_SESSIONS),
          getAllFromStore(STORE_MURDER_MYSTERY_EVENTS),
          getAllFromStore(STORE_LIFE_REPLAY),
          getAllFromStore(STORE_COMMUNITY_COMMITTEE),
          getAllFromStore(STORE_TASK_WORKSHOP),
          getAllFromStore(STORE_TIME_CAPSULE),
          getAllFromStore(STORE_MY_SCHEDULE),
          getAllFromStore(STORE_WORLDS),
          getAllFromStore(STORE_WORLD_EPISODES),
          getAllFromStore(STORE_LIFE_RECORDS),
          getAllFromStore(STORE_MED_PLANS),
          getAllFromStore(STORE_LIFE_SETTINGS),
      ]);
      const [healingSessions, healingMessages, healingMemoryNodes, healingMemoryVectorRows] = await Promise.all([
          getAllFromStore(STORE_HEALING_SESSIONS),
          getAllFromStore(STORE_HEALING_MESSAGES),
          getAllFromStore(STORE_HEALING_MEMORY_NODES),
          getAllFromStore(STORE_HEALING_MEMORY_VECTORS),
      ]);
      const [oneChangeChanges, oneChangeRecords, oneChangeStandardVersions, oneChangeStateEvents, oneChangeSettings] = await Promise.all([
          getAllFromStore(STORE_ONE_CHANGE_CHANGES),
          getAllFromStore(STORE_ONE_CHANGE_RECORDS),
          getAllFromStore(STORE_ONE_CHANGE_STANDARD_VERSIONS),
          getAllFromStore(STORE_ONE_CHANGE_STATE_EVENTS),
          getAllFromStore(STORE_ONE_CHANGE_SETTINGS),
      ]);
      // exportFullData 仍可能被直接 JSON.stringify；把紧凑字节恢复成浮点数组，避免
      // Uint8Array 被 JSON 序列化成带数字键的普通对象。OSContext v2 备份另走二进制旁路。
      const healingMemoryVectors = (healingMemoryVectorRows as HealingMemoryVector[]).map(row => {
          const vector = row.vector instanceof Uint8Array
              ? new Float32Array(row.vector.buffer.slice(row.vector.byteOffset, row.vector.byteOffset + row.vector.byteLength))
              : row.vector instanceof Float32Array ? row.vector : new Float32Array(row.vector);
          return { ...row, dimensions: vector.length, vector: Array.from(vector) };
      });
      const characterLifeStates = await getAllFromStore(STORE_CHARACTER_LIFE) as LifeState[];
      const dailySchedules = await getAllFromStore(STORE_DAILY_SCHEDULE) as DailySchedule[];

      // 单例资料新增字段也必须随旧式完整/文字备份走；只剥 IndexedDB 主键，不能白名单截断
      // （上游 3D 家园的 chibiStudio / home3D 槽位同理，分享卡的隐私过滤不适用于本机设备备份）。
      const userProfile = userProfiles.length > 0 ? (() => {
          const { id: _id, ...profile } = userProfiles[0];
          return profile as UserProfile;
      })() : undefined;

      const mainState = bankData.find((d: any) => d.id === 'main_state');
      const dollhouseRecord = bankData.find((d: any) => d.id === 'dollhouse_state');

      return {
          characters, characterGroups, messages, customThemes: themes, savedEmojis: emojis, emojiCategories, assets, galleryImages, userProfile, diaries, tasks, anniversaries, roomTodos, roomNotes, groups, savedJournalStickers: journalStickers, socialPosts, courses, characterStudySessions, games, boardGameSessions, murderMysteryScripts, murderMysterySessions, murderMysteryEvents, healingSessions, healingMessages, healingMemoryNodes, healingMemoryVectors, oneChangeChanges, oneChangeRecords, oneChangeStandardVersions, oneChangeStateEvents, oneChangeSettings, worldbooks, storyTheaters, storyTheaterPresets, storyTheaterMasks, novels,
          bankState: mainState ? { ...mainState, id: undefined } : undefined,
          bankDollhouse: dollhouseRecord?.data || undefined,
          bankTransactions: bankTx,
          xhsActivities,
          xhsOwnedPosts,
          xhsStockImages,
          songs,
          quizSessions: quizzes,
          guidebookSessions,
          scheduledMessages,
          lifeSimState: lifeSimStates[0] || null,
          characterLifeStates,
          dailySchedules,
          handbooks,
          trackers,
          trackerEntries,
          lifeRecords,
          medPlans,
          lifeRecordSettings,
          hotNewsSnapshots,
          vrNovels,
          vrAnnotations,
          customCreatorParts,
          vrMusicRoom: vrMusic && vrMusic.length ? vrMusic[0] : undefined,
          vrGuestbook: vrGuestbook && vrGuestbook.length ? vrGuestbook[0] : undefined,
          vrScripts,
          vrStagedPlays,
          vrPresets,
          vrLetters,
          vrSettings,
          heartSyncRecords: (heartSyncRecords || []).filter((record: HeartSyncRecord) => !isRetiredHeartSyncRecord(record)),
          debateSessions,
          lifeReplayRecords,
          communityCommitteeSessions,
          taskWorkshopRecords,
          timeCapsuleRecords,
          myScheduleRecords,
          vrPostOffice: exportPostOfficeLocal(), // 邮局本机配置（身份/后端地址，存 localStorage）
          vrSignal: exportSignalLocal(),         // 信号坠落处本机记录（句子归属「你·角色」+ 反复用清单，存 localStorage）
          worlds,
          worldEpisodes,
          worldHomeLocal: exportWorldHomeLocal(), // 家园本机配置：全局 API + 文风收藏（存 localStorage）
          luckinLocal: exportLuckinLocal(),       // 瑞幸 token + 启用状态（存 localStorage）
          mcdLocal: exportMcdLocal(),             // 麦当劳 token + 启用状态（存 localStorage）
          home3DLocal: exportHome3DLocal(),
          mcpLocal: exportMcpLocal(),             // 通用 MCP 服务器配置（存 localStorage）
          stickerVisionLocal: exportStickerVisionLocal(), // 表情包视觉理解全局开关（存 localStorage）
          chatActionOrders: loadChatActionOrders(), // 私聊/群聊「＋」功能格的两套本机顺序
          amsg2GlobalConfig: await exportAmsg2GlobalConfig(options), // 主动消息 2.0 全局配置（存独立的 ActiveMsg 库；后端连接默认不带走）
          beautyAuthorLocal: exportBeautyAuthorBackup(),
          beautyPreferences: exportBeautyPreferences(),
          desktopSkinLocal: await exportDesktopSkinLocal(), // 桌面皮肤：界面配色 + 看板 banner（看板图令牌解析为 data URL）
      };
  },

  importFullData: async (
      data: FullBackupData,
      options: {
          beforeWrite?: (root: any, label: string) => Promise<void>;
          onProgress?: (progress: {
              label: string;
              stage: 'start' | 'items' | 'done';
              sectionDone: number;
              sectionTotal: number;
              itemDone?: number;
              itemTotal?: number;
          }) => void;
          /**
           * 让备份里带的 Worker 地址 / 密钥 / 用户 id 落地。默认不落：导入者未必知道
           * 这份文件是谁的，静默连上去的话，ta 的 API 凭据和聊天上下文会写进别人那台 D1。
           */
          allowBackendConnection?: boolean;
      } = {}
  ): Promise<void> => {
      const db = await openDB();
      invalidateStoryTimelineRepair(db);
      
      const availableStores = [
          STORE_CHARACTERS, STORE_CHAR_GROUPS, STORE_MESSAGES, STORE_THEMES, STORE_EMOJIS, STORE_EMOJI_CATEGORIES,
          STORE_ASSETS, STORE_GALLERY, STORE_USER, STORE_DIARIES,
          STORE_TASKS, STORE_ANNIVERSARIES, STORE_ROOM_TODOS, STORE_ROOM_NOTES,
          STORE_GROUPS, STORE_JOURNAL_STICKERS, STORE_SOCIAL_POSTS, STORE_COURSES, STORE_CHARACTER_STUDY, STORE_GAMES, STORE_BOARD_GAME_SESSIONS, STORE_MURDER_MYSTERY_SCRIPTS, STORE_MURDER_MYSTERY_SESSIONS, STORE_MURDER_MYSTERY_EVENTS, STORE_HEALING_SESSIONS, STORE_HEALING_MESSAGES, STORE_HEALING_MEMORY_NODES, STORE_HEALING_MEMORY_VECTORS, STORE_ONE_CHANGE_CHANGES, STORE_ONE_CHANGE_RECORDS, STORE_ONE_CHANGE_STANDARD_VERSIONS, STORE_ONE_CHANGE_STATE_EVENTS, STORE_ONE_CHANGE_SETTINGS, STORE_WORLDBOOKS, STORE_STORY_THEATERS, STORE_STORY_THEATER_PRESETS, STORE_STORY_THEATER_MASKS, STORE_NOVELS, STORE_SONGS,
          STORE_BANK_TX, STORE_BANK_DATA,
          STORE_XHS_ACTIVITIES, STORE_XHS_OWNED_POSTS, STORE_XHS_STOCK,
          STORE_QUIZZES,
          STORE_GUIDEBOOK,
          STORE_SCHEDULED,
          STORE_LIFE_SIM,
          STORE_DAILY_SCHEDULE,
          STORE_CHARACTER_LIFE,
          STORE_HANDBOOK,
          STORE_TRACKERS,
          STORE_TRACKER_ENTRIES,
          STORE_LIFE_RECORDS,
          STORE_MED_PLANS,
          STORE_LIFE_SETTINGS,
          STORE_HOTNEWS,
          STORE_VR_NOVELS, STORE_VR_ANNOTATIONS, STORE_CC_PARTS, STORE_VR_MUSIC, STORE_VR_GUESTBOOK, STORE_VR_SCRIPTS, STORE_VR_PLAYS, STORE_VR_PRESETS, STORE_VR_LETTERS, STORE_VR_SETTINGS, STORE_HEART_SYNC, STORE_DEBATE, STORE_BOARD_GAME_SESSIONS, STORE_MURDER_MYSTERY_SCRIPTS, STORE_MURDER_MYSTERY_SESSIONS, STORE_MURDER_MYSTERY_EVENTS, STORE_LIFE_REPLAY, STORE_COMMUNITY_COMMITTEE, STORE_TASK_WORKSHOP, STORE_TIME_CAPSULE, STORE_MY_SCHEDULE, STORE_XIAOHONGSHU,
          STORE_WORLDS, STORE_WORLD_EPISODES,
          'memory_nodes', 'memory_vectors', 'memory_links', 'topic_boxes', 'anticipations', 'event_boxes',
          'room_plates', 'digest_reports',
          'memory_batches', 'pixel_home_assets', 'pixel_home_layouts'
      ].filter(name => db.objectStoreNames.contains(name));

      const hasStore = (storeName: string) => availableStores.includes(storeName);

      const waitForTransaction = (tx: IDBTransaction) => new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
          tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
      });

      const withStore = async (storeName: string, writer: (store: IDBObjectStore) => void): Promise<void> => {
          if (!hasStore(storeName)) return;
          const tx = db.transaction(storeName, 'readwrite');
          try {
              writer(tx.objectStore(storeName));
          } catch (err) {
              try { tx.abort(); } catch { /* ignore */ }
              throw err;
          }
          await waitForTransaction(tx);
      };

      const getAllFromStore = async <T,>(storeName: string): Promise<T[]> => {
          if (!hasStore(storeName)) return [];
          return new Promise((resolve, reject) => {
              const tx = db.transaction(storeName, 'readonly');
              const request = tx.objectStore(storeName).getAll();
              request.onsuccess = () => resolve(request.result as T[]);
              request.onerror = () => reject(request.error || tx.error);
              tx.onerror = () => reject(tx.error || new Error('IndexedDB read failed'));
              tx.onabort = () => reject(tx.error || new Error('IndexedDB read aborted'));
          });
      };

      const plannedSections = [
          data.characters !== undefined || data.mediaAssets !== undefined,
          data.characterGroups !== undefined,
          data.messages !== undefined,
          data.customThemes !== undefined,
          data.savedEmojis !== undefined,
          data.emojiCategories !== undefined,
          data.assets !== undefined,
          data.savedJournalStickers !== undefined,
          data.galleryImages !== undefined,
          data.diaries !== undefined,
          data.tasks !== undefined,
          data.anniversaries !== undefined,
          data.roomTodos !== undefined,
          data.roomNotes !== undefined,
          data.groups !== undefined,
          data.socialPosts !== undefined,
          data.courses !== undefined,
          data.characterStudySessions !== undefined,
          data.games !== undefined,
          data.healingSessions !== undefined,
          data.healingMessages !== undefined,
          data.healingMemoryNodes !== undefined,
          data.healingMemoryVectors !== undefined,
          data.oneChangeChanges !== undefined,
          data.oneChangeRecords !== undefined,
          data.oneChangeStandardVersions !== undefined,
          data.oneChangeStateEvents !== undefined,
          data.oneChangeSettings !== undefined,
          data.worldbooks !== undefined,
          data.storyTheaters !== undefined,
          data.storyTheaterPresets !== undefined,
          data.storyTheaterMasks !== undefined,
          data.novels !== undefined,
          data.songs !== undefined,
          data.quizSessions !== undefined,
          data.guidebookSessions !== undefined,
          data.scheduledMessages !== undefined,
          data.lifeSimState !== undefined,
          data.bankTransactions !== undefined,
          data.xhsActivities !== undefined,
          data.xhsStockImages !== undefined,
          data.memoryNodes !== undefined,
          data.memoryVectors !== undefined,
          data.memoryLinks !== undefined,
          data.topicBoxes !== undefined,
          data.anticipations !== undefined,
          data.eventBoxes !== undefined,
          data.roomPlates !== undefined,
          data.digestReports !== undefined,
          data.memoryBatches !== undefined,
          data.dailySchedules !== undefined,
          data.characterLifeStates !== undefined,
          data.handbooks !== undefined,
          data.trackers !== undefined,
          data.trackerEntries !== undefined,
          data.lifeRecords !== undefined,
          data.medPlans !== undefined,
          data.lifeRecordSettings !== undefined,
          data.hotNewsSnapshots !== undefined,
          data.vrNovels !== undefined,
          data.vrAnnotations !== undefined,
          data.customCreatorParts !== undefined,
          data.vrMusicRoom !== undefined,
          data.vrGuestbook !== undefined,
          data.vrScripts !== undefined,
          data.vrStagedPlays !== undefined,
          data.vrPresets !== undefined,
          data.vrLetters !== undefined,
          data.heartSyncRecords !== undefined,
          data.debateSessions !== undefined,
          data.lifeReplayRecords !== undefined,
          data.communityCommitteeSessions !== undefined,
          data.taskWorkshopRecords !== undefined,
          data.timeCapsuleRecords !== undefined,
          data.myScheduleRecords !== undefined,
          (data as any).vrPostOffice !== undefined,
          data.worlds !== undefined,
          data.worldEpisodes !== undefined,
          (data as any).worldHomeLocal !== undefined,
          data.home3DLocal !== undefined,
          (data as any).luckinLocal !== undefined,
          (data as any).mcdLocal !== undefined,
          data.pixelHomeAssets !== undefined,
          data.pixelHomeLayouts !== undefined,
          data.userProfile !== undefined,
          data.bankState !== undefined || data.bankDollhouse !== undefined,
      ];
      const sectionTotal = Math.max(1, plannedSections.filter(Boolean).length);
      let sectionDone = 0;

      const report = (
          label: string,
          stage: 'start' | 'items' | 'done',
          itemDone?: number,
          itemTotal?: number
      ) => {
          options.onProgress?.({
              label,
              stage,
              sectionDone,
              sectionTotal,
              itemDone,
              itemTotal,
          });
      };

      const runSection = async (
          label: string,
          present: boolean,
          work: () => Promise<void>,
          itemTotal?: number
      ) => {
          if (!present) return;
          report(label, 'start', 0, itemTotal);
          await work();
          sectionDone += 1;
          report(label, 'done', itemTotal, itemTotal);
      };

      const beforeWrite = async (root: any, label: string, restoreAssets: boolean) => {
          if (!restoreAssets || root === undefined || root === null) return;
          if (!options.beforeWrite) return;
          await options.beforeWrite(root, label);
      };

      const clearStore = async (storeName: string) => {
          await withStore(storeName, store => {
              store.clear();
          });
      };

      const putItems = async (
          storeName: string,
          items: any[] | undefined | null,
          label: string,
          restoreAssets = true
      ) => {
          if (!hasStore(storeName) || !items || items.length === 0) return;

          const CHUNK_SIZE = 50;
          const total = items.length;
          for (let i = 0; i < total; i += CHUNK_SIZE) {
              const end = Math.min(i + CHUNK_SIZE, total);
              const chunk = items.slice(i, end).filter(Boolean);
              if (chunk.length === 0) {
                  report(label, 'items', end, total);
                  continue;
              }
              await beforeWrite(chunk, label, restoreAssets);
              await withStore(storeName, store => {
                  chunk.forEach(item => store.put(item));
              });
              for (let j = i; j < end; j++) {
                  (items as any[])[j] = undefined;
              }
              report(label, 'items', end, total);
          }
      };

      const clearAndAdd = async (
          storeName: string,
          items: any[] | undefined | null,
          label: string,
          restoreAssets = true
      ) => {
          if (!hasStore(storeName) || items === undefined || items === null) return;
          await clearStore(storeName);
          await putItems(storeName, items, label, restoreAssets);
      };

      const mergeStore = async (
          storeName: string,
          items: any[] | undefined | null,
          label: string,
          restoreAssets = true
      ) => {
          if (!hasStore(storeName) || !items || items.length === 0) return;
          await putItems(storeName, items, label, restoreAssets);
      };

      const applyMediaToChar = (c: CharacterProfile, media: NonNullable<FullBackupData['mediaAssets']>[number]): CharacterProfile => {
          return {
              ...c,
              avatar: media.avatar || c.avatar,
              companionAvatar: media.companionAvatar || c.companionAvatar,
              companionTouchSettings: media.companionTouchSettings || c.companionTouchSettings,
              sprites: media.sprites || c.sprites,
              dateSkinSets: media.dateSkinSets || c.dateSkinSets,
              activeSkinSetId: media.activeSkinSetId || c.activeSkinSetId,
              customDateSprites: media.customDateSprites || c.customDateSprites,
              spriteConfig: media.spriteConfig || c.spriteConfig,
              chatBackground: media.backgrounds?.chat || c.chatBackground,
              dateBackground: media.backgrounds?.date || c.dateBackground,
              roomConfig: c.roomConfig ? {
                  ...c.roomConfig,
                  wallImage: media.backgrounds?.roomWall || c.roomConfig.wallImage,
                  floorImage: media.backgrounds?.roomFloor || c.roomConfig.floorImage,
                  items: c.roomConfig.items.map(item => {
                      const img = media.roomItems?.[item.id];
                      return img ? { ...item, image: img } : item;
                  })
              } : c.roomConfig,
              ...restoreDecorationMedia(media.decoration),
          } as CharacterProfile;
      };

      const hasCharacterBackup = Array.isArray(data.characters);

      await runSection('角色资料', data.characters !== undefined || data.mediaAssets !== undefined, async () => {
          if (data.characters) {
              if (data.mediaAssets) {
                  await beforeWrite(data.mediaAssets, '角色媒体', true);
                  const mediaAssets = data.mediaAssets;
                  data.characters = data.characters.map(c => {
                      const media = mediaAssets.find(m => m.charId === c.id);
                      return media ? applyMediaToChar(c, media) : c;
                  });
              }
              await clearAndAdd(STORE_CHARACTERS, data.characters, '角色资料', true);
          } else if (data.mediaAssets && hasStore(STORE_CHARACTERS)) {
              await beforeWrite(data.mediaAssets, '角色媒体', true);
              const mediaAssets = data.mediaAssets;
              const existingChars = await getAllFromStore<CharacterProfile>(STORE_CHARACTERS);
              if (existingChars.length > 0) {
                  const updatedChars = existingChars.map(c => {
                      const media = mediaAssets.find(m => m.charId === c.id);
                      return media ? applyMediaToChar(c, media) : c;
                  });
                  await putItems(STORE_CHARACTERS, updatedChars, '角色资料', false);
              }
          }
          data.characters = undefined as any;
          data.mediaAssets = undefined as any;
      }, data.characters?.length || data.mediaAssets?.length || 0);

      await runSection('角色分组', data.characterGroups !== undefined, async () => {
          await mergeStore(STORE_CHAR_GROUPS, data.characterGroups, '角色分组', false);
          data.characterGroups = undefined as any;
      }, data.characterGroups?.length || 0);

      await runSection('聊天记录', data.messages !== undefined, async () => {
          if (!hasStore(STORE_MESSAGES)) return;
          try {
              const isPatchMode = !hasCharacterBackup;
              if (!isPatchMode) {
                  await clearStore(STORE_MESSAGES);
              }
              await putItems(STORE_MESSAGES, data.messages || [], '聊天记录', true);
              data.messages = undefined as any;
          } finally {
              // 分批导入中途失败也可能已覆盖旧记录；中途读取建立的缓存必须作废。
              invalidateStoryTimelineRepair(db);
          }
      }, data.messages?.length || 0);

      await runSection('聊天主题', data.customThemes !== undefined, async () => {
          await mergeStore(STORE_THEMES, data.customThemes, '聊天主题', true);
          data.customThemes = undefined as any;
      }, data.customThemes?.length || 0);
      await runSection('表情包', data.savedEmojis !== undefined, async () => {
          await mergeStore(STORE_EMOJIS, data.savedEmojis, '表情包', true);
          data.savedEmojis = undefined as any;
      }, data.savedEmojis?.length || 0);
      await runSection('表情分类', data.emojiCategories !== undefined, async () => {
          await mergeStore(STORE_EMOJI_CATEGORIES, data.emojiCategories, '表情分类', false);
          data.emojiCategories = undefined as any;
      }, data.emojiCategories?.length || 0);
      await runSection('系统资源', data.assets !== undefined, async () => {
          await clearAndAdd(STORE_ASSETS, data.assets || [], '系统资源', true);
          data.assets = undefined as any;
      }, data.assets?.length || 0);
      await runSection('聊天收藏', data.contentFavoritesIndex != null, async () => {
          await DB.saveAssetRaw('content_favorites_index_v1', data.contentFavoritesIndex);
      });
      await runSection('日记贴纸', data.savedJournalStickers !== undefined, async () => {
          await mergeStore(STORE_JOURNAL_STICKERS, data.savedJournalStickers, '日记贴纸', true);
          data.savedJournalStickers = undefined as any;
      }, data.savedJournalStickers?.length || 0);

      await runSection('相册图片', data.galleryImages !== undefined, async () => {
          await clearAndAdd(STORE_GALLERY, data.galleryImages, '相册图片', true);
          data.galleryImages = undefined as any;
      }, data.galleryImages?.length || 0);
      await runSection('日记', data.diaries !== undefined, async () => {
          await clearAndAdd(STORE_DIARIES, data.diaries, '日记', true);
          data.diaries = undefined as any;
      }, data.diaries?.length || 0);
      await runSection('任务', data.tasks !== undefined, async () => {
          await clearAndAdd(STORE_TASKS, data.tasks, '任务', false);
          data.tasks = undefined as any;
      }, data.tasks?.length || 0);
      await runSection('纪念日', data.anniversaries !== undefined, async () => {
          await clearAndAdd(STORE_ANNIVERSARIES, data.anniversaries, '纪念日', false);
          data.anniversaries = undefined as any;
      }, data.anniversaries?.length || 0);
      await runSection('房间待办', data.roomTodos !== undefined, async () => {
          await clearAndAdd(STORE_ROOM_TODOS, data.roomTodos, '房间待办', false);
          data.roomTodos = undefined as any;
      }, data.roomTodos?.length || 0);
      await runSection('房间便签', data.roomNotes !== undefined, async () => {
          await clearAndAdd(STORE_ROOM_NOTES, data.roomNotes, '房间便签', false);
          data.roomNotes = undefined as any;
      }, data.roomNotes?.length || 0);
      await runSection('群聊资料', data.groups !== undefined, async () => {
          await clearAndAdd(STORE_GROUPS, data.groups, '群聊资料', true);
          data.groups = undefined as any;
      }, data.groups?.length || 0);
      await runSection('动态帖子', data.socialPosts !== undefined, async () => {
          await clearAndAdd(STORE_SOCIAL_POSTS, data.socialPosts, '动态帖子', true);
          data.socialPosts = undefined as any;
      }, data.socialPosts?.length || 0);
      await runSection('学习课程', data.courses !== undefined, async () => {
          await clearAndAdd(STORE_COURSES, data.courses, '学习课程', false);
          data.courses = undefined as any;
      }, data.courses?.length || 0);
      await runSection('角色自习室', data.characterStudySessions !== undefined, async () => {
          await clearAndAdd(STORE_CHARACTER_STUDY, data.characterStudySessions, '角色自习室', false);
          data.characterStudySessions = undefined as any;
      }, data.characterStudySessions?.length || 0);
      await runSection('游戏记录', data.games !== undefined, async () => {
          await clearAndAdd(STORE_GAMES, data.games, '游戏记录', false);
          data.games = undefined as any;
      }, data.games?.length || 0);
      await runSection('聊愈会话', data.healingSessions !== undefined, async () => {
          await clearAndAdd(STORE_HEALING_SESSIONS, data.healingSessions, '聊愈会话', false);
          data.healingSessions = undefined as any;
      }, data.healingSessions?.length || 0);
      await runSection('聊愈原始记录', data.healingMessages !== undefined, async () => {
          await clearAndAdd(STORE_HEALING_MESSAGES, data.healingMessages, '聊愈原始记录', true);
          data.healingMessages = undefined as any;
      }, data.healingMessages?.length || 0);
      await runSection('聊愈共享记忆', data.healingMemoryNodes !== undefined, async () => {
          await clearAndAdd(STORE_HEALING_MEMORY_NODES, data.healingMemoryNodes, '聊愈共享记忆', false);
          data.healingMemoryNodes = undefined as any;
      }, data.healingMemoryNodes?.length || 0);
      await runSection('聊愈记忆向量', data.healingMemoryVectors !== undefined, async () => {
          await clearAndAdd(STORE_HEALING_MEMORY_VECTORS, data.healingMemoryVectors, '聊愈记忆向量', false);
          data.healingMemoryVectors = undefined as any;
      }, data.healingMemoryVectors?.length || 0);
      await runSection('只做一个改变 · 改变', data.oneChangeChanges !== undefined, async () => {
          await clearAndAdd(STORE_ONE_CHANGE_CHANGES, data.oneChangeChanges, '只做一个改变 · 改变', false);
          data.oneChangeChanges = undefined as any;
      }, data.oneChangeChanges?.length || 0);
      await runSection('只做一个改变 · 记录', data.oneChangeRecords !== undefined, async () => {
          await clearAndAdd(STORE_ONE_CHANGE_RECORDS, data.oneChangeRecords, '只做一个改变 · 记录', false);
          data.oneChangeRecords = undefined as any;
      }, data.oneChangeRecords?.length || 0);
      await runSection('只做一个改变 · 标准版本', data.oneChangeStandardVersions !== undefined, async () => {
          await clearAndAdd(STORE_ONE_CHANGE_STANDARD_VERSIONS, data.oneChangeStandardVersions, '只做一个改变 · 标准版本', false);
          data.oneChangeStandardVersions = undefined as any;
      }, data.oneChangeStandardVersions?.length || 0);
      await runSection('只做一个改变 · 状态事件', data.oneChangeStateEvents !== undefined, async () => {
          await clearAndAdd(STORE_ONE_CHANGE_STATE_EVENTS, data.oneChangeStateEvents, '只做一个改变 · 状态事件', false);
          data.oneChangeStateEvents = undefined as any;
      }, data.oneChangeStateEvents?.length || 0);
      await runSection('只做一个改变 · 设置', data.oneChangeSettings !== undefined, async () => {
          await clearAndAdd(STORE_ONE_CHANGE_SETTINGS, data.oneChangeSettings, '只做一个改变 · 设置', false);
          data.oneChangeSettings = undefined as any;
      }, data.oneChangeSettings?.length || 0);
      await runSection('世界书', data.worldbooks !== undefined, async () => {
          await clearAndAdd(STORE_WORLDBOOKS, data.worldbooks, '世界书', false);
          data.worldbooks = undefined as any;
      }, data.worldbooks?.length || 0);
      await runSection('剧情剧场', data.storyTheaters !== undefined, async () => {
          await clearAndAdd(STORE_STORY_THEATERS, data.storyTheaters, '剧情剧场', false);
          data.storyTheaters = undefined as any;
      }, data.storyTheaters?.length || 0);
      await runSection('剧情预设', data.storyTheaterPresets !== undefined, async () => {
          await clearAndAdd(STORE_STORY_THEATER_PRESETS, data.storyTheaterPresets, '剧情预设', false);
          data.storyTheaterPresets = undefined as any;
      }, data.storyTheaterPresets?.length || 0);
      await runSection('剧场面具箱', data.storyTheaterMasks !== undefined, async () => {
          await clearAndAdd(STORE_STORY_THEATER_MASKS, data.storyTheaterMasks, '剧场面具箱', true);
          data.storyTheaterMasks = undefined as any;
      }, data.storyTheaterMasks?.length || 0);
      await runSection('小说', data.novels !== undefined, async () => {
          await clearAndAdd(STORE_NOVELS, data.novels, '小说', false);
          data.novels = undefined as any;
      }, data.novels?.length || 0);
      await runSection('彼方小说库', data.vrNovels !== undefined, async () => {
          await clearAndAdd(STORE_VR_NOVELS, data.vrNovels, '彼方小说库', false);
          data.vrNovels = undefined as any;
      }, data.vrNovels?.length || 0);
      await runSection('彼方批注', data.vrAnnotations !== undefined, async () => {
          await clearAndAdd(STORE_VR_ANNOTATIONS, data.vrAnnotations, '彼方批注', false);
          data.vrAnnotations = undefined as any;
      }, data.vrAnnotations?.length || 0);
      await runSection('捏脸自定义部件', data.customCreatorParts !== undefined, async () => {
          // restoreAssets=true：部件 src/shadowSrc 是 data:image，media/full 导出时被抽进 zip，
          // 导入必须经 beforeWrite 把 assets/*.png 路径还原回 base64，否则部件图裂成死链。
          await clearAndAdd(STORE_CC_PARTS, data.customCreatorParts, '捏脸自定义部件', true);
          data.customCreatorParts = undefined as any;
      }, data.customCreatorParts?.length || 0);
      await runSection('听歌房', data.vrMusicRoom !== undefined, async () => {
          if (hasStore(STORE_VR_MUSIC) && data.vrMusicRoom) await DB.saveVRMusicRoom(data.vrMusicRoom);
          data.vrMusicRoom = undefined as any;
      }, 1);
      await runSection('留言簿', data.vrGuestbook !== undefined, async () => {
          if (hasStore(STORE_VR_GUESTBOOK) && data.vrGuestbook) await DB.saveVRGuestbook(data.vrGuestbook);
          data.vrGuestbook = undefined as any;
      }, 1);
      await runSection('剧院剧本', data.vrScripts !== undefined, async () => {
          if (hasStore(STORE_VR_SCRIPTS) && Array.isArray(data.vrScripts)) for (const s of data.vrScripts) await DB.saveVRScript(s);
          data.vrScripts = undefined as any;
      }, data.vrScripts?.length || 0);
      await runSection('历史舞台剧', data.vrStagedPlays !== undefined, async () => {
          if (hasStore(STORE_VR_PLAYS) && Array.isArray(data.vrStagedPlays)) for (const p of data.vrStagedPlays) await DB.saveVRStagedPlay(p);
          data.vrStagedPlays = undefined as any;
      }, data.vrStagedPlays?.length || 0);
      await runSection('剧院预设', (data as any).vrPresets !== undefined, async () => {
          if (hasStore(STORE_VR_PRESETS) && Array.isArray((data as any).vrPresets)) for (const p of (data as any).vrPresets) await DB.saveVRPreset(p);
          (data as any).vrPresets = undefined as any;
      }, (data as any).vrPresets?.length || 0);
      await runSection('邮局信件', data.vrLetters !== undefined, async () => {
          await clearAndAdd(STORE_VR_LETTERS, data.vrLetters, '邮局信件', false);
          data.vrLetters = undefined as any;
      }, data.vrLetters?.length || 0);
      await runSection('彼方设置', data.vrSettings !== undefined, async () => {
          if (hasStore(STORE_VR_SETTINGS) && Array.isArray(data.vrSettings)) {
              for (const rec of data.vrSettings) await DB.saveVRSettingRecord(rec);
          }
          data.vrSettings = undefined as any;
      }, data.vrSettings?.length || 0);
      await runSection('心心相印', data.heartSyncRecords !== undefined, async () => {
          const heartSyncRecords = (data.heartSyncRecords || []).filter((record: HeartSyncRecord) => !isRetiredHeartSyncRecord(record));
          await clearAndAdd(STORE_HEART_SYNC, heartSyncRecords, '心心相印', false);
          data.heartSyncRecords = undefined as any;
      }, data.heartSyncRecords?.length || 0);
      await runSection('辩论赛', data.debateSessions !== undefined, async () => {
          await clearAndAdd(STORE_DEBATE, data.debateSessions, '辩论赛', false);
          data.debateSessions = undefined as any;
      }, data.debateSessions?.length || 0);
      await runSection('剧本杀模板', data.murderMysteryScripts !== undefined, async () => {
          await clearAndAdd(STORE_MURDER_MYSTERY_SCRIPTS, data.murderMysteryScripts, '剧本杀模板', false);
          data.murderMysteryScripts = undefined as any;
      }, data.murderMysteryScripts?.length || 0);
      await runSection('剧本杀对局', data.murderMysterySessions !== undefined, async () => {
          await clearAndAdd(STORE_MURDER_MYSTERY_SESSIONS, data.murderMysterySessions, '剧本杀对局', false);
          data.murderMysterySessions = undefined as any;
      }, data.murderMysterySessions?.length || 0);
      await runSection('剧本杀事件', data.murderMysteryEvents !== undefined, async () => {
          await clearAndAdd(STORE_MURDER_MYSTERY_EVENTS, data.murderMysteryEvents, '剧本杀事件', false);
          data.murderMysteryEvents = undefined as any;
      }, data.murderMysteryEvents?.length || 0);
      await runSection('桌游', data.boardGameSessions !== undefined, async () => {
          await clearAndAdd(STORE_BOARD_GAME_SESSIONS, data.boardGameSessions, '桌游', false);
          data.boardGameSessions = undefined as any;
      }, data.boardGameSessions?.length || 0);
      await runSection('人生重映', data.lifeReplayRecords !== undefined, async () => {
          await clearAndAdd(STORE_LIFE_REPLAY, data.lifeReplayRecords, '人生重映', false);
          data.lifeReplayRecords = undefined as any;
      }, data.lifeReplayRecords?.length || 0);
      await runSection('居委会', data.communityCommitteeSessions !== undefined, async () => {
          await clearAndAdd(STORE_COMMUNITY_COMMITTEE, data.communityCommitteeSessions, '居委会', false);
          data.communityCommitteeSessions = undefined as any;
      }, data.communityCommitteeSessions?.length || 0);
      await runSection('任务工坊', data.taskWorkshopRecords !== undefined, async () => {
          await clearAndAdd(STORE_TASK_WORKSHOP, data.taskWorkshopRecords, '任务工坊', false);
          data.taskWorkshopRecords = undefined as any;
      }, data.taskWorkshopRecords?.length || 0);
      await runSection('时间胶囊', data.timeCapsuleRecords !== undefined, async () => {
          await clearAndAdd(STORE_TIME_CAPSULE, data.timeCapsuleRecords, '时间胶囊', false);
          data.timeCapsuleRecords = undefined as any;
      }, data.timeCapsuleRecords?.length || 0);
      await runSection('我的日程', data.myScheduleRecords !== undefined, async () => {
          await clearAndAdd(STORE_MY_SCHEDULE, data.myScheduleRecords, '我的日程', false);
          data.myScheduleRecords = undefined as any;
      }, data.myScheduleRecords?.length || 0);
      await runSection('邮局身份', (data as any).vrPostOffice !== undefined, async () => {
          importPostOfficeLocal((data as any).vrPostOffice);
          (data as any).vrPostOffice = undefined;
      }, 1);
      await runSection('信号坠落处', (data as any).vrSignal !== undefined, async () => {
          importSignalLocal((data as any).vrSignal);
          (data as any).vrSignal = undefined;
      }, 1);
      await runSection('家园世界', data.worlds !== undefined, async () => {
          await clearAndAdd(STORE_WORLDS, data.worlds, '家园世界', false);
          data.worlds = undefined as any;
      }, data.worlds?.length || 0);
      await runSection('家园演绎历史', data.worldEpisodes !== undefined, async () => {
          await clearAndAdd(STORE_WORLD_EPISODES, data.worldEpisodes, '家园演绎历史', false);
          data.worldEpisodes = undefined as any;
      }, data.worldEpisodes?.length || 0);
      await runSection('家园本机配置', (data as any).worldHomeLocal !== undefined, async () => {
          importWorldHomeLocal((data as any).worldHomeLocal); // 全局 API + 文风收藏
          (data as any).worldHomeLocal = undefined;
      }, 1);
      await runSection('瑞幸配置', (data as any).luckinLocal !== undefined, async () => {
          importLuckinLocal((data as any).luckinLocal); // token + 启用状态
          (data as any).luckinLocal = undefined;
      }, 1);
      await runSection('麦当劳配置', (data as any).mcdLocal !== undefined, async () => {
          importMcdLocal((data as any).mcdLocal); // token + 启用状态
          (data as any).mcdLocal = undefined;
      }, 1);
      await runSection('3D 家园本机偏好', data.home3DLocal !== undefined, async () => {
          importHome3DLocal(data.home3DLocal);
          // Imported assets may contain an older localStorage mirror. Do not let
          // the next startup resurrect preferences explicitly reset by this backup.
          const mirror = await DB.getAssetRaw('ls_mirror_v1');
          if (mirror?.data && typeof mirror.data === 'object' && !Array.isArray(mirror.data)) {
              const values = {...mirror.data};
              for (const key of HOME3D_LOCAL_KEYS) delete values[key];
              await DB.saveAssetRaw('ls_mirror_v1', {...mirror, data: {...values, ...exportHome3DLocal()}});
          }
          data.home3DLocal = undefined;
      });

      await runSection('MCP 服务器配置', (data as any).mcpLocal !== undefined, async () => {
          importMcpLocal((data as any).mcpLocal); // 用户自配的 MCP 服务器列表
          (data as any).mcpLocal = undefined;
      }, 1);
      await runSection('表情包视觉理解开关', (data as any).stickerVisionLocal !== undefined, async () => {
          importStickerVisionLocal((data as any).stickerVisionLocal); // 全局开关（存 localStorage）
          (data as any).stickerVisionLocal = undefined;
      }, 1);
      await runSection('聊天功能顺序', data.chatActionOrders !== undefined, async () => {
          saveChatActionOrders(data.chatActionOrders);
          data.chatActionOrders = undefined;
      }, 1);
      await runSection('主动消息配置', (data as any).amsg2GlobalConfig !== undefined, async () => {
          // 必须在 OSContext 那段「导入后跟云端对一次账」之前落地：那段的第一道门是
          // 「本机有没有 Worker 地址」，地址还没写回去的话它会整段跳过，旧档角色留在
          // 云端的无主任务就没人取消，等用户手填回地址时照样到点推送。
          await importAmsg2GlobalConfig(
              (data as any).amsg2GlobalConfig,
              { allowBackendConnection: options.allowBackendConnection },
          );
          (data as any).amsg2GlobalConfig = undefined;
      }, 1);
      await runSection('美化偏好', data.beautyPreferences !== undefined, async () => {
          importBeautyPreferences(data.beautyPreferences);data.beautyPreferences=undefined;
      });
      await runSection('美化作者身份', data.beautyAuthorLocal !== undefined, async () => {
          importBeautyAuthorBackup(data.beautyAuthorLocal);data.beautyAuthorLocal=undefined;
      });
      await runSection('桌面皮肤偏好', (data as any).desktopSkinLocal !== undefined, async () => {
          await importDesktopSkinLocal((data as any).desktopSkinLocal); // 界面配色 + 看板 banner（data URL→本机 blob）
          (data as any).desktopSkinLocal = undefined;
      }, 1);
      await runSection('歌曲', data.songs !== undefined, async () => {
          await clearAndAdd(STORE_SONGS, data.songs, '歌曲', false);
          data.songs = undefined as any;
      }, data.songs?.length || 0);
      await runSection('练习本', data.quizSessions !== undefined, async () => {
          await clearAndAdd(STORE_QUIZZES, data.quizSessions, '练习本', false);
          data.quizSessions = undefined as any;
      }, data.quizSessions?.length || 0);
      await runSection('攻略本', data.guidebookSessions !== undefined, async () => {
          await clearAndAdd(STORE_GUIDEBOOK, data.guidebookSessions, '攻略本', false);
          data.guidebookSessions = undefined as any;
      }, data.guidebookSessions?.length || 0);
      await runSection('定时消息', data.scheduledMessages !== undefined, async () => {
          await clearAndAdd(STORE_SCHEDULED, data.scheduledMessages || [], '定时消息', false);
          data.scheduledMessages = undefined as any;
      }, data.scheduledMessages?.length || 0);
      await runSection('人生模拟', data.lifeSimState !== undefined, async () => {
          if (!hasStore(STORE_LIFE_SIM)) return;
          await beforeWrite(data.lifeSimState, '人生模拟', true);
          await withStore(STORE_LIFE_SIM, store => {
              store.clear();
              if (data.lifeSimState) {
                  store.put({ ...data.lifeSimState, id: 'main' });
              }
          });
          data.lifeSimState = undefined as any;
      }, data.lifeSimState ? 1 : 0);
      await runSection('银行流水', data.bankTransactions !== undefined, async () => {
          await clearAndAdd(STORE_BANK_TX, data.bankTransactions, '银行流水', false);
          data.bankTransactions = undefined as any;
      }, data.bankTransactions?.length || 0);
      await runSection('小红书活动', data.xhsActivities !== undefined, async () => {
          await clearAndAdd(STORE_XHS_ACTIVITIES, data.xhsActivities, '小红书活动', false);
          data.xhsActivities = undefined as any;
      }, data.xhsActivities?.length || 0);
      await runSection('角色小红书主页', data.xhsOwnedPosts !== undefined, async () => {
          await clearAndAdd(STORE_XHS_OWNED_POSTS, data.xhsOwnedPosts, '角色小红书主页', false);
          data.xhsOwnedPosts = undefined as any;
      }, data.xhsOwnedPosts?.length || 0);
      await runSection('小红书图库', data.xhsStockImages !== undefined, async () => {
          await clearAndAdd(STORE_XHS_STOCK, data.xhsStockImages, '小红书图库', true);
          data.xhsStockImages = undefined as any;
      }, data.xhsStockImages?.length || 0);

      // Memory Palace (记忆宫殿)
      await runSection('记忆节点', data.memoryNodes !== undefined, async () => {
          await clearAndAdd('memory_nodes', data.memoryNodes, '记忆节点', false);
          data.memoryNodes = undefined as any;
      }, data.memoryNodes?.length || 0);
      await runSection('记忆向量', data.memoryVectors !== undefined, async () => {
          if (!data.memoryVectors || !hasStore('memory_vectors')) {
              data.memoryVectors = undefined as any;
              return;
          }
          await clearStore('memory_vectors');
          const CHUNK_SIZE = 50;
          const total = data.memoryVectors.length;
          for (let i = 0; i < total; i += CHUNK_SIZE) {
              const end = Math.min(i + CHUNK_SIZE, total);
              const chunk = data.memoryVectors.slice(i, end).filter(Boolean).map((v: any) => {
                  if (!v || !v.vector || !Array.isArray(v.vector)) return v;
                  const f32 = new Float32Array(v.vector);
                  return { ...v, vector: new Uint8Array(f32.buffer, f32.byteOffset, f32.byteLength) };
              });
              await withStore('memory_vectors', store => {
                  chunk.forEach((item: any) => store.put(item));
              });
              for (let j = i; j < end; j++) {
                  (data.memoryVectors as any[])[j] = undefined;
              }
              report('记忆向量', 'items', end, total);
          }
          data.memoryVectors = undefined as any;
      }, data.memoryVectors?.length || 0);
      await runSection('记忆关系', data.memoryLinks !== undefined, async () => {
          await clearAndAdd('memory_links', data.memoryLinks, '记忆关系', false);
          data.memoryLinks = undefined as any;
      }, data.memoryLinks?.length || 0);
      await runSection('话题盒', data.topicBoxes !== undefined, async () => {
          await clearAndAdd('topic_boxes', data.topicBoxes, '话题盒', false);
          data.topicBoxes = undefined as any;
      }, data.topicBoxes?.length || 0);
      await runSection('期待事项', data.anticipations !== undefined, async () => {
          await clearAndAdd('anticipations', data.anticipations, '期待事项', false);
          data.anticipations = undefined as any;
      }, data.anticipations?.length || 0);
      await runSection('事件盒', data.eventBoxes !== undefined, async () => {
          await clearAndAdd('event_boxes', data.eventBoxes, '事件盒', false);
          data.eventBoxes = undefined as any;
      }, data.eventBoxes?.length || 0);
      await runSection('房间门牌', data.roomPlates !== undefined, async () => {
          await clearAndAdd('room_plates', data.roomPlates, '房间门牌', false);
          data.roomPlates = undefined as any;
      }, data.roomPlates?.length || 0);
      await runSection('消化日志', data.digestReports !== undefined, async () => {
          await clearAndAdd('digest_reports', data.digestReports, '消化日志', false);
          data.digestReports = undefined as any;
      }, data.digestReports?.length || 0);
      await runSection('记忆批次', data.memoryBatches !== undefined, async () => {
          await clearAndAdd('memory_batches', data.memoryBatches, '记忆批次', false);
          data.memoryBatches = undefined as any;
      }, data.memoryBatches?.length || 0);

      // 角色日程表（每日日程 + 意识流）
      await runSection('每日程', data.dailySchedules !== undefined, async () => {
          await clearAndAdd(STORE_DAILY_SCHEDULE, data.dailySchedules, '每日程', false);
          data.dailySchedules = undefined as any;
      }, data.dailySchedules?.length || 0);
      await runSection('角色生活状态', data.characterLifeStates !== undefined, async () => {
          await clearAndAdd(STORE_CHARACTER_LIFE, data.characterLifeStates, '角色生活状态', false);
          data.characterLifeStates = undefined as any;
      }, data.characterLifeStates?.length || 0);

      // 手账（跨角色聚合留痕本）
      await runSection('手账', data.handbooks !== undefined, async () => {
          await clearAndAdd(STORE_HANDBOOK, data.handbooks, '手账', false);
          data.handbooks = undefined as any;
      }, data.handbooks?.length || 0);

      // 手账 Tracker（健康/生活打卡引擎）
      await runSection('打卡项目', data.trackers !== undefined, async () => {
          await clearAndAdd(STORE_TRACKERS, data.trackers, '打卡项目', false);
          data.trackers = undefined as any;
      }, data.trackers?.length || 0);
      await runSection('打卡记录', data.trackerEntries !== undefined, async () => {
          await clearAndAdd(STORE_TRACKER_ENTRIES, data.trackerEntries, '打卡记录', false);
          data.trackerEntries = undefined as any;
      }, data.trackerEntries?.length || 0);

      // 生活记录（档案 App：生理期/药盒/锻炼 + 药盒计划 + 设置）
      await runSection('生活记录', data.lifeRecords !== undefined, async () => {
          await clearAndAdd(STORE_LIFE_RECORDS, data.lifeRecords, '生活记录', false);
          data.lifeRecords = undefined as any;
      }, data.lifeRecords?.length || 0);
      await runSection('药盒计划', data.medPlans !== undefined, async () => {
          await clearAndAdd(STORE_MED_PLANS, data.medPlans, '药盒计划', false);
          data.medPlans = undefined as any;
      }, data.medPlans?.length || 0);
      await runSection('生活记录设置', data.lifeRecordSettings !== undefined, async () => {
          await clearAndAdd(STORE_LIFE_SETTINGS, data.lifeRecordSettings, '生活记录设置', false);
          data.lifeRecordSettings = undefined as any;
      }, data.lifeRecordSettings?.length || 0);

      // 热点快照（全角色共享缓存）
      await runSection('热点快照', data.hotNewsSnapshots !== undefined, async () => {
          await clearAndAdd(STORE_HOTNEWS, data.hotNewsSnapshots, '热点快照', false);
          data.hotNewsSnapshots = undefined as any;
      }, data.hotNewsSnapshots?.length || 0);

      // Pixel Home（小屋像素界面）
      await runSection('像素小屋素材', data.pixelHomeAssets !== undefined, async () => {
          await clearAndAdd('pixel_home_assets', data.pixelHomeAssets, '像素小屋素材', true);
          data.pixelHomeAssets = undefined as any;
      }, data.pixelHomeAssets?.length || 0);
      await runSection('像素小屋布局', data.pixelHomeLayouts !== undefined, async () => {
          await clearAndAdd('pixel_home_layouts', data.pixelHomeLayouts, '像素小屋布局', false);
          data.pixelHomeLayouts = undefined as any;
      }, data.pixelHomeLayouts?.length || 0);

      await runSection('用户资料', data.userProfile !== undefined, async () => {
          if (!hasStore(STORE_USER)) return;
          await beforeWrite(data.userProfile, '用户资料', true);
          await withStore(STORE_USER, store => {
              store.clear();
              if (data.userProfile) {
                  store.put({ ...data.userProfile, id: 'me' });
              }
          });
          data.userProfile = undefined as any;
      }, data.userProfile ? 1 : 0);

      await runSection('银行状态', data.bankState !== undefined || data.bankDollhouse !== undefined, async () => {
          if (!hasStore(STORE_BANK_DATA)) return;
          await beforeWrite([data.bankState, data.bankDollhouse], '银行状态', true);
          await withStore(STORE_BANK_DATA, store => {
              store.clear();
              if (data.bankState) {
                  store.put({ ...data.bankState, id: 'main_state' });
              }
              if (data.bankDollhouse) {
                  store.put({ id: 'dollhouse_state', data: data.bankDollhouse });
              }
          });
          data.bankState = undefined as any;
          data.bankDollhouse = undefined as any;
      }, (data.bankState ? 1 : 0) + (data.bankDollhouse ? 1 : 0));
      // 导入会覆盖相同 ID 的旧记录，不能复用导入前或中途建立的校正缓存。
      invalidateStoryTimelineRepair(db);
      await ensureStoryTimelineRepair(db);
  }
};
