/** 公开版. Strip diary bodies before speech rendering, including truncated output. */
export function extractObsidianDiary(text: string) {
    const entries: Array<{ header: string; content: string; complete: boolean }> = [];
    const cleaned = text.replace(/\[\[OBS_DIARY_START:\s*([^\]]*?)\]\]\r?\n?([\s\S]*?)(\[\[OBS_DIARY_END\]\]|$)/g,
        (_whole, header, content, end) => { entries.push({ header, content, complete: !!end }); return ''; });
    return { text: cleaned, entries };
}
