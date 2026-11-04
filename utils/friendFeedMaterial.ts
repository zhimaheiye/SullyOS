import type {FriendPost} from './friendFeed';
import {friendPublication, validFriendTime} from './friendFeedTime';

/** Input excerpts only; publication limits and explicit share snapshots are separate. */
export const FRIEND_FEED_EXCERPT_LIMIT = 1200;
export const friendFeedExcerpt = (text: string) => text.length > FRIEND_FEED_EXCERPT_LIMIT
    ? `${text.slice(0, FRIEND_FEED_EXCERPT_LIMIT)}…` : text;

/** Keep every local contribution, including replies quoting an original comment. */
export const friendLocalComments = (post: Pick<FriendPost,'comments'|'weiboComments'>, timeZone?: string) => post.comments.map(c => ({
    id: c.id, authorId:c.authorId, author: c.authorName, text: friendFeedExcerpt(c.text),
    ...friendPublication(c.createdAt, timeZone),
    ...(c.localReply ? {localReply:{...c.localReply, ...friendPublication(validFriendTime(c.localReply.createdAt)
        ? c.localReply.createdAt : post.comments.find(original=>original.id===c.localReply!.id)?.createdAt, timeZone)}} : {}),
    ...(c.sourceReply ? {sourceReply: {...c.sourceReply, ...friendPublication(validFriendTime(c.sourceReply.createdAt)
        ? c.sourceReply.createdAt : post.weiboComments?.rows.find(original=>original.id===c.sourceReply!.id)?.createdAt, timeZone)}} : {}),
}));

/** Time-only attachment for an existing behavior note; never adds another memory write. */
export function friendCommentTimes(post: FriendPost, ids: string[], timeZone?: string) {
    return friendLocalComments(post,timeZone).filter(c=>ids.includes(c.id)).map(c=>({
        id:c.id,createdAt:c.createdAt,publishedAtText:c.publishedAtText,
        ...(c.localReply?{localReply:{id:c.localReply.id,...friendPublication(c.localReply.createdAt,timeZone)}}:{}),
        ...(c.sourceReply?{sourceReply:{id:c.sourceReply.id,...friendPublication(c.sourceReply.createdAt,timeZone)}}:{}),
    }));
}
