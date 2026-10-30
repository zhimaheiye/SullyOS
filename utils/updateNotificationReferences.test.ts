import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

describe('public startup notices and manual changelog references', () => {
  it('limits automatic startup notices to explicit configuration choices and network disclosure', () => {
    const source = readFileSync(path.resolve(__dirname, '../components/UpdateNotificationEvent.tsx'), 'utf8');
    expect(source).toContain("UPDATE_NOTIFICATION_KEY_2026_08_30 = 'sullyos_update_2026_08_30_collaboration_seen'");
    const queue = source.match(/const STARTUP_NOTICE_QUEUE[\s\S]*?= \[([\s\S]*?)\n\];/)![1];
    expect([...queue.matchAll(/key: (\w+)/g)].map(match => match[1])).toEqual([
      'HOLIDAY_NOTICE_KEY', 'NETWORK_TRANSIT_NOTICE_KEY_2026_08',
    ]);
    expect(source).toContain('STARTUP_NOTICE_QUEUE.some');
    expect(source).toContain('STARTUP_NOTICE_QUEUE.filter');
    const shell = readFileSync(path.resolve(__dirname, '../components/PhoneShell.tsx'), 'utf8');
    expect(shell).toContain('shouldShowUpdateNotification as shouldShowStartupNotice');
    expect(shell.match(/shouldShowStartupNotice\(\)/g)).toHaveLength(3);
  });

  it('links the handbook collaboration entry to its detailed release note', () => {
    const faqSource = readFileSync(path.resolve(__dirname, '../apps/FAQApp.tsx'), 'utf8');
    const detailSource = readFileSync(path.resolve(__dirname, '../public/changelogs/2026-8-30.html'), 'utf8');
    expect(faqSource).toContain('id: CHANGELOG_2026_08_30');
    expect(faqSource).toContain("src: 'changelogs/2026-8-30.html'");
    expect(detailSource).toContain('ChatApp');
    expect(detailSource).toContain('设置 → 导出');
    expect(detailSource).toContain('长按删除');
  });

  it('keeps manual history identifiers without historical automatic popups or fabricated read markers', () => {
    const source = readFileSync(path.resolve(__dirname, '../components/UpdateNotificationEvent.tsx'), 'utf8');

    expect(source).not.toContain('StoryPremierePopup');
    expect(source).not.toContain('STORY_FEATURES');
    expect(source).not.toContain('Live2DUpdatePopup');
    expect(source).not.toContain('CollaborationUpdatePopup');
    expect(source).toContain("UPDATE_NOTIFICATION_KEY_2026_08_10 = 'sullyos_update_2026_08_10_live2d_seen'");
    expect(source).toContain("CHANGELOG_2026_08_10 = 'changelog-2026-08-10'");
    expect(source.match(/markUpdateSeen\(/g)).toHaveLength(2);
    expect(source).not.toContain('localStorage.clear');
  });

  it('keeps the handbook card and detail page linked to the same changelog id', () => {
    const faqSource = readFileSync(path.resolve(__dirname, '../apps/FAQApp.tsx'), 'utf8');
    const detailSource = readFileSync(path.resolve(__dirname, '../public/changelogs/2026-8-10.html'), 'utf8');

    expect(faqSource).toContain('id: CHANGELOG_2026_08_10');
    expect(faqSource).toContain("src: 'changelogs/2026-8-10.html'");
    expect(detailSource).toContain('新增视频通话');
    expect(detailSource).toContain('新增面向 L2D 的桌面主题');
  });
});
