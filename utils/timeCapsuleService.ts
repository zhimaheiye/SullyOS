import type { APIConfig, CharacterProfile, GroupProfile, RealtimeConfig, TimeCapsuleEntry, UserProfile } from '../types';
import { buildChatRequestPayload } from './chatRequestPayload';
import { DB } from './db';
import { extractContent, safeFetchJson } from './safeApi';
import { isManualRelayEnabled } from './manualModelRelay';
import { parseCharacterTimeCapsule } from './timeCapsule';

const endpoint = (apiConfig: APIConfig): string => {
  const baseUrl = apiConfig.baseUrl?.replace(/\/+$/, '');
  if (!isManualRelayEnabled() && (!baseUrl || !apiConfig.model)) throw new Error('请先配置时间胶囊文本来源');
  return `${baseUrl || ''}/chat/completions`;
};

export async function requestCharacterTimeCapsule(input: {
  char: CharacterProfile;
  userProfile: UserProfile;
  groups: GroupProfile[];
  apiConfig: APIConfig;
  realtimeConfig: RealtimeConfig;
  source: 'invited' | 'auto';
  signal?: AbortSignal;
}): Promise<TimeCapsuleEntry> {
  const { char, userProfile, groups, apiConfig, realtimeConfig, source } = input;
  const relayAtStart = isManualRelayEnabled();
  const check = () => {input.signal?.throwIfAborted();if(source==='auto'&&isManualRelayEnabled() || relayAtStart!==isManualRelayEnabled())throw new DOMException('本轮接力模式已变化或为自动来访','AbortError');};
  check();
  const [historyMsgs, emojis, categories] = await abortableCapsuleWork(Promise.all([
    DB.getRecentMessagesByCharId(char.id, 50), DB.getEmojis(), DB.getEmojiCategories(),
  ]), input.signal);
  check();
  const payload = await abortableCapsuleWork(buildChatRequestPayload({
    char, userProfile, groups, emojis, categories, historyMsgs,
    contextLimit: Math.min(Math.max(1, char.contextLimit || 50), 50),
    realtimeConfig, stripImages: true, disableMcp: true,
    recallQueryHint: `你正在时间胶囊里给${userProfile.name || '用户'}写一段未来才会开启的话。只召回与彼此关系、最近近况、约定和此刻心情有关的真实信息。`,
  }), input.signal);
  check();
  const prompt = [
    '[时间胶囊 · 私密写作]',
    `你是主聊天里的同一个${char.name}。${source === 'invited' ? `${userProfile.name || '用户'}主动邀请你` : '你在一次前台来访中自己想到'}写一枚时间胶囊。`,
    '这是一项虚拟应用内的写作，不是现实中的埋藏、邮寄或行动。保持你原有的人设、关系和语言习惯，不要声称已经在现实里做了什么。',
    '胶囊内容在到期前不会展示给用户。写一段值得留到未来再看的话，可以回应此刻的相处、近况、期待、提醒或一个小小的赌约；不要写成泛用鸡汤。',
    '你自己决定 1 到 365 天后的开启日。标题是封面题签，会在到期前可见，因此不要在标题里泄露正文。',
    '不得调用工具，不得写聊天或记忆，不得输出分析过程。',
    '只输出 JSON：{"title":"不剧透的短题签","content":"胶囊正文","unlockInDays":30}',
  ].join('\n\n');
  const data = await safeFetchJson(endpoint(apiConfig), {
    method: 'POST', signal: input.signal,
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiConfig.apiKey || 'sk-none'}` },
    body: JSON.stringify({
      model: apiConfig.model,
      messages: [...payload.fullMessages, { role: 'user', content: prompt }],
      temperature: apiConfig.temperature ?? 0.82,
      max_tokens: 1600,
      stream: false,
    }),
  }, relayAtStart ? 0 : 2, 0, { appId:'time_capsule', relayPriority:source==='invited'?'user':'background', appName: '时间胶囊', charId: char.id, charName: char.name, purpose: `time-capsule-${source}`, featureId: 'timeCapsule' }, undefined, {privateTransient:true});
  check();
  if(data?.choices?.[0]?.message?.refusal || ['content_filter','tool_calls'].includes(data?.choices?.[0]?.finish_reason))throw new Error('本次没有可封存的完成正文');
  if(data?.choices?.[0]?.finish_reason === 'length')throw new Error('胶囊内容被截断，未封存，请重试');
  const content = extractContent(data);
  if (!content) throw new Error('角色这次没有留下可封存的内容');
  return parseCharacterTimeCapsule(content, char, source);
}

/** Context preparation itself can be non-abortable; release UI ownership immediately. */
export async function abortableCapsuleWork<T>(work:Promise<T>,signal?:AbortSignal):Promise<T>{
  if(!signal)return work;
  signal.throwIfAborted();
  let cancel!:()=>void;
  const aborted=new Promise<never>((_,reject)=>{cancel=()=>reject(signal.reason||new DOMException('本轮已取消','AbortError'));signal.addEventListener('abort',cancel,{once:true});});
  try{return await Promise.race([work,aborted]);}finally{signal.removeEventListener('abort',cancel);}
}
