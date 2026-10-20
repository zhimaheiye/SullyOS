import type {
  APIConfig, CharacterProfile, HealingMemoryNode, HealingMessage, HealingSession, UserProfile,
} from '../../types';
import type { EmbeddingConfig } from '../memoryPalace/types';
import { ContextBuilder } from '../context';
import { resolveRefToDataUrl } from '../blobRef';
import { DB } from '../db';
import { extractContent, safeFetchJson } from '../safeApi';
import { buildHealingMemoryQuery, retrieveHealingMemories } from './memoryRetrieval';

export const HEALING_MODE_PROMPT = `你现在正在「聊愈」空间与用户交流。

保持你原本的角色身份、语言习惯和与用户的关系，但当前交流重点是认真理解用户正在表达的经历、感受和想法。
下面提供的「聊愈共享记忆」是用户过去在本空间留下的背景资料。自然地使用这些信息，不要逐条复述记忆库，也不要刻意告诉用户“数据库里写着”。
记忆可能不完整；如果当前用户表达与旧记忆冲突，以当前用户明确表达为准，不要把模型推测当作用户事实。
不要做心理诊断、量表或治疗承诺。直接以你自己的口吻回应，不加说话人名或场外说明。`;

const memoryBlock = (memories: HealingMemoryNode[]): string => memories.length
  ? `### 聊愈 · 关于用户的共享记忆\n${memories.map(memory => `- ${memory.content}`).join('\n')}`
  : '### 聊愈 · 关于用户的共享记忆\n（本轮没有召回到相关旧记忆。）';

const toApiMessage = async (message: HealingMessage): Promise<{ role: 'user' | 'assistant'; content: any }> => {
  if (message.type === 'text') return { role: message.role, content: message.content };
  const imageUrl = await resolveRefToDataUrl(message.content);
  if (!imageUrl) return { role: message.role, content: '[用户发送了一张图片，但图片数据不可用]' };
  return {
    role: message.role,
    content: [
      { type: 'text', text: '[用户发送了一张图片]' },
      { type: 'image_url', image_url: { url: imageUrl } },
    ],
  };
};

export async function buildHealingChatPayload(input: {
  char: CharacterProfile;
  userProfile: UserProfile;
  messages: HealingMessage[];
  memories: HealingMemoryNode[];
}): Promise<{ systemPrompt: string; messages: Array<{ role: string; content: any }> }> {
  const systemPrompt = [
    await ContextBuilder.buildCoreContext(input.char, input.userProfile, true),
    '---',
    HEALING_MODE_PROMPT,
    memoryBlock(input.memories),
  ].join('\n\n');
  const history = await Promise.all(input.messages.slice(-60).map(toApiMessage));
  return { systemPrompt, messages: [{ role: 'system', content: systemPrompt }, ...history] };
}

export async function sendHealingMessage(input: {
  session: HealingSession;
  messages: HealingMessage[];
  char: CharacterProfile;
  userProfile: UserProfile;
  apiConfig: APIConfig;
  embeddingConfig?: EmbeddingConfig | null;
}): Promise<HealingMessage> {
  const baseUrl = input.apiConfig.baseUrl?.replace(/\/+$/, '');
  if (!baseUrl || !input.apiConfig.model) throw new Error('请先在设置中配置聊天 API');
  const query = buildHealingMemoryQuery(input.messages);
  const memories = await retrieveHealingMemories(query, input.embeddingConfig);
  const payload = await buildHealingChatPayload({
    char: input.char,
    userProfile: input.userProfile,
    messages: input.messages,
    memories,
  });
  const data = await safeFetchJson(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${input.apiConfig.apiKey || 'sk-none'}` },
    body: JSON.stringify({
      model: input.apiConfig.model,
      messages: payload.messages,
      temperature: input.apiConfig.temperature ?? 0.78,
      max_tokens: 3000,
      // safeFetchJson 读取 JSON；v0.1 固定非流式，避免全局 SSE 开关让聊愈误读响应。
      stream: false,
    }),
  }, 0, 0, {
    appName: '林间聊愈室',
    charId: input.char.id,
    charName: input.char.name,
    purpose: 'healing-chat',
  });
  const content = extractContent(data).trim();
  if (!content) throw new Error('没有收到有效回复，请重试。');
  const timestamp = Date.now();
  const id = await DB.saveHealingMessage({
    sessionId: input.session.id,
    charId: input.char.id,
    role: 'assistant',
    type: 'text',
    content,
    timestamp,
  });
  const nextSession = { ...input.session, updatedAt: timestamp };
  await DB.saveHealingSession(nextSession);
  return { id, sessionId: input.session.id, charId: input.char.id, role: 'assistant', type: 'text', content, timestamp };
}
