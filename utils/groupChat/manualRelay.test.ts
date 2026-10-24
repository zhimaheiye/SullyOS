import { afterEach, expect, it, vi } from 'vitest';
import type { GroupProfile, Message } from '../../types';
import { appendMemberJoinWindow, filterGroupMessagesForMember } from './membership';
import { parseDirectorActions } from './parse';
import { completeGroupChatWithMcp } from './mcp';
import { completeMainChat } from '../mainChatCompletion';
import { armManualRelay, disarmManualRelay, getManualRelayState, noteManualRelayUserAction, submitManualRelay } from '../manualModelRelay';

afterEach(() => { disarmManualRelay(); vi.restoreAllMocks(); localStorage.clear(); });

it('relays one member reply with only that member visible history and parses the director reply normally', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('paid completion'));
    const group: GroupProfile = appendMemberJoinWindow({ id: 'g', name: '测试群', members: ['A'], createdAt: 1 }, 'B', 100);
    group.members.push('B');
    const messages = [99, 101].map(id => ({ id, charId: 'user', groupId: 'g', role: 'user',
        type: 'text', content: `第 ${id} 条`, timestamp: id })) as Message[];
    const visible = filterGroupMessagesForMember(group, 'B', messages);
    expect(visible.map(item => item.id)).toEqual([101]);
    armManualRelay(); noteManualRelayUserAction();
    const completion = completeGroupChatWithMcp({ url: '', headers: {}, groupId: 'g', userName: '用户',
        body: { model: 'test', messages: [{ role: 'system', content: 'B 的人设' },
            ...visible.map(item => ({ role: 'user', content: item.content }))] },
        requestCompletion: body => completeMainChat({ body, url: '/chat/completions', headers: {}, scope: 'group',
            meta: { appName: '群聊', charId: 'B', charName: '乙', purpose: '成员回复' } }),
    });
    await vi.waitFor(() => expect(getManualRelayState().status).toBe('waiting'));
    const captured = getManualRelayState().request!;
    expect(captured.messages.slice(0, -1).map(item => item.content)).toEqual(['B 的人设', '第 101 条']);
    submitManualRelay(captured.id, '乙：我看见了。');
    const data = await completion;
    expect(parseDirectorActions(data.choices[0].message.content, [{ id: 'B', name: '乙' }]))
        .toEqual([{ charId: 'B', content: '我看见了。' }]);
    expect(fetchMock).not.toHaveBeenCalled();
});
