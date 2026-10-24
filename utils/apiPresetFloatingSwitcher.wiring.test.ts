import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const switcher = readFileSync(
  fileURLToPath(new URL('../components/os/ApiPresetFloatingSwitcher.tsx', import.meta.url)),
  'utf8',
);
const phoneShell = readFileSync(fileURLToPath(new URL('../components/PhoneShell.tsx', import.meta.url)), 'utf8');
const settings = readFileSync(fileURLToPath(new URL('../apps/Settings.tsx', import.meta.url)), 'utf8');
const commitHelper = readFileSync(fileURLToPath(new URL('./apiConfigCommit.ts', import.meta.url)), 'utf8');
const floatingSettings = readFileSync(fileURLToPath(new URL('./apiPresetFloatingSettings.ts', import.meta.url)), 'utf8');

const bodyOf = (source: string, name: string): string => {
  const start = source.indexOf(`const ${name} = `);
  expect(start, `${name} 没找到`).toBeGreaterThan(-1);
  const end = source.indexOf('\n  };', start);
  expect(end, `${name} 的函数体没收尾`).toBeGreaterThan(start);
  return source.slice(start, end);
};

describe('悬浮切换器全局接线', () => {
  it('PhoneShell 在 boot 和 lock 提前返回之后全局挂载', () => {
    expect(phoneShell).toMatch(/import ApiPresetFloatingSwitcher/);
    const lockReturn = phoneShell.indexOf('if (isLocked)');
    const switcherMount = phoneShell.indexOf('<ApiPresetFloatingSwitcher />');
    expect(lockReturn).toBeGreaterThan(-1);
    expect(switcherMount).toBeGreaterThan(lockReturn);
  });

  it('使用现有规则反查当前预设', () => {
    expect(switcher).toMatch(/findActivePresetId\(apiPresets, apiConfig\)/);
  });

  it('切换时复用 preset patch 和共享提交 helper', () => {
    const handleSelectPreset = bodyOf(switcher, 'handleSelectPreset');
    expect(handleSelectPreset).toMatch(/commitApiConfig\(\{ apiConfig, patch: configFromPreset\(preset\), updateApiConfig, addToast \}\)/);
    expect(handleSelectPreset).not.toMatch(/updateApiConfig\(/);
  });

  it('卡片源码不读取预设 Key 或 URL', () => {
    expect(switcher).not.toMatch(/preset\.config\.(apiKey|baseUrl)/);
    expect(switcher).toMatch(/preset\.config\.model/);
    expect(switcher).not.toContain('🤖');
  });

  it('拖动使用 Pointer Events、阈值和持久化吸边位置', () => {
    expect(switcher).toMatch(/DRAG_THRESHOLD = 6/);
    expect(switcher).toMatch(/onPointerDown=\{handlePointerDown\}/);
    expect(switcher).toMatch(/onPointerMove=\{handlePointerMove\}/);
    expect(switcher).toMatch(/onPointerUp=\{handlePointerUp\}/);
    expect(bodyOf(switcher, 'handlePointerUp')).toMatch(/updateApiPresetFloatingSettings\(\{[\s\S]*side:[\s\S]*yRatio:/);
  });

  it('圆钮自己接收点击，右键也不落入拖动流程', () => {
    const label = switcher.indexOf('aria-label="切换 API 预设"');
    const trigger = switcher.slice(label, switcher.indexOf('</button>', label));
    expect(trigger).toContain('pointer-events-auto');
    expect(trigger).toContain('onContextMenu={handleContextMenu}');

    const handleContextMenu = bodyOf(switcher, 'handleContextMenu');
    expect(handleContextMenu).toMatch(/event\.preventDefault\(\)/);
    expect(handleContextMenu).toMatch(/suppressClickRef\.current\s*\) return;/);
    expect(handleContextMenu).toMatch(/setOpen\(\(value\) => !value\)/);

    // 鼠标右键交给 context menu 开面板；触控笔等仍维持拖动行为。
    expect(bodyOf(switcher, 'handlePointerDown')).toMatch(
      /event\.pointerType === 'mouse' && event\.button !== 0/,
    );
  });

  it('悬浮钮改用低饱和玻璃样式，不盖过当前页面', () => {
    expect(switcher).not.toMatch(/bg-blue-500|shadow-blue-900\/20|active:bg-blue-600/);
    expect(switcher).toMatch(
      /border-slate-200\/70 bg-white\/60 text-slate-500 shadow-lg shadow-slate-900\/10 backdrop-blur-md active:bg-white\/75/,
    );
  });
});

describe('悬浮设置即时同步', () => {
  it('Settings 写设置并订阅同标签页通知', () => {
    expect(settings).toMatch(/subscribeApiPresetFloatingSettings\(setApiPresetFloatingSettings\)/);
    expect(settings).toMatch(/updateApiPresetFloatingSettings\(\{ enabled: !apiPresetFloatingSettings\.enabled \}\)/);
  });

  it('持久化模块同时派发 CustomEvent 并监听跨标签页 storage', () => {
    expect(floatingSettings).toMatch(/dispatchEvent\(new CustomEvent<ApiPresetFloatingSettings>/);
    expect(floatingSettings).toContain("window.addEventListener('storage', handleChange)");
  });
});

describe('共享提交路径', () => {
  it('Settings 仍调用同一个 helper', () => {
    expect(settings).toMatch(/commitApiConfig as commitSharedApiConfig/);
    expect(bodyOf(settings, 'commitApiConfig')).toMatch(/commitSharedApiConfig\(\{/);
  });

  it('helper 保留主动消息两条凭据同步路径', () => {
    expect(commitHelper).toMatch(/syncAmsgLlmCredentials\(nextConfig\)/);
    expect(commitHelper).toMatch(/ActiveMsgClient\.refreshApiCredentialsForPendingTasks\(nextConfig\)/);
  });
});
