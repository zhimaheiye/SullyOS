import React, { useMemo, useEffect, useLayoutEffect, useState, useRef, useCallback } from 'react';
import { isPaperWallpaper, useOS } from '../context/OSContext';
import { INSTALLED_APPS, DOCK_APPS } from '../constants';
import { isDevDebugAvailable, subscribeDevDebugAvailability } from '../utils/devDebug';
import AppIcon from '../components/os/AppIcon';
import LauncherAppGrid from '../components/os/LauncherAppGrid';
import { LAUNCHER_FOLDER_ID, LAUNCHER_EMPTY_SLOT_PREFIX, normalizeLauncherLayout, moveLauncherItem, type LauncherFolderLayout } from '../utils/launcherFolder';
import TokenImg from '../components/os/TokenImg';
import { useBlobRefUrl } from '../utils/blobRef';
import { DB } from '../utils/db';
import { isChatPreviewMessage, chatPreviewText } from '../utils/chatMessageVisibility';
import { CharacterProfile, Anniversary, AppID, DailySchedule } from '../types';
import { ScheduleHomeWidget, ScheduleFullscreenViewer } from '../components/schedule/ScheduleHomeWidget';
import NowPlayingSquareWidget from '../components/os/NowPlayingSquareWidget';
import MobileGameHome from '../components/os/MobileGameHome';
import TamagotchiHome from '../components/os/TamagotchiHome';
import { getDailyScheduleForChar } from '../utils/dailySchedule';
import { useLocalDateKey } from '../hooks/useLocalDateKey';
import { resolveCharTimeZone } from '../utils/timezone';
import { trackEvent } from '../utils/analytics';
import TheaterPlayer from '../components/schedule/TheaterPlayer';
import { generateSlotTheater } from '../utils/theaterGenerator';
import { persistScheduleTheaterCard } from '../utils/scheduleTheater';

const CompanionHome = React.lazy(() => import('../components/os/CompanionHome'));
const HomelyHome = React.lazy(() => import('../components/os/HomelyHome'));

// --- Isolated Components to prevent full re-renders ---

// 1. Clock Component (Consumes virtualTime)
const DesktopClock = React.memo(() => {
    const { virtualTime, theme } = useOS();
    const contentColor = theme.contentColor || '#ffffff';
    const clockStyle = theme.desktopClockStyle || (theme.desktopVariant === 'nostalgia' ? 'bold' : 'serif');
    const serifClock = clockStyle === 'serif';
    const paper = theme.skin !== 'animalcrossing' && theme.skin !== 'mobilegame' && theme.skin !== 'tamagotchi' && isPaperWallpaper(theme.wallpaper);

    const days = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY'];
    const months = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
    const now = new Date();
    const dayName = days[now.getDay()];
    const monthName = months[now.getMonth()];
    const dateNum = now.getDate().toString().padStart(2, '0');
    const yearNum = now.getFullYear();

    // 简单问候（基于虚拟时间）
    const greeting = virtualTime.hours < 5 ? 'Good Night'
        : virtualTime.hours < 12 ? 'Good Morning'
        : virtualTime.hours < 18 ? 'Good Afternoon'
        : 'Good Evening';

    const hh = virtualTime.hours.toString().padStart(2, '0');
    const mm = virtualTime.minutes.toString().padStart(2, '0');

    // 动森彩蛋：NookPhone 主屏时钟 —— 问候 + 大号时间(主角) + 星期·日期
    if (theme.skin === 'animalcrossing') {
        const weekdayTitle = dayName.charAt(0) + dayName.slice(1).toLowerCase();
        const monthTitle = monthName.charAt(0) + monthName.slice(1).toLowerCase();
        return (
            <div className="mt-7 mb-5 text-center animate-fade-in select-none">
                <div className="text-[13px] font-extrabold tracking-wide" style={{ color: '#8a7a5c' }}>
                    🍃 {greeting}, Resident
                </div>
                <div className="text-[3.5rem] font-extrabold leading-none mt-1.5 tracking-[2px]" style={{ color: '#8b7355' }}>
                    {hh}<span className="animate-pulse" style={{ color: '#cfcab2' }}>:</span>{mm}
                </div>
                <div className="text-[15px] font-bold mt-1.5" style={{ color: '#725C4E' }}>
                    {weekdayTitle} · {monthTitle} {Number(dateNum)}
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col mb-5 mt-5 relative animate-fade-in" style={{ color: contentColor }}>
            {/* 顶部装饰 — 状态胶囊 + 细线 */}
            <div className="flex items-center gap-2 mb-3 opacity-90">
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full"
                    style={{
                        background: paper ? 'rgba(224,221,215,0.30)' : 'rgba(255,255,255,0.28)',
                        border: paper ? '1px solid rgba(91,72,51,0.07)' : '1px solid rgba(255,255,255,0.18)',
                    }}>
                    <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: paper ? '#788369' : '#4ade80', boxShadow: paper ? 'none' : '0 0 6px #4ade80' }} />
                    <span className="text-[9px] font-bold tracking-[0.2em] uppercase">System Online</span>
                </div>
                <div className="h-[1px] flex-1 bg-gradient-to-r from-current to-transparent opacity-30" />
                <span className="text-[9px] tracking-[0.2em] uppercase opacity-60">{yearNum}</span>
            </div>

            {/* 问候 */}
            <div className="text-[11px] tracking-[0.25em] uppercase opacity-55 font-semibold mb-1">
                {greeting}
            </div>

            {/* 主时钟 */}
            <div className="flex items-end gap-4">
                <div className="relative">
                    <div className={`${serifClock ? 'text-[5.65rem] font-semibold tracking-[-0.055em] drop-shadow-[0_2px_0_rgba(255,255,255,0.34)]' : 'text-[6.25rem] font-black tracking-tighter drop-shadow-2xl'} leading-[0.84]`}
                        style={{ fontFamily: clockStyle === 'system' ? 'inherit' : serifClock ? `'Iowan Old Style', 'Baskerville', 'Times New Roman', serif` : `'Space Grotesk', 'SF Pro Display', sans-serif`, fontFeatureSettings: '"tnum"' }}>
                        <span>{virtualTime.hours.toString().padStart(2, '0')}</span>
                        <span className="opacity-35 font-thin mx-0.5 animate-pulse">:</span>
                        <span>{virtualTime.minutes.toString().padStart(2, '0')}</span>
                    </div>
                    {/* 细光斑 */}
                    {!paper && <div className="absolute -top-2 -right-3 w-8 h-8 rounded-full pointer-events-none"
                        style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.4), transparent 70%)' }} />}
                </div>

                <div className="flex flex-col justify-end pb-2.5 gap-0.5">
                    <div className="text-[10px] font-bold tracking-[0.22em] opacity-85">{dayName}</div>
                    <div className="flex items-baseline gap-1">
                        <div className="text-2xl font-black leading-none" style={{ fontFamily: `'Space Grotesk', sans-serif` }}>{dateNum}</div>
                        <div className="text-[10px] font-bold tracking-[0.2em] opacity-70">{monthName}</div>
                    </div>
                </div>
            </div>
        </div>
    );
});

