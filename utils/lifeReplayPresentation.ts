import type { CharacterProfile, LifeReplaySession, LifeReplayTurn } from '../types';

export interface ReplayPassage {
  id: string;
  turnId: string;
  label: string;
  kind: 'scene' | 'user' | 'character' | 'private' | 'past' | 'npc';
  text: string;
}

/** A reading projection of saved turns. It never alters the transcript or creates new turns. */
export function lifeReplayPassages(session: LifeReplaySession, charName: string, userName: string): ReplayPassage[] {
  const passages: ReplayPassage[] = [];
  const add = (turn: LifeReplayTurn, kind: ReplayPassage['kind'], label: string, text?: string) => {
    if (text?.trim()) passages.push({ id: `${turn.id}-${passages.length}`, turnId: turn.id, kind, label, text: text.trim() });
  };
  session.turns.forEach((turn, index) => {
    if (index === 0) add(turn, 'scene', '开场', session.blueprint.openingScene);
    if (turn.kind === 'interaction') add(turn, 'user', userName || '现在的我', turn.userAction);
    add(turn, 'scene', '旁白', turn.world.narrative);
    add(turn, 'character', charName, turn.character.action);
    add(turn, 'character', `${charName}说`, turn.character.speech && `“${turn.character.speech}”`);
    // Perception belongs to the companion alone, and must never look like public scene knowledge.
    add(turn, 'private', `${charName}的未说出口的感受`, turn.character.perception);
    add(turn, 'past', session.blueprint.pastSelf.label, turn.world.pastSelfReaction);
    add(turn, 'past', `${session.blueprint.pastSelf.label}说`, turn.world.pastSelfSpeech && `“${turn.world.pastSelfSpeech}”`);
    turn.world.npcBeats.forEach(npc => {
      add(turn, 'npc', npc.name, npc.action);
      add(turn, 'npc', `${npc.name}说`, npc.speech && `“${npc.speech}”`);
    });
    add(turn, 'scene', '走向变化', turn.world.directionChange);
  });
  return passages;
}

const firstSprite = (sprites?: Record<string, string>): string | undefined => {
  if (!sprites) return undefined;
  for (const key of ['normal', 'default', 'happy', 'shy', 'sad', 'angry']) if (sprites[key]) return sprites[key];
  return Object.entries(sprites).find(([key, value]) => key !== 'chibi' && Boolean(value))?.[1];
};

/** Match DateSession's active skin preference, then its default sprite, then the profile avatar. */
export function lifeReplayPortrait(char: CharacterProfile): { value?: string; isAvatar: boolean } {
  const activeSkin = char.dateSkinSets?.find(skin => skin.id === char.activeSkinSetId);
  const sprite = firstSprite(activeSkin?.sprites) || firstSprite(char.sprites);
  return sprite ? { value: sprite, isAvatar: false } : { value: char.avatar || undefined, isAvatar: true };
}
