import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HealingMessage, HealingSession } from '../types';
import { DB } from './db';
import { buildChatRequestPayload } from './chatRequestPayload';
import { buildHealingChatPayload, sendHealingMessage } from './healing/chatService';
import { normalizeExtractedHealingDrafts } from './healing/memoryExtraction';
import { ingestImportedHealingMemoryDrafts } from './healing/memoryImport';
import { HEALING_MEMORY_BUFFER_MESSAGES, ingestHealingMemoryDrafts, processHealingMemoryBuffer } from './healing/memoryService';
import { retrieveHealingMemories } from './healing/memoryRetrieval';

const session: HealingSession = { id: 'session-a', charId: 'char-a', createdAt: 1, updatedAt: 1 };
const char = { id: 'char-b', name: '林深', avatar: '', description: '', systemPrompt: '你是林深。', memories: [], memoryPalaceEnabled: false } as any;
const userProfile = { name: '小满', avatar: '', bio: '' } as any;

const message = (id: number, role: 'user' | 'assistant', content: string): HealingMessage => ({
  id, sessionId: session.id, charId: session.charId, role, type: 'text', content, timestamp: id,
});

describe('healing memory scope', () => {
  beforeEach(async () => { await DB.deleteDB(); localStorage.clear(); });
  afterEach(async () => { vi.restoreAllMocks(); await DB.deleteDB(); localStorage.clear(); });

  it('只保留能在用户原话中找到依据的候选，AI 臆测与空数组都不会入库', () => {
    const messages = [message(1, 'user', '我下周三有一个很重要的面试。'), message(2, 'assistant', '我猜你其实一直很喜欢猫。')];
    expect(normalizeExtractedHealingDrafts([
      { content: '用户下周三有一次重要面试。', tags: ['面试'], importance: 8 },
      { content: '用户一直很喜欢猫。', tags: ['猫'], importance: 6 },
    ], messages).map(item => item.content)).toEqual(['用户下周三有一次重要面试。']);
    expect(normalizeExtractedHealingDrafts([], messages)).toEqual([]);
  });

  it('角色 A 产生的记忆可被角色 B 的聊愈语义检索，并支持 import 统一入口', async () => {
    await ingestHealingMemoryDrafts([{ content: '用户下周三有一次重要面试，正在准备自我介绍。', tags: ['面试', '准备'], importance: 8 }], { origin: 'chat', sourceSessionId: session.id, sourceCharId: 'char-a' });
    const recalled = await retrieveHealingMemories('下周面试怎么准备', null);
    expect(recalled[0].content).toContain('重要面试');
    expect(recalled[0].sourceCharId).toBe('char-a');
    const imported = await ingestImportedHealingMemoryDrafts([{ content: '用户每逢公开演讲前会提前列提纲。', tags: ['演讲'] }]);
    expect(imported[0].origin).toBe('import');
  });

  it('普通 chat payload 不会读取或包含聊愈共享记忆', async () => {
    const secret = '只属于聊愈的密语-7f1d';
    await ingestHealingMemoryDrafts([{ content: secret }], { origin: 'chat', sourceCharId: 'char-a' });
    const normal = await buildChatRequestPayload({
      char, userProfile, groups: [], emojis: [], categories: [], contextLimit: 20,
      historyMsgs: [{ id: 1, charId: char.id, role: 'user', type: 'text', content: '普通聊天', timestamp: 1 }],
      realtimeConfig: { weatherEnabled: false, newsEnabled: false } as any,
      disableMcp: true,
    });
    expect(JSON.stringify(normal.fullMessages)).not.toContain(secret);
    const healing = await buildHealingChatPayload({ char, userProfile, messages: [message(1, 'user', '继续聊聊')], memories: await DB.getHealingMemoryNodes() });
    expect(healing.systemPrompt).toContain(secret);
  });

  it(`累计 ${HEALING_MEMORY_BUFFER_MESSAGES} 条才自动整理，force 会补处理尾巴`, async () => {
    await DB.saveHealingSession(session);
    for (let id = 1; id < HEALING_MEMORY_BUFFER_MESSAGES; id++) {
      const { id: _id, ...pending } = message(id, id % 2 ? 'user' : 'assistant', id === 1 ? '我周三要面试' : '继续');
      await DB.saveHealingMessage(pending);
    }
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '[]' } }] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    await processHealingMemoryBuffer({ sessionId: session.id, apiConfig: { baseUrl: 'https://example.test/v1', apiKey: 'x', model: 'test' } });
    expect(fetchSpy).not.toHaveBeenCalled();
    await processHealingMemoryBuffer({ sessionId: session.id, apiConfig: { baseUrl: 'https://example.test/v1', apiKey: 'x', model: 'test' }, force: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect((await DB.getHealingSession(session.id))?.memoryProcessedThrough).toBe(HEALING_MEMORY_BUFFER_MESSAGES - 1);
  });

  it('文字聊天使用现有角色上下文，AI 回复只落 healing_messages', async () => {
    await DB.saveHealingSession(session);
    const user = message(1, 'user', '今天有点累。');
    const { id: _id, ...pendingUser } = user;
    await DB.saveHealingMessage(pendingUser);
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ choices: [{ message: { content: '那就先把今天放轻一点，我在。' } }] }), { status: 200, headers: { 'content-type': 'application/json' } }));
    const reply = await sendHealingMessage({
      session, messages: [user], char, userProfile,
      apiConfig: { baseUrl: 'https://example.test/v1', apiKey: 'x', model: 'test' },
    });
    expect(reply.content).toContain('我在');
    expect(JSON.parse(String((fetchSpy.mock.calls[0][1] as RequestInit).body)).stream).toBe(false);
    expect((await DB.getHealingMessages(session.id)).at(-1)?.role).toBe('assistant');
    expect(await DB.getMessagesByCharId(char.id, true)).toEqual([]);
  });
});
