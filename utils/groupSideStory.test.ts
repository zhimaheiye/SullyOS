// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import type { CharacterProfile, GroupProfile, Message, MountedWorldbook, UserProfile } from '../types';
import { DB } from './db';
import { MemoryNodeDB } from './memoryPalace/db';
import { buildGroupSideStoryMessages, expandGroupSideStoryMacros, groupSideStorySignature } from './groupSideStory';

const user = { name: '阿岚', bio: '群友' } as UserProfile;
const book = (id: string, content: string): MountedWorldbook => ({ id, title: id, content, constant: true, position: 4 });
const members = [
    { id: 'a', name: '阿甲', avatar: '', systemPrompt: '爱摄影，和阿岚是恋人', memories: [], mountedWorldbooks: [book('shared', '共同灯塔设定'), book('a', '阿甲独有设定')] },
    { id: 'b', name: '阿乙', avatar: '', systemPrompt: '谨慎的船长', memories: [], mountedWorldbooks: [book('shared', '共同灯塔设定')] },
    { id: 'c', name: '阿丙', avatar: '', systemPrompt: '热心的厨师', memories: [], mountedWorldbooks: [] },
] as unknown as CharacterProfile[];
const group: GroupProfile = {
    id: 'current', name: '海边旅行群', members: members.map(member => member.id), createdAt: 1,
    memberVisibilityWindows: {
        a: [{ joinedAfterMessageId: 0 }],
        b: [{ joinedAfterMessageId: 2 }],
        c: [{ joinedAfterMessageId: 0, leftAtMessageId: 2 }, { joinedAfterMessageId: 5 }],
    },
    topicBoxes: [{ id: 'box', groupId: 'current', title: '秘密会议', summary: '盒子只给甲乙', sourceStartMessageId: 1,
        sourceEndMessageId: 2, messageCount: 2, participants: ['a'], deliveredMemberIds: ['a', 'b'], createdAt: 1, updatedAt: 1 }],
};
const message = (id: number, content: string, charId = 'a', type: Message['type'] = 'text'): Message =>
    ({ id, groupId: group.id, charId, role: 'assistant', type, content, timestamp: id * 1000 } as Message);
const groupMessages = [message(1, '入群前秘密'), message(2, '早期约定'), message(3, '乙入群后可见'),
    message(4, '丙离群期间秘密'), message(5, '丙尚未回来'), message(6, '丙回来后旅行'),
    message(7, 'data:image/png;base64,AAAA', 'a', 'image')];

afterEach(() => vi.restoreAllMocks());

