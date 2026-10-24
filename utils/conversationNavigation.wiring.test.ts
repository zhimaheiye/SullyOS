// 当前 Vitest 运行在纯 Node 环境；这里用源码级断言守住跨 App 返回来源接线。
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');
const chat = read('../apps/Chat.tsx');
const chatHeaderShell = read('../components/chat/ChatHeaderShell.tsx');
const recentConversations = read('../components/chat/RecentConversationsView.tsx');
const groupChat = read('../apps/GroupChat.tsx');
const osContext = read('../context/OSContext.tsx');

describe('recent conversation navigation wiring', () => {
    it('does not return the recent list before Chat has finished calling its hooks', () => {
        // 家园小手机复用同一个 Chat 组件，但最近会话是桌面级视图，早退必须带 !homePhone。
        const recentReturnAt = chat.indexOf("if (!homePhone && chatView === 'recent')");
        const lastChatHookAt = chat.indexOf('const chatFineTuneCss = useMemo');
        expect(recentReturnAt).toBeGreaterThan(lastChatHookAt);
    });

    it('shares the trigger theme hook with the recent conversation action', () => {
        expect(chat).toContain("tone: 'action'");
        expect(chatHeaderShell).toContain("extraAction?.tone === 'action' ? `sully-chat-trigger ${actionButtonClass}` : iconButtonClass");
    });

    it('keeps recent conversations unread until a private conversation is visible', () => {
        expect(chat).toContain("chatLandingIntent === 'recent' ? 'recent' : 'conversation'");
        expect(chat).toContain("setChatViewSnapshot(true, chatView === 'conversation' ? activeCharacterId ?? null : null)");
        expect(chat).toContain("if (chatView !== 'conversation' || !activeCharacterId) return;");
        expect(chat).toContain('unreadMessages={unreadMessages}');
        expect(chat).toContain('refreshToken={lastMsgTimestamp}');
        expect(recentConversations).toContain("item.kind === 'private' ? (unreadMessages[item.id] || 0) : 0");
        expect(recentConversations).toContain('[characters, groups, refreshToken]');
    });

    it('uses the fine-grained chat snapshot for every private unread writer', () => {
        expect(osContext).not.toContain('setChatViewSnapshot(');
        expect(osContext.match(/isPrivateChatActivelyVisible\(/g)).toHaveLength(4);
        expect(osContext).not.toContain('activeAppRef.current === AppID.Chat && activeCharIdScheduleRef.current ===');
    });

    it('returns private chats from either entry directly to the desktop', () => {
        expect(chat).toContain("chatLandingIntent === 'recent' ? 'recent' : 'conversation'");
        expect(chat).toContain("onBack={() => setChatView('conversation')}");
        expect(chat).toMatch(/onOpenPrivate=\{\(charId\) => \{\s*setActiveCharacterId\(charId\);\s*setChatView\('conversation'\);\s*\}\}/);
        expect(chat).toMatch(/\{homePhone\?<header[\s\S]*?:<ChatHeader[\s\S]*?onClose=\{closeApp\}/);
        expect(chatHeaderShell.match(/onClick=\{onClose\}/g)).toHaveLength(2);
        expect(osContext).toContain('const closeApp = () => setActiveApp(AppID.Launcher);');
        expect(chat).not.toContain('returnToRecent');
    });

    it('closes a group opened from recent conversations directly to the desktop', () => {
        expect(osContext).toContain("setGroupChatLaunchIntent({ groupId, origin: 'recent-conversations' })");
        expect(groupChat).toContain("setLaunchOrigin('recent-conversations')");
        expect(groupChat).toContain('clearGroupChatLaunchIntent();');
        expect(groupChat).toContain("onClose={() => launchOrigin === 'recent-conversations' ? closeApp() : setView('list')}");
        expect(groupChat).toContain("if (launchOrigin === 'recent-conversations') closeApp();");
        expect(groupChat).not.toContain('returnToRecentConversations');
    });

    it('keeps the original GroupChat list-to-chat-to-list route', () => {
        expect(groupChat).toContain("setLaunchOrigin('group-list'); setView('chat')");
        expect(groupChat).toMatch(/useAppShortcut\(ShortcutAppID\.GroupChat, intent => \{[\s\S]*?setLaunchOrigin\('group-list'\)/);
        expect(groupChat).toContain("else setView('list')");
    });
});
