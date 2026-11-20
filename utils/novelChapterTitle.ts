export function formatNovelChapterTitle(number: number | '?', title?: string): string {
    const label = `第${number}章`;
    return title?.trim() ? `${label} · ${title.trim()}` : label;
}
