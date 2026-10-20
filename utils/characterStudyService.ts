import type { APIConfig, CharacterProfile, CharacterStudySession, UserProfile } from '../types';
import { ContextBuilder } from './context';
import { DB } from './db';
import { normalizeMessageContent } from './messageFormat';
import { extractContent, safeFetchJson } from './safeApi';

const CHAT_CONTEXT_LIMIT = 50;

const endpoint = (api: APIConfig) => {
  const baseUrl = api.baseUrl?.replace(/\/+$/, '');
  if (!baseUrl || !api.model) throw new Error('请先在自习室设置中配置 API');
  return `${baseUrl}/chat/completions`;
};

async function callStudyApi(api: APIConfig, char: CharacterProfile, purpose: string, messages: Array<{ role: string; content: string }>) {
  const data = await safeFetchJson(endpoint(api), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${api.apiKey || 'sk-none'}` },
    body: JSON.stringify({
      model: api.model,
      messages,
      temperature: api.temperature ?? 0.65,
      max_tokens: 3000,
      stream: false,
    }),
  }, 2, 0, { appName: '角色自习室', charId: char.id, charName: char.name, purpose });
  const content = extractContent(data).trim();
  if (!content) throw new Error('没有收到有效回复，请重试');
  return content;
}

async function buildLightContext(char: CharacterProfile, userProfile: UserProfile, includeRecentChat = true) {
  const leanCharacter: CharacterProfile = {
    ...char,
    memories: [],
    refinedMemories: {},
    activeMemoryMonths: [],
    impression: undefined,
    selfInsights: [],
    memoryPalaceEnabled: false,
    memoryPalaceInjection: undefined,
    roomPlatesInjection: undefined,
  };
  const messages = (includeRecentChat ? await DB.getMessagesByCharId(char.id) : [])
    .filter(message => message.role === 'user' || message.role === 'assistant')
    .slice(-CHAT_CONTEXT_LIMIT)
    .map(message => ({
      role: message.role as 'user' | 'assistant',
      content: normalizeMessageContent(message, char.name, userProfile.name).trim(),
    }))
    .filter(message => message.content);

  return {
    persona: await ContextBuilder.buildCoreContext(leanCharacter, userProfile, false),
    messages,
  };
}

const studentRules = (charName: string) => `你正在 SullyOS 的“角色自习室”里作为学生学习。你仍然是${charName}，保留原本的性格、措辞和与用户相处的方式。

课堂规则：
- 这是费曼学习法：用户负责讲解，你负责认真听、压缩成笔记，并用问题帮助用户发现解释中的缺口。
- 你没有讲义。黑板笔记只能记录用户已经讲过的内容，不得用自己的知识偷偷补完整段课程。
- 把自己当作真正第一次接触这个主题的学生。理解时只允许使用：用户本回合和此前课堂讲过的内容、黑板已有笔记，以及你的人设会带来的关注方式。不要用大语言模型的先验知识替用户补定义、结论、例子或因果链。
- beginnerThinking 要写出你作为初学者怎样一步步接住用户刚才的话：先抓到什么、如何连到此前讲解、哪里暂时理解了、哪里仍不确定。它不是模型幕后推理，也不是正确答案；写成 3—6 个简短步骤，允许保留真实困惑。
- 你的常识只能用来识别潜在易错点，例如概念边界、因果跳步、适用条件、反例、混淆项；只能把疑点变成问题，不能在心象、回应或笔记里自行给出用户尚未讲过的答案。
- 不要故意犯低级错误，也不要为了提问而提问。若本回合禁止提问，question 必须为 null。
- notePatch 是本回合新增的精炼 Markdown 笔记，不要复述整块黑板，不要写“用户说”。
- response 要比寒暄更有信息量，用 2—4 句说明你目前真正听懂了什么、你的角色性格让你特别注意了什么；不要只回复“记下了”“明白了”。
- 不得声称读取了未提供的记忆，不得要求把课堂写回聊天或长期记忆。`;

export async function requestCharacterStudyOpening(input: {
  char: CharacterProfile;
  userProfile: UserProfile;
  apiConfig: APIConfig;
  topic: string;
}): Promise<string> {
  const { char, userProfile, apiConfig, topic } = input;
  const context = await buildLightContext(char, userProfile);
  return callStudyApi(apiConfig, char, 'character-study-opening', [
    { role: 'system', content: `${context.persona}\n\n${studentRules(char.name)}` },
    ...context.messages,
    {
      role: 'user',
      content: `我准备给你讲“${topic.trim()}”。请先结合你自己的性格与我们最近的相处方式，自然说明为什么你现在愿意学它，然后邀请我开始讲。不要假装已经学过这门课。\n\n只输出 JSON：{"rationale":"为什么此刻愿意学，1—2句","opening":"以角色口吻对我说的话，1—3句","notesMarkdown":"# ${topic.trim()}\\n\\n> 等待讲解"}`,
    },
  ]);
}

export async function requestCharacterStudyReply(input: {
  char: CharacterProfile;
  userProfile: UserProfile;
  apiConfig: APIConfig;
  session: CharacterStudySession;
  userText: string;
  questionAllowed: boolean;
}): Promise<string> {
  const { char, userProfile, apiConfig, session, userText, questionAllowed } = input;
  const context = await buildLightContext(char, userProfile, false);
  const recentTurns = session.turns.slice(-12).flatMap(turn => [
    { role: 'user', content: turn.userText },
    { role: 'assistant', content: [turn.charResponse, turn.question].filter(Boolean).join('\n') },
  ]);
  return callStudyApi(apiConfig, char, 'character-study-turn', [
    { role: 'system', content: `${context.persona}\n\n${studentRules(char.name)}` },
    ...context.messages,
    ...recentTurns,
    {
      role: 'user',
      content: [
        `学习主题：${session.topic}`,
        `当前黑板笔记：\n<notes>\n${session.notesMarkdown}\n</notes>`,
        `我这一回合的讲解：\n<teaching>\n${userText.trim()}\n</teaching>`,
        `本回合${questionAllowed ? '允许提问：仅在确有易错点或解释缺口时提出一个问题；若已经清楚则为 null' : '禁止提问：question 必须为 null'}`,
        '只输出 JSON：{"notePatch":"本回合新增的 Markdown 笔记","beginnerThinking":"3—6步的初学者理解过程，只依据课堂内容","response":"以角色口吻给出2—4句有内容的听课反应","question":"一个具体问题或 null"}',
      ].join('\n\n'),
    },
  ]);
}
