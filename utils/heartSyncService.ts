import type {
  APIConfig, CharacterProfile, GroupProfile, HeartSyncEventCard, HeartSyncPsychQuestion, HeartSyncPsychSession,
  HeartSyncQuestionnaireSession, RealtimeConfig, UserProfile,
} from '../types';
import { buildChatRequestPayload } from './chatRequestPayload';
import { DB } from './db';
import { extractContent, safeFetchJson } from './safeApi';
import { shouldSendThinkingParams } from './thinkingGate';
import { buildPsychDiscussionPrompt, buildPsychInitialPrompt } from './heartSyncPsych';
import { buildQuestionnaireAnswerPrompt, buildQuestionnaireEvaluationPrompt } from './heartSyncQuestionnaire';

/** 提取与主聊天一致的原生 reasoning + 内联 think 块。 */
function extractHeartSyncThinking(message: any): string | undefined {
  const content = typeof message?.content === 'string'
    ? message.content
    : Array.isArray(message?.content)
      ? message.content.map((part: any) => typeof part === 'string' ? part : (part?.text || '')).join('\n')
      : '';
  const toText = (value: any): string => {
    if (typeof value === 'string') return value.trim();
    if (Array.isArray(value)) return value.map(toText).filter(Boolean).join('\n').trim();
    if (!value || typeof value !== 'object') return '';
    return [value.text, value.content, value.reasoning, value.thinking, value.summary]
      .map(toText).filter(Boolean).join('\n').trim();
  };
  const nativeParts = [
    message?.reasoning_content,
    message?.reasoning,
    message?.thinking,
    message?.reasoning_details,
    ...(Array.isArray(message?.content)
      ? message.content.filter((part: any) => /reason|think/i.test(String(part?.type || '')))
      : []),
  ].map(toText).filter(Boolean);
  const blocks: string[] = [];
  const pattern = /<(think|thinking|thought)>([\s\S]*?)<\/\1>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    const block = match[2].trim();
    if (block) blocks.push(block);
  }
  if (!/<\/(?:think|thinking|thought)>/i.test(content)) {
    const openOnly = content.match(/<(?:think|thinking|thought)>([\s\S]*$)/i)?.[1]?.trim();
    if (openOnly) blocks.push(openOnly);
  }
  const thinking = [...new Set([...nativeParts, ...blocks])].join('\n\n').trim();
  return thinking || undefined;
}

interface HeartSyncModelInput {
  char: CharacterProfile;
  userProfile: UserProfile;
  groups: GroupProfile[];
  apiConfig: APIConfig;
  realtimeConfig: RealtimeConfig;
  purpose: string;
  prompt: string;
  systemAddon: string;
  recallQueryHint?: string;
  includeMainChatContext?: boolean;
}

