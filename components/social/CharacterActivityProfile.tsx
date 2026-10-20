import React, { useEffect, useState } from 'react';
import { CaretLeft, Fire } from '@phosphor-icons/react';
import type { CharacterProfile, SocialPost } from '../../types';
import { DB } from '../../utils/db';

const CharacterActivityProfile: React.FC<{
  characterId: string;
  characters: CharacterProfile[];
  onClose: () => void;
  topPadding?: string;
}> = ({ characterId, characters, onClose, topPadding = 'var(--chrome-top)' }) => {
  const character = characters.find(item => item.id === characterId);
  const [posts, setPosts] = useState<SocialPost[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void DB.getSocialPosts().then(rows => {
      if (!cancelled) setPosts(rows.filter(item => item.authorCharId === characterId).sort((a, b) => b.timestamp - a.timestamp));
    }).finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [characterId]);

  return (
    <div className="absolute inset-0 z-[80] flex flex-col bg-[#f4fbfc]">
      <header className="shrink-0 bg-gradient-to-br from-cyan-900 to-teal-700 px-4 pb-6 text-white" style={{ paddingTop: topPadding }}>
        <button type="button" onClick={onClose} className="flex h-12 w-12 items-center justify-center rounded-full" aria-label="返回"><CaretLeft size={26} /></button>
        <div className="flex items-end gap-4 px-2">
          <div className="h-20 w-20 overflow-hidden rounded-[26px] bg-white/20 ring-4 ring-white/20">
            {character?.avatar ? <img src={character.avatar} alt={character.name} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-3xl font-black">{character?.name?.slice(0, 1) || '?'}</div>}
          </div>
          <div className="min-w-0 pb-1"><h1 className="truncate text-2xl font-black">{character?.name || '已删除角色'}</h1><p className="mt-1 text-sm text-white/70">{character?.socialProfile?.handle ? `@${character.socialProfile.handle}` : 'SullyOS 居民'}</p></div>
        </div>
        {character?.socialProfile?.bio && <p className="mt-4 px-2 text-sm leading-6 text-white/85">{character.socialProfile.bio}</p>}
        <div className="mt-5 px-2 text-sm">Spark 动态 · {posts.length}</div>
      </header>
      <main className="flex-1 overflow-y-auto px-4 pb-[calc(var(--safe-bottom)+24px)] pt-3">
        {loading ? <div className="py-20 text-center text-sm text-slate-400">正在整理公开动态…</div> : posts.length === 0 ? <div className="py-20 text-center text-sm text-slate-400">这里还没有公开活动。</div> : (
          <div className="space-y-3">
            {posts.map(post => <article key={`spark-${post.id}`} className="rounded-2xl bg-white p-4 shadow-sm"><div className="flex items-center gap-2 text-xs font-bold text-rose-500"><Fire size={15} />Spark</div><h2 className="mt-2 font-bold text-slate-900">{post.title}</h2><p className="mt-1 line-clamp-3 text-sm leading-6 text-slate-500">{post.content}</p></article>)}
          </div>
        )}
      </main>
    </div>
  );
};

export default CharacterActivityProfile;
