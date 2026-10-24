import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AppID } from '../types';

const read = (path: string) => readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');

describe('只做一个改变独立 App 接线', () => {
  it('注册独立桌面入口、懒加载、预热和安全区', () => {
    expect(AppID.OneChange).toBe('one_change');
    expect(read('../constants.tsx')).toContain("id: AppID.OneChange, name: '只做一个改变'");
    const shell = read('../components/PhoneShell.tsx');
    expect(shell).toContain("import('../apps/OneChangeApp')");
    expect(shell).toContain('[AppID.OneChange]: OneChangeApp');
    expect(shell).toContain('case AppID.OneChange: return <OneChangeApp />');
    expect(shell).toMatch(/APP_IDLE_PRELOAD_ORDER[\s\S]*OneChangeApp/);
    expect(read('./safeAreaApps.ts')).toContain('AppID.OneChange');
  });

  it('独立五表进入 v2 全量/纯文字备份映射，不复用手账 Tracker', () => {
    const context = read('../context/OSContext.tsx');
    for (const store of ['one_change_changes', 'one_change_records', 'one_change_standard_versions', 'one_change_state_events', 'one_change_settings']) {
      expect(context).toContain(store);
    }
    const engine = read('./oneChange/engine.ts');
    expect(engine).not.toContain('Tracker');
    expect(engine).not.toContain('APIConfig');
  });

  it('受控输入页不会作为局部组件反复挂载而丢失焦点', () => {
    const app = read('../apps/OneChangeApp.tsx');
    for (const page of ['CheckinPage', 'FormPage', 'SettingsView']) {
      expect(app).not.toContain(`<${page} />`);
    }
  });

  it('首页提供返回桌面的按钮', () => {
    const app = read('../apps/OneChangeApp.tsx');
    expect(app).toContain('aria-label="返回桌面"');
  });

  it('新增入口只在改变库显示，不出现在今日页', () => {
    const app = read('../apps/OneChangeApp.tsx');
    const todayView = app.slice(app.indexOf('const TodayView'), app.indexOf('const LibraryView'));
    const libraryView = app.slice(app.indexOf('const LibraryView'), app.indexOf('const CalendarView'));
    expect(todayView).not.toContain('<Plus');
    expect(libraryView).toContain('<Plus');
  });
});
