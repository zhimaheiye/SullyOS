import UserHolidayIntro from './settings/UserHolidayIntro';
import { HOLIDAY_NOTICE_KEY, hasChosenHolidayIntro } from '../utils/userHolidays';
/**
 * 历史更新资料与必要启动说明。
 *
 * 公开版不再自动排队补弹历史功能介绍；手册使用的日志常量与旧标记保持兼容。
 * 启动只保留联网数据流披露和假期配置选择，不代替用户写已读或同意。
 */

import React from 'react';
import { useOS } from '../context/OSContext';
import { AppID } from '../types';
import { trackEvent } from '../utils/analytics';
import { requestProxyWorkerSettingsFocus } from '../utils/proxyWorker';

// 历史 key —— 保留给备份兼容与旧版本日志使用。
export const UPDATE_NOTIFICATION_KEY = 'sullyos_update_2026_04_seen';
export const UPDATE_NOTIFICATION_KEY_2026_05 = 'sullyos_update_2026_05_seen';
export const UPDATE_NOTIFICATION_KEY_2026_05_10 = 'sullyos_update_2026_05_10_seen';
export const UPDATE_NOTIFICATION_KEY_2026_05_17 = 'sullyos_update_2026_05_17_seen';
export const UPDATE_NOTIFICATION_KEY_2026_05_25 = 'sullyos_update_2026_05_25_seen';
export const UPDATE_NOTIFICATION_KEY_2026_06_05 = 'sullyos_update_2026_06_05_seen';
export const UPDATE_NOTIFICATION_KEY_2026_06_14 = 'sullyos_update_2026_06_14_seen';
export const UPDATE_NOTIFICATION_KEY_2026_06_21 = 'sullyos_update_2026_06_21_seen';
export const UPDATE_NOTIFICATION_KEY_2026_06_26 = 'sullyos_update_2026_06_26_seen';
export const UPDATE_NOTIFICATION_KEY_2026_07_10 = 'sullyos_update_2026_07_10_seen';
// 本次更新：主动消息 2.0。
export const UPDATE_NOTIFICATION_KEY_2026_08_03 = 'sullyos_update_2026_08_03_amsg2_seen';
// 本次更新：Live2D 视频通话与陪伴桌面。
export const UPDATE_NOTIFICATION_KEY_2026_08_10 = 'sullyos_update_2026_08_10_live2d_seen';
// 本次更新：角色协同工作台。
export const UPDATE_NOTIFICATION_KEY_2026_08_30 = 'sullyos_update_2026_08_30_collaboration_seen';
// 例行维护补充：静态网页环境下部分联网功能的数据流说明。
export const NETWORK_TRANSIT_NOTICE_KEY_2026_08 = 'sullyos_notice_2026_08_network_transit_seen';

export const FAQ_TARGET_SECTION_KEY = 'sullyos_faq_target_section';
export const CHANGELOG_2026_04 = 'changelog-2026-04';
export const CHANGELOG_2026_05 = 'changelog-2026-05';
export const CHANGELOG_2026_05_10 = 'changelog-2026-05-10';
export const CHANGELOG_2026_05_17 = 'changelog-2026-05-17';
export const CHANGELOG_2026_05_27 = 'changelog-2026-05-27';
export const CHANGELOG_2026_06_05 = 'changelog-2026-06-05';
export const CHANGELOG_2026_06_14 = 'changelog-2026-06-14';
export const CHANGELOG_2026_06_21 = 'changelog-2026-06-21';
export const CHANGELOG_2026_06_26 = 'changelog-2026-06-26';
export const CHANGELOG_2026_07_10 = 'changelog-2026-07-10';
export const CHANGELOG_2026_08_03 = 'changelog-2026-08-03';
export const CHANGELOG_2026_08_10 = 'changelog-2026-08-10';
export const CHANGELOG_2026_08_30 = 'changelog-2026-08-30';

