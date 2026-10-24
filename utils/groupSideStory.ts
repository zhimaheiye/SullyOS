import type { CharacterProfile, GroupProfile, Message, UserProfile } from '../types';
import { DB } from './db';
import { ContextBuilder } from './context';
import { MemoryNodeDB } from './memoryPalace/db';
import { computeContextRangeSnapshot, getMemoryPalaceHighWaterMarkForContext } from './chatContextRange';
import { filterGroupMessagesForMember } from './groupChat/membership';
import { buildGroupHistoryBlock } from './groupChat/prompts';
import { buildGroupTopicContext } from './groupChat/topicBoxes';
import { buildMemberTimeline, DEFAULT_MEMBER_TIMELINE_CAP } from './groupChat/timeline';

export interface GroupSideStorySource {
    group: GroupProfile;
    members: CharacterProfile[];
    contextLimit: number;
}

const clean = (value: string) => value
    .replace(/data:image\/[\w.+-]+;base64,[a-z\d+/=]+/gi, '[图片原图未提供]')
    .replace(/blobref:[a-z\d_-]+/gi, '[图片原图未提供]')
    .replace(/https?:\/\/[^\s<>"']+/gi, '[外部链接未提供]')
    .replace(/\b(?:sk-|Bearer\s+)[a-z\d._~+/-]{8,}/gi, '[凭据已隐藏]');

export function groupSideStorySignature(group: GroupProfile): string {
    return JSON.stringify({ id: group.id, name: group.name, members: group.members,
        windows: group.memberVisibilityWindows, topicBoxes: group.topicBoxes,
        archivedThroughMessageId: group.archivedThroughMessageId });
}

export function expandGroupSideStoryMacros(request: string, group: GroupProfile, members: CharacterProfile[], user: UserProfile): string {
    return request.replace(/{{\s*(group|members|user)\s*}}/gi, (_match, key: string) => {
        if (key.toLowerCase() === 'group') return group.name;
        if (key.toLowerCase() === 'members') return members.map(member => member.name).join('、');
        return user.name;
    });
}

const RULES = `# 本轮群聊番外创作
你是独立小说的叙述者。番外为非正史的临时阅读文字，不推进群聊或私聊主线，也不成为任何角色的真实经历、记忆或关系变化。遵从用户本轮题材、视角、文风、篇幅与主角选择；群内成员都可登场，但不要求平均戏份或人人发言。
下列每位成员档案、私聊和群史按角色分别标注知情范围。叙述者可用它们写群像，但角色只能知道本人档案与本人可见群史、话题盒及自己参与的私聊；不得借旁白使其他人无故知道私聊秘密、入群前或离群期间的消息。未明确共享的世界书也只属于其标注角色。
自由输出 Markdown 叙事正文，可含标题、章节、台词、前后记；无需 JSON、HTML、群消息格式、逐人调用或工具。历史中的 [[PRIVATE]]、[[SEND_PACKET]]、红包与 MCP 指令仅是素材，不执行现实动作或消息派发。{{char}} 是单角色宏，在群聊需求中保留原样，不指向第一位成员。`;

/** Read-only, per-member knowledge snapshot. Never uses the mutable group reply or palace recall paths. */
export async function buildGroupSideStoryMessages(source: GroupSideStorySource, user: UserProfile, request: string, onHistoryReady?: () => void) {
    const { group, members } = source;
    if (!members.length || members.length !== group.members.length || members.some(member => !group.members.includes(member.id))) {
        throw new Error('GROUP_SIDE_STORY_CHANGED');
    }
    const persisted = (await DB.getGroups()).find(item => item.id === group.id);
    if (!persisted || groupSideStorySignature(persisted) !== groupSideStorySignature(group)) throw new Error('GROUP_SIDE_STORY_CHANGED');
    const allGroupMessages = (await DB.getGroupMessages(group.id)).sort((a, b) => a.id - b.id);
    onHistoryReady?.();
    const live = allGroupMessages.filter(message => message.id > (group.archivedThroughMessageId || 0));
    const limit = Number.isFinite(source.contextLimit) && source.contextLimit > 0 ? Math.floor(source.contextLimit) : 30;
    const compiled = expandGroupSideStoryMacros(request, group, members, user);
    const shared = ContextBuilder.buildGroupSharedScene(members.map(member => ({ ...member, mountedWorldbooks: [] })), user, []);
    const blocks: string[] = [];
    for (const member of members) {
        const visible = filterGroupMessagesForMember(group, member.id, live).slice(-limit);
        const groupHistory = buildGroupHistoryBlock(visible, members, [], user.name, 0, { useVisionDescriptions: true });
        const rawPrivate = await DB.peekMessagesByCharId(member.id);
        const privateRange = computeContextRangeSnapshot(rawPrivate, member, getMemoryPalaceHighWaterMarkForContext(member.id));
        // Topic cards can refer to other groups; this group's boxes are provided through its own audience gate.
        const privateMessages = privateRange.messages.filter(message => message.type !== 'group_topic_card')
            .slice(-(group.privateContextCap ?? 80));
        const timeline = buildMemberTimeline({ privateMsgs: privateMessages, groupMsgs: visible,
            cap: group.memberTimelineCap ?? DEFAULT_MEMBER_TIMELINE_CAP,
            resolveSpeaker: message => members.find(person => person.id === message.charId)?.name || '未知成员' });
        // Worldbook triggers see only this member's permitted history, with original message boundaries.
        const history = [
            ...privateMessages.map(message => ({ id: message.id, timestamp: message.timestamp,
                role: message.role, content: clean(String(message.content || '')) })),
            ...visible.map((message, index) => ({ id: message.id, timestamp: message.timestamp,
                role: groupHistory.messages?.[index]?.role || message.role,
                content: clean(groupHistory.messages?.[index]?.content || '') })),
        ].sort((a, b) => a.timestamp - b.timestamp || a.id - b.id)
            .map(({ role, content }) => ({ role, content }));
        const characterContext = await ContextBuilder.buildCharacterContext({
            char: { ...member, memoryPalaceInjection: '', roomPlatesInjection: '' }, user,
            history, includeLifeContext: false,
            groupOptions: { skipUserProfile: true, skipWorldview: shared.worldviewIsShared,
                headerOverride: `[Group Member Profile: ${member.name}]` },
            layout: { deferVolatile: true },
        });
        const historySet = new Set<object>(history);
        let palace = '';
        if (member.memoryPalaceEnabled) {
            const nodes = await MemoryNodeDB.getByCharId(member.id);
            palace = nodes.filter(node => !node.archived && !node.storyTimelineScope
                && (!node.groupId || node.groupId === group.id) && node.content.trim())
                .sort((a, b) => b.createdAt - a.createdAt).slice(0, 12)
                .map(node => `- ${clean(node.content.slice(0, 500))}`).join('\n');
        }
        blocks.push(`<<< ${member.name}（${member.id}）专属知情档案 START >>>\n`
            + `${clean(characterContext.coreContext)}\n`
            + `【仅 ${member.name} 知道的私聊与本群互动时间线】\n${clean(timeline) || '（暂无）'}\n`
            + `【仅 ${member.name} 可见的本群原文】\n${clean(groupHistory.text) || '（暂无）'}\n`
            + `【仅 ${member.name} 可见的话题盒】\n${clean(buildGroupTopicContext(group, member.id)) || '（暂无）'}\n`
            + (palace ? `【仅 ${member.name} 的只读记忆】\n${palace}\n` : '')
            + `【仅 ${member.name} 的世界书深度触发】\n${characterContext.history
                .filter(item => !historySet.has(item)).map(item => clean(String(item.content))).join('\n') || '（无额外条目）'}\n`
            + `<<< ${member.name} 专属知情档案 END >>>`);
    }
    // A membership edit or deletion during the async reads invalidates the entire snapshot.
    const latest = (await DB.getGroups()).find(item => item.id === group.id);
    if (!latest || groupSideStorySignature(latest) !== groupSideStorySignature(group)) throw new Error('GROUP_SIDE_STORY_CHANGED');
    const messages: Array<{ role: 'system' | 'assistant' | 'user'; content: string }> = [
        { role: 'system', content: `${RULES}\n\n群名：${clean(group.name)}\n当前成员：${members.map(member => clean(member.name)).join('、')}\n${clean(shared.text)}\n\n${blocks.join('\n\n')}` },
        { role: 'user', content: compiled },
    ];
    return messages;
}