export async function requestHeartSyncModel(input: HeartSyncModelInput): Promise<{ content: string; thinking?: string }> {
  const { char, userProfile, groups, apiConfig, realtimeConfig, purpose, prompt, systemAddon } = input;
  const includeMainChatContext = input.includeMainChatContext !== false;
  const baseUrl = apiConfig.baseUrl?.replace(/\/+$/, '');
  if (!baseUrl || !apiConfig.model) throw new Error('请先在设置中配置聊天 API');
  const [historyMsgs, emojis, categories] = await Promise.all([
    includeMainChatContext ? DB.getMessagesByCharId(char.id) : Promise.resolve([]), DB.getEmojis(), DB.getEmojiCategories(),
  ]);
  const contextChar: CharacterProfile = includeMainChatContext ? char : {
    ...char,
    memories: [], refinedMemories: {}, activeMemoryMonths: [], impression: undefined,
    selfInsights: [], memoryPalaceEnabled: false, memoryPalaceInjection: undefined, roomPlatesInjection: undefined,
  };
  const payload = await buildChatRequestPayload({
    char: contextChar, userProfile, groups, emojis, categories, historyMsgs,
    contextLimit: includeMainChatContext ? Math.max(1, char.contextLimit || 500) : 1,
    realtimeConfig, stripImages: true, disableMcp: true,
    thinkingChain: { enabled: !!char.showThinkingChain, customPrompt: char.thinkingChainCustomPrompt },
    recallQueryHint: includeMainChatContext ? input.recallQueryHint : undefined,
  });
  const requestBody: any = {
    model: apiConfig.model,
    messages: [{
      role: 'system',
      content: `${payload.systemPrompt}\n\n${systemAddon}`,
    }, ...payload.cleanedApiMessages, { role: 'user', content: prompt }],
    temperature: apiConfig.temperature ?? 0.85,
    max_tokens: 8000,
    stream: false,
  };
  if (shouldSendThinkingParams({
    thinkingActive: !!payload.flags.thinkingActive,
    legacyToolModeActive: false,
    amsg2ToolsInjected: false,
    model: requestBody.model,
  })) {
    if (/^claude-/i.test(requestBody.model) && !/-thinking$/i.test(requestBody.model)) {
      requestBody.model = `${requestBody.model}-thinking`;
    }
    requestBody.thinking = { type: 'enabled', budget_tokens: 4000 };
    requestBody.reasoning_effort = 'medium';
    requestBody.extra_body = { thinking: { type: 'enabled', budget_tokens: 4000 } };
    delete requestBody.temperature;
  }
  const data = await safeFetchJson(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiConfig.apiKey || 'sk-none'}` },
    body: JSON.stringify(requestBody),
  }, 2, 0, { appName: '心心相印', charId: char.id, charName: char.name, purpose });
  const content = extractContent(data).trim();
  if (!content) throw new Error('角色没有返回内容，请重试');
  return {
    content,
    thinking: char.showThinkingChain ? extractHeartSyncThinking(data?.choices?.[0]?.message) : undefined,
  };
}

type NewHeartSyncRequestBase = Pick<HeartSyncModelInput,
  'char' | 'userProfile' | 'groups' | 'apiConfig' | 'realtimeConfig'>;

export function requestPsychInitialAnswer(input: NewHeartSyncRequestBase & {
  question: HeartSyncPsychQuestion;
  repairNote?: string;
}) {
  return requestHeartSyncModel({
    ...input,
    purpose: '心理测试·角色盲答',
    prompt: buildPsychInitialPrompt(input.question, input.repairNote),
    systemAddon: '你正在参与「心心相印」心理测试。先独立作答，保持自己的视角；不要猜测或代替用户回答。',
    recallQueryHint: '我和用户正在做一道心理测试，请回忆我们的关系与相处经历，并保持我自己的真实视角。',
  });
}

export function requestPsychDiscussionReply(input: NewHeartSyncRequestBase & {
  session: HeartSyncPsychSession;
  latestUserMessage?: string;
}) {
  return requestHeartSyncModel({
    ...input,
    purpose: '心理测试·深入讨论',
    prompt: buildPsychDiscussionPrompt(input.session, input.latestUserMessage),
    systemAddon: '你正在与用户继续讨论刚刚揭晓的心理测试答案。这是平等、双向的交流，不做临床诊断，不替用户下结论。',
    recallQueryHint: '我和用户正在继续讨论一次心理测试，请自然延续我们的关系与说话方式。',
  });
}

export function requestQuestionnaireAnswers(input: NewHeartSyncRequestBase & {
  session: HeartSyncQuestionnaireSession;
}) {
  return requestHeartSyncModel({
    ...input,
    purpose: '问卷填写·角色盲答',
    prompt: buildQuestionnaireAnswerPrompt(input.session),
    systemAddon: '你正在独立填写一份选择题问卷。只能按自己的真实视角选择，不分析结果，不替用户回答。',
    recallQueryHint: '我正在以自己的视角填写问卷，请结合我的人格、经历与关系作出真实选择。',
  });
}

export function requestQuestionnaireEvaluation(input: NewHeartSyncRequestBase & {
  session: HeartSyncQuestionnaireSession;
}) {
  return requestHeartSyncModel({
    ...input,
    purpose: '问卷填写·结果结算',
    prompt: buildQuestionnaireEvaluationPrompt(input.session),
    systemAddon: '你正在按原问卷规则结算已经冻结的答案。不得修改或重新回答任何题目，只返回结算结果与自然反应。',
    recallQueryHint: '我刚刚完成了一份问卷，现在只按规则核对结果并表达自己的反应。',
  });
}

export async function persistHeartSyncEvent(charId: string, card: HeartSyncEventCard): Promise<number> {
  return DB.saveMessage({
    charId,
    role: 'assistant',
    type: 'score_card',
    content: card.contextText,
    metadata: { scoreCard: card, heartSyncEvent: card, source: 'heart_sync', heartSyncSessionId: card.sessionId },
  });
}
