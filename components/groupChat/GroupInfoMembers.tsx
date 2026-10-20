import React from 'react';
import type { CharacterProfile, GroupProfile, UserProfile } from '../../types';
import TokenImg from '../os/TokenImg';

type Props = {
    group: GroupProfile;
    characters: CharacterProfile[];
    userProfile: UserProfile;
    onInvite: () => void;
    onRemove: () => void;
};

const MemberAvatar: React.FC<{ avatar?: string; name: string }> = ({ avatar, name }) => avatar ? (
    <TokenImg value={avatar} className="h-12 w-12 rounded-2xl object-cover" />
) : (
    <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-sm font-bold text-slate-400">{name.slice(0, 1)}</div>
);

const GroupInfoMembers: React.FC<Props> = ({ group, characters, userProfile, onInvite, onRemove }) => (
    <section className="space-y-3">
        <div className="flex items-center justify-between">
            <label className="text-[10px] font-bold uppercase tracking-widest text-slate-400">群成员</label>
            <span className="text-[10px] font-semibold text-slate-400">{group.members.length + 1} 人</span>
        </div>
        <div className="grid grid-cols-4 gap-x-2 gap-y-4 rounded-2xl bg-slate-50 p-3">
            <div className="flex min-w-0 flex-col items-center gap-1.5">
                <MemberAvatar avatar={userProfile.avatar} name={userProfile.name || '我'} />
                <span className="w-full truncate text-center text-[10px] text-slate-600">{userProfile.name || '我'}（我）</span>
            </div>
            {group.members.map(memberId => {
                const character = characters.find(item => item.id === memberId);
                if (!character) return null;
                return (
                    <div key={memberId} className="flex min-w-0 flex-col items-center gap-1.5">
                        <MemberAvatar avatar={character.avatar} name={character.name} />
                        <span className="w-full truncate text-center text-[10px] text-slate-600">{character.name}</span>
                    </div>
                );
            })}
            <button type="button" onClick={onInvite} className="flex min-w-0 flex-col items-center gap-1.5 text-emerald-600">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-dashed border-emerald-300 bg-emerald-50 text-2xl font-light">+</span>
                <span className="text-[10px] font-semibold">邀请</span>
            </button>
            <button type="button" onClick={onRemove} className="flex min-w-0 flex-col items-center gap-1.5 text-rose-500">
                <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-dashed border-rose-300 bg-rose-50 text-2xl font-light">−</span>
                <span className="text-[10px] font-semibold">移除</span>
            </button>
        </div>
    </section>
);

export default GroupInfoMembers;
