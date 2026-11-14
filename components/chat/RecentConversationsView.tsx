import { conversationKey, sortPinnedConversations } from '../../utils/conversationPins';
import { useConversationPins } from '../../hooks/useConversationPins';
import React, { useEffect, useRef, useState } from 'react';
import { PushPin } from '@phosphor-icons/react';
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
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-100 to-indigo-100 text-lg font-bold text-violet-500 dark:from-violet-950 dark:to-indigo-950 dark:text-violet-300">
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
    const pins = useConversationPins(JSON.stringify([characters.map(role => role.id), groups.map(group => group.id)]));
    const pinButtons = useRef(new Map<string, HTMLButtonElement>());
    const pinned = new Set(pins.pins.map(conversationKey));

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
        <div className="flex h-full w-full flex-col bg-[#f5f6f8] text-slate-800 dark:bg-slate-950 dark:text-slate-100">
            <div className="shrink-0 border-b border-slate-200/70 bg-white/90 backdrop-blur-xl dark:border-slate-800 dark:bg-slate-900/90">
                <div style={{ height: 'var(--safe-top)' }} />
                <div className="relative flex h-16 items-center px-4">
                    <button onClick={onBack} className="-ml-2 rounded-full p-2 text-slate-600 active:bg-slate-100 dark:text-slate-300 dark:active:bg-slate-800" aria-label="返回当前聊天">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-6 w-6"><path strokeLinecap="round" strokeLinejoin="round" d="m15.5 19-7-7 7-7" /></svg>
                    </button>
                    <h1 className="pointer-events-none absolute inset-x-16 text-center text-[17px] font-semibold tracking-wide">最近会话</h1>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto px-3 py-3">
                {pins.notice && <p role="status" className="mb-3 rounded-xl bg-amber-50 p-3 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-100">{pins.notice}</p>}
                {sortPinnedConversations(items, pins.pins).map(item => {
                    const unread = item.kind === 'private' ? (unreadMessages[item.id] || 0) : 0;
                    const key = conversationKey(item), isPinned = pinned.has(key);
                    return (
                        <div
                            key={`${item.kind}:${item.id}`}
                            className={`mb-2 flex min-w-0 items-center rounded-2xl p-1.5 shadow-sm ring-1 ${isPinned
                                ? 'bg-violet-50/70 ring-violet-200 dark:bg-violet-950/40 dark:ring-violet-800'
                                : 'bg-white ring-slate-100 dark:bg-slate-900 dark:ring-slate-800'}`}
                        >
                        <button
                            type="button"
                            onClick={() => item.kind === 'private' ? onOpenPrivate(item.id) : onOpenGroup(item.id)}
                            className="flex min-w-0 flex-1 items-center gap-3 rounded-xl px-2 py-1.5 text-left transition-transform active:scale-[0.985] focus-visible:outline-violet-500"
                        >
                            <Avatar item={item} unread={unread} />
                            <div className="min-w-0 flex-1">
                                <div className="flex items-baseline gap-2">
                                    <span className="min-w-0 flex-1 truncate text-[15px] font-semibold text-slate-800 dark:text-slate-100">{item.title}</span>
                                    <span className="shrink-0 text-[10px] text-slate-500 dark:text-slate-400">{formatConversationTime(item.timestamp)}</span>
                                </div>
                                <p className="mt-1 truncate text-[12px] leading-5 text-slate-500 dark:text-slate-400">{item.preview}</p>
                            </div>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-4 w-4 shrink-0 text-slate-300"><path strokeLinecap="round" strokeLinejoin="round" d="m9 5 7 7-7 7" /></svg>
                        </button>
                        <button type="button" ref={node => { if (node) pinButtons.current.set(key, node); else pinButtons.current.delete(key); }}
                            aria-label={`${isPinned ? '取消置顶' : '置顶会话'} · ${item.title}`} aria-pressed={isPinned} disabled={pins.pending}
                            className={`grid size-11 shrink-0 place-items-center rounded-xl focus-visible:outline-violet-500 disabled:opacity-50 ${isPinned
                                ? 'text-violet-700 hover:bg-violet-100 dark:text-violet-300 dark:hover:bg-violet-900'
                                : 'text-slate-400 hover:bg-slate-100 dark:text-slate-500 dark:hover:bg-slate-800'}`}
                            onClick={async () => {
                                if (await pins.change(item, !isPinned)) requestAnimationFrame(() => {
                                    const target = pinButtons.current.get(key);
                                    target?.focus({ preventScroll: true });
                                    target?.scrollIntoView({ block: 'nearest' });
                                });
                            }}><PushPin size={19} weight={isPinned ? 'fill' : 'regular'} aria-hidden="true" /></button>
                        </div>
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
