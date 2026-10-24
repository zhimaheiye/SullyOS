import React, { useEffect, useState } from 'react';
import type { CharacterProfile, GroupProfile, Message } from '../../types';
import { DB } from '../../utils/db';
import {
    buildConversationSummaries,
    formatConversationTime,
    isConversationListMessage,
    type ConversationSummary,
} from '../../utils/conversationList';
import TokenImg from '../os/TokenImg';

type Props = {
    characters: CharacterProfile[];
    groups: GroupProfile[];
    unreadMessages: Record<string, number>;
    refreshToken: number;
    onBack: () => void;
    onOpenPrivate: (charId: string) => void;
    onOpenGroup: (groupId: string) => void;
};

const Avatar: React.FC<{ item: ConversationSummary; unread: number }> = ({ item, unread }) => (
    <div className="relative shrink-0">
        {item.avatar ? (
            <TokenImg value={item.avatar} className="h-14 w-14 rounded-2xl object-cover" />
        ) : (
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-100 to-indigo-100 text-lg font-bold text-violet-500">
                {item.title.trim().slice(0, 1) || (item.kind === 'group' ? '群' : '?')}
            </div>
        )}
        {unread > 0 && (
            <span className="absolute -right-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white shadow-[0_0_8px_rgba(244,63,94,0.6)] ring-2 ring-white" aria-label={`${unread} 条未读消息`}>
                {unread > 99 ? '99+' : unread}
            </span>
        )}
    </div>
);

const RecentConversationsView: React.FC<Props> = ({ characters, groups, unreadMessages, refreshToken, onBack, onOpenPrivate, onOpenGroup }) => {
    const [items, setItems] = useState<ConversationSummary[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        void Promise.all([
            Promise.all(characters.map(async character => [
                character.id,
                await DB.getLatestPrivateMessageByCharId(
                    character.id,
                    (message: Message) => isConversationListMessage(message, !!character.hideSystemLogs),
                ),
            ] as const)),
            Promise.all(groups.map(async group => [
                group.id,
                await DB.getLatestGroupMessageByGroupId(group.id, isConversationListMessage),
            ] as const)),
        ]).then(([privateEntries, groupEntries]) => {
            if (cancelled) return;
            setItems(buildConversationSummaries({
                characters,
                groups,
                privateLatest: Object.fromEntries(privateEntries),
                groupLatest: Object.fromEntries(groupEntries),
            }));
        }).finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [characters, groups, refreshToken]);

    return (
        <div className="flex h-full w-full flex-col bg-[#f5f6f8] text-slate-800">
            <div className="shrink-0 border-b border-slate-200/70 bg-white/90 backdrop-blur-xl">
                <div style={{ height: 'var(--safe-top)' }} />
                <div className="relative flex h-16 items-center px-4">
                    <button onClick={onBack} className="-ml-2 rounded-full p-2 text-slate-600 active:bg-slate-100" aria-label="返回当前聊天">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6"><path strokeLinecap="round" strokeLinejoin="round" d="m15.5 19-7-7 7-7" /></svg>
                    </button>
                    <h1 className="pointer-events-none absolute inset-x-16 text-center text-[17px] font-semibold tracking-wide">最近会话</h1>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-3">
                {items.map(item => {
                    const unread = item.kind === 'private' ? (unreadMessages[item.id] || 0) : 0;
                    return (
                        <button
                            key={`${item.kind}:${item.id}`}
                            onClick={() => item.kind === 'private' ? onOpenPrivate(item.id) : onOpenGroup(item.id)}
                            className="mb-2 flex w-full items-center gap-3 rounded-2xl bg-white px-3.5 py-3 text-left shadow-sm ring-1 ring-slate-100 transition-transform active:scale-[0.985]"
                        >
                            <Avatar item={item} unread={unread} />
                            <div className="min-w-0 flex-1">
                                <div className="flex items-baseline gap-2">
                                    <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-slate-800">{item.title}</span>
                                    <span className="shrink-0 text-[10px] text-slate-400">{formatConversationTime(item.timestamp)}</span>
                                </div>
                                <p className="mt-1 truncate text-[12px] leading-5 text-slate-400">{item.preview}</p>
                            </div>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-4 w-4 shrink-0 text-slate-300"><path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" /></svg>
                        </button>
                    );
                })}
                {!loading && items.length === 0 && (
                    <div className="py-20 text-center text-xs text-slate-400">还没有可以显示的会话</div>
                )}
                {loading && <div className="py-20 text-center text-xs text-slate-400">正在整理最近会话…</div>}
            </div>
        </div>
    );
};

export default RecentConversationsView;
