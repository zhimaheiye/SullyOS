/**
 * 离线长文案/大文本批量记忆处理与导入引擎 (Batch Memory Importer)
 * 
 * 专门解决大段无时间戳文案导入时的两大痛点：
 * 1. 字符数截断限制（原单次 API 请求约 8000 字瓶颈）
 * 2. 分块输入导致的时间戳混乱与缺乏时间线连贯性（统一按指定日期区间如 2026年4月-7月 进行线性分布与解析）
 */

import type { CharacterProfile, MemoryFragment, UserProfile } from '../types';
import { safeFetchJson, extractContent, extractJson } from './safeApi';
import type { MemoryNode } from './memoryPalace/types';
import { vectorizeAndStore } from './memoryPalace/vectorStore';
import { MemoryNodeDB } from './memoryPalace/db';

export interface BatchImportOptions {
    /** 选定的起始日期 YYYY-MM-DD（默认 '2026-04-01'） */
    startDate: string;
    /** 选定的结束日期 YYYY-MM-DD（默认 '2026-07-31'） */
    endDate: string;
    /** 是否优先从文本中提取 [YYYY-MM-DD] 显式时间戳（默认 true） */
    autoDetectDates?: boolean;
    /** 单块处理字符上限（默认 3500 字，按段落切割） */
    chunkSize?: number;
    /** 目标存储系统 */
    targetSystems?: {
        legacy?: boolean; // 传统 MemoryFragment[]
        palace?: boolean; // 向量 MemoryPalace IndexedDB
    };
}

export interface BatchImportProgress {
    currentChunk: number;
    totalChunks: number;
    percentage: number;
    extractedCount: number;
    statusText: string;
    isFinished?: boolean;
    error?: string;
}

export interface BatchImportResult {
    success: boolean;
    extractedLegacyMemories: MemoryFragment[];
    palaceStoredCount: number;
    palaceSkippedCount: number;
    totalExtracted: number;
    totalChunks: number;
    errors: string[];
}

/**
 * 将长文本按段落逻辑切割成指定大小的 Chunk 列表
 */
export function splitTextIntoChunks(text: string, maxChunkSize: number = 3500): string[] {
    const trimmed = text.trim();
    if (!trimmed) return [];

    if (trimmed.length <= maxChunkSize) {
        return [trimmed];
    }

    const paragraphs = trimmed.split(/\n\s*\n/);
    const chunks: string[] = [];
    let currentChunk = '';

    for (const para of paragraphs) {
        const p = para.trim();
        if (!p) continue;

        // 如果单个段落本身就超长，则按单行或硬切割
        if (p.length > maxChunkSize) {
            if (currentChunk.trim()) {
                chunks.push(currentChunk.trim());
                currentChunk = '';
            }
            const lines = p.split('\n');
            for (const line of lines) {
                if ((currentChunk + '\n' + line).length > maxChunkSize && currentChunk.trim()) {
                    chunks.push(currentChunk.trim());
                    currentChunk = line;
                } else {
                    currentChunk = currentChunk ? `${currentChunk}\n${line}` : line;
                }
            }
        } else if ((currentChunk + '\n\n' + p).length > maxChunkSize) {
            chunks.push(currentChunk.trim());
            currentChunk = p;
        } else {
            currentChunk = currentChunk ? `${currentChunk}\n\n${p}` : p;
        }
    }

    if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
    }

    return chunks;
}

/**
 * 根据起始日期和结束日期，为第 index (0..totalChunks-1) 个 chunk 计算匀速递进的日期 YYYY-MM-DD
 */
export function computeChunkDate(startDateStr: string, endDateStr: string, index: number, totalChunks: number): string {
    const parseDate = (s: string) => {
        const m = /^(\d{4})[-/年](\d{1,2})[-/月](\d{1,2})/.exec(s);
        if (m) {
            return new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]), 12, 0, 0);
        }
        return new Date('2026-04-01T12:00:00');
    };

    const startTs = parseDate(startDateStr).getTime();
    const endTs = parseDate(endDateStr).getTime();

    if (totalChunks <= 1 || isNaN(startTs) || isNaN(endTs) || startTs >= endTs) {
        const d = new Date(startTs || Date.now());
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }

    const step = (endTs - startTs) / (totalChunks - 1);
    const currentTs = startTs + step * index;
    const d = new Date(currentTs);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/**
 * 从文本中尝试匹配 Explicit 日期（如 [2026-05-20] 或 2026-05-20: ）
 */