// 2. Character Widget (Consumes Character Data & Messages)
const CharacterWidget = React.memo(({ 
    char, 
    unreadCount, 
    lastMessage, 
    onClick, 
    contentColor,
    paper = false,
}: { 
    char: CharacterProfile | null, 
    unreadCount: number, 
    lastMessage: string, 
    onClick: () => void,
    contentColor: string,
    paper?: boolean,
}) => {
    const { theme } = useOS();
    const acnh = theme.skin === 'animalcrossing'; // 动森彩蛋：会"说话"的村民卡
    // 卡片底的虚化头像画在 CSS background-image 上，吃不到 TokenImg 的解析，这里自己解析一次。
    const avatarUrl = useBlobRefUrl(char?.avatar);

    // 动森：村民头像 + AC 对话气泡（显示最近消息，点开聊天）
    if (acnh) {
        return (
            <div className="mb-4 animate-fade-in" onClick={onClick}>
                <div className="flex items-end gap-2.5 cursor-pointer active:scale-[0.98] transition-transform">
                    {/* 村民头像（圆角方块 + 白边） */}
                    <div className="relative w-[60px] h-[60px] shrink-0 rounded-[26%] overflow-hidden bg-[#e8e2d6]"
                        style={{ border: '3px solid #ffffff', boxShadow: '0 4px 10px -2px rgba(61,52,40,0.28)' }}>
                        {char?.avatar
                            ? <TokenImg value={char.avatar} className="w-full h-full object-cover" alt="char" loading="lazy" />
                            : <div className="w-full h-full flex items-center justify-center text-2xl">🍃</div>}
                        {unreadCount > 0 && (
                            <div className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 bg-[#fc736d] rounded-full flex items-center justify-center text-[10px] font-bold text-white"
                                style={{ border: '2px solid #fff' }}>
                                {unreadCount > 9 ? '9+' : unreadCount}
                            </div>
                        )}
                    </div>
                    {/* AC 对话气泡 */}
                    <div className="relative flex-1 min-w-0 mb-1">
                        <div className="absolute -left-1.5 bottom-3 w-3 h-3 rotate-45"
                            style={{ background: '#FFFBF2', borderLeft: '2px solid #ece0c8', borderBottom: '2px solid #ece0c8' }} />
                        <div className="relative rounded-2xl px-3.5 py-2.5"
                            style={{ background: '#FFFBF2', border: '2px solid #ece0c8', boxShadow: '0 4px 12px -5px rgba(120,90,40,0.25)' }}>
                            <div className="flex items-center gap-1.5 mb-0.5">
                                <span className="text-[13px] font-extrabold truncate" style={{ color: '#725d42' }}>{char?.name || 'Resident'}</span>
                                <span className="text-[11px] leading-none">{unreadCount > 0 ? '💬' : '🍃'}</span>
                            </div>
                            <div className="text-[11px] leading-snug line-clamp-2" style={{ color: '#9f8b68' }}>{lastMessage}</div>
                        </div>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="mb-3 group animate-fade-in">
             <div
                className="relative h-24 w-full overflow-hidden rounded-3xl cursor-pointer transition-transform duration-300 active:scale-[0.98]"
                onClick={onClick}
                style={paper ? {
                    background: 'rgba(224,221,215,0.40)',
                    border: '1px solid rgba(91,72,51,0.07)',
                    boxShadow: '0 5px 16px rgba(91,72,51,0.055)',
                } : acnh ? {
                    background: 'rgb(247,243,223)',
                    border: '2px solid #e8e2d6',
                    boxShadow: '0 8px 24px 0 rgba(61,52,40,0.14)',
                } : {
                    background: 'rgba(255,255,255,0.08)',
                    backdropFilter: 'blur(24px) saturate(1.4)',
                    WebkitBackdropFilter: 'blur(24px) saturate(1.4)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.15), inset 0 1px 0 rgba(255,255,255,0.08)',
                }}
             >
                 {/* 背景虚化角色头像（动森模式下省略，避免糊在奶油底上） */}
                 {!acnh && !paper && avatarUrl && (
                     <div className="absolute inset-0 opacity-25 pointer-events-none"
                         style={{
                             backgroundImage: `url(${avatarUrl})`,
                             backgroundSize: 'cover',
                             backgroundPosition: 'center',
                             filter: 'blur(30px) saturate(1.6)',
                             transform: 'scale(1.3)',
                         }} />
                 )}

                 <div className="relative flex items-center p-3 gap-3 h-full">
                     {/* 头像 */}
                     <div className={`w-[68px] h-[68px] shrink-0 rounded-2xl overflow-hidden relative ${paper ? 'bg-[#ded2c1]' : 'bg-slate-800'}`}
                         style={{
                             border: paper ? '1px solid rgba(91,72,51,0.14)' : acnh ? '2px solid #e8e2d6' : '1.5px solid rgba(255,255,255,0.25)',
                             boxShadow: paper ? '0 5px 14px rgba(91,72,51,0.13)' : acnh ? '0 4px 12px -4px rgba(61,52,40,0.25)' : '0 4px 14px rgba(0,0,0,0.25)',
                         }}>
                         {char ? (
                             <TokenImg value={char.avatar} className="w-full h-full object-cover" alt="char" loading="lazy" />
                         ) : <div className="w-full h-full bg-white/10 animate-pulse" />}
                         {unreadCount > 0 ? (
                            <div className="absolute bottom-0.5 right-0.5 min-w-[16px] h-[16px] px-1 bg-red-500 rounded-full border border-white/30 shadow-sm flex items-center justify-center text-[9px] font-bold text-white">
                                {unreadCount > 9 ? '9+' : unreadCount}
                            </div>
                         ) : (
                            <div className="absolute bottom-1 right-1 w-2.5 h-2.5 rounded-full border-2 border-white/60" style={{ background: paper ? '#788369' : '#4ade80', boxShadow: paper ? 'none' : '0 0 6px #4ade80' }}></div>
                         )}
                     </div>

                     {/* 文本 */}
                     <div className="flex-1 min-w-0 flex flex-col justify-center gap-1" style={{ color: contentColor }}>
                         <div className="flex items-center gap-1.5">
                             <h3 className={`text-[15px] font-bold tracking-wide truncate ${paper ? '' : 'drop-shadow-md'}`}>
                                 {char?.name || 'NO SIGNAL'}
                             </h3>
                             {unreadCount > 0 ? (
                                 <div className="px-1.5 py-px rounded-full text-[8px] font-bold uppercase tracking-[0.15em]"
                                     style={{ background: 'rgba(239,68,68,0.9)', color: 'white' }}>NEW</div>
                             ) : (
                                 <div className="px-1.5 py-px rounded-full text-[8px] font-bold uppercase tracking-[0.15em]"
                                     style={paper ? { background: 'rgba(120,131,105,0.16)', color: '#68725b' } : acnh ? { background: '#7cba4c', color: 'white' } : { background: 'rgba(255,255,255,0.18)' }}>Online</div>
                             )}
                         </div>
                         <div className="text-xs font-medium leading-relaxed opacity-85 flex items-start gap-1.5">
                            <span
                                aria-hidden="true"
                                className="shrink-0 mt-[0.42em] opacity-45"
                                style={{ width: 0, height: 0, borderTop: '3px solid transparent', borderBottom: '3px solid transparent', borderLeft: '4px solid currentColor' }}
                            />
                            <span className="line-clamp-2">{lastMessage}</span>
                         </div>
                     </div>
                 </div>
             </div>
        </div>
    );
});

// 3c. Square image slot for pinwheel (bottom-right)
const DesktopSquareImage = React.memo(({ image, contentColor, onClick, acnh = false }: {
    image?: string,
    contentColor: string,
    onClick: () => void,
    acnh?: boolean,
}) => {
    const { theme } = useOS();
    const paper = theme.skin !== 'animalcrossing' && theme.skin !== 'mobilegame' && theme.skin !== 'tamagotchi' && isPaperWallpaper(theme.wallpaper);
    return (
        <div
            onClick={onClick}
            className="relative w-full h-full rounded-[1.75rem] overflow-hidden cursor-pointer animate-fade-in transition-transform active:scale-[0.98]"
            style={paper ? {
                background: image ? 'rgba(224,221,215,0.26)' : 'rgba(224,221,215,0.38)',
                border: '1px solid rgba(91,72,51,0.07)',
                boxShadow: '0 5px 16px rgba(91,72,51,0.055)',
                color: contentColor,
            } : acnh ? {
                background: image ? 'rgb(247,243,223)' : 'rgb(247,243,223)',
                border: '2px solid #e8e2d6',
                boxShadow: '0 6px 18px rgba(61,52,40,0.12)',
                color: contentColor,
            } : {
                background: image ? 'rgba(0,0,0,0.18)' : 'rgba(255,255,255,0.28)',
                border: '1px solid rgba(255,255,255,0.18)',
                boxShadow: '0 8px 30px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.07)',
                color: contentColor,
            }}
        >
            {image ? (
                <TokenImg value={image} alt="" className="w-full h-full object-cover" loading="lazy" />
            ) : (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-3 text-center">
                    <div className="w-9 h-9 rounded-full flex items-center justify-center"
                        style={{ background: paper ? 'rgba(120,131,105,0.10)' : 'rgba(255,255,255,0.1)', border: paper ? '1px solid rgba(91,72,51,0.12)' : '1px solid rgba(255,255,255,0.16)' }}>
                        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.6} stroke="currentColor" className="w-4 h-4 opacity-70">
                            <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909m-18 3.75h16.5a1.5 1.5 0 0 0 1.5-1.5V6a1.5 1.5 0 0 0-1.5-1.5H3.75A1.5 1.5 0 0 0 2.25 6v12a1.5 1.5 0 0 0 1.5 1.5Zm10.5-11.25h.008v.008h-.008V8.25Zm.375 0a.375.375 0 1 1-.75 0 .375.375 0 0 1 .75 0Z" />
                        </svg>
                    </div>
                    <div className="text-[8.5px] uppercase font-bold tracking-[0.22em] opacity-55">Add Image</div>
                    <div className="text-[8.5px] opacity-40 leading-tight">从 外观 · 启动器组件<br/>设置一张方图</div>
                </div>
            )}
        </div>
    );
});

const CALENDAR_WEEKDAYS = [
    { key: 'sun', label: 'S' },
    { key: 'mon', label: 'M' },
    { key: 'tue', label: 'T' },
    { key: 'wed', label: 'W' },
    { key: 'thu', label: 'T' },
    { key: 'fri', label: 'F' },
    { key: 'sat', label: 'S' },
] as const;

// 4. Widget Page Component (Calendar + Events)
const WidgetsPage = React.memo(({ contentColor, openApp, anniversaries, characters, acnh = false, paper = false }: any) => {
    // 动森：奶油卡片样式（替代暗色玻璃）
    const acCard = acnh ? { background: 'rgb(247,243,223)', border: '2px solid #e8e2d6', boxShadow: '0 6px 18px rgba(61,52,40,0.12)' } : undefined;
    const acDot = acnh ? '#6fba2c' : undefined;
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth();
    const monthName = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'][currentMonth];
    
    const getDaysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();
    const getFirstDayOfMonth = (year: number, month: number) => new Date(year, month, 1).getDay();
    
    const totalDays = getDaysInMonth(currentYear, currentMonth);
    const startOffset = getFirstDayOfMonth(currentYear, currentMonth);
    
    const calendarDays = Array.from({ length: totalDays }, (_, i) => i + 1);
    const paddingDays = Array.from({ length: startOffset }, () => null);

    // --- Upcoming events: only today + future, soonest first (non-mutating), paginated ---
    const todayStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    const upcomingEvents = useMemo(
        () => [...(anniversaries as any[])]
            .filter((a: any) => a.date >= todayStr)
            .sort((a: any, b: any) => a.date.localeCompare(b.date)),
        [anniversaries, todayStr]
    );
    const EVENTS_PER_PAGE = 4;
    const eventPageCount = Math.max(1, Math.ceil(upcomingEvents.length / EVENTS_PER_PAGE));
    const [eventPage, setEventPage] = useState(0);
    // Clamp the page if the list shrinks (e.g. an event passes / is removed)
    useEffect(() => {
        if (eventPage > eventPageCount - 1) setEventPage(eventPageCount - 1);
    }, [eventPageCount, eventPage]);
    const pagedEvents = upcomingEvents.slice(eventPage * EVENTS_PER_PAGE, eventPage * EVENTS_PER_PAGE + EVENTS_PER_PAGE);

    return (
        <div className="launcher-page w-full flex-shrink-0 snap-center snap-always flex flex-col px-6 pt-24 pb-8 space-y-6 h-full overflow-y-auto no-scrollbar">
              <div className={`rounded-3xl p-6 ${acnh ? 'shadow-sm' : paper ? '' : 'bg-white/25 border border-white/25 shadow-xl'}`} style={paper ? { background: 'rgba(224,221,215,0.36)', border: '1px solid rgba(91,72,51,0.07)', boxShadow: '0 5px 16px rgba(91,72,51,0.05)' } : acCard}>
                  <div className="flex justify-between items-center mb-4" style={{ color: contentColor }}>
                      <h3 className="text-xl font-bold tracking-widest">{monthName} {currentYear}</h3>
                      <div onClick={() => openApp('schedule')} className={`p-2 rounded-full cursor-pointer transition-colors ${acnh ? 'bg-[#82D5BB]/30 hover:bg-[#82D5BB]/50' : paper ? 'bg-[#788369]/10 hover:bg-[#788369]/20' : 'bg-white/20 hover:bg-white/40'}`}>
                          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-4 h-4"><path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" /></svg>
                      </div>
                  </div>
                  
                  <div className="grid grid-cols-7 gap-y-3 gap-x-1 text-center mb-2">
                      {CALENDAR_WEEKDAYS.map(day => <div key={day.key} className="text-[10px] font-bold opacity-40" style={{ color: contentColor }}>{day.label}</div>)}
                  </div>
                  
                  <div className="grid grid-cols-7 gap-y-2 gap-x-1 text-center">
                      {paddingDays.map((_, i) => <div key={`pad-${i}`} />)}
                      {calendarDays.map(day => {
                          const dateStr = `${currentYear}-${String(currentMonth + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                          const isToday = day === now.getDate();
                          const hasEvent = anniversaries.some((a: any) => a.date === dateStr);
                          
                          return (
                              <div key={day} className="flex flex-col items-center justify-center h-8 relative">
                                  <div
                                    className={`w-8 h-8 flex items-center justify-center rounded-full text-sm font-medium ${isToday ? (acnh ? 'text-white font-bold' : paper ? 'text-white font-bold' : 'bg-white text-black font-bold shadow-lg') : 'opacity-80'}`}
                                    style={isToday ? (acnh ? { background: '#19c8b9' } : paper ? { background: '#788369', boxShadow: '0 4px 10px rgba(91,72,51,0.14)' } : {}) : { color: contentColor }}
                                  >
                                      {day}
                                  </div>
                                  {hasEvent && <div className="w-1.5 h-1.5 rounded-full absolute bottom-0 shadow-sm border border-black/10" style={{ background: acDot || (paper ? '#a66f52' : '#c084fc') }}></div>}
                              </div>
                          );
                      })}
                  </div>
              </div>

              <div className={`rounded-3xl p-5 flex flex-col flex-1 min-h-[200px] ${acnh ? 'shadow-sm' : paper ? '' : 'bg-white/25 border border-white/25 shadow-xl'}`} style={paper ? { background: 'rgba(224,221,215,0.36)', border: '1px solid rgba(91,72,51,0.07)', boxShadow: '0 5px 16px rgba(91,72,51,0.05)' } : acCard}>
                  <div className="flex items-center justify-between mb-4">
                      <h3 className="text-xs font-bold opacity-60 uppercase tracking-widest flex items-center gap-2" style={{ color: contentColor }}>
                          <span className="w-2 h-2 rounded-full" style={{ background: acDot || (paper ? '#a66f52' : '#c084fc') }}></span> Upcoming Events
                      </h3>
                      {eventPageCount > 1 && (
                          <div className="flex items-center gap-2 shrink-0" style={{ color: contentColor }}>
                              <button
                                  onClick={(e) => { e.stopPropagation(); setEventPage(p => Math.max(0, p - 1)); }}
                                  disabled={eventPage === 0}
                                  className={`w-6 h-6 rounded-full flex items-center justify-center disabled:opacity-25 transition-colors active:scale-90 ${paper ? 'bg-[#788369]/10 hover:bg-[#788369]/20' : 'bg-white/15 hover:bg-white/30'}`}
                                  aria-label="Previous events"
                              >
                                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" /></svg>
                              </button>
                              <span className="text-[10px] font-mono opacity-60 tabular-nums">{eventPage + 1}/{eventPageCount}</span>
                              <button
                                  onClick={(e) => { e.stopPropagation(); setEventPage(p => Math.min(eventPageCount - 1, p + 1)); }}
                                  disabled={eventPage >= eventPageCount - 1}
                                  className={`w-6 h-6 rounded-full flex items-center justify-center disabled:opacity-25 transition-colors active:scale-90 ${paper ? 'bg-[#788369]/10 hover:bg-[#788369]/20' : 'bg-white/15 hover:bg-white/30'}`}
                                  aria-label="Next events"
                              >
                                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2.5} stroke="currentColor" className="w-3 h-3"><path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" /></svg>
                              </button>
                          </div>
                      )}
                  </div>
                  <div className="space-y-3">
                      {upcomingEvents.length > 0 ? pagedEvents.map((anni: any) => (
                          <div key={anni.id} className={`flex items-center gap-3 p-3 rounded-xl ${acnh ? 'bg-[#efe7d4] border border-[#e0d6c0]' : paper ? 'bg-[#f3ecdf]/70 border border-[#5b4833]/10' : 'bg-white/5 border border-white/10'}`}>
                              <div className={`w-10 h-10 shrink-0 rounded-lg flex flex-col items-center justify-center ${acnh ? 'bg-[#82D5BB] text-white border border-[#6cc0a6]' : paper ? 'bg-[#a66f52]/12 text-[#8c5d46] border border-[#a66f52]/15' : 'bg-purple-500/20 text-purple-200 border border-purple-500/30'}`}>
                                  <span className="text-[9px] opacity-70">{anni.date.split('-')[1]}</span>
                                  <span className="text-sm font-bold leading-none">{anni.date.split('-')[2]}</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                  <div className="text-sm font-bold truncate" style={{ color: contentColor }}>{anni.title}</div>
                                  <div className="text-[10px] opacity-50 truncate" style={{ color: contentColor }}>{characters.find((c: any) => c.id === anni.charId)?.name || 'Unknown'}</div>
                              </div>
                          </div>
                      )) : (
                          <div className="text-center opacity-30 text-xs py-8" style={{ color: contentColor }}>No upcoming events</div>
                      )}
                  </div>
              </div>
        </div>
    );
});

// --- Persist scroll page across remounts (e.g. returning from apps) ---
let _lastPageIndex = 0;

// --- Main Launcher ---

const Launcher: React.FC<{ staticPreview?: boolean }> = ({ staticPreview = false }) => {
  const { openApp, characters, activeCharacterId, theme, updateTheme, lastMsgTimestamp, isDataLoaded, unreadMessages, userProfile, apiConfig, addToast, registerBackHandler } = useOS();

  // Local state for widget data to prevent context trashing
  const [widgetChar, setWidgetChar] = useState<CharacterProfile | null>(staticPreview ? characters[0] || null : null);
  const [lastMessage, setLastMessage] = useState<string>(staticPreview ? '今天也有想和你分享的小事。' : '');
  const [anniversaries, setAnniversaries] = useState<Anniversary[]>([]);
  const [scheduleData, setScheduleData] = useState<DailySchedule | null>(null);
  const [scheduleCharId, setScheduleCharId] = useState<string | null>(null);
  const [scheduleViewerOpen, setScheduleViewerOpen] = useState(false);
  const [theaterSlotIdx, setTheaterSlotIdx] = useState<number | null>(null);
  const [theaterGenerating, setTheaterGenerating] = useState(false);
  const [layoutEditing, setLayoutEditing] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [folderManaging, setFolderManaging] = useState(false);
  const [folderNameDraft, setFolderNameDraft] = useState(theme.launcherFolderName || '不太常用');
  const folderPanelRef = useRef<HTMLDivElement>(null);
  const layoutPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const layoutPointer = useRef<{
      pointerId: number;
      key: string;
      kind: string;
      x: number;
      y: number;
      active: boolean;
      element: HTMLElement;
      ghost?: HTMLElement;
      grabOffsetX?: number;
      grabOffsetY?: number;
      lastTarget?: string;
      targetElement?: HTMLElement;
      fromFolder?: boolean;
  } | null>(null);
  const suppressLayoutClickUntil = useRef(0);
  const layoutPageTurnTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const layoutPageTurnDirection = useRef<-1 | 0 | 1>(0);

  const [activePageIndex, setActivePageIndex] = useState(_lastPageIndex);
  const activePageIndexRef = useRef(_lastPageIndex);
  const pageWidthRef = useRef(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Mouse Drag Logic refs
  const isDragging = useRef(false);
  const startX = useRef(0);
  const scrollLeftRef = useRef(0);
  const dragMoved = useRef(0);

  // Pagination Logic
  // 跟随 DevDebug 可用性：prod 用户在设置页连点 5 下解锁后，CharCreatorDev 立刻出现；
  // 点「关闭」/ 刷新（prod 自动失效）也立刻消失。useMemo deps 没列 devDebugVisible
  // 会让它锁在 mount 时的初值。
  const [devDebugVisible, setDevDebugVisible] = useState(() => !staticPreview && isDevDebugAvailable());
  useEffect(() => subscribeDevDebugAvailability(setDevDebugVisible), []);
  const availableGridApps = useMemo(() => {
    return INSTALLED_APPS.filter(app =>
      !DOCK_APPS.includes(app.id)
      // 「捏脸·开发」仅在开发模式（右下角开发徽标可见或手动解锁时）显示
      && (app.id !== AppID.CharCreatorDev || devDebugVisible)
    );
  }, [devDebugVisible]);

  const normalizeOrder = useCallback((saved: string[] | undefined, available: string[]) => {
      const valid = new Set(available);
      return [...(saved || []).filter((id, index, all) => valid.has(id) && all.indexOf(id) === index), ...available.filter(id => !(saved || []).includes(id))];
  }, []);

  const availableGridIds = useMemo(() => availableGridApps.map(app => app.id), [availableGridApps]);
  const [folderLayout, setFolderLayout] = useState<LauncherFolderLayout>(() => normalizeLauncherLayout(theme, availableGridIds));
  const [launcherDockOrder, setLauncherDockOrder] = useState<string[]>(() => normalizeOrder(theme.launcherDockOrder, DOCK_APPS));
  const [pinwheelOrder, setPinwheelOrder] = useState<Array<'music' | 'appsA' | 'appsB' | 'image'>>(() => {
      const available = ['music', 'appsA', 'appsB', 'image'] as const;
      const saved = theme.launcherPinwheelOrder || [];
      return [...saved.filter((id, index) => available.includes(id) && saved.indexOf(id) === index), ...available.filter(id => !saved.includes(id))];
  });
  const folderLayoutRef = useRef(folderLayout);
  const launcherDockOrderRef = useRef(launcherDockOrder);
  const pinwheelOrderRef = useRef(pinwheelOrder);

  useEffect(() => {
      if (layoutEditing) return;
      const next = normalizeLauncherLayout(theme, availableGridIds);
      folderLayoutRef.current = next;
      setFolderLayout(next);
  }, [availableGridIds, layoutEditing, theme.launcherAppOrder, theme.launcherFolderApps]);
  useEffect(() => { launcherDockOrderRef.current = launcherDockOrder; }, [launcherDockOrder]);
  useEffect(() => { pinwheelOrderRef.current = pinwheelOrder; }, [pinwheelOrder]);
  useEffect(() => {
      if (layoutEditing) return;
      const next = normalizeOrder(theme.launcherDockOrder, DOCK_APPS);
      launcherDockOrderRef.current = next;
      setLauncherDockOrder(next);
  }, [layoutEditing, normalizeOrder, theme.launcherDockOrder]);
  useEffect(() => {
      if (layoutEditing) return;
      const available = ['music', 'appsA', 'appsB', 'image'] as const;
      const saved = theme.launcherPinwheelOrder || [];
      const next = [...saved.filter((id, index) => available.includes(id) && saved.indexOf(id) === index), ...available.filter(id => !saved.includes(id))];
      pinwheelOrderRef.current = next;
      setPinwheelOrder(next);
  }, [layoutEditing, theme.launcherPinwheelOrder]);

  const dockAppsConfig = useMemo(() => {
      const byId = new Map(INSTALLED_APPS.map(app => [app.id, app]));
      return launcherDockOrder.map(id => byId.get(id as AppID)).filter(Boolean) as typeof INSTALLED_APPS;
  }, [launcherDockOrder]);

  // The first two pages have large widgets, so they keep 8 apps each. Page 3 has the
  // full-height grid and absorbs every remaining app instead of creating sparse tail pages.
  const appPages = useMemo(() => {
      return [folderLayout.order.slice(0, 8), folderLayout.order.slice(8, 16), folderLayout.order.slice(16)];
  }, [folderLayout.order]);
  const folderName = theme.launcherFolderName || '不太常用';
  useEffect(() => { setFolderNameDraft(folderName); }, [folderName]);
  const gridProps = { editing: layoutEditing, folderApps: folderLayout.folderApps, folderName, openApp, openFolder: () => { setFolderOpen(true); setFolderManaging(false); } };
  const commitFolderLayout = (next: LauncherFolderLayout) => {
      if (staticPreview) return;
      const normalized = normalizeLauncherLayout({ launcherAppOrder: next.order, launcherFolderApps: next.folderApps }, availableGridIds);
      folderLayoutRef.current = normalized;
      setFolderLayout(normalized);
      void updateTheme({ launcherAppOrder: normalized.order, launcherFolderApps: normalized.folderApps });
  };
  const toggleFolderApp = (id: string) => {
      const layout = folderLayoutRef.current;
      const target = layout.folderApps.includes(id) ? `${LAUNCHER_EMPTY_SLOT_PREFIX}${layout.order.indexOf('')}` : LAUNCHER_FOLDER_ID;
      commitFolderLayout(moveLauncherItem(layout, id, target));
  };
  useEffect(() => {
      if (staticPreview || (!folderOpen && !layoutEditing)) return;
      const close = () => {
          finishLayoutPointer(undefined, true);
          if (folderOpen) { setFolderOpen(false); setFolderManaging(false); }
          else setLayoutEditing(false);
          return true;
      };
      const unregister = registerBackHandler(close);
      const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
      window.addEventListener('keydown', onKeyDown);
      return () => { unregister(); window.removeEventListener('keydown', onKeyDown); };
  }, [folderOpen, layoutEditing, registerBackHandler, staticPreview]);
  useEffect(() => {
      if (!folderOpen) return;
      const previous = document.activeElement as HTMLElement | null;
      const panel = folderPanelRef.current;
      panel?.querySelector<HTMLElement>('input, button')?.focus();
      const trapFocus = (event: KeyboardEvent) => {
          if (event.key !== 'Tab' || !panel) return;
          const controls = Array.from(panel.querySelectorAll<HTMLElement>('button, input, [tabindex="0"]'));
          const first = controls[0], last = controls[controls.length - 1];
          if (event.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
              event.preventDefault(); last?.focus();
          } else if (!event.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
              event.preventDefault(); first?.focus();
          }
      };
      window.addEventListener('keydown', trapFocus);
      return () => { window.removeEventListener('keydown', trapFocus); if (previous?.isConnected) previous.focus(); };
  }, [folderOpen]);

  // Page 2 (pinwheel) uses appPages[1]: split into two 2x2 quads
  const page2Apps = appPages[1] || [];
  const page2QuadA = useMemo(() => page2Apps.slice(0, 4), [page2Apps]);
  const page2QuadB = useMemo(() => page2Apps.slice(4, 8), [page2Apps]);

  // Total pages = App Pages + 1 Widget Page
  const totalPages = appPages.length + 1;

  useEffect(() => { activePageIndexRef.current = activePageIndex; }, [activePageIndex]);

  useEffect(() => {
      let cancelled = false;
      const loadData = async () => {
          // SAFEGUARD: If characters array is empty, reset widget char
          if (!characters || characters.length === 0) {
              setWidgetChar(null);
              setLastMessage('No Character Connected');
              setAnniversaries([]);
              return;
          }

          const targetChar = characters.find(c => c.id === activeCharacterId) || characters[0];
          setWidgetChar(targetChar);

          try {
              const [recent, annis] = await Promise.all([
                  DB.getRecentMessagesWithCount(targetChar.id, 1, isChatPreviewMessage),
                  DB.getAllAnniversaries()
              ]);
              if (cancelled) return;
              const last = recent.messages[0];
              if (last) {
                  setLastMessage(chatPreviewText(last));
              } else {
                  setLastMessage(targetChar.description || "System Ready.");
              }
              setAnniversaries(annis);
          } catch (e) {
              console.error(e);
          }
      };
      
      if (isDataLoaded) {
          loadData();
      }
      return () => { cancelled = true; };
  }, [activeCharacterId, lastMsgTimestamp, isDataLoaded, characters]); // Trigger on characters change

  // Schedule widget data loading (shown below SpecialMoments icon)
  const scheduleChar = useMemo(() => {
      if (!characters || characters.length === 0) return null;
      if (scheduleCharId) return characters.find(c => c.id === scheduleCharId) || characters[0];
      return characters.find(c => c.id === activeCharacterId) || characters[0];
  }, [characters, scheduleCharId, activeCharacterId]);
  const scheduleDateKey = useLocalDateKey(resolveCharTimeZone(scheduleChar));
  const activeSchedule = scheduleChar && scheduleData?.charId === scheduleChar.id ? scheduleData : null;

  useEffect(() => {
      if (!scheduleChar || !isDataLoaded) return;
      getDailyScheduleForChar(scheduleChar).then(s => setScheduleData(s)).catch(() => {});
  }, [scheduleChar, isDataLoaded, scheduleDateKey]);

  const openScheduleTheater = async (index: number, forceRegenerate = false) => {
      if (!scheduleChar || !activeSchedule || theaterGenerating) return;
      const schedule = activeSchedule;
      const slot = schedule.slots[index];
      if (!slot) return;

      setScheduleViewerOpen(false);
      setTheaterSlotIdx(index);
      if (!forceRegenerate && slot.theater?.lines.length) return;

      setTheaterGenerating(true);
      try {
          const updated = await generateSlotTheater(scheduleChar, userProfile, schedule, index, apiConfig, forceRegenerate);
          if (!updated) throw new Error('empty schedule theater');
          setScheduleData(updated);
      } catch (error) {
          console.error('[Launcher] schedule theater failed:', error);
          addToast('小剧场生成失败，稍后再试', 'error');
          setTheaterSlotIdx(null);
          setScheduleViewerOpen(true);
      } finally {
          setTheaterGenerating(false);
      }
  };

  const sendScheduleTheaterToChat = async (exposed: boolean) => {
      if (theaterSlotIdx === null || !activeSchedule) return;
      try {
          const saved = await persistScheduleTheaterCard(activeSchedule, theaterSlotIdx, exposed);
          if (!saved) return;
          setTheaterSlotIdx(null);
          addToast(exposed ? '已让 TA 发现你在看 👀' : '已悄悄记下 · TA 不知道你看了 🙈', 'info');
          openApp(AppID.Chat);
      } catch (error) {
          console.error('[Launcher] schedule theater card failed:', error);
          addToast('写回聊天失败，稍后再试', 'error');
      }
  };

  // Restore scroll position BEFORE paint to avoid visible flash/slide
  useLayoutEffect(() => {
      const el = scrollContainerRef.current;
      if (!el) return;
      let frame = 0;
      const alignPage = () => {
          if (!el.clientWidth || pageWidthRef.current === el.clientWidth) return;
          pageWidthRef.current = el.clientWidth;
          el.style.scrollBehavior = 'auto';
          el.scrollLeft = el.clientWidth * activePageIndexRef.current;
          cancelAnimationFrame(frame);
          frame = requestAnimationFrame(() => { el.style.scrollBehavior = 'smooth'; });
      };
      alignPage();
      const observer = new ResizeObserver(alignPage);
      observer.observe(el);
      return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleScroll = () => {
      if (scrollContainerRef.current) {
          const width = scrollContainerRef.current.clientWidth;
          if (!width || width !== pageWidthRef.current) return;
          const scrollLeft = scrollContainerRef.current.scrollLeft;
          const index = Math.round(scrollLeft / width);
          setActivePageIndex(index);
          activePageIndexRef.current = index;
          _lastPageIndex = index; // Persist across remounts
      }
  };

  // --- Mouse Drag Handlers ---
  const handleMouseDown = (e: React.MouseEvent) => {
      if (!scrollContainerRef.current || layoutEditing) return;
      isDragging.current = true;
      dragMoved.current = 0;
      startX.current = e.pageX - scrollContainerRef.current.offsetLeft;
      scrollLeftRef.current = scrollContainerRef.current.scrollLeft;
      
      // Disable snap and smooth scroll for direct control
      scrollContainerRef.current.style.scrollBehavior = 'auto';
      scrollContainerRef.current.style.scrollSnapType = 'none';
      scrollContainerRef.current.style.cursor = 'grabbing';
  };

  const handleMouseMove = (e: React.MouseEvent) => {
      if (layoutEditing || !isDragging.current || !scrollContainerRef.current) return;
      e.preventDefault();
      const x = e.pageX - scrollContainerRef.current.offsetLeft;
      const walk = (x - startX.current);
      scrollContainerRef.current.scrollLeft = scrollLeftRef.current - walk;
      
      dragMoved.current = Math.abs(x - (startX.current + scrollContainerRef.current.offsetLeft)); 
  };

  const handleMouseUp = () => {
      if (!isDragging.current || !scrollContainerRef.current) return;
      isDragging.current = false;
      
      // Restore styles
      scrollContainerRef.current.style.scrollBehavior = 'smooth';
      scrollContainerRef.current.style.scrollSnapType = 'x mandatory';
      scrollContainerRef.current.style.cursor = 'grab';
  };

  const handleMouseLeave = () => {
      if (isDragging.current) handleMouseUp();
  };

  const handleClickCapture = (e: React.MouseEvent) => {
      if (dragMoved.current > 5 || Date.now() < suppressLayoutClickUntil.current) {
          e.stopPropagation();
          e.preventDefault();
      }
  };

  const reorderByTarget = useCallback((kind: string, source: string, target: string) => {
      if (source === target) return;
      const reorder = <T extends string>(items: T[]) => {
          const from = items.indexOf(source as T);
          const to = items.indexOf(target as T);
          if (from < 0 || to < 0) return items;
          const next = [...items];
          const [moved] = next.splice(from, 1);
          next.splice(to, 0, moved);
          return next;
      };
      if (kind === 'app') {
          const next = moveLauncherItem(folderLayoutRef.current, source, target);
          folderLayoutRef.current = next;
          setFolderLayout(next);
      } else if (kind === 'dock') {
          const next = reorder(launcherDockOrderRef.current);
          launcherDockOrderRef.current = next;
          setLauncherDockOrder(next);
      } else if (kind === 'widget') {
          const next = reorder(pinwheelOrderRef.current) as Array<'music' | 'appsA' | 'appsB' | 'image'>;
          pinwheelOrderRef.current = next;
          setPinwheelOrder(next);
      }
  }, []);

  const clearLayoutPressTimer = useCallback(() => {
      if (layoutPressTimer.current) clearTimeout(layoutPressTimer.current);
      layoutPressTimer.current = null;
  }, []);

  const clearLayoutPageTurn = useCallback(() => {
      if (layoutPageTurnTimer.current) clearTimeout(layoutPageTurnTimer.current);
      layoutPageTurnTimer.current = null;
      layoutPageTurnDirection.current = 0;
  }, []);

  const activateLayoutDrag = useCallback((pointer: NonNullable<typeof layoutPointer.current>) => {
      if (pointer.ghost) return;
      const rect = pointer.element.getBoundingClientRect();
      const ghost = pointer.element.cloneNode(true) as HTMLElement;
      ghost.removeAttribute('data-launcher-item');
      ghost.removeAttribute('data-launcher-kind');
      ghost.classList.remove('launcher-edit-item', 'launcher-drop-target');
      ghost.classList.add('launcher-drag-ghost');
      Object.assign(ghost.style, {
          position: 'fixed',
          left: `${rect.left}px`,
          top: `${rect.top}px`,
          width: `${rect.width}px`,
          height: `${rect.height}px`,
          margin: '0',
          pointerEvents: 'none',
          zIndex: '9999',
          transform: 'scale(1.055)',
          transformOrigin: 'center',
          transition: 'none',
      });
      document.body.appendChild(ghost);
      pointer.ghost = ghost;
      pointer.grabOffsetX = pointer.x - rect.left;
      pointer.grabOffsetY = pointer.y - rect.top;
      pointer.element.classList.add('launcher-dragging');
      pointer.element.style.pointerEvents = 'none';
  }, []);

  const queueLayoutPageTurn = useCallback((direction: -1 | 1) => {
      if (layoutPageTurnDirection.current === direction && layoutPageTurnTimer.current) return;
      clearLayoutPageTurn();
      layoutPageTurnDirection.current = direction;
      const turn = () => {
          const pointer = layoutPointer.current;
          const scroller = scrollContainerRef.current;
          if (!pointer?.active || pointer.kind !== 'app' || !scroller || layoutPageTurnDirection.current !== direction) {
              clearLayoutPageTurn();
              return;
          }
          const maxAppPage = Math.max(0, appPages.length - 1);
          const nextPage = Math.max(0, Math.min(maxAppPage, activePageIndexRef.current + direction));
          if (nextPage === activePageIndexRef.current) {
              clearLayoutPageTurn();
              return;
          }
          pointer.targetElement?.classList.remove('launcher-drop-target');
          pointer.targetElement = undefined;
          pointer.lastTarget = undefined;
          activePageIndexRef.current = nextPage;
          setActivePageIndex(nextPage);
          _lastPageIndex = nextPage;
          scroller.scrollTo({ left: scroller.clientWidth * nextPage, behavior: 'smooth' });
          layoutPageTurnTimer.current = setTimeout(turn, 760);
      };
      layoutPageTurnTimer.current = setTimeout(turn, 560);
  }, [appPages.length, clearLayoutPageTurn]);

  useEffect(() => () => {
      clearLayoutPressTimer();
      clearLayoutPageTurn();
      const pointer = layoutPointer.current;
      if (pointer) {
          pointer.ghost?.remove();
          pointer.targetElement?.classList.remove('launcher-drop-target');
          pointer.element.classList.remove('launcher-dragging');
          pointer.element.style.pointerEvents = '';
      }
  }, [clearLayoutPageTurn, clearLayoutPressTimer]);

  const handleLayoutPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
      if (staticPreview || layoutPointer.current) return;
      if ((e.target as HTMLElement).closest('[data-launcher-control]')) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      const launcherRoot = e.currentTarget;
      const item = (e.target as HTMLElement).closest<HTMLElement>('[data-launcher-item]');
      if (!item) return;
      const key = item.dataset.launcherItem;
      const kind = item.dataset.launcherKind;
      if (!key || !kind) return;
      if (key.startsWith(LAUNCHER_EMPTY_SLOT_PREFIX)) return;
      clearLayoutPressTimer();
      layoutPointer.current = { pointerId: e.pointerId, key, kind, x: e.clientX, y: e.clientY, active: layoutEditing, element: item, fromFolder: !!item.closest('[data-launcher-folder-content]') };
      if (layoutEditing) {
          activateLayoutDrag(layoutPointer.current);
          launcherRoot.setPointerCapture(e.pointerId);
          e.preventDefault();
          return;
      }
      layoutPressTimer.current = setTimeout(() => {
          if (!layoutPointer.current || layoutPointer.current.pointerId !== e.pointerId) return;
          layoutPointer.current.active = true;
          activateLayoutDrag(layoutPointer.current);
          launcherRoot.setPointerCapture(e.pointerId);
          isDragging.current = false;
          suppressLayoutClickUntil.current = Date.now() + 700;
          setLayoutEditing(true);
          trackEvent('进入桌面整理模式');
      }, 520);
  };

  const handleLayoutPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
      const pointer = layoutPointer.current;
      if (!pointer || pointer.pointerId !== e.pointerId) return;
      if (!pointer.active) {
          if (Math.hypot(e.clientX - pointer.x, e.clientY - pointer.y) > 9) {
              clearLayoutPressTimer();
              layoutPointer.current = null;
          }
          return;
      }
      e.preventDefault();
      if (pointer.ghost) {
          pointer.ghost.style.left = `${e.clientX - (pointer.grabOffsetX || 0)}px`;
          pointer.ghost.style.top = `${e.clientY - (pointer.grabOffsetY || 0)}px`;
      }
      const panelRect = folderPanelRef.current?.getBoundingClientRect();
      if (pointer.fromFolder && panelRect && (e.clientX < panelRect.left || e.clientX > panelRect.right || e.clientY < panelRect.top || e.clientY > panelRect.bottom)) {
          setFolderOpen(false);
          setFolderManaging(false);
      }
      const rootRect = e.currentTarget.getBoundingClientRect();
      if (!folderPanelRef.current && pointer.kind === 'app' && e.clientX <= rootRect.left + 72) queueLayoutPageTurn(-1);
      else if (!folderPanelRef.current && pointer.kind === 'app' && e.clientX >= rootRect.right - 72) queueLayoutPageTurn(1);
      else clearLayoutPageTurn();
      if (!folderPanelRef.current && pointer.kind === 'app') {
          const page = scrollContainerRef.current?.children[activePageIndexRef.current] as HTMLElement | undefined;
          const verticalScroller = page?.querySelector<HTMLElement>('[data-launcher-grid-scroll]') || page;
          if (verticalScroller) {
              const rect = verticalScroller.getBoundingClientRect();
              if (e.clientY < rect.top + 48) verticalScroller.scrollTop -= 18;
              else if (e.clientY > rect.bottom - 48) verticalScroller.scrollTop += 18;
          }
      }
      const target = document.elementFromPoint(e.clientX, e.clientY)?.closest<HTMLElement>('[data-launcher-item]');
      const targetKey = target?.dataset.launcherItem;
      const targetKind = target?.dataset.launcherKind;
      const targetInFolder = !!target?.closest('[data-launcher-folder-content]');
      const validTarget = !!targetKey && targetKind === pointer.kind && targetKey !== pointer.key
          && (!targetInFolder || pointer.fromFolder)
          && (!pointer.fromFolder || targetInFolder || targetKey.startsWith(LAUNCHER_EMPTY_SLOT_PREFIX))
          && !(pointer.key === LAUNCHER_FOLDER_ID && targetKey === LAUNCHER_FOLDER_ID);
      if (!validTarget) {
          pointer.targetElement?.classList.remove('launcher-drop-target');
          pointer.targetElement = undefined;
          pointer.lastTarget = undefined;
          return;
      }
      if (target === pointer.targetElement) return;
      pointer.targetElement?.classList.remove('launcher-drop-target');
      target?.classList.add('launcher-drop-target');
      pointer.targetElement = target;
      pointer.lastTarget = targetKey;
  };

  const finishLayoutPointer = (e?: React.PointerEvent<HTMLDivElement>, cancelled = false) => {
      const pointer = layoutPointer.current;
      if (e && pointer && pointer.pointerId !== e.pointerId) return;
      if (e && pointer?.active && !cancelled) handleLayoutPointerMove(e);
      clearLayoutPressTimer();
      clearLayoutPageTurn();
      if (pointer?.active) {
          suppressLayoutClickUntil.current = Date.now() + 500;
          pointer.element.style.pointerEvents = '';
          pointer.element.classList.remove('launcher-dragging');
          pointer.ghost?.remove();
          pointer.targetElement?.classList.remove('launcher-drop-target');
          if (!cancelled && pointer.lastTarget) {
              reorderByTarget(pointer.kind, pointer.key, pointer.lastTarget);
              const layout = normalizeLauncherLayout({ launcherAppOrder: folderLayoutRef.current.order, launcherFolderApps: folderLayoutRef.current.folderApps }, availableGridIds);
              folderLayoutRef.current = layout;
              setFolderLayout(layout);
              void updateTheme({
                  launcherAppOrder: layout.order,
                  launcherFolderApps: layout.folderApps,
                  launcherDockOrder: launcherDockOrderRef.current,
                  launcherPinwheelOrder: pinwheelOrderRef.current,
              });
          }
      }
      if (e && e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
      layoutPointer.current = null;
  };

  const finishLayoutEditing = () => {
      finishLayoutPointer(undefined, true);
      setLayoutEditing(false);
      setFolderManaging(false);
  };

  const contentColor = theme.contentColor || '#ffffff';
  const acnh = theme.skin === 'animalcrossing'; // 动森彩蛋：Dock 换奶油木质底
  const paper = theme.skin !== 'animalcrossing' && theme.skin !== 'mobilegame' && theme.skin !== 'tamagotchi' && isPaperWallpaper(theme.wallpaper);
  // 已迁移 App 外壳已收回到可见 viewport 底边，dock 仅需自留视觉间距，无需再 + safe-bottom
  // （否则会比 home 条上方多让 34px，dock 看起来悬空）。
  const launcherBottomInset = '1.25rem';
  
  const totalUnread = Object.values(unreadMessages).reduce((a, b) => a + b, 0);
  const widgetUnread = widgetChar && unreadMessages[widgetChar.id] ? unreadMessages[widgetChar.id] : 0;

  // 手游主题：整页换成二次元手游首页布局（独立组件自渲染），不走下面的默认/动森启动器。
  if (theme.skin === 'mobilegame') {
    return <MobileGameHome />;
  }

  // 电子宠物主题：桌面即养成机——角色真实小屋做舞台 + 四颗糖果实体键（独立组件自渲染）。
  if (theme.skin === 'tamagotchi') {
    return <TamagotchiHome />;
  }

  if (theme.skin === 'homely') {
    return <React.Suspense fallback={<div className="h-full w-full bg-[#dce3d5]" role="status">正在回家…</div>}><HomelyHome /></React.Suspense>;
  }

  if (theme.skin === 'companion') {
    return (
      <React.Suspense fallback={<div className="h-full w-full bg-[#100d1c]" />}>
        <CompanionHome />
      </React.Suspense>
    );
  }

  return (
    <div
      className={`launcher-desktop h-full w-full flex flex-col relative z-10 overflow-hidden font-sans select-none ${layoutEditing ? 'launcher-editing' : ''}`}
      onPointerDown={handleLayoutPointerDown}
      onPointerMove={handleLayoutPointerMove}
      onPointerUp={finishLayoutPointer}
      onPointerCancel={e => finishLayoutPointer(e, true)}
      onClickCapture={handleClickCapture}
      onContextMenu={(e) => {
          if ((e.target as HTMLElement).closest('[data-launcher-item]')) e.preventDefault();
      }}
    >
      <style>{`
        .launcher-pages { min-height: 0; }
        .launcher-page {
          overflow-y: auto;
          overscroll-behavior-y: contain;
          padding-top: max(3rem, calc(var(--chrome-top, 24px) + 12px));
          padding-left: max(1.5rem, env(safe-area-inset-left));
          padding-right: max(1.5rem, env(safe-area-inset-right));
        }
        .launcher-page > * { flex-shrink: 0; }
        .launcher-pinwheel-content { flex: 0 0 auto; margin-block: auto; }
        .launcher-editing .launcher-page { padding-top: max(5rem, calc(var(--safe-top, 0px) + 4rem)); }
        .launcher-widget-remove {
          position: absolute; top: 0; right: 0; z-index: 30;
          min-width: 44px; min-height: 44px; border-radius: 999px;
          background: #fffdf8; color: #a93232; box-shadow: 0 2px 8px #0003;
          font-size: 12px; touch-action: manipulation;
        }
        @media (orientation: landscape) {
          .launcher-page > * { width: 100%; max-width: 680px; margin-left: auto; margin-right: auto; }
          .launcher-page > .launcher-pinwheel-content { max-width: 480px; }
        }
        @media (orientation: landscape) and (min-width: 1000px) {
          .launcher-page > .launcher-pinwheel-content { max-width: 1100px; }
          .launcher-pinwheel-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
        }
        .launcher-edit-item {
          touch-action: none;
          cursor: grab;
          transition: transform 180ms cubic-bezier(.2,.75,.25,1), opacity 150ms ease, filter 150ms ease;
          will-change: transform;
        }
        .launcher-dragging {
          cursor: grabbing;
          opacity: .18;
        }
        .launcher-drag-ghost {
          opacity: .96;
          filter: drop-shadow(0 12px 14px rgba(75,65,54,.18));
          cursor: grabbing;
        }
        .launcher-drop-target {
          transform: scale(.93);
          opacity: .52;
          outline: 1.5px dashed rgba(75,65,54,.36);
          outline-offset: 5px;
          border-radius: 1.35rem;
        }
      `}</style>

      {layoutEditing && (
          <div className="absolute top-[calc(var(--safe-top)+0.65rem)] left-4 right-4 z-50 flex items-center justify-between rounded-full px-3 py-2"
              style={{ background: 'rgba(75,65,54,0.88)', color: '#fffdf8', boxShadow: '0 8px 24px rgba(75,65,54,0.20)' }}>
              <span className="text-[10px] font-semibold tracking-wide">拖到文件夹收纳，拖到空位放回</span>
              <button data-launcher-control onClick={() => { setFolderOpen(true); setFolderManaging(true); }} className="ml-2 px-2 py-1 rounded-full text-[10px] font-bold bg-white/15">收纳</button>
              <button data-launcher-control onClick={finishLayoutEditing} className="ml-2 px-2 py-1 rounded-full text-[10px] font-bold bg-white/15 active:scale-95">完成</button>
          </div>
      )}
      
      {/* Visual Elements (Decorative Background - Static, low-cost gradients instead of blur) */}
      {/* 动森模式跳过：这层冷蓝光斑会污染奶油底 */}
      {!acnh && (
      <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-20 -right-20 w-80 h-80 rounded-full" style={{ background: paper ? 'radial-gradient(circle, rgba(255,255,255,0.22) 0%, transparent 68%)' : 'radial-gradient(circle, rgba(255,255,255,0.05) 0%, transparent 70%)' }}></div>
          <div className="absolute -bottom-20 -left-20 w-80 h-80 rounded-full" style={{ background: paper ? 'radial-gradient(circle, rgba(123,104,78,0.06) 0%, transparent 68%)' : 'radial-gradient(circle, rgba(59,130,246,0.08) 0%, transparent 70%)' }}></div>
      </div>
      )}

      {/* Scrollable Content Layer */}
      {/* UPDATE: Added snap-always to children to ensure one-page-at-a-time scrolling on mobile swipe */}
      <div
        ref={scrollContainerRef}
        onScroll={handleScroll}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        onClickCapture={handleClickCapture}
        className="launcher-pages flex-1 flex overflow-x-auto snap-x snap-mandatory no-scrollbar cursor-grab active:cursor-grabbing"
        style={{
            scrollBehavior: 'smooth',
            overscrollBehaviorX: 'contain',
            overscrollBehaviorY: 'none',
            touchAction: layoutEditing ? 'pan-y' : 'pan-x pan-y',
            willChange: 'scroll-position',
            contain: 'layout paint',
            transform: 'translateZ(0)',
            WebkitOverflowScrolling: 'touch',
        }}
      >
          {/* Render App Pages */}
          {appPages.map((pageApps, idx) => (
              <div
                key={idx}
                className="launcher-page w-full flex-shrink-0 snap-center snap-always flex flex-col px-6 pt-12 pb-8 h-full"
                style={{ contentVisibility: 'auto', contain: 'layout paint', transform: 'translateZ(0)' }}
              >
                  {idx === 0 ? (
                      // Page 1 (original): Clock + Chat + 4x2 App Grid
                      <>
                        <DesktopClock />
                        <CharacterWidget
                            char={widgetChar}
                            unreadCount={widgetUnread}
                            lastMessage={lastMessage}
                            onClick={() => openApp(AppID.Chat)}
                            contentColor={contentColor}
                            paper={paper}
                        />
                        <div className="flex-1">
                            <LauncherAppGrid items={pageApps} offset={0} {...gridProps} />
                        </div>
                      </>
                  ) : idx === 1 ? (
                      // Page 2: Schedule 4x2 widget on top + Pinwheel (Music / 2x2 icons / 2x2 icons / Image) below
                      <div className="launcher-pinwheel-content w-full flex flex-col gap-5">
                          {scheduleChar && (
                              <ScheduleHomeWidget
                                  schedule={activeSchedule}
                                  character={scheduleChar}
                                  contentColor={contentColor}
                                  onOpen={() => { setScheduleViewerOpen(true); trackEvent('打开角色日程面板'); }}
                                  acnh={acnh}
                                  paper={paper}
                              />
                          )}
                          <div className="launcher-pinwheel-grid grid grid-cols-2 gap-x-3 gap-y-5 w-full">
                              {pinwheelOrder.filter(cell => cell === 'music' ? theme.launcherMusicVisible !== false : cell === 'image' ? theme.launcherImageVisible !== false : true).map(cell => (
                                  <div
                                      key={cell}
                                      data-launcher-item={cell}
                                      data-launcher-kind="widget"
                                      className={`relative aspect-square min-w-0 ${layoutEditing ? 'launcher-edit-item' : ''}`}
                                  >
                                      {layoutEditing && (cell === 'music' || cell === 'image') && (
                                          <button type="button" data-launcher-control className="launcher-widget-remove"
                                              aria-label={cell === 'music' ? '删除音乐组件' : '删除图片组件'}
                                              onClick={e => {
                                                  e.stopPropagation();
                                                  updateTheme(cell === 'music' ? { launcherMusicVisible: false } : { launcherImageVisible: false });
                                              }}>删除</button>
                                      )}
                                      {cell === 'music' ? (
                                          <NowPlayingSquareWidget contentColor={contentColor} />
                                      ) : cell === 'appsA' ? (
                                          <LauncherAppGrid items={page2QuadA} offset={8} columns={2} dense {...gridProps} />
                                      ) : cell === 'appsB' ? (
                                          <LauncherAppGrid items={page2QuadB} offset={12} columns={2} dense {...gridProps} />
                                      ) : (
                                          <DesktopSquareImage
                                              image={theme.launcherWidgets?.['dsq']}
                                              contentColor={contentColor}
                                              onClick={() => { if (!layoutEditing) openApp(AppID.Appearance); }}
                                              acnh={acnh}
                                          />
                                      )}
                                  </div>
                              ))}
                          </div>
                      </div>
                  ) : (
                      // Page 3+: Widget Images (idx===2 only) + Free Decorations + Apps
                      <div data-launcher-grid-scroll className="min-h-0 flex-1 overflow-y-auto no-scrollbar pt-4 pb-2 flex flex-col relative">
                          {idx === 2 && (() => {
                            const raw = theme.launcherWidgets || {};
                            const w = { ...raw };
                            const hasAny = w['tl'] || w['tr'] || w['wide'];
                            const hasTopRow = w['tl'] || w['tr'];
                            return (
                              <>
                                {hasAny && (
                                  <div className="mb-3 space-y-2 relative z-10">
                                    {hasTopRow && (
                                      <div className="flex gap-2">
                                        {['tl', 'tr'].map(key => w[key] ? (
                                          <div key={key} className="flex-1 aspect-square rounded-2xl overflow-hidden shadow-md border border-white/20">
                                            <TokenImg value={w[key]} className="w-full h-full object-cover" alt="" loading="lazy" />
                                          </div>
                                        ) : <div key={key} className="flex-1"></div>)}
                                      </div>
                                    )}
                                    {w['wide'] && (
                                      <div className="w-full h-32 rounded-2xl overflow-hidden shadow-md border border-white/20">
                                        <TokenImg value={w['wide']} className="w-full h-full object-cover" alt="" loading="lazy" />
                                      </div>
                                    )}
                                  </div>
                                )}
                                {/* Free-positioned Desktop Decorations (z-20 to float above widgets z-10) */}
                                {theme.desktopDecorations && theme.desktopDecorations.length > 0 && (
                                  <div className="absolute inset-0 pointer-events-none overflow-hidden z-20">
                                    {theme.desktopDecorations.map(deco => (
                                      <img
                                        key={deco.id}
                                        src={deco.content}
                                        alt=""
                                        loading="lazy"
                                        className="absolute w-16 h-16 object-contain select-none"
                                        style={{
                                          left: `${deco.x}%`,
                                          top: `${deco.y}%`,
                                          transform: `translate(-50%, -50%) scale(${deco.scale}) rotate(${deco.rotation}deg)${deco.flip ? ' scaleX(-1)' : ''}`,
                                          opacity: deco.opacity,
                                          zIndex: deco.zIndex,
                                          filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.15))',
                                        }}
                                      />
                                    ))}
                                  </div>
                                )}
                              </>
                            );
                          })()}

                          <LauncherAppGrid items={pageApps} offset={16} dense {...gridProps} />
                          <div className="flex-1"></div>
                      </div>
                  )}
              </div>
          ))}

          {/* Final Page: Widgets */}
          <WidgetsPage
            contentColor={contentColor}
            openApp={openApp}
            anniversaries={anniversaries}
            characters={characters}
            acnh={acnh}
            paper={paper}
          />

      </div>

      {/* Page Indicators */}
      <div
          className="absolute left-0 w-full flex justify-center gap-1 pointer-events-none z-20"
          style={{ bottom: `calc(${launcherBottomInset} + 5.5rem)` }}
          aria-hidden="true"
      >
          {Array.from({ length: totalPages }).map((_, i) => (
              // 每个页码占固定 16px 槽位，只动画内部圆点。旧版直接动画 flex child 的宽度，
              // 快速划过多页时 WebKit 会一边改宽一边重算整行居中，几个过渡态就会挤成方块串。
              <div key={i} className="flex h-1.5 w-4 shrink-0 items-center justify-center">
                  <div
                    className={`h-1.5 rounded-full transform-gpu transition-[width,opacity] duration-300 ${activePageIndex === i ? 'w-4 opacity-100' : 'w-1.5 opacity-40'}`}
                    style={{ backgroundColor: contentColor }}
                  />
              </div>
          ))}
      </div>

      {/* Floating Dock - Updated Margin and Safe Area handling */}
      <div
           className="mt-auto flex justify-center w-full px-4 relative z-30"
           style={{ paddingBottom: launcherBottomInset }}
      >
           <div
             className={`rounded-[1.75rem] px-4 py-3 flex gap-3 sm:gap-6 items-center mx-auto max-w-full justify-between overflow-x-auto no-scrollbar transform-gpu ${acnh || paper ? '' : 'bg-white/30 border border-white/25 shadow-[0_8px_40px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.08)]'}`}
             style={acnh ? { background: 'transparent' } : paper ? {
               background: 'rgba(224,221,215,0.42)',
               border: '1px solid rgba(91,72,51,0.07)',
               boxShadow: '0 6px 18px rgba(91,72,51,0.065)',
             } : undefined}
           >
               {dockAppsConfig.map(app => (
                   <div key={app.id} data-launcher-item={app.id} data-launcher-kind="dock" className={`relative ${layoutEditing ? 'launcher-edit-item' : ''}`}>
                        <AppIcon app={app} onClick={() => { if (!layoutEditing) openApp(app.id); }} variant="dock" size="md" />
                        {app.id === 'chat' && totalUnread > 0 && (
                            <div className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 rounded-full text-white text-[9px] flex items-center justify-center border-2 border-white/20 shadow-sm font-bold pointer-events-none animate-pop-in">
                                {totalUnread > 9 ? '9+' : totalUnread}
                            </div>
                        )}
                   </div>
               ))}
           </div>
      </div>

      {folderOpen && (
          <div className="absolute inset-0 z-[60] flex items-center justify-center px-5" role="dialog" aria-modal="true" aria-label={folderName}>
              <button type="button" data-launcher-control aria-label="关闭文件夹" className="absolute inset-0 bg-black/20 backdrop-blur-sm" onClick={() => { setFolderOpen(false); setFolderManaging(false); }} />
              <div ref={folderPanelRef} className="relative w-full max-w-md rounded-[2rem] p-5 shadow-2xl border border-white/20 flex flex-col max-h-[70%]"
                  style={{ background: paper || acnh ? 'rgba(247,243,233,0.96)' : 'rgba(48,48,58,0.88)', color: acnh ? '#725d42' : contentColor }}>
                  <div data-launcher-control className="flex items-center gap-2 mb-3">
                      {folderManaging ? <input autoFocus aria-label="文件夹名称" maxLength={32} value={folderNameDraft}
                          onChange={e => setFolderNameDraft(e.target.value)}
                          onBlur={() => {
                              const name = folderNameDraft.trim() || '不太常用';
                              setFolderNameDraft(name);
                              if (name !== folderName) void updateTheme({ launcherFolderName: name });
                          }} className="min-w-0 w-full bg-transparent text-lg font-semibold border-b border-current/30 outline-none" />
                          : <h2 className="text-lg font-semibold truncate flex-1">{folderName}</h2>}
                      {!staticPreview && <button type="button" onClick={() => setFolderManaging(value => !value)} className="shrink-0 px-2 py-2 rounded-xl bg-white/15 text-xs">{folderManaging ? '查看' : '整理'}</button>}
                      {layoutEditing && <button type="button" onClick={finishLayoutEditing} className="shrink-0 px-2 py-2 rounded-xl bg-white/15 text-xs">完成</button>}
                      <button type="button" autoFocus={!folderManaging} onClick={() => { setFolderOpen(false); setFolderManaging(false); }} className="shrink-0 px-2 py-2 rounded-xl bg-white/15 text-xs">关闭</button>
                  </div>
                  <p className="text-[11px] opacity-65 mb-4">{folderManaging ? '勾选要收纳的应用，取消勾选放回桌面空位。' : '点击打开应用；长按后拖出此面板，放到桌面空位。'}</p>
                  <div className="min-h-0 overflow-y-auto overscroll-contain no-scrollbar pb-2">
                      {folderManaging ? <div data-launcher-control className="grid grid-cols-2 gap-2">
                          {availableGridApps.map(app => <label key={app.id} className="flex items-center gap-2 rounded-xl bg-white/10 p-3 cursor-pointer text-xs">
                              <input type="checkbox" checked={folderLayout.folderApps.includes(app.id)} onChange={() => toggleFolderApp(app.id)} />
                              <span className="truncate">{app.name}</span>
                          </label>)}
                      </div> : <div data-launcher-folder-content>
                          {folderLayout.folderApps.length ? <LauncherAppGrid items={folderLayout.folderApps} columns={3} {...gridProps} openApp={id => { setFolderOpen(false); openApp(id); }} />
                              : <div className="py-10 text-center text-sm opacity-60">这里还是空的，点“整理”选择不常用的应用。</div>}
                      </div>}
                  </div>
              </div>
          </div>
      )}

      <ScheduleFullscreenViewer
          open={scheduleViewerOpen}
          onClose={() => setScheduleViewerOpen(false)}
          characters={characters}
          activeCharId={scheduleChar?.id || null}
          onSwitchCharacter={(id) => setScheduleCharId(id)}
          schedule={activeSchedule}
          activeCharacter={scheduleChar}
          contentColor={contentColor}
          onPlayTheater={(index) => void openScheduleTheater(index)}
      />

      {theaterSlotIdx !== null && activeSchedule && (
          <TheaterPlayer
              character={scheduleChar}
              slot={activeSchedule.slots[theaterSlotIdx] || null}
              lines={activeSchedule.slots[theaterSlotIdx]?.theater?.lines || null}
              isGenerating={theaterGenerating}
              onReplay={() => void openScheduleTheater(theaterSlotIdx, true)}
              onSendCard={(exposed) => void sendScheduleTheaterToChat(exposed)}
              onClose={() => {
                  setTheaterSlotIdx(null);
                  setScheduleViewerOpen(true);
              }}
          />
      )}

    </div>
  );
};

export default Launcher;
