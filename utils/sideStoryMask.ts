/** Device-only screenshot vocabulary. The story and model request never use this key. */
export const SIDE_STORY_MASK_WORDS_KEY = 'os_side_story_mask_words_v1';

export type StoryMaskPart = { kind: 'text'; text: string } | { kind: 'blank'; widthEm: number };

export function normalizeStoryMaskWords(values: unknown): string[] {
    if (!Array.isArray(values)) return [];
    const seen = new Set<string>();
    return values.filter((value): value is string => typeof value === 'string' && !!value.trim())
        .filter(value => { if (seen.has(value)) return false; seen.add(value); return true; });
}

export function loadStoryMaskWords(): string[] {
    try { return normalizeStoryMaskWords(JSON.parse(localStorage.getItem(SIDE_STORY_MASK_WORDS_KEY) || '[]')); }
    catch { return []; }
}

export function saveStoryMaskWords(values: string[]): void {
    try { localStorage.setItem(SIDE_STORY_MASK_WORDS_KEY, JSON.stringify(normalizeStoryMaskWords(values))); }
    catch { /* unavailable storage leaves this session usable */ }
}

function blankWidthEm(value: string): number {
    let width = 0;
    for (const char of value) {
        if (/\s/.test(char)) width += 0.33;
        else if (/[\u0000-\u007f]/.test(char)) width += /[il.,'!:;]/.test(char) ? 0.28 : 0.56;
        else width += 1;
    }
    return Math.max(0.28, width);
}

const compiledWords = new WeakMap<string[], Map<string, string[]>>();
function bucketsFor(words: string[]): Map<string, string[]> {
    const prior = compiledWords.get(words);
    if (prior) return prior;
    const buckets = new Map<string, string[]>();
    for (const word of normalizeStoryMaskWords(words)) {
        const key = word[0];
        const bucket = buckets.get(key) || [];
        bucket.push(word);
        buckets.set(key, bucket);
    }
    for (const bucket of buckets.values()) bucket.sort((a, b) => b.length - a.length);
    compiledWords.set(words, buckets);
    return buckets;
}

/** Literal, case-sensitive, longest-first matching. No regex or source word enters blank parts. */
export function splitStoryMaskedText(text: string, words: string[], streaming = false): StoryMaskPart[] {
    if (!text || !words.length) return text ? [{ kind: 'text', text }] : [];
    const byFirst = bucketsFor(words);
    const result: StoryMaskPart[] = [];
    let plainStart = 0;
    let at = 0;
    while (at < text.length) {
        const matched = byFirst.get(text[at])?.find(word => text.startsWith(word, at));
        if (!matched) { at++; continue; }
        if (at > plainStart) result.push({ kind: 'text', text: text.slice(plainStart, at) });
        result.push({ kind: 'blank', widthEm: blankWidthEm(matched) });
        at += matched.length;
        plainStart = at;
    }
    if (plainStart < text.length) result.push({ kind: 'text', text: text.slice(plainStart) });

    // A stream can stop in the middle of a protected word. Conceal its visible suffix
    // until the next delta confirms whether it is a complete match.
    if (streaming && result.at(-1)?.kind === 'text') {
        const last = result.pop() as Extract<StoryMaskPart, { kind: 'text' }>;
        let pending = '';
        for (const word of words) {
            if (typeof word !== 'string' || !word.trim()) continue;
            const max = Math.min(word.length - 1, last.text.length);
            for (let length = max; length > pending.length; length--) {
                if (last.text.endsWith(word.slice(0, length))) { pending = last.text.slice(-length); break; }
            }
        }
        const visible = pending ? last.text.slice(0, -pending.length) : last.text;
        if (visible) result.push({ kind: 'text', text: visible });
        if (pending) result.push({ kind: 'blank', widthEm: blankWidthEm(pending) });
    }
    return result;
}