describe('group side story read-only snapshot', () => {
    it('mounts the shared reader from the group action grid', () => {
        const source = readFileSync('apps/GroupChat.tsx', 'utf8');
        expect(source).toContain('key="group-side-story"');
        expect(source).toContain('setSideStorySource({ group:');
        expect(source).toContain('<SideStoryModal key={sideStorySource.group.id} group={sideStorySource}');
    });
    function setup() {
        vi.spyOn(DB, 'getGroups').mockResolvedValue([group]);
        vi.spyOn(DB, 'getGroupMessages').mockResolvedValue(groupMessages);
        vi.spyOn(DB, 'peekMessagesByCharId').mockImplementation(async id => [
            { ...message(20, `${id}私聊秘密`), groupId: undefined, charId: id },
            { ...message(21, '另一群的秘密卡片', id, 'group_topic_card'), groupId: undefined },
            { ...message(22, 'blobref:private-secret', id, 'image'), groupId: undefined },
            { ...message(23, '旧凭据 sk-secretABCDEF123456', id), groupId: undefined },
        ]);
        vi.spyOn(MemoryNodeDB, 'getByCharId').mockResolvedValue([]);
        const writes = ['saveMessage', 'saveGroup', 'saveCharacter', 'updateMessage', 'saveDailySchedule', 'saveUserProfile']
            .map(key => vi.spyOn(DB, key as 'saveMessage'));
        return { writes };
    }

    it('uses all members, distinct profiles, visible windows, scoped private facts and safe media text', async () => {
        const { writes } = setup();
        const source = { group, members, contextLimit: 30 };
        const result = await buildGroupSideStoryMessages(source, user, '写{{group}}里{{members}}和{{user}}旅行；{{char}}保留，$ / @');
        const prompt = result[0].content;
        expect(result[1].content).toContain('海边旅行群里阿甲、阿乙、阿丙和阿岚');
        expect(result[1].content).toContain('{{char}}保留，$ / @');
        expect(prompt).toContain('爱摄影');
        expect(prompt).toContain('谨慎的船长');
        expect(prompt).toContain('热心的厨师');
        expect(prompt).toContain('共同灯塔设定');
        const block = (name: string) => prompt.split(`<<< ${name}（`)[1].split(`<<< ${name} 专属知情档案 END >>>`)[0];
        expect(block('阿甲')).toContain('入群前秘密');
        expect(block('阿甲')).toContain('a私聊秘密');
        expect(block('阿乙')).not.toContain('入群前秘密');
        expect(block('阿乙')).toContain('乙入群后可见');
        expect(block('阿乙')).not.toContain('a私聊秘密');
        expect(block('阿丙')).not.toContain('丙离群期间秘密');
        expect(block('阿丙')).toContain('丙回来后旅行');
        expect(block('阿丙')).not.toContain('盒子只给甲乙');
        expect(block('阿乙')).not.toContain('阿甲独有设定');
        expect(prompt).not.toMatch(/AAAA|blobref:|另一群的秘密卡片|private-secret|secretABCDEF123456/);
        expect(prompt).toContain('非正史');
        expect(prompt).toContain('不得借旁白使其他人无故知道私聊秘密');
        writes.forEach(write => expect(write).not.toHaveBeenCalled());
    });

    it('invalidates a deleted or edited group before preparing a request', async () => {
        setup();
        vi.mocked(DB.getGroups).mockResolvedValueOnce([]);
        await expect(buildGroupSideStoryMessages({ group, members, contextLimit: 30 }, user, '旅行'))
            .rejects.toThrow('GROUP_SIDE_STORY_CHANGED');
        expect(groupSideStorySignature({ ...group, members: ['a'] })).not.toBe(groupSideStorySignature(group));
    });

    it('drops a snapshot when membership changes during the read-only preparation', async () => {
        setup();
        vi.mocked(DB.getGroups).mockResolvedValueOnce([group]).mockResolvedValueOnce([{ ...group, members: ['a', 'b'] }]);
        await expect(buildGroupSideStoryMessages({ group, members, contextLimit: 30 }, user, '旅行'))
            .rejects.toThrow('GROUP_SIDE_STORY_CHANGED');
    });

    it('loads beyond the visible 50-message page and respects the group archive boundary', async () => {
        setup();
        const many = Array.from({ length: 65 }, (_, index) => message(index + 1, `群史_${index + 1}`));
        vi.mocked(DB.getGroupMessages).mockResolvedValue(many);
        const snapshot = await buildGroupSideStoryMessages({ group, members, contextLimit: 80 }, user, '长篇');
        expect(snapshot[0].content).toContain('群史_1');
        const archived = { ...group, archivedThroughMessageId: 55 };
        vi.mocked(DB.getGroups).mockResolvedValue([archived]);
        const afterArchive = await buildGroupSideStoryMessages({ group: archived, members, contextLimit: 80 }, user, '长篇');
        expect(afterArchive[0].content).not.toContain('群史_1');
        expect(afterArchive[0].content).toContain('群史_56');
    });

    it('expands only group macros without changing arbitrary writing symbols', () => {
        expect(expandGroupSideStoryMacros('{{group}} {{members}} {{user}} {{char}} $ / @', group, members, user))
            .toBe('海边旅行群 阿甲、阿乙、阿丙 阿岚 {{char}} $ / @');
    });
});
