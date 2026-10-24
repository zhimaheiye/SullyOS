import type { StoryTheaterEntry } from '../types';
import type { EmbeddingConfig, MemoryNode, RemoteVectorConfig } from './memoryPalace/types';
import { MemoryLinkDB, MemoryNodeDB, MemoryVectorDB } from './memoryPalace/db';
import { updateStoredMemoryNode } from './memoryPalace/vectorStore';
import { deleteVector as deleteRemoteVector } from './memoryPalace/supabaseVector';
import { storyTheaterThreadId } from './storyTheater';

function assertStoryPartition(entryId: string, node: MemoryNode | undefined): MemoryNode {
    if (!node) throw new Error('这条剧情记忆已经不存在了');
    const legacyPartition = storyTheaterThreadId(entryId);
    const scopedPartitionPrefix = `${legacyPartition}:archive:`;
    if (node.charId !== legacyPartition && !node.charId.startsWith(scopedPartitionPrefix)) {
        throw new Error('已阻止跨剧情分区操作');
    }
    if (node.storyTimelineScope && node.storyTimelineScope.entryId !== entryId) throw new Error('已阻止跨剧情分区操作');
    return node;
}

export async function listStoryVectorMemories(entryOrId: StoryTheaterEntry | string): Promise<MemoryNode[]> {
    const entryId = typeof entryOrId === 'string' ? entryOrId : entryOrId.id;
    const partitions = new Set([storyTheaterThreadId(entryId)]);
    if (typeof entryOrId !== 'string') {
        for (const archive of entryOrId.archives) if (archive.vectorPartitionId) partitions.add(archive.vectorPartitionId);
    }
    const nodes = (await Promise.all([...partitions].map(partition => MemoryNodeDB.getByCharId(partition)))).flat();
    return nodes
        .filter(node => partitions.has(node.charId))
        .sort((a, b) => b.createdAt - a.createdAt);
}

export async function updateStoryVectorMemory(
    entryId: string,
    nodeId: string,
    content: string,
    embeddingConfig?: EmbeddingConfig,
    remoteVectorConfig?: RemoteVectorConfig,
): Promise<MemoryNode> {
    assertStoryPartition(entryId, await MemoryNodeDB.getById(nodeId));
    const result = await updateStoredMemoryNode(
        nodeId,
        { content: content.trim() },
        embeddingConfig,
        remoteVectorConfig,
    );
    return assertStoryPartition(entryId, result.node);
}

export async function deleteStoryVectorMemory(
    entryId: string,
    nodeId: string,
    remoteVectorConfig?: RemoteVectorConfig,
): Promise<{ remoteDeleted: boolean | null }> {
    assertStoryPartition(entryId, await MemoryNodeDB.getById(nodeId));
    const links = await MemoryLinkDB.getByNodeId(nodeId);
    await Promise.all([
        ...links.map(link => MemoryLinkDB.delete(link.id)),
        MemoryVectorDB.delete(nodeId),
        MemoryNodeDB.delete(nodeId),
    ]);

    if (!remoteVectorConfig?.enabled || !remoteVectorConfig.initialized) {
        return { remoteDeleted: null };
    }
    return { remoteDeleted: await deleteRemoteVector(remoteVectorConfig, nodeId) };
}
