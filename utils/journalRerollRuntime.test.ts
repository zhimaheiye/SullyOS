import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('Journal save and character-page rewrite wiring', () => {
  it('keeps the body and every observation in one bounded paper scroller', () => {
    const source = readFileSync(path.resolve(__dirname, '../apps/JournalApp.tsx'), 'utf8');
    const pageSource = source.slice(source.indexOf('const renderPage ='), source.indexOf('const renderEmptyCharPage ='));
    const stageSource = source.slice(source.indexOf('{/* Main Page Area */}'), source.indexOf('{/* Bottom Controls */}'));

    expect(pageSource).not.toMatch(/<textarea\b/);
    expect(pageSource.match(/<JournalTextarea\b/g)).toHaveLength(4);
    expect(pageSource).toMatch(/sully-journal-page-content[^"\n]*min-h-0[^"\n]*overflow-y-auto/);
    expect(pageSource).toMatch(/sully-journal-textarea flex-none/);
    expect(pageSource).not.toContain('resize-y');
    expect(pageSource).toMatch(/sully-journal-paper-[^\n]*touch-pan-y/);
    expect(pageSource).toMatch(/sully-journal-sticker[^\n]*touch-none/);
    // Each flex/grid wrapper must be allowed to shrink inside the viewport.
    expect(stageSource.match(/flex-1 min-h-0/g)).toHaveLength(3);
    expect(stageSource).toContain('sully-journal-spread h-full min-h-0 grid-rows-[minmax(0,1fr)]');
    expect(stageSource.match(/sully-journal-spread-page min-h-0/g)).toHaveLength(2);
    expect(pageSource.indexOf('onClick={addObservationEvent}')).toBeGreaterThan(pageSource.indexOf('(page.observations?.events || []).map'));
  });

  it('keeps ordinary saves out of chat-card updates and only snapshots successful exchanges', () => {
    const source = readFileSync(path.resolve(__dirname, '../apps/JournalApp.tsx'), 'utf8');
    const saveStart = source.indexOf('const saveEntry = async');
    const exchangeStart = source.indexOf('const handleExchange = async () =>');
    const saveSource = source.slice(saveStart, exchangeStart);
    const archiveStart = source.indexOf('const handleArchiveDiary = async', exchangeStart);
    const exchangeSource = source.slice(exchangeStart, archiveStart);

    expect(source).toContain("const saveEntry = async (options: { silent?: boolean } = {})");
    expect(saveSource).toContain('canReceiveUserDiaryBroadcast(existing)');
    expect(saveSource).toContain('normalizeDiaryPage(currentEntry.userPage)');
    expect(saveSource).toContain('syncUserDiaryContent(existing');
    expect(saveSource).not.toContain('syncDiaryCardToChat');
    expect(saveSource).toContain('successfulSyncCount');
    expect(saveSource).toContain('skippedRepliedCount');
    expect(saveSource).toContain('if (options.silent) return');
    expect(saveSource).toContain('日记已保存，并同步到其他 ${successfulSyncCount} 本未交换日记');
    expect(saveSource).toContain('日记已保存，其他日记本均已交换，不再同步');
    expect(saveSource).toContain('日记已保存，已同步到其他 ${successfulSyncCount} 本未交换日记；未能同步到：${failedCharNames.join');
    expect(saveSource).toContain('日记已保存，但未能同步到：${failedCharNames.join');
    expect(exchangeSource).toContain('await saveEntry({ silent: true })');
    expect(exchangeSource).toContain('serializeUserDiaryForExchange(currentEntry.userPage)');
    expect(exchangeSource).toContain('Users Diary:\\n${serializedUserDiary}');
    expect(exchangeSource).not.toContain('saveEntry();');
    expect(exchangeSource.indexOf('await saveEntry({ silent: true })')).toBeLessThan(exchangeSource.indexOf('syncDiaryCardToChat(updatedEntry, selectedChar)'));
    expect(exchangeSource).toContain('syncDiaryCardToChat(updatedEntry, selectedChar)');
    expect(exchangeSource).toContain('正在请 ${selectedChar.name} 重新写这篇日记');
    expect(exchangeSource).toContain('角色日记已重新写好 · 已同步到聊天');
    expect(exchangeSource).toContain("'重新写日记' : '交换日记'");
    expect(source).toContain('data-testid="journal-rewrite-character-page"');
    expect(source).toContain('aria-label="重新写角色日记"');
    expect(source).toContain('userObservations: normalizeDiaryObservations(entry.userPage.observations)');
  });

  it('keeps self-observation prompts optional and event notes free-form', () => {
    const source = readFileSync(path.resolve(__dirname, '../apps/JournalApp.tsx'), 'utf8');

    expect(source).toContain('看看今天的自己');
    expect(source).toContain("['emotional', '情感'");
    expect(source).toContain("['cognitive', '思维'");
    expect(source).toContain("['volitional', '意志'");
    expect(source).toContain('发生了什么？当时有什么感受？你怎么理解它？现在回看，想记住什么？');
    expect(source).toContain('＋ 记录一件事情');
    expect(source).not.toContain('观察完成度');
  });

  it('starts every opened character page with stickers hidden without changing the intro version', () => {
    const source = readFileSync(path.resolve(__dirname, '../apps/JournalApp.tsx'), 'utf8');
    const openStart = source.indexOf('const openEntry = (');
    const editorStart = source.indexOf('// --- Editor Logic ---', openStart);
    const openSource = source.slice(openStart, editorStart);

    expect(source).toContain("const INTRO_SEEN_KEY = 'journal_app_intro_seen_v4'");
    expect(source).toContain('const [hideCharStickers, setHideCharStickers] = useState(true)');
    expect(openSource).toContain('setHideCharStickers(true)');
    expect(source).toContain('普通保存只改日记本；成功重新写回复后，才会更新聊天里的卡片快照');
  });
});
