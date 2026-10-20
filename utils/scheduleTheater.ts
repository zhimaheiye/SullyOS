import type { DailySchedule } from '../types';
import { DB } from './db';

/**
 * 将角色日程中的一段已生成小剧场留痕到对应主聊天。
 *
 * 主聊天内的日程入口与桌面多角色日程查看器都走这里，避免两处对
 * exposed（角色是否发现用户在看）的语义产生分叉。
 */
export async function persistScheduleTheaterCard(
    schedule: DailySchedule,
    slotIndex: number,
    exposed: boolean,
): Promise<boolean> {
    const slot = schedule.slots[slotIndex];
    if (!slot?.theater || slot.theater.lines.length === 0) return false;

    await DB.saveMessage({
        charId: schedule.charId,
        role: 'user',
        type: 'theater_card',
        content: `${slot.startTime} · ${slot.activity}`,
        metadata: {
            theater: slot.theater,
            slotTime: slot.startTime,
            activity: slot.activity,
            emoji: slot.emoji,
            date: schedule.date,
            exposed,
        },
    });
    return true;
}
