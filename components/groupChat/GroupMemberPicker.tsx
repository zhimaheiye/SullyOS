import React, { useMemo, useState } from 'react';
import type { CharacterGroup, CharacterProfile } from '../../types';
import { CharacterGroupFilterBar, filterCharactersByGroup, GROUP_FILTER_ALL } from '../character/CharacterGroupFilter';
import TokenImg from '../os/TokenImg';

type Props = {
    mode: 'invite' | 'remove';
    characters: CharacterProfile[];
    characterGroups: CharacterGroup[];
    currentMemberIds: string[];
    selectedIds: Set<string>;
    onToggle: (charId: string) => void;
};

const GroupMemberPicker: React.FC<Props> = ({ mode, characters, characterGroups, currentMemberIds, selectedIds, onToggle }) => {
    const [groupId, setGroupId] = useState(GROUP_FILTER_ALL);
    const candidates = useMemo(() => {
        const current = new Set(currentMemberIds);
        return filterCharactersByGroup(characters, characterGroups, groupId)
            .filter(character => mode === 'invite' ? !current.has(character.id) : current.has(character.id));
    }, [characters, characterGroups, currentMemberIds, groupId, mode]);
    const remaining = currentMemberIds.length - selectedIds.size;

    return (
        <div className="space-y-3">
            <p className="text-xs leading-5 text-slate-500">
                {mode === 'invite' ? '可多选尚未加入本群的角色。新成员只会知道加入后的群消息。' : '可多选当前 AI 成员；群里必须至少保留 1 名 AI。历史消息不会被删除。'}
            </p>
            <CharacterGroupFilterBar characters={characters} groups={characterGroups} value={groupId} onChange={setGroupId} />
            <div className="grid max-h-[46vh] grid-cols-4 gap-2 overflow-y-auto pr-1">
                {candidates.map(character => {
                    const selected = selectedIds.has(character.id);
                    const disabled = mode === 'remove' && !selected && remaining <= 1;
                    return (
                        <button
                            type="button"
                            key={character.id}
                            disabled={disabled}
                            onClick={() => onToggle(character.id)}
                            className={`relative flex min-w-0 flex-col items-center gap-1 rounded-xl border p-2 transition-all ${selected ? 'border-violet-500 bg-violet-50 ring-1 ring-violet-500' : 'border-slate-100 bg-white'} ${disabled ? 'cursor-not-allowed opacity-35' : 'active:scale-95'}`}
                        >
                            {character.avatar ? (
                                <TokenImg value={character.avatar} className="h-11 w-11 rounded-full object-cover" />
                            ) : (
                                <span className="flex h-11 w-11 items-center justify-center rounded-full bg-slate-100 text-sm font-bold text-slate-400">{character.name.slice(0, 1)}</span>
                            )}
                            <span className="w-full truncate text-center text-[9px] font-medium text-slate-600">{character.name}</span>
                            {selected && <span className="absolute right-1.5 top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-violet-500 text-[9px] text-white">✓</span>}
                        </button>
                    );
                })}
            </div>
            {candidates.length === 0 && <div className="py-8 text-center text-xs text-slate-400">没有可选择的角色</div>}
        </div>
    );
};

export default GroupMemberPicker;
