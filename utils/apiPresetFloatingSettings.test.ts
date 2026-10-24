import { describe, expect, it } from 'vitest';

import {
  DEFAULT_API_PRESET_FLOATING_SETTINGS,
  loadApiPresetFloatingSettings,
} from './apiPresetFloatingSettings';

const storageWith = (value: string | null) => ({ getItem: () => value });

describe('API 预设悬浮设置', () => {
  it('默认关闭并从右侧 55% 高度开始', () => {
    expect(loadApiPresetFloatingSettings(null)).toEqual({
      enabled: false,
      side: 'right',
      yRatio: 0.55,
    });
  });

  it('损坏 JSON 回退默认值', () => {
    expect(loadApiPresetFloatingSettings(storageWith('{broken'))).toEqual(DEFAULT_API_PRESET_FLOATING_SETTINGS);
  });

  it('非法 side 和 yRatio 回退默认值', () => {
    expect(loadApiPresetFloatingSettings(storageWith(JSON.stringify({
      enabled: true,
      side: 'top',
      yRatio: '0.2',
    })))).toEqual({ enabled: true, side: 'right', yRatio: 0.55 });
  });

  it('把垂直比例限制在 0 到 1', () => {
    expect(loadApiPresetFloatingSettings(storageWith('{"yRatio":-2}')).yRatio).toBe(0);
    expect(loadApiPresetFloatingSettings(storageWith('{"yRatio":3}')).yRatio).toBe(1);
  });

  it('接受合法的左右位置', () => {
    expect(loadApiPresetFloatingSettings(storageWith('{"side":"left"}')).side).toBe('left');
    expect(loadApiPresetFloatingSettings(storageWith('{"side":"right"}')).side).toBe('right');
  });
});
