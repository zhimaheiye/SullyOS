import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { runVRSession } from './runSession';
import { DB } from '../db';
import { armManualRelay, cancelManualRelay, disarmManualRelay, getManualRelayState, noteManualRelayUserAction, submitManualRelay } from '../manualModelRelay';

const mocks = vi.hoisted(() => ({
    novels: [{ id: 'book', title: '测试书', segments: [{ idx: 0, text: '第一段原文', chars: 5 }], totalChars: 5, createdAt: 1, updatedAt: 1 }],
    messages: [] as any[], board: { id: 'board', messages: [] as any[], updatedAt: 0 },
}));
vi.mock('../db', () => ({ DB: {
    getVRNovels: vi.fn(async () => mocks.novels), getVRMusicRoom: vi.fn(async () => null),
    getEmojis: vi.fn(async () => []), getEmojiCategories: vi.fn(async () => []),
    getVRAnnotations: vi.fn(async () => []), saveVRAnnotation: vi.fn(async () => {}),
    getVRGuestbook: vi.fn(async () => mocks.board), getLatestHotNewsSnapshot: vi.fn(async () => null),
    appendVRGuestbookMessages: vi.fn(async (items: any[]) => { mocks.board.messages.push(...items); }),
    saveVRScript: vi.fn(async () => {}), saveMessage: vi.fn(async (item: any) => { mocks.messages.push(item); }),
    getRecentMessagesByCharId: vi.fn(async () => []),
} }));
vi.mock('../chatContextRange', () => ({ loadCharacterContextMessages: vi.fn(async () => []) }));
vi.mock('../chatRequestPayload', () => ({ buildChatRequestPayload: vi.fn(async () => ({ systemPrompt: 'ORIGINAL PERSONA', cleanedApiMessages: [] })) }));
vi.mock('../memoryPalace/autoArchive', () => ({ processNewMessagesWithAutoArchive: vi.fn(async () => {}) }));
vi.mock('../../context/MusicContext', () => ({ loadMusicCfgStandalone: vi.fn(() => ({})) }));
vi.mock('./vrApi', () => ({ getVRApi: vi.fn(async () => null), logVRApiCall: vi.fn() }));

const char = { id: 'manual-vr-char', name: '艾文', vrState: { enabled: true, intervalMinutes: 120 }, memoryPalaceEnabled: false } as any;
const updateCharacter = vi.fn(async () => {});
const deps = { char, characters: [char], userProfile: { name: '用户' } as any,
    apiConfig: { baseUrl: '', apiKey: '', model: '' } as any, groups: [], updateCharacter, manual: true };

beforeEach(() => {
    vi.clearAllMocks(); mocks.messages = []; mocks.board = { id: 'board', messages: [], updatedAt: 0 };
    localStorage.clear();
});
afterEach(() => { disarmManualRelay(); vi.restoreAllMocks(); });

async function relayRoom(room: 'library' | 'guestbook' | 'theater', output: string) {
    const paidFetch = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('real model request'));
    armManualRelay(); noteManualRelayUserAction();
    const pending = runVRSession({ ...deps, forcedRoom: room });
    await vi.waitFor(() => expect(getManualRelayState().status).toBe('waiting'));
    const captured = getManualRelayState().request!;
    expect(captured.messages[0].content).toContain('ORIGINAL PERSONA');
    expect(captured.messages.at(-2)?.role).toBe('user');
    expect(submitManualRelay(captured.id, output)).toBe(true);
    const result = await pending;
    expect(paidFetch).not.toHaveBeenCalled();
    return result;
}

it('library relays an annotation through the original parser and advances the bookmark', async () => {
    expect(await relayRoom('library', '<批注 段落=0>这段很有趣。</批注><动态>读完一段。</动态>')).toMatchObject({ ok: true, room: 'library' });
    expect(DB.saveVRAnnotation).toHaveBeenCalledWith(expect.objectContaining({ novelId: 'book', segIdx: 0, content: '这段很有趣。' }));
    expect(updateCharacter).toHaveBeenCalledWith(char.id, expect.any(Function));
    expect(mocks.messages.at(-1)).toMatchObject({ charId: char.id, type: 'vr_card' });
});

it('a changed book invalidates a late library reply before annotations or bookmark writes', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('real model request'));
    armManualRelay(); noteManualRelayUserAction();
    const pending = runVRSession({ ...deps, forcedRoom: 'library' });
    await vi.waitFor(() => expect(getManualRelayState().status).toBe('waiting'));
    const id = getManualRelayState().request!.id;
    const original = mocks.novels[0];
    mocks.novels = [{ ...original, updatedAt: original.updatedAt + 1 }];
    submitManualRelay(id, '<批注 段落=0>迟到的批注。</批注>');
    await expect(pending).resolves.toMatchObject({ ok: false, reason: 'stale-book' });
    expect(DB.saveVRAnnotation).not.toHaveBeenCalled();
    expect(updateCharacter).not.toHaveBeenCalled();
    mocks.novels = [original];
});

it('cancelled relay does not count as a failed VR model call or save an activity', async () => {
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('real model request'));
    armManualRelay(); noteManualRelayUserAction();
    const pending = runVRSession({ ...deps, forcedRoom: 'library' });
    await vi.waitFor(() => expect(getManualRelayState().status).toBe('waiting'));
    cancelManualRelay(getManualRelayState().request!.id);
    await expect(pending).resolves.toMatchObject({ ok: false, reason: 'manual-relay-cancelled' });
    expect(DB.saveVRAnnotation).not.toHaveBeenCalled();
    expect(DB.saveMessage).not.toHaveBeenCalled();
    expect(updateCharacter).not.toHaveBeenCalled();
});

it('guestbook posts only through its room handler', async () => {
    expect(await relayRoom('guestbook', '<留言>今天在这里留个脚印。</留言><动态>在墙上写字。</动态>')).toMatchObject({ ok: true, room: 'guestbook' });
    expect(mocks.board.messages).toMatchObject([{ authorId: char.id, content: '今天在这里留个脚印。' }]);
    expect(mocks.messages.at(-1).metadata.room).toBe('guestbook');
});

it('theater saves a parsed script in the original store', async () => {
    expect(await relayRoom('theater', '<标题>临时舞台</标题><简介>一场雨</简介><角色>艾文：旅人</角色><正文>开幕。</正文>')).toMatchObject({ ok: true, room: 'theater' });
    expect(DB.saveVRScript).toHaveBeenCalledWith(expect.objectContaining({ title: '临时舞台', body: '开幕。', authorId: char.id }));
    expect(mocks.messages.at(-1).metadata.room).toBe('theater');
});
