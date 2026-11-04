import type {FriendPost} from './friendFeed';
import type {FriendFeedSource} from './friendFeedSource';
import {nowInTimeZone} from './timezone';

export const validFriendTime = (value: unknown): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 8.64e15;

/** Publication is immutable source data; reading/importing never supplies a missing date. */
export function friendTimeText(value: unknown, timeZone?: string): string {
    if (!validFriendTime(value)) return '未知（未保存原始时间）';
    let zone = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
    try {new Intl.DateTimeFormat('en', {timeZone: zone}).format();}
    catch {zone = Intl.DateTimeFormat().resolvedOptions().timeZone;}
    const date = nowInTimeZone(zone, new Date(value));
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth()+1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())} [${zone}]`;
}
export function friendPublication(createdAt: unknown, timeZone?: string) {
    return {createdAt: validFriendTime(createdAt) ? createdAt : null, publishedAtText: friendTimeText(createdAt, timeZone)};
}
export function friendSourceTime(source: Pick<FriendFeedSource,'publishedAt'|'fetchedAt'>, timeZone?: string) {
    return {...friendPublication(source.publishedAt, timeZone), publishedAt: source.publishedAt ?? null,
        fetchedAt: source.fetchedAt, fetchedAtText: friendTimeText(source.fetchedAt, timeZone)};
}
export function friendPostTime(post: Pick<FriendPost,'createdAt'|'source'|'authorKind'|'synced'>, timeZone?: string) {
    // Synced RP rows already store source publication; local reposts have their own publication.
    const imported = post.authorKind === 'external' && !post.synced;
    return {...friendPublication(imported ? post.source?.publishedAt : post.createdAt, timeZone),
        ...(imported ? {importedAt: post.createdAt, importedAtText: friendTimeText(post.createdAt, timeZone)} : {})};
}
export const FRIEND_FEED_TIME_RULE = '\n材料的 createdAt/publishedAtText 是各自原始发表时间；正文、评论与引用里的“今天/昨晚”等相对词以该原话的发表日期解释，不以本轮日期解释。抓取 fetchedAt、导入 importedAt、分享 sharedAt 都不是发表或事件时间，刚刷到不等于刚发生。原始时间未知时不推成今天或仍在持续，也不把获取物品等旧事实扩展成当天使用的新事件；自然保持角色口吻，不必反复声明未知或盘问用户。';
