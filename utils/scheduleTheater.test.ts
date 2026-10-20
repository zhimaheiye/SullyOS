import { describe, expect, it } from 'vitest';
import type { DailySchedule } from '../types';
import { DB } from './db';
import { persistScheduleTheaterCard } from './scheduleTheater';

describe('schedule theater chat persistence', () => {
    it('writes the same exposed theater card for every schedule entry point', async () => {
        const charId = `schedule-theater-${Date.now()}`;
        const schedule: DailySchedule = {
            id: `${charId}_2026-08-17`,
            charId,
            date: '2026-08-17',
            generatedAt: Date.now(),
            slots: [{
                startTime: '14:00',
                activity: '挥刀训练',
                emoji: '🗡️',
                theater: { generatedAt: Date.now(), lines: [{ emotion: '✨', text: '刀锋掠过木桩。' }] },
            }],
        };

        expect(await persistScheduleTheaterCard(schedule, 0, true)).toBe(true);
        const messages = await DB.getMessagesByCharId(charId, true);
        const message = messages.at(-1);
        expect(message).toMatchObject({
            charId,
            role: 'user',
            type: 'theater_card',
            content: '14:00 · 挥刀训练',
            metadata: {
                slotTime: '14:00',
                activity: '挥刀训练',
                emoji: '🗡️',
                date: '2026-08-17',
                exposed: true,
            },
        });

        if (message?.id) await DB.deleteMessages([message.id]);
    });

    it('does not write an empty or not-yet-generated slot', async () => {
        const schedule: DailySchedule = {
            id: 'schedule-theater-empty_2026-08-17',
            charId: 'schedule-theater-empty',
            date: '2026-08-17',
            generatedAt: Date.now(),
            slots: [{ startTime: '20:00', activity: '晚餐' }],
        };

        expect(await persistScheduleTheaterCard(schedule, 0, false)).toBe(false);
    });
});
