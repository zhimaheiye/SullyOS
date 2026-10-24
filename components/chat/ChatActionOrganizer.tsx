import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PencilSimple, Check, ArrowCounterClockwise, X } from '@phosphor-icons/react';
import {
    loadChatActionOrders, mergeChatActionOrder, moveChatAction,
    saveChatActionOrder, type ChatActionScope,
} from '../../utils/chatActionOrder';

const PAGE_SIZE = 8;
const PAGE_HOVER_MS = 450;
const EDGE_WIDTH_PX = 48;

interface Props {
    scope: ChatActionScope;
    tiles: React.ReactElement[];
    visibleIds?: readonly string[];
    initialPage?: number;
    dark?: boolean;
}

interface DragState {
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    before: string[];
    active: boolean;
    lastTargetId: string | null;
}

/** Shared pointer and pagination surface for private and group plus menus. */
export default function ChatActionOrganizer({ scope, tiles, visibleIds, initialPage = 0, dark = false }: Props) {
    const tileMap = new Map(tiles.filter(tile => typeof tile.key === 'string').map(tile => [String(tile.key), tile]));
    const available = [...tileMap.keys()];
    const availableKey = available.join('\^@');
    const [draft, setDraft] = useState(() => mergeChatActionOrder(available, loadChatActionOrders()[scope]));
    const [editing, setEditing] = useState(false);
    const [resetPending, setResetPending] = useState(false);
    const [page, setPage] = useState(initialPage);
    const [ghost, setGhost] = useState<{ id: string; x: number; y: number } | null>(null);
    const [hoverPage, setHoverPage] = useState<number | null>(null);
    const rootRef = useRef<HTMLDivElement>(null);
    const previousScope = useRef(scope);
    const dragRef = useRef<DragState | null>(null);
    const edgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingPage = useRef<number | null>(null);
    const edgeArmed = useRef(true);
    const pageRef = useRef(page);
    const swipeStart = useRef<{ x: number; y: number } | null>(null);
    const suppressClick = useRef(false);

    useEffect(() => { if (rootRef.current) rootRef.current.scrollTop = 0; }, [scope]);

    useEffect(() => {
        if (previousScope.current !== scope) {
            setDraft(mergeChatActionOrder(available, loadChatActionOrders()[scope]));
            setEditing(false);
            previousScope.current = scope;
        } else {
            setDraft(current => mergeChatActionOrder(available, current));
        }
    }, [availableKey, scope]);

    const visibleSet = useMemo(() => visibleIds ? new Set(visibleIds) : null, [visibleIds?.join('\^@')]);
    const shown = draft.filter(id => tileMap.has(id) && (!visibleSet || visibleSet.has(id)));
    const pageCount = Math.max(1, Math.ceil(shown.length / PAGE_SIZE));
    const currentPage = Math.min(page, pageCount - 1);
    pageRef.current = currentPage;

    const clearEdge = () => {
        if (edgeTimer.current) clearTimeout(edgeTimer.current);
        edgeTimer.current = null;
        pendingPage.current = null;
        setHoverPage(null);
    };
    const releaseDrag = (restore: boolean) => {
        clearEdge();
        const drag = dragRef.current;
        if (restore && drag?.active) setDraft(drag.before);
        if (drag && rootRef.current?.hasPointerCapture?.(drag.pointerId)) rootRef.current.releasePointerCapture(drag.pointerId);
        dragRef.current = null;
        setGhost(null);
        suppressClick.current = true;
    };
    const discard = () => {
        releaseDrag(false);
        setDraft(mergeChatActionOrder(available, loadChatActionOrders()[scope]));
        setEditing(false);
        setResetPending(false);
        suppressClick.current = false;
    };

    useEffect(() => {
        if (!editing) return;
        const onKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                event.preventDefault();
                discard();
            }
        };
        const onBlur = () => discard();
        window.addEventListener('keydown', onKey);
        window.addEventListener('blur', onBlur);
        return () => {
            window.removeEventListener('keydown', onKey);
            window.removeEventListener('blur', onBlur);
        };
    }, [editing, availableKey, scope]);
    useEffect(() => () => clearEdge(), []);

    const changePage = (next: number) => {
        const bounded = Math.max(0, Math.min(pageCount - 1, next));
        pageRef.current = bounded;
        setPage(bounded);
    };
    const queuePage = (next: number) => {
        if (next === pageRef.current || next < 0 || next >= pageCount) { clearEdge(); return; }
        if (pendingPage.current === next) return;
        clearEdge();
        pendingPage.current = next;
        setHoverPage(next);
        edgeTimer.current = setTimeout(() => {
            edgeTimer.current = null;
            pendingPage.current = null;
            setHoverPage(null);
            const drag = dragRef.current;
            if (!drag?.active) return;
            drag.lastTargetId = null;
            // Put the held tile on the destination page before hit testing its cells.
            // A release over a blank cell or page dot then has a valid landing place.
            setDraft(current => {
                const without = current.filter(id => id !== drag.id);
                const destination = Math.min(without.length, (next + 1) * PAGE_SIZE - 1);
                without.splice(destination, 0, drag.id);
                return without;
            });
            changePage(next);
            edgeArmed.current = false;
        }, PAGE_HOVER_MS);
    };
    const updateEdge = (x: number, y: number) => {
        const rect = rootRef.current?.getBoundingClientRect();
        if (!rect) return;
        if (x < rect.left - 24 || x > rect.right + 24 || y < rect.top - 24 || y > rect.bottom + 24) {
            clearEdge(); return;
        }
        const pageButton = document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-chat-action-page]');
        if (pageButton && rootRef.current?.contains(pageButton)) {
            queuePage(Number(pageButton.dataset.chatActionPage));
            return;
        }
        const direction = x < rect.left + EDGE_WIDTH_PX ? -1 : x > rect.right - EDGE_WIDTH_PX ? 1 : 0;
        if (!direction) { edgeArmed.current = true; clearEdge(); return; }
        if (!edgeArmed.current) { clearEdge(); return; }
        queuePage(pageRef.current + direction);
    };

    const onPointerDown = (event: React.PointerEvent, id: string) => {
        if (!editing || event.button !== 0 || dragRef.current) return;
        event.preventDefault();
        setResetPending(false);
        dragRef.current = { id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, before: draft, active: false, lastTargetId: null };
        edgeArmed.current = true;
        rootRef.current?.setPointerCapture?.(event.pointerId);
    };
    const onPointerMove = (event: React.PointerEvent) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        if (!drag.active && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 6) return;
        drag.active = true;
        setGhost({ id: drag.id, x: event.clientX, y: event.clientY });
        updateEdge(event.clientX, event.clientY);
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-chat-action-id]');
        const targetId = target && rootRef.current?.contains(target) && !target.parentElement?.classList.contains('hidden')
            ? target.dataset.chatActionId : undefined;
        if (targetId && targetId !== drag.id && targetId !== drag.lastTargetId) {
            drag.lastTargetId = targetId;
            setDraft(current => moveChatAction(current, drag.id, targetId));
        } else if (!targetId) drag.lastTargetId = null;
    };
    const onPointerUp = (event: React.PointerEvent) => {
        const drag = dragRef.current;
        if (!drag || drag.pointerId !== event.pointerId) return;
        const rect = rootRef.current?.getBoundingClientRect();
        const inside = !!rect && event.clientX >= rect.left && event.clientX <= rect.right
            && event.clientY >= rect.top && event.clientY <= rect.bottom;
        const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>('[data-chat-action-id]');
        const targetId = inside && target && rootRef.current?.contains(target) && !target.parentElement?.classList.contains('hidden')
            ? target.dataset.chatActionId : undefined;
        if (drag.active && targetId && targetId !== drag.id && targetId !== drag.lastTargetId) {
            setDraft(current => moveChatAction(current, drag.id, targetId));
        }
        // A valid page remains the drop zone after crossing, including its blank cells.
        releaseDrag(!drag.active || !inside);
    };
    const onPointerCancel = (event: React.PointerEvent) => {
        if (dragRef.current?.pointerId === event.pointerId) releaseDrag(true);
    };
    const onTouchStart = (event: React.TouchEvent) => {
        if (editing) return;
        const touch = event.touches[0];
        swipeStart.current = { x: touch.clientX, y: touch.clientY };
        suppressClick.current = false;
    };
    const onTouchEnd = (event: React.TouchEvent) => {
        if (editing || !swipeStart.current) return;
        const touch = event.changedTouches[0];
        const dx = touch.clientX - swipeStart.current.x;
        const dy = touch.clientY - swipeStart.current.y;
        swipeStart.current = null;
        if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
            suppressClick.current = true;
            changePage(pageRef.current + (dx < 0 ? 1 : -1));
        }
    };

    return <div ref={rootRef} className="min-h-0 flex-1 overflow-y-auto no-scrollbar select-none" onPointerMove={onPointerMove}
        onPointerUp={onPointerUp} onPointerCancel={onPointerCancel} onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}
        onTouchCancel={() => { swipeStart.current = null; }}
        onWheel={() => { if (dragRef.current) releaseDrag(true); }}
        onClickCapture={event => {
            const onTile = !!(event.target as HTMLElement).closest('[data-chat-action-id]');
            if (editing && onTile) {
                event.preventDefault(); event.stopPropagation();
            } else if (suppressClick.current) {
                suppressClick.current = false;
                if (onTile) { event.preventDefault(); event.stopPropagation(); }
            }
        }}
        onContextMenuCapture={event => { if (editing) { event.preventDefault(); event.stopPropagation(); } }}>
        <div className="min-h-[18rem]">
        {Array.from({ length: pageCount }, (_, index) => <div key={index} role="group" aria-label={`聊天功能第 ${index + 1} 页`}
            className={`p-6 grid grid-cols-4 grid-rows-[repeat(2,96px)] gap-x-4 gap-y-8 ${currentPage === index ? '' : 'hidden'}`}>
            {shown.slice(index * PAGE_SIZE, (index + 1) * PAGE_SIZE).map(id => <div key={id} data-chat-action-id={id}
                tabIndex={editing ? 0 : undefined} aria-label={editing ? `移动${id}` : undefined}
                className={`relative min-w-0 ${editing ? 'cursor-grab touch-none' : ''} ${ghost?.id === id ? 'opacity-35' : ''}`}
                onPointerDown={event => onPointerDown(event, id)}
                onKeyDown={event => {
                    if (!editing) return;
                    const step = event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : event.key === 'ArrowUp' ? -4 : event.key === 'ArrowDown' ? 4 : 0;
                    if (!step) return;
                    event.preventDefault();
                    setResetPending(false);
                    const destination = shown[Math.max(0, Math.min(shown.length - 1, shown.indexOf(id) + step))];
                    if (destination) { setDraft(current => moveChatAction(current, id, destination)); changePage(Math.floor(shown.indexOf(destination) / PAGE_SIZE)); }
                }}>
                <div className={editing ? 'pointer-events-none' : ''}>{tileMap.get(id)}</div>
                {editing && <span aria-hidden="true" className="absolute top-0 right-0 text-xs opacity-60">⠿</span>}
            </div>)}
        </div>)}
        <div className="flex items-center justify-center gap-3 pb-3 -mt-2">
            {Array.from({ length: pageCount }, (_, index) => <button key={index} type="button" aria-label={`第 ${index + 1} 页`}
                data-chat-action-page={index}
                aria-current={currentPage === index ? 'page' : undefined} onClick={() => changePage(index)}
                className={`relative h-2 w-2 rounded-full transition-all before:absolute before:-inset-x-1.5 before:-inset-y-2 before:content-[''] ${hoverPage === index ? 'ring-2 ring-primary/60 ring-offset-2' : ''} ${currentPage === index ? (dark ? 'bg-slate-200 w-5' : 'bg-slate-500 w-5') : (dark ? 'bg-slate-600' : 'bg-slate-300')}`} />)}
        </div>
        </div>
        {editing && <div className="flex flex-wrap items-center justify-end gap-2 px-3 py-2 min-h-9">
            <span className="mr-auto text-xs opacity-70">按住图标拖动排序</span>
            <button type="button" className="text-xs px-2 py-1 rounded-lg border border-current/20" onClick={() => {
                if (resetPending) { setDraft([...available]); setResetPending(false); }
                else setResetPending(true);
            }}><ArrowCounterClockwise className="inline mr-1" />{resetPending ? '确认恢复默认' : '恢复默认顺序'}</button>
            <button type="button" aria-label="取消功能排序" className="p-1" onClick={discard}><X size={17} /></button>
            <button type="button" className="text-xs px-3 py-1 rounded-lg bg-primary text-white" onClick={() => {
                releaseDrag(false); saveChatActionOrder(scope, draft); setEditing(false); setResetPending(false); suppressClick.current = false;
            }}><Check className="inline mr-1" />完成</button>
        </div>}
        {!editing && <div className="mt-2 flex justify-end px-6 pb-2">
            <button type="button" aria-label="编辑功能顺序" className="flex items-center gap-1 text-xs px-2 py-1 rounded-lg border border-current/20" onClick={() => {
                setDraft(mergeChatActionOrder(available, loadChatActionOrders()[scope])); setEditing(true);
                rootRef.current?.scrollTo?.({ top: 0 });
            }}><PencilSimple size={15} />编辑</button>
        </div>}
        {ghost && <div aria-hidden="true" className="fixed z-[9999] w-20 opacity-90 pointer-events-none drop-shadow-xl"
            style={{ left: ghost.x - 40, top: ghost.y - 35 }}>
            {React.cloneElement(tileMap.get(ghost.id) as React.ReactElement<any>, {
                tabIndex: -1, onClick: undefined, onContextMenu: undefined, disabled: true,
            })}
        </div>}
    </div>;
}
