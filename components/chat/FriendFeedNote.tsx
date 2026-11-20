import React from 'react';
import {ArrowUpRight, ChatCircle} from '@phosphor-icons/react';
import type {FriendFeedCommentNote} from '../../utils/friendFeedEmotion';
import './friendFeedNote.css';

/** A quiet timeline annotation: one preview line, details only when requested. */
export function FriendFeedNote({note, onOpenPost, selectionMode = false}: {
    note: FriendFeedCommentNote; onOpenPost?: (postId: string) => void; selectionMode?: boolean;
}) {
    if(note.kind==='identity')return <details className="friend-feed-note">
        <summary><ChatCircle size={13} aria-hidden="true"/><span>哔哔 · 认出了一个账号</span><small>展开</small><span className="friend-feed-note-preview">{note.comment}</span></summary>
        <div className="friend-feed-note-detail"><p>{note.comment}</p><p><span>确认依据</span>{note.postExcerpt}</p></div>
    </details>;
    return <details className="friend-feed-note">
        <summary><ChatCircle size={13} aria-hidden="true"/><span>哔哔 · {note.kind === 'repost' ? '转发了真实帖子' : note.kind === 'post' ? '发了条动态' : note.kind === 'replied' ? '评论被回复' : note.kind === 'received' ? '收到新评论' : '留了句评论'}</span><small>展开</small>
            <span className="friend-feed-note-preview">{note.kind === 'post' || note.kind === 'repost' ? note.postExcerpt : note.comment}</span></summary>
        <div className="friend-feed-note-detail">
            {note.accountName && <p><span>使用的账号</span>{note.accountName}</p>}
            {onOpenPost && typeof note.postId === 'string' && note.postId.trim() ? <button type="button" className="friend-feed-note-post"
                aria-label="查看这条哔哔动态" aria-disabled={selectionMode || undefined}
                onClick={event => {if (selectionMode) return; event.stopPropagation(); onOpenPost(note.postId);}}>
                <span>{note.kind === 'post' || note.kind === 'repost' || note.kind === 'received' ? '你发布的动态' : `${note.postAuthor}的动态`}<ArrowUpRight size={12} aria-hidden="true"/></span>
                {note.postExcerpt}
            </button> : <p><span>{note.kind === 'post' || note.kind === 'repost' || note.kind === 'received' ? '你发布的动态' : `${note.postAuthor}的动态`}</span>{note.postExcerpt}</p>}
            {onOpenPost && !(typeof note.postId === 'string' && note.postId.trim()) && <small role="status">这条旧记录没有动态标识，无法跳转。</small>}
            {note.replyTo && <p><span>回应的评论</span>{note.replyTo}</p>}
            {note.kind !== 'post' && note.kind !== 'repost' && <p><span>{note.kind === 'received'||note.kind==='replied' ? '收到的评论' : '已发布的评论'}</span>{note.comment}</p>}
            {note.source && <p><span>原帖 · {note.source.author}</span>{note.source.text}</p>}
        </div>
    </details>;
}
