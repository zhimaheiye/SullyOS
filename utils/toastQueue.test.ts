import { describe, expect, it } from 'vitest';
import type { Toast } from '../types';
import { appendUniqueToast } from './toastQueue';

describe('appendUniqueToast', () => {
  const existing: Toast = { id: '1', message: '旅行归来，获得 800 金币', type: 'success' };

  it('同文案同类型仍在显示时不重复入队', () => {
    const queue = [existing];
    expect(appendUniqueToast(queue, { ...existing, id: '2' })).toBe(queue);
  });

  it('不同类型的同文案仍可分别显示', () => {
    expect(appendUniqueToast([existing], { ...existing, id: '2', type: 'error' })).toHaveLength(2);
  });
});
