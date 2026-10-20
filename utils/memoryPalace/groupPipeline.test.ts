import { describe, expect, it } from 'vitest';
import type { CharacterProfile } from '../../types';
import { resolveGroupMemoryAudience } from './groupPipeline';

describe('group memory audience', () => {
    it('targets only members in the historical audience who enabled memory palace', () => {
        const characters = [
            { id: 'A', name: 'A', memoryPalaceEnabled: true },
            { id: 'B', name: 'B', memoryPalaceEnabled: true },
            { id: 'C', name: 'C', memoryPalaceEnabled: false },
        ] as CharacterProfile[];
        expect(resolveGroupMemoryAudience(characters, ['A', 'C']).map(character => character.id)).toEqual(['A']);
        expect(resolveGroupMemoryAudience(characters, ['B']).map(character => character.id)).toEqual(['B']);
    });
});