/** storage 读不出来时当成看过：宁可少弹一次，也别每次开机都糊用户一脸。 */
const isUpdateSeen = (key: string): boolean => {
    if (key === HOLIDAY_NOTICE_KEY) return hasChosenHolidayIntro();
    try {
        return !!localStorage.getItem(key);
    } catch {
        return true;
    }
};

const markUpdateSeen = (key: string): void => {
    try {
        localStorage.setItem(key, Date.now().toString());
    } catch { /* storage 不可用时不阻断按钮行为 */ }
};

interface UpdatePopupProps {
    /** 这条用户自己关掉了 —— 接着弹队列里的下一条。 */
    onDone: () => void;
    /**
     * 用户选择去设置后收起本轮说明；未处理的说明不自动标记已读。
     * 后面那几条不标已读，下次启动照弹，免得刚跳过去就被新弹窗盖住。
     */
    onExit: () => void;
}

const NetworkTransitNoticePopup: React.FC<UpdatePopupProps> = ({ onDone, onExit }) => {
    const { openApp } = useOS();

    React.useEffect(() => {
        trackEvent('弹出联网方式说明', { 版本: 'network-transit-2026-08' });
    }, []);

    const handleDismiss = () => {
        markUpdateSeen(NETWORK_TRANSIT_NOTICE_KEY_2026_08);
        onDone();
        trackEvent('知悉联网方式说明', { 去向: '关闭' });
    };

    const handleSettings = () => {
        markUpdateSeen(NETWORK_TRANSIT_NOTICE_KEY_2026_08);
        requestProxyWorkerSettingsFocus();
        openApp(AppID.Settings);
        onExit();
        trackEvent('知悉联网方式说明', { 去向: '设置' });
    };

    return (
        <div
            className="fixed inset-0 z-[9998] flex items-center justify-center overflow-hidden bg-[#111827]/65 px-4 backdrop-blur-sm"
            style={{
                paddingTop: 'max(1rem, env(safe-area-inset-top))',
                paddingBottom: 'max(1rem, env(safe-area-inset-bottom))',
            }}
            role="dialog"
            aria-modal="true"
            aria-labelledby="network-transit-notice-title"
        >
            <section className="relative flex max-h-full w-full max-w-[23rem] flex-col overflow-hidden rounded-[2rem] bg-[#f8fafc] text-slate-700 shadow-[0_24px_80px_rgba(15,23,42,0.4)] ring-1 ring-white/30">
                <header className="shrink-0 bg-[linear-gradient(145deg,#334155,#475569)] px-6 pb-5 pt-6 text-white">
                    <div className="mb-3 inline-flex rounded-full bg-white/10 px-2.5 py-1 text-[9px] font-bold tracking-[0.16em] text-slate-200 ring-1 ring-white/15">
                        例行维护 · 说明补充
                    </div>
                    <h2 id="network-transit-notice-title" className="text-[21px] font-black tracking-[-0.02em]">
                        关于部分联网功能
                    </h2>
                    <p className="mt-2 text-[11px] leading-5 text-slate-300">
                        这次只补充此前写得不够清楚的联网路径，功能和使用方式没有变化。
                    </p>
                </header>

                <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-6 py-5 text-[12px] leading-[1.75]">
                    <p>
                        例行排查中，我们发现部分功能对“请求会怎么走”的说明不够清楚。静态网页下，以下入口会在你实际启用或使用时经过网络 Worker：
                    </p>
                    <ul className="space-y-1.5 rounded-2xl bg-white px-3.5 py-3 text-[11px] leading-[1.65] ring-1 ring-slate-200/70">
                        <li><b>聊天 / 实时感知：</b>Brave 联网搜索与新闻、Notion / 飞书日记、网页链接读取</li>
                        <li><b>音乐 App：</b>网易云登录状态、搜索、歌单与播放相关请求</li>
                        <li><b>小红书 Lite：</b>登录校验、搜索浏览、互动与发布</li>
                        <li><b>语音 / 写歌：</b>Fish Audio 语音合成、Replicate / ACE-Step</li>
                        <li><b>点单：</b>麦当劳与瑞幸 MCP</li>
                        <li><b>云备份：</b>WebDAV；GitHub 的 Worker 中转路径当前默认关闭，仅在你手动开启后使用</li>
                    </ul>
                    <p>
                        这些请求经过 Worker，只是为了替静态网页完成跨域请求并把结果返回。项目代码不会将请求内容写入数据库、对象存储或业务日志；转发完成后，项目侧没有可供回看或恢复的内容副本。Worker 源码公开可查。
                    </p>
                    <div className="rounded-2xl bg-sky-50 px-3.5 py-3 text-[11px] leading-[1.7] text-sky-900 ring-1 ring-sky-100">
                        <p>
                            这和你平时使用<b>联网搜索、第三方登录或在线音乐</b>时的接口请求相近：只有主动使用对应功能时，当次必要数据才会经过服务端，不会把 SullyOS·糯米机 的聊天记录或本地资料整体上传。
                        </p>
                        <p className="mt-1.5">
                            如果你平时能够接受 API 中转站，可以把它作为参照：API 中转站能够接触完整的模型请求与聊天内容；这里的 Worker 只接触对应功能的当次请求，并在转发后不保留请求内容。
                        </p>
                    </div>
                    <p className="text-[11px] text-slate-500">
                        介意中转的话，可以关闭对应功能，或在设置中换成自己部署的 Worker。
                    </p>
                </div>

                <footer className="grid shrink-0 grid-cols-[0.9fr_1.1fr] gap-2.5 border-t border-slate-200/70 bg-[#f8fafc] px-6 pb-6 pt-3">
                    <button
                        type="button"
                        onClick={handleSettings}
                        className="rounded-2xl bg-slate-100 px-3 py-3 text-[11px] font-bold text-slate-600 transition-transform active:scale-[0.98]"
                    >
                        查看代理设置
                    </button>
                    <button
                        type="button"
                        onClick={handleDismiss}
                        className="rounded-2xl bg-slate-700 px-3 py-3 text-[12px] font-extrabold text-white shadow-lg shadow-slate-300 transition-transform active:scale-[0.98]"
                    >
                        我知道了
                    </button>
                </footer>
            </section>
        </div>
    );
};

