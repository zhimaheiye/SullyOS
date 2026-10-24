import type { CharacterProfile } from '../../types';
import { resolveCompanionPortrait } from '../companionAvatar';

const firstPortrait = (sprites?: Record<string, string>): string | undefined => {
  if (!sprites) return undefined;
  for (const key of ['normal', 'default', 'happy', 'shy', 'sad', 'angry']) {
    if (sprites[key]) return sprites[key];
  }
  return Object.entries(sprites).find(([key, value]) => key !== 'chibi' && Boolean(value))?.[1];
};

/** 只挑现有静态图片；不读取或初始化 videoAvatar / Live2D / VRM。 */
export function resolveHealingPortrait(character: CharacterProfile): string {
  return resolveCompanionPortrait(character)
    || firstPortrait(character.sprites)
    || character.dateSkinSets?.map(skin => firstPortrait(skin.sprites)).find(Boolean)
    || character.avatar;
}
