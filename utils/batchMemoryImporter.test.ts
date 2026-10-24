import { describe, it, expect, vi } from 'vitest';
import { splitTextIntoChunks, computeChunkDate, processBatchMemoryImport } from './batchMemoryImporter';
import type { CharacterProfile, UserProfile } from '../types';

describe('batchMemoryImporter', () => {
    describe('splitTextIntoChunks', () => {
        it('returns single chunk when text size is below maxChunkSize', () => {
            const text = 'Hello world\nThis is a short memory text.';
            const chunks = splitTextIntoChunks(text, 100);
            expect(chunks).toEqual([text]);
        });

        it('splits long paragraph text into multiple chunks', () => {
            const p1 = 'A'.repeat(60);
            const p2 = 'B'.repeat(60);
            const p3 = 'C'.repeat(60);
            const text = `${p1}\n\n${p2}\n\n${p3}`;
            const chunks = splitTextIntoChunks(text, 100);
            expect(chunks.length).toBeGreaterThan(1);
            expect(chunks.join('\n\n')).toBe(text);
        });

        it('returns empty array when text is empty', () => {
            expect(splitTextIntoChunks('')).toEqual([]);
            expect(splitTextIntoChunks('   ')).toEqual([]);
        });
    });

    describe('computeChunkDate', () => {
        it('calculates linear date mapping between start and end date', () => {
            const startDate = '2026-04-01';
            const endDate = '2026-07-31';

            const d0 = computeChunkDate(startDate, endDate, 0, 4);
            const d3 = computeChunkDate(startDate, endDate, 3, 4);

            expect(d0).toBe('2026-04-01');
            expect(d3).toBe('2026-07-31');
        });

        it('handles single chunk edge case', () => {
            const startDate = '2026-04-01';
            const endDate = '2026-07-31';
            const d = computeChunkDate(startDate, endDate, 0, 1);
            expect(d).toBe('2026-04-01');
        });
    });

    describe('processBatchMemoryImport', () => {
        it('extracts legacy memories correctly with mock API response', async () => {
            const mockChar = { id: 'char1', name: 'TestChar', memoryPalaceEnabled: false } as CharacterProfile;
            const mockUser = { name: 'User' } as UserProfile;
            const mockApiConfig = { baseUrl: 'https://api.test/v1', apiKey: 'test_key', model: 'test_model' };

            // Mock fetch / safeFetchJson
            global.fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({
                    choices: [{
                        message: {
                            content: JSON.stringify([
                                { date: '2026-04-15', summary: 'Memory Item 1', mood: 'happy' },
                                { date: '2026-05-01', summary: 'Memory Item 2', mood: 'tender' }
                            ])
                        }
                    }]
                }), {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' }
                }));

            const progressLogs: any[] = [];
            const result = await processBatchMemoryImport(
                'Line 1 of long text log.\n\nLine 2 of long text log.',
                mockChar,
                mockUser,
                mockApiConfig,
                {
                    startDate: '2026-04-01',
                    endDate: '2026-07-31',
                    autoDetectDates: true,
                    targetSystems: { legacy: true, palace: false }
                },
                (p) => progressLogs.push(p)
            );

            expect(result.success).toBe(true);
            expect(result.totalExtracted).toBe(2);
            expect(result.extractedLegacyMemories[0].summary).toBe('Memory Item 1');
            expect(result.extractedLegacyMemories[0].date).toBe('2026-04-15');
            expect(progressLogs.length).toBeGreaterThan(0);
        });
    });
});
