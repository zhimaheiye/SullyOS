/** 查手机真人对话的本机玩法偏好，不属于角色资料或备份。 */
export type RealConversationMode = 'free' | 'mutual-friend';

const STORAGE_KEY = 'cp_real_conversation_modes_v1';

export function realConversationPairKey(aId: string, bId: string): string {
    return [aId, bId].sort().join('::');
}

export function readRealConversationModes(): Record<string, RealConversationMode> {
    try {
        const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
        if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
        return Object.fromEntries(Object.entries(value).filter(([, mode]) => mode === 'free' || mode === 'mutual-friend'));
    } catch {
        return {};
    }
}

export function saveRealConversationModes(modes: Record<string, RealConversationMode>): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(modes));
    } catch {
        // 存储不可用时仍使用当前 UI 选择，不能阻塞对话。
    }
}
