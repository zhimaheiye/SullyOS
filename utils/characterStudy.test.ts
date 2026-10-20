import { describe, expect, it } from 'vitest';
import { appendCharacterStudyNotes, characterStudyMarkdownFileName, parseCharacterStudyOpening, parseCharacterStudyReply } from './characterStudy';

describe('characterStudy', () => {
  it('parses fenced opening JSON', () => {
    expect(parseCharacterStudyOpening('```json\n{"rationale":"想弄懂","opening":"你讲吧","notesMarkdown":"# 主题"}\n```')).toEqual({
      rationale: '想弄懂', opening: '你讲吧', notesMarkdown: '# 主题',
    });
  });

  it('suppresses model questions when the user disabled questions', () => {
    expect(parseCharacterStudyReply('{"notePatch":"- 要点","beginnerThinking":"先抓住关键词，再连接前文","response":"记下了","question":"为什么？"}', false)).toEqual({
      notePatch: '- 要点', beginnerThinking: '先抓住关键词，再连接前文', response: '记下了', question: undefined,
    });
  });

  it('appends incremental markdown instead of replacing the board', () => {
    expect(appendCharacterStudyNotes('# 主题\n\n> 等待讲解', '## 新要点')).toBe('# 主题\n\n## 新要点');
  });

  it('uses the conversation topic as a filesystem-safe markdown filename', () => {
    expect(characterStudyMarkdownFileName('  2^32：为什么这么大?  ')).toBe('2^32：为什么这么大_.md');
    expect(characterStudyMarkdownFileName('...')).toBe('课堂笔记.md');
  });
});
