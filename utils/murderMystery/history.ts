type VisibleEvent = { id: string; revision: number; channel: string; speechMode: string; content: string; action?: string };

// Extractive, bounded prompt aid. Caller must supply the current player's projected events.
// The complete original text remains in IndexedDB and the exported report.
export function buildVisibleHistoryDigest(events: VisibleEvent[], recentCount: number): string {
  const older = events.slice(0, Math.max(0, events.length - recentCount));
  if (!older.length) return '';
  const milestones = older.filter(event => /^(grant_|phase_|truth_reveal|ability_|game_end|accusation)/.test(event.action || ''));
  const selected = [...new Map([...milestones.slice(-12), ...older.slice(-12)].map(event => [event.id, event])).values()]
    .sort((a, b) => a.revision - b.revision);
  return `较早的本人可见事件摘录（完整原文保存在本局存档；此处只用于接续上下文）：\n${selected.map(event =>
    `#${event.revision} [${event.channel}; ${event.speechMode}] ${event.content.slice(0, 500)}`).join('\n')}`;
}
