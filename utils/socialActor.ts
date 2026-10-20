import type { CharacterProfile, SocialActorRef, UserProfile } from '../types';

export const characterActor = (character: CharacterProfile): SocialActorRef => ({
  kind: 'character',
  identityId: `character:${character.id}`,
  characterId: character.id,
  displayName: character.name,
  avatar: character.avatar,
  handle: character.socialProfile?.handle || undefined,
  badge: '角色',
});

export const userActor = (user: UserProfile): SocialActorRef => ({
  kind: 'user',
  identityId: 'user:local',
  displayName: user.name || '我',
  avatar: user.avatar,
  handle: 'me',
  badge: '楼主',
});

/** 路人只有公开皮肤，没有 CharacterProfile，也永远不凭昵称反查角色。 */
export const passerbyActor = (name: string, seed: string, avatar?: string): SocialActorRef => ({
  kind: 'passerby',
  identityId: `passerby:${seed}`,
  displayName: name.trim() || '路过的人',
  avatar,
  badge: '路人',
});

export const actorCharacterId = (actor: SocialActorRef): string | undefined => (
  actor.kind === 'character' ? actor.characterId : undefined
);
