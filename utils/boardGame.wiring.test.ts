import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AppID } from '../types';

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

describe('standalone board game app wiring', () => {
  it('keeps TRPG and board games as separate desktop apps', () => {
    expect(AppID.Game).toBe('game');
    expect(AppID.BoardGame).toBe('board_game');
    const constants = read('../constants.tsx');
    expect(constants).toContain("{ id: AppID.Game, name: 'TRPG'");
    expect(constants).toContain("{ id: AppID.BoardGame, name: '桌游'");
  });

  it('registers lazy loading, stale-response guards, MCP isolation, and v2 backups', () => {
    const shell = read('../components/PhoneShell.tsx');
    const app = read('../apps/boardGame/LiarsBarApp.tsx');
    const service = read('./boardGame/liarsBar/aiService.ts');
    const context = read('../context/OSContext.tsx');
    const runner = read('./boardGame/liarsBar/batch.ts');
    expect(shell).toContain("import('../apps/BoardGameApp')");
    expect(shell).toContain('case AppID.BoardGame');
    expect(runner).toContain('latest.revision !== expected.revision');
    expect(runner).toContain('latest.round.currentActorId !== expected.round.currentActorId');
    expect(app).toContain('requestRef.current?.abort()');
    expect(app).toContain('tableRef.current.activeId === snapshot.id');
    expect(app).toContain('save: DB.saveBoardGameSessionIfCurrent');
    expect(app).toContain('requestLiarsBarBatch');
    expect(app).toContain('requestLiarsBarAction');
    expect(app).toContain("useState<LiarsBarGenerationMode>('batch')");
    expect(app).toContain('不是严格信息隔离');
    expect(service).toContain('disableMcp: true');
    expect(context).toContain("board_game_sessions: 'boardGameSessions'");
    expect(context).toContain("case 'board_game_sessions': backupData.boardGameSessions");
  });
});
