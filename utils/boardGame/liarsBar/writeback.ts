import type {
    APIConfig, CharacterProfile, GroupProfile, LiarsBarSession, MemoryFragment, RealtimeConfig, UserProfile,
} from '../../../types';
import type { MemoryPalaceGlobalConfig } from '../../../context/OSContext';
import { markAmsgStateDirty } from '../../amsgStateSync';
import { DB } from '../../db';
import { processNewMessages } from '../../memoryPalace/pipeline';
import { buildLiarsBarPerspectiveSummary, calculateLiarsBarStats } from './stats';

export async function persistLiarsBarShare(input: {
    char: CharacterProfile;
    session: LiarsBarSession;
    userProfile: UserProfile;
    groups: GroupProfile[];
    realtimeConfig: RealtimeConfig;
    apiConfig: APIConfig;
    memoryPalaceConfig: MemoryPalaceGlobalConfig;
}): Promise<{ messageId: number; memories: MemoryFragment[] }> {
    const { char, session, userProfile, groups, realtimeConfig, apiConfig, memoryPalaceConfig } = input;
    const actorId = `character:${char.id}`;
    const summary = buildLiarsBarPerspectiveSummary(session, actorId);
    const existing = (await DB.getMessagesByCharId(char.id)).find(message =>
        message.type === 'score_card'
        && message.metadata?.source === 'board_game'
        && message.metadata?.boardGameSessionId === session.id,
    );
    const stats = calculateLiarsBarStats(session);
    const winnerName = session.players.find(player => player.actorId === session.winnerActorId)?.name || '';
    const scoreCard = {
        type: 'board_game_liars_bar_card', gameId: 'liars_bar', gameName: '骗子酒馆',
        winnerName, participantName: char.name, participantStats: stats.find(item => item.actorId === actorId),
        participants: session.players.map(player => player.name), summary,
    };
    const messageId = typeof existing?.id === 'number' ? existing.id : await DB.saveMessage({
        charId: char.id, role: 'assistant', type: 'score_card', content: summary,
        metadata: { scoreCard, source: 'board_game', gameId: 'liars_bar', boardGameSessionId: session.id },
    });
    const memoryId = `mem-board-game-liars-bar-${session.id}-${char.id}`;
    const date = new Date(session.completedAt || session.updatedAt).toISOString().slice(0, 10);
    const memories: MemoryFragment[] = [
        ...(char.memories || []).filter(memory => memory.id !== memoryId),
        { id: memoryId, date, summary, mood: 'playful' },
    ];
    markAmsgStateDirty({ char: { ...char, memories }, userProfile, groups, realtimeConfig });

    if (char.memoryPalaceEnabled && memoryPalaceConfig?.embedding?.baseUrl && memoryPalaceConfig.embedding.apiKey) {
        const lightLLM = memoryPalaceConfig.lightLLM?.baseUrl
            ? memoryPalaceConfig.lightLLM
            : { baseUrl: apiConfig.baseUrl, apiKey: apiConfig.apiKey, model: apiConfig.model };
        if (lightLLM.baseUrl) void DB.getRecentMessagesByCharId(char.id, 50)
            .then(messages => processNewMessages(messages, char.id, char.name, memoryPalaceConfig.embedding, lightLLM, userProfile.name || '', false))
            .catch(error => console.warn('[LiarsBar] memory post-hook failed:', error));
    }
    return { messageId, memories };
}
