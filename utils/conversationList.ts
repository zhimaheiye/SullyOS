import type { CharacterProfile, GroupProfile, Message } from '../types';
import { isBlobRef } from './blobRef';

export type ConversationSummary = {
    kind: 'private' | 'group';
    id: string;
    title: string;
    avatar?: string;
    preview: string;
    timestamp: number;
};

export const isConversationListMessage = (message: Message, hideSystemLogs = false): boolean => (
    message.metadata?.source !== 'date'
    && message.metadata?.source !== 'call'
    && message.metadata?.source !== 'story_theater_memory'
    && !message.metadata?.proactiveHint
    && !(hideSystemLogs && message.role === 'system' && message.type !== 'score_card')
);

const oneLine = (value: string): string => value.replace(/\s+/g, ' ').trim();

export function conversationMessagePreview(message: Message): string {
    if (message.type === 'image') return '[图片]';
    if (message.type === 'voice') return '[语音]';
    if (message.type === 'emoji') return '[表情]';
    if (message.type === 'transfer') return message.metadata?.packet ? '[红包]' : '[转账]';
    if (message.type === 'group_topic_card') return '[群聊话题]';
    if (message.type === 'html_card') return '[HTML卡片]';
    if (message.type === 'score_card') {
        const card = message.metadata?.scoreCard;
        if (card?.type === 'diary_card') return '[交换日记]';
        return '[互动卡片]';
    }
    if (message.type.endsWith('_card')) return `[${({
        music_card: '音乐', xhs_card: '小红书', webpage_card: '网页', theater_card: '小剧场',
        social_card: '动态', news_card: '新闻', phone_card: '手机', life_card: '生活记录',
    } as Record<string, string>)[message.type] || '卡片'}]`;
    const content = oneLine(typeof message.content === 'string' ? message.content : '');
    if (!content) return '[消息]';
    if (/^(?:data:|https?:\/\/)/i.test(content) || isBlobRef(content)) return '[媒体]';
    return content;
}

export function formatConversationTime(timestamp: number, now = new Date()): string {
    const value = new Date(timestamp);
    const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const startYesterday = startToday - 24 * 60 * 60 * 1000;
    if (timestamp >= startToday) {
        return `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
    }
    if (timestamp >= startYesterday) return '昨天';
    return `${value.getMonth() + 1}月${value.getDate()}日`;
}

export function buildConversationSummaries(input: {
    characters: CharacterProfile[];
    groups: GroupProfile[];
    privateLatest: Record<string, Message | undefined>;
    groupLatest: Record<string, Message | undefined>;
}): ConversationSummary[] {
    const { characters, groups, privateLatest, groupLatest } = input;
    const characterById = new Map(characters.map(character => [character.id, character]));
    const items: ConversationSummary[] = [];

    for (const character of characters) {
        const message = privateLatest[character.id];
        if (!message) continue;
        items.push({
            kind: 'private', id: character.id, title: character.name, avatar: character.avatar,
            preview: conversationMessagePreview(message), timestamp: message.timestamp,
        });
    }

    for (const group of groups) {
        const message = groupLatest[group.id];
        const speaker = message
            ? message.role === 'user'
                ? '我'
                : characterById.get(message.charId)?.name || '群成员'
            : '';
        items.push({
            kind: 'group', id: group.id, title: group.name, avatar: group.avatar,
            preview: message ? `${speaker}：${conversationMessagePreview(message)}` : '暂无消息',
            timestamp: message?.timestamp ?? group.createdAt,
        });
    }

    return items.sort((a, b) => b.timestamp - a.timestamp);
}
