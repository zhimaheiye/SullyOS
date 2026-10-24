import type { CharacterProfile, GroupProfile, GroupTopicBox, Message } from '../../types';
import { isMessageSemanticallyRelevant } from '../messageFormat';
import { messageLogText } from './format';
import { expandPromptMacros } from '../worldbook';

export const GROUP_TOPIC_HOT_ZONE = 200;
export const GROUP_TOPIC_BUFFER_THRESHOLD = 100;
export const GROUP_TOPIC_PROCESS_RATIO = 0.85;
export const GROUP_TOPIC_MAX_BATCH = 200;

export type GroupTopicBatch = {
    messages: Message[];
    pendingCount: number;
    hotZoneCount: number;
};

/** 只规划公共成盒范围；最近 200 条永远保留为原文热区。 */
export function planGroupTopicBatch(
    allMessages: Message[],
    archivedThroughMessageId: number = 0,
    force: boolean = false,
): GroupTopicBatch | null {
    const semantic = allMessages
        .filter(isMessageSemanticallyRelevant)
        .sort((a, b) => a.id - b.id);
    if (semantic.length <= GROUP_TOPIC_HOT_ZONE) return null;
    const hotZoneStartId = semantic[semantic.length - GROUP_TOPIC_HOT_ZONE].id;
    const pending = semantic.filter(m => m.id > archivedThroughMessageId && m.id < hotZoneStartId);
    const threshold = force ? 1 : GROUP_TOPIC_BUFFER_THRESHOLD;
    if (pending.length < threshold) return null;
    const processCount = Math.min(
        force ? pending.length : Math.ceil(pending.length * GROUP_TOPIC_PROCESS_RATIO),
        GROUP_TOPIC_MAX_BATCH,
    );
    return {
        messages: pending.slice(0, processCount),
        pendingCount: pending.length,
        hotZoneCount: Math.min(GROUP_TOPIC_HOT_ZONE, semantic.length),
    };
}

export function groupTopicPendingCount(allMessages: Message[], archivedThroughMessageId: number = 0): number {
    const semantic = allMessages.filter(isMessageSemanticallyRelevant).sort((a, b) => a.id - b.id);
    if (semantic.length <= GROUP_TOPIC_HOT_ZONE) return 0;
    const hotZoneStartId = semantic[semantic.length - GROUP_TOPIC_HOT_ZONE].id;
    return semantic.filter(m => m.id > archivedThroughMessageId && m.id < hotZoneStartId).length;
}

export function buildGroupTopicPrompt(
    group: GroupProfile,
    batch: Message[],
    characters: CharacterProfile[],
    userName: string,
    audienceMemberIds: string[] = group.members,
): string {
    const nameOf = (m: Message) => m.role === 'user'
        ? userName
        : (characters.find(c => c.id === m.charId)?.name || '未知成员');
    const participants = audienceMemberIds.map(id => characters.find(c => c.id === id)?.name).filter(Boolean).join('、');
    // 只给总结机角色语义资料，不传头像/立绘/房间图片等媒体字段，避免 base64 撑爆请求。
    const memberProfiles = audienceMemberIds.map(id => characters.find(c => c.id === id)).filter(Boolean).map(char => {
        const c = char as CharacterProfile;
        return expandPromptMacros(`### ${c.name}（${c.id}）\n角色简介：${c.description || '无'}\n核心设定：${c.systemPrompt || '无'}\n世界观：${c.worldview || '无'}\n写作人格：${c.writerPersona || '无'}\n核心记忆：${c.refinedMemories ? JSON.stringify(c.refinedMemories) : '无'}`, c.name, userName);
    }).join('\n\n');
    const logs = batch.map(m => {
        const time = new Date(m.timestamp).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
        return `[${time}] ${nameOf(m)}: ${messageLogText(m)}`;
    }).join('\n');
    return `你是群聊档案整理员。请把下面一段已经离开近期上下文的群聊，整理成一张仅由当时可见成员共享的“群聊话题盒”。

群名：${group.name}
成员：${participants}
用户：${userName}

## 当时可见成员资料
这些资料只用于准确理解每个人的身份、关系和说话含义；总结仍必须保持该可见范围内的客观视角。
${memberProfiles}

要求：
1. 使用客观第三人称，准确区分每个发言者，不站在任何单一角色视角。
2. 保留关键话题、约定、冲突、共同经历、群内梗和情绪变化；不要逐句复述。
3. 标题 6–18 字；总结 100–500 字。琐碎内容可以简短，但不能编造。
4. 这张盒子只会进入上述当时可见成员的角色上下文，并作为卡片送到这些成员私聊。
5. 严格只输出 JSON：{"title":"...","summary":"..."}
群聊原文：
${logs.slice(0, 30000)}`;
}

export function buildGroupTopicContext(group: GroupProfile, memberId?: string): string {
    const deliveredTo = (box: GroupTopicBox) => box.deliveredMemberIds || group.members;
    const boxes = (group.topicBoxes || []).filter(box => !memberId || deliveredTo(box).includes(memberId));
    if (boxes.length === 0) return '';
    const body = boxes.slice(-20).map(box => memberId
        ? `- 【${box.title}】${box.summary}`
        : `- 【${box.title}｜仅这些角色可见：${deliveredTo(box).join('、')}】${box.summary}`
    ).join('\n');
    const scope = memberId
        ? '以下是该角色亲历过的群聊归档；需要时自然承接，不要逐条复述。'
        : '以下是导演私有归档。每个角色只能使用标注为自己可见的盒子，严禁把其他范围的信息泄漏给该角色。';
    return `\n### 【${group.name} · 群聊话题盒】\n${scope}\n${body}\n`;
}

export function makeGroupTopicBox(
    group: GroupProfile,
    batch: Message[],
    title: string,
    summary: string,
    audienceMemberIds: string[] = group.members,
): GroupTopicBox {
    const now = Date.now();
    return {
        id: `group-topic-${now}-${Math.random().toString(36).slice(2, 7)}`,
        groupId: group.id,
        title: title.trim() || '一段群聊回忆',
        summary: summary.trim(),
        sourceStartMessageId: batch[0].id,
        sourceEndMessageId: batch[batch.length - 1].id,
        messageCount: batch.length,
        participants: Array.from(new Set(batch.map(m => m.charId).filter(Boolean))),
        deliveredMemberIds: [...audienceMemberIds],
        createdAt: now,
        updatedAt: now,
    };
}