function extractExplicitDate(text: string): string | null {
    const match = text.match(/(?:\[|\b)(20\d{2}[-/年]\d{1,2}[-/月]\d{1,2})(?:\]|\b)/);
    if (match) {
        const parts = match[1].split(/[-/年月]/).filter(Boolean);
        if (parts.length >= 3) {
            const y = parts[0];
            const m = parts[1].padStart(2, '0');
            const d = parts[2].padStart(2, '0');
            return `${y}-${m}-${d}`;
        }
    }
    return null;
}

/**
 * 从 localStorage 读取全局或角色 MemoryPalace embedding 配置
 */
function getEmbeddingConfig(charEmbeddingConfig?: any) {
    try {
        const raw = localStorage.getItem('os_memory_palace_config');
        if (raw) {
            const global = JSON.parse(raw);
            if (global.embedding?.baseUrl && global.embedding?.apiKey) {
                return global.embedding;
            }
        }
    } catch {}
    if (charEmbeddingConfig?.baseUrl && charEmbeddingConfig?.apiKey) {
        return charEmbeddingConfig;
    }
    return null;
}

/**
 * 离线批量抽取与写入主逻辑
 */
export async function processBatchMemoryImport(
    rawText: string,
    char: CharacterProfile,
    userProfile: UserProfile,
    apiConfig: { baseUrl: string; apiKey: string; model: string },
    options: BatchImportOptions,
    onProgress?: (progress: BatchImportProgress) => void
): Promise<BatchImportResult> {
    const result: BatchImportResult = {
        success: false,
        extractedLegacyMemories: [],
        palaceStoredCount: 0,
        palaceSkippedCount: 0,
        totalExtracted: 0,
        totalChunks: 0,
        errors: [],
    };

    if (!rawText.trim()) {
        result.errors.push('输入文本为空');
        return result;
    }
    if (!apiConfig.apiKey) {
        result.errors.push('未配置 API Key');
        return result;
    }

    const maxChunkSize = options.chunkSize || 3500;
    const chunks = splitTextIntoChunks(rawText, maxChunkSize);
    result.totalChunks = chunks.length;

    if (chunks.length === 0) {
        result.errors.push('切割文本后无可处理片段');
        return result;
    }

    const legacyEnabled = options.targetSystems?.legacy !== false;
    // 宫殿写入：只要 UI 勾选了 palace 就尝试，不依赖 char.memoryPalaceEnabled（该字段对新角色可能未设置）
    const palaceEnabled = options.targetSystems?.palace === true;

    const startDate = options.startDate || '2026-04-01';
    const endDate = options.endDate || '2026-07-31';
    const autoDetect = options.autoDetectDates !== false;

    const extractedNodesForPalace: MemoryNode[] = [];
    const extractedLegacyItems: MemoryFragment[] = [];

    onProgress?.({
        currentChunk: 0,
        totalChunks: chunks.length,
        percentage: 0,
        extractedCount: 0,
        statusText: `准备处理，共 ${chunks.length} 个文本块...`,
    });

    for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        const computedDate = computeChunkDate(startDate, endDate, i, chunks.length);
        const explicitDate = autoDetect ? extractExplicitDate(chunk) : null;
        const targetDate = explicitDate || computedDate;

        const currentPercentage = Math.round(((i) / chunks.length) * 100);
        onProgress?.({
            currentChunk: i + 1,
            totalChunks: chunks.length,
            percentage: currentPercentage,
            extractedCount: extractedLegacyItems.length,
            statusText: `正在处理第 ${i + 1}/${chunks.length} 块 (${targetDate})...`,
        });

        // 构造智能提取 Prompt
        const prompt = `Task: Extract key memory fragments from the historical text log below.
Character Name: ${char.name}
User Name: ${userProfile.name}
Assigned Target Date: ${targetDate}

Rules:
1. Extract atomic memories from the perspective of ${char.name} (first-person "我" or neutral observations).
2. Assign each memory item a "date" in YYYY-MM-DD format (use "${targetDate}" if no explicit different date is given in the text).
3. Assign a "mood" from: happy, sad, angry, anxious, tender, archive, record.
4. Assign a "room" for Memory Palace from: living_room, bedroom, study, user_room, self_room, attic, windowsill.
5. Assign an "importance" score between 1 and 10.
6. Output JSON format strictly:
[
  {
    "date": "YYYY-MM-DD",
    "summary": "详细记忆内容...",
    "mood": "happy",
    "room": "living_room",
    "importance": 7,
    "tags": ["标签1", "标签2"]
  }
]

Text Log Chunk:
${chunk}`;

        try {
            const data = await safeFetchJson(
                `${apiConfig.baseUrl.replace(/\/+$/, '')}/chat/completions`,
                {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiConfig.apiKey}`,
                    },
                    body: JSON.stringify({
                        model: apiConfig.model,
                        messages: [{ role: 'user', content: prompt }],
                        temperature: 0.2,
                    }),
                },
                1, 0, { appName: '记忆导入', purpose: '批量旧记忆抽取', featureId: 'memoryImport' }
            );

            let content = extractContent(data);
            const parsedArray = extractJson(content);

            if (Array.isArray(parsedArray)) {
                for (const item of parsedArray) {
                    if (!item.summary) continue;

                    const date = item.date && /^\d{4}-\d{2}-\d{2}$/.test(item.date) ? item.date : targetDate;
                    const summary = String(item.summary).trim();
                    const mood = item.mood || 'record';
                    const room = item.room || 'living_room';
                    const importance = typeof item.importance === 'number' ? item.importance : 5;
                    const tags = Array.isArray(item.tags) ? item.tags.map(String) : [];

                    // 1. Traditional Legacy Fragment
                    const frag: MemoryFragment = {
                        id: `mem-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                        date,
                        summary,
                        mood,
                    };
                    extractedLegacyItems.push(frag);

                    // 2. Memory Palace Node
                    if (palaceEnabled) {
                        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
                        let nodeTs = Date.now();
                        if (m) {
                            nodeTs = new Date(parseInt(m[1]), parseInt(m[2]) - 1, parseInt(m[3]), 12, 0, 0).getTime();
                        }
                        const node: MemoryNode = {
                            id: `mp_batch_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
                            charId: char.id,
                            content: summary,
                            room,
                            importance,
                            mood,
                            tags,
                            createdAt: nodeTs,
                            lastAccessedAt: nodeTs,
                            accessCount: 1,
                            embedded: false,
                            origin: 'system',
                        };
                        extractedNodesForPalace.push(node);
                    }
                }
            } else {
                result.errors.push(`第 ${i + 1} 块未能解析为有效 JSON 结构`);
            }
        } catch (e: any) {
            console.error(`[BatchImport] Chunk ${i + 1} failed:`, e);
            result.errors.push(`第 ${i + 1} 块提取失败: ${e.message || '未知错误'}`);
        }
    }

    result.totalExtracted = extractedLegacyItems.length;
    result.extractedLegacyMemories = extractedLegacyItems;

    // 向量化写入 Memory Palace (如果开启)
    if (palaceEnabled && extractedNodesForPalace.length > 0) {
        onProgress?.({
            currentChunk: chunks.length,
            totalChunks: chunks.length,
            percentage: 95,
            extractedCount: extractedLegacyItems.length,
            statusText: `正在对 ${extractedNodesForPalace.length} 条向量记忆进行 Embedding 入库...`,
        });

        try {
            const embeddingConfig = getEmbeddingConfig(char.embeddingConfig);
            if (embeddingConfig) {
                const vecRes = await vectorizeAndStore(extractedNodesForPalace, embeddingConfig, undefined, { skipDedup: false });
                result.palaceStoredCount = vecRes.stored;
                result.palaceSkippedCount = vecRes.skipped;
            } else {
                // 如果未设置 embedding 配置，仅存 IDB 文本节点
                for (const node of extractedNodesForPalace) {
                    await MemoryNodeDB.save(node);
                }
                result.palaceStoredCount = extractedNodesForPalace.length;
            }
        } catch (e: any) {
            console.error('[BatchImport] Palace Vectorization failed:', e);
            result.errors.push(`记忆宫殿向量化失败: ${e.message || '未知错误'}`);
        }
    }

    onProgress?.({
        currentChunk: chunks.length,
        totalChunks: chunks.length,
        percentage: 100,
        extractedCount: extractedLegacyItems.length,
        statusText: `批量处理完成！成功提取 ${extractedLegacyItems.length} 条记忆`,
        isFinished: true,
    });

    result.success = extractedLegacyItems.length > 0;
    return result;
}