const STARTUP_NOTICE_QUEUE: { key: string; render: (props: UpdatePopupProps) => React.ReactNode }[] = [
    { key: HOLIDAY_NOTICE_KEY, render: props => <UserHolidayIntro {...props} /> },
    { key: NETWORK_TRANSIT_NOTICE_KEY_2026_08, render: (props) => <NetworkTransitNoticePopup {...props} /> },
];

// PhoneShell 的展示与 blocked 判断共用这个范围，历史标记缺失不会形成隐形阻塞。
export const shouldShowUpdateNotification = (): boolean => STARTUP_NOTICE_QUEUE.some((entry) => !isUpdateSeen(entry.key));

interface UpdateNotificationControllerProps {
    onClose: () => void;
}

export const UpdateNotificationController: React.FC<UpdateNotificationControllerProps> = ({ onClose }) => {
    // 进场时把没看过的挑出来定住。每次渲染重算的话，当前这条一被标记已读就会自己从队列里
    // 消失、直接跳到下一条，用户还没来得及点——推进队列的只能是下面 onDone 那一下。
    const [pending, setPending] = React.useState(() => STARTUP_NOTICE_QUEUE.filter((entry) => !isUpdateSeen(entry.key)));
    const current = pending[0];

    React.useEffect(() => {
        if (!current) onClose();
    }, [current, onClose]);

    if (!current) return null;

    return (
        <React.Fragment key={current.key}>
            {current.render({
                onDone: () => setPending((rest) => rest.slice(1)),
                onExit: onClose,
            })}
        </React.Fragment>
    );
};
