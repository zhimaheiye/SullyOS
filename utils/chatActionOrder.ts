/** The plus-menu order belongs to the device's chat UI, not to a character or group. */
export type ChatActionScope = 'private' | 'group';
export type ChatActionOrders = Partial<Record<ChatActionScope, string[]>>;

export const CHAT_ACTION_ORDER_KEY = 'sully-chat-action-order-v1';

const cleanIds = (value: unknown): string[] => {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    return value.filter((id): id is string => {
        if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(id) || seen.has(id)) return false;
        seen.add(id);
        return true;
    });
};

export const normalizeChatActionOrders = (value: unknown): ChatActionOrders => {
    const record = value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown> : {};
    return { private: cleanIds(record.private), group: cleanIds(record.group) };
};

export const mergeChatActionOrder = (availableIds: readonly string[], saved: unknown): string[] => {
    const available = cleanIds(availableIds);
    const allowed = new Set(available);
    const ordered = cleanIds(saved).filter(id => allowed.has(id));
    const included = new Set(ordered);
    return [...ordered, ...available.filter(id => !included.has(id))];
};

export const moveChatAction = (ids: readonly string[], movingId: string, targetId: string): string[] => {
    const from = ids.indexOf(movingId);
    const to = ids.indexOf(targetId);
    if (from < 0 || to < 0 || from === to) return [...ids];
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, movingId);
    return next;
};

export const loadChatActionOrders = (): ChatActionOrders => {
    try { return normalizeChatActionOrders(JSON.parse(localStorage.getItem(CHAT_ACTION_ORDER_KEY) || 'null')); }
    catch { return normalizeChatActionOrders(null); }
};

export const saveChatActionOrders = (value: unknown): void => {
    try { localStorage.setItem(CHAT_ACTION_ORDER_KEY, JSON.stringify(normalizeChatActionOrders(value))); }
    catch { /* An unavailable storage surface must not break the menu. */ }
};

export const saveChatActionOrder = (scope: ChatActionScope, ids: readonly string[]): void => {
    saveChatActionOrders({ ...loadChatActionOrders(), [scope]: [...ids] });
};

export const resetChatActionOrder = (scope: ChatActionScope): void => {
    saveChatActionOrders({ ...loadChatActionOrders(), [scope]: [] });
};
