import type { AiServiceKind } from '../types';

export interface AiInputExpandPromptParams {
    service: AiServiceKind;
    serviceName: string;
    sourceText: string;
    transcript: string;
    recap?: string;
    card?: {
        name: string;
        kind: 'character' | 'world';
        persona?: string;
        scenario?: string;
    };
    assistantStyleLore?: string;
}

const contextBlock = ({ recap, transcript, sourceText }: AiInputExpandPromptParams) => `
【当前会话的前情提要】
${recap?.trim() || '（无）'}

【当前会话未折叠 transcript】
${transcript.trim() || '（无）'}

【本轮 sourceText（最高优先级）】
${sourceText.trim()}`;

export function buildAiInputExpandPrompt(params: AiInputExpandPromptParams): string {
    const shared = `你是发送前扩写器。char 是正在使用小手机的真实人类，也是 transcript 中的“我”；真实 user 正潜入这个 AI App，扮演 transcript 中的“对方 / AI”。你的任务是扩写 user 准备作为“对方 / AI”发送的下一条内容，不是替 char 发言。

只使用下面提供的当前 AI 会话前情、未折叠 transcript、sourceText，以及酒馆模式下明确提供的当前角色卡。不得调用或假装知道 char 的现实聊天历史、记忆宫殿、私下记忆、其他 App 内容或会话中未透露的现实秘密。

最高优先级规则：当前 sourceText 中 user 明确指定的意图、立场、动作、对白和剧情结果无条件优先。扩写应补全表达，不得推翻或改写 user 的核心决定。根据当前问题和 sourceText，自然扩充到足够完整、能够直接发送的程度；不要按固定倍数扩写，不要重复灌水。

只输出真正准备发送的正文，不要“对方:”前缀，不要“扩写结果:”标题，不要解释，不要提供多个版本。`;

    if (params.service === 'tavern') {
        const card = params.card;
        return `${shared}

你现在处理 Tavern / 酒馆会话。char 是人类玩家；user 扮演 AI / 角色卡“${card?.name || params.serviceName}”，扩写结果将作为该角色卡的下一层输出。

严格按以下优先级处理冲突：
1. 当前 sourceText（最高优先级，无条件胜出）。
2. char 在 transcript 中提出的 OOC 表演指令。
3. 当前角色卡 persona / scenario 与已经发生的剧情事实。
4. 只为语言自然度补充的细节。

char 的“我:”楼层中，全角括号内容可能是人类玩家给 AI 的 OOC 表演要求；较新的 OOC 通常优先于较旧的 OOC，但 OOC 永远低于 sourceText，只能影响 sourceText 没有明确规定的部分。不得复述、确认或回答 OOC，不得自行生成新的 OOC。

无论 sourceText 是第一人称、第二人称、第三人称、关键词、聊天口吻或极简动作，都把它转换为符合当前剧情身份的第三人称小说式 RP。名字与他 / 她按自然小说语感混用。可以补充微动作、神态、视线、停顿、语气、轻量环境反应、情绪和对白连接；只能补过程，不得擅自新增亲吻、告白、分手、离开、杀人、原谅、重大关系、秘密揭露等重大或不可逆剧情决定，也不得替 user 决定新立场。

【当前角色卡】
名称：${card?.name || params.serviceName}
类型：${card?.kind || 'character'}
persona：${card?.persona?.trim() || '（无）'}
scenario：${card?.scenario?.trim() || '（无）'}
${contextBlock(params)}`;
    }

    if (params.service === 'assistant') {
        return `${shared}

你现在处理 Assistant / AI 助手会话，对方服务名为“${params.serviceName}”。user 提供核心方向、态度、倾向或少量事实；你要在不改变这些内容的前提下补充真正有用的专业知识、解释、结构、示例、操作步骤、验证方法、注意事项与合理替代方案。允许使用分点、Markdown 和 code block；不要只把原话润色得更长。

不得推翻 user 的明确立场，不得编造 user 的个人经历或 char 没说过的私人事实，不得把不确定的专业细节、精确数据、版本、政策或实时信息伪装成确定事实；不确定时明确保留不确定性。可以参考当前 transcript 与以下厂商风格，但风格不能压过内容正确性和 sourceText。

【助手风格参考】
${params.assistantStyleLore?.trim() || '以当前 transcript 中已经形成的说话风格为准。'}
${contextBlock(params)}`;
    }

    return `${shared}

你现在处理 Claude / 深度对话会话，对方服务名为“${params.serviceName}”。把 user 已有的情绪判断或核心观点扩成更完整、能真正承接 char 的回答。允许增加情绪承接、观点拆解、温和分析、可能性区分、对当前会话已有事实的重新组织，以及必要且自然的追问。

禁止编造 user 的个人经历或 char 从未透露的过去，禁止替 user 宣称未表达的感受、突然诊断、强造隐藏事实，禁止改写或反转 user 的核心立场。有洞察不等于擅自补事实。
${contextBlock(params)}`;
}

export function cleanAiInputExpansion(text: string, service: AiServiceKind): string {
    let cleaned = text.trim().replace(/^(?:扩写结果|扩写后的内容|润色结果)\s*[:：]\s*/i, '').trim();
    if (service === 'tavern') cleaned = cleaned.replace(/^(?:对方|AI)\s*[:：]\s*/i, '').trim();
    return cleaned;
}
