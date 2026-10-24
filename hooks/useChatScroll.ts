import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import type { KeyboardEvent, TouchEvent, WheelEvent } from 'react';
import type { Message } from '../types';

export const BOTTOM_FOLLOW_THRESHOLD = 96;

// 私聊与群聊共用的阅读状态；所有 DOM 高度变化都只在跟随模式下贴底。
export function useChatScroll(conversationKey: string | null, messages: Message[], blocked: boolean, historyWindow = false) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const contentRef = useRef<HTMLDivElement>(null);
    const followingLatestRef = useRef(true);
    const [hasNewMessageBelow, setHasNewMessageBelow] = useState(false);
    const highWaterRef = useRef<number | null>(null);
    const lastScrollTopRef = useRef(0);
    const touchYRef = useRef<number | null>(null);
    const smoothJumpRef = useRef(false);
    const smoothTargetRef = useRef(0);
    const prependAnchorRef = useRef<{ scrollHeight: number; scrollTop: number } | null>(null);

    const pauseFollowing = useCallback(() => {
        followingLatestRef.current = false;
        if (smoothJumpRef.current && scrollRef.current) {
            scrollRef.current.scrollTo({ top: scrollRef.current.scrollTop, behavior: 'auto' });
        }
        smoothJumpRef.current = false;
    }, []);
    const resumeFollowing = useCallback(() => {
        followingLatestRef.current = true;
        setHasNewMessageBelow(false);
    }, []);
    const reportNewContent = useCallback(() => {
        if (!followingLatestRef.current) setHasNewMessageBelow(true);
    }, []);

    useLayoutEffect(() => {
        resumeFollowing();
        highWaterRef.current = null;
        prependAnchorRef.current = null;
        lastScrollTopRef.current = 0;
        smoothJumpRef.current = false;
    }, [conversationKey, resumeFollowing]);

    useLayoutEffect(() => {
        if (!conversationKey || messages.some(m => (m.groupId || m.charId) !== conversationKey)) return;
        const maxId = messages.reduce((max, m) => Math.max(max, m.id), 0);
        const previous = highWaterRef.current;
        if (previous !== null && messages.some(m => m.id > previous && m.role === 'assistant')) reportNewContent();
        highWaterRef.current = Math.max(previous ?? 0, maxId);
    }, [conversationKey, messages, reportNewContent]);

    const followBottom = useCallback(() => {
        const scroller = scrollRef.current;
        if (!scroller || blocked || historyWindow || !followingLatestRef.current || prependAnchorRef.current) return;
        if (smoothJumpRef.current) {
            const target = scroller.scrollHeight - scroller.clientHeight;
            if (target !== smoothTargetRef.current) {
                smoothTargetRef.current = target;
                scroller.scrollTo({ top: target, behavior: 'smooth' });
            }
            return;
        }
        // 自动跟随不启动持续动画，用户上翻后就不会有旧动画继续抢位置。
        scroller.scrollTop = scroller.scrollHeight;
        lastScrollTopRef.current = scroller.scrollTop;
    }, [blocked, historyWindow]);

    // 每次提交覆盖流式/状态 UI；ResizeObserver 覆盖图片解码、卡片与输入区缩放。
    useLayoutEffect(() => {
        const anchor = prependAnchorRef.current;
        const scroller = scrollRef.current;
        if (anchor && scroller) {
            scroller.scrollTop = anchor.scrollTop + scroller.scrollHeight - anchor.scrollHeight;
            lastScrollTopRef.current = scroller.scrollTop;
            prependAnchorRef.current = null;
        }
        followBottom();
    });
    useLayoutEffect(() => {
        const scroller = scrollRef.current;
        const content = contentRef.current;
        if (!scroller || !content || typeof ResizeObserver === 'undefined') return;
        const observer = new ResizeObserver(followBottom);
        observer.observe(scroller);
        observer.observe(content);
        return () => observer.disconnect();
    }, [conversationKey, followBottom]);

    const onScroll = useCallback(() => {
        const scroller = scrollRef.current;
        if (!scroller) return;
        const distance = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight;
        if (!historyWindow && distance <= BOTTOM_FOLLOW_THRESHOLD) {
            if (distance <= 1) smoothJumpRef.current = false;
            resumeFollowing();
        }
        // 向上滚才退出跟随，避免新内容或容器缩小产生的 scroll 事件误判用户意图。
        else if (historyWindow || scroller.scrollTop < lastScrollTopRef.current) pauseFollowing();
        lastScrollTopRef.current = scroller.scrollTop;
    }, [historyWindow, pauseFollowing, resumeFollowing]);

    const scrollToLatest = useCallback(() => {
        resumeFollowing();
        const scroller = scrollRef.current;
        smoothJumpRef.current = !!scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 1;
        smoothTargetRef.current = scroller ? scroller.scrollHeight - scroller.clientHeight : 0;
        scroller?.scrollTo({ top: scroller.scrollHeight, behavior: 'smooth' });
    }, [resumeFollowing]);

    const interruptUpwardScroll = useCallback((distance: number) => {
        const scroller = scrollRef.current;
        if (distance > 0 && scroller && scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight + distance > BOTTOM_FOLLOW_THRESHOLD) pauseFollowing();
    }, [pauseFollowing]);
    const onWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
        const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? scrollRef.current?.clientHeight ?? 1 : 1;
        interruptUpwardScroll(-event.deltaY * unit);
    }, [interruptUpwardScroll]);
    const onTouchStart = useCallback((event: TouchEvent<HTMLDivElement>) => {
        touchYRef.current = event.touches[0]?.clientY ?? null;
    }, []);
    const onTouchMove = useCallback((event: TouchEvent<HTMLDivElement>) => {
        const y = event.touches[0]?.clientY;
        if (y !== undefined && touchYRef.current !== null) interruptUpwardScroll(y - touchYRef.current);
        touchYRef.current = y ?? null;
    }, [interruptUpwardScroll]);
    const onKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
        if ((event.target as HTMLElement).matches('input, textarea, [contenteditable="true"]')) return;
        const distance = event.key === 'Home' ? scrollRef.current?.scrollHeight ?? 0
            : event.key === 'PageUp' || (event.key === ' ' && event.shiftKey) ? scrollRef.current?.clientHeight ?? 0
            : event.key === 'ArrowUp' ? 40 : 0;
        interruptUpwardScroll(distance);
    }, [interruptUpwardScroll]);

    // 在异步查询完成、即将提交 prepend 时捕获，期间的新消息不会误消费锚点。
    const preservePrepend = useCallback(() => {
        const scroller = scrollRef.current;
        if (!scroller) return;
        pauseFollowing();
        prependAnchorRef.current = { scrollHeight: scroller.scrollHeight, scrollTop: scroller.scrollTop };
    }, [pauseFollowing]);

    return { scrollRef, contentRef, followingLatestRef, hasNewMessageBelow, onScroll, onWheel, onTouchStart, onTouchMove, onKeyDown, pauseFollowing, resumeFollowing, reportNewContent, scrollToLatest, preservePrepend };
}
