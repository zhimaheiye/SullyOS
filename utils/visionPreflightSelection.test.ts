// @vitest-environment jsdom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import VisionPreflightModal from '../components/chat/VisionPreflightModal';
import type { VisionPreflightItem } from './visionPreflight';
const mock = vi.hoisted(() => ({ items: [] as any[], cached: new Map<string, any>(), describe: vi.fn(), commit: vi.fn(), seed: vi.fn(), read: vi.fn(), readOne: vi.fn() }));
vi.mock('./db', () => ({ DB: { peekMessagesByCharId: () => mock.read(), getMessageById: (id: number) => mock.readOne(id), getEmojis: async () => [] } }));
vi.mock('./chatContextRange', () => ({ selectCharacterContextMessages: (messages: any[]) => messages.filter(m => m.inRange) }));
vi.mock('./visionAssetCache', () => ({ findStableVisionAsset: async (ref: string) => mock.cached.get(ref), visionAssetVersion: () => null, visionCacheEpoch: async () => 'epoch', VISION_DESCRIPTION_LIMIT: 4000 }));
vi.mock('./visionPreflight', () => ({ collectVisionItems: (messages: any[]) => mock.items.filter(item => messages.some(m => m.id === item.message.id)), emojiVisionItems: () => mock.items,
  describePreflightItem: (...args: any[]) => mock.describe(...args), commitPreflightItem: (...args: any[]) => mock.commit(...args), seedVisionDescriptions: (...args: any[]) => mock.seed(...args), editPreflightVision: vi.fn(), markPreflightFailure: vi.fn(), isPreflightRefUsable: (ref: string) => !!ref, visionPreflightError: (error: Error) => error.message }));
vi.mock('../components/os/TokenImg', () => ({ default: () => null }));
let root: Root, host: HTMLElement;
const item = (id: string, patch: Partial<VisionPreflightItem> = {}) => ({ id, label: id, ref: id, description: '', eligible: true, path: 'image', semantics: 'photo-v1', message: { id, inRange: true }, ...patch });
const checkbox = (name: string) => document.querySelector<HTMLInputElement>(`input[aria-label="${name}"]`)!;
const bulk = () => checkbox('全选当前筛选');
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('button')].find(el => el.textContent?.includes(text))!;
const click = async (el: HTMLElement) => { await act(async () => el.click()); };
const filter = async (value: string, label = '描述筛选') => { await act(async () => { const el = document.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!; el.value = value; el.dispatchEvent(new Event('change', { bubbles: true })); }); };
const mount = async (library = false) => { await act(async () => root.render(React.createElement(VisionPreflightModal, { key: library ? 'library' : 'chat', char: { id: 'test' } as any, emojis: library ? [] : undefined, onClose: () => { root.unmount(); } }))); };
const mountDirect = async (message: any) => { await act(async () => root.render(React.createElement(VisionPreflightModal, { key: `direct:${message.id}`, char: { id: 'test' } as any, targetMessage: message, operationId: `operation:${message.id}`, onClose: () => { root.unmount(); } }))); };
beforeEach(() => {
  (globalThis as any).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  mock.items = []; mock.cached.clear(); mock.read.mockReset().mockImplementation(async () => mock.items.map(item => item.message));
  mock.readOne.mockReset().mockImplementation(async (id: number) => mock.items.find(item => item.message.id === id)?.message || null);
  mock.describe.mockReset().mockResolvedValue({ description: 'result' }); mock.commit.mockReset().mockImplementation(async item => ({ item: { ...item, description: 'result' }, description: 'result' })); mock.seed.mockReset();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });
it('uses mixed/all/none from selectable rows, includes old stickers explicitly, never writes or generates on selection', async () => {
  mock.items = [item('normal'), item('old', { eligible: false }), item('known', { description: 'saved' }), item('manual', { manualBlank: true }), item('cache-blank'), item('broken', { ref: '' })];
  mock.cached.set('cache-blank', { origin: 'manual', description: '' }); await mount();
  expect(bulk().indeterminate).toBe(true); expect(bulk().getAttribute('aria-checked')).toBe('mixed'); expect(checkbox('选择old').checked).toBe(false);
  await click(bulk()); expect(bulk().checked).toBe(true); expect(checkbox('选择old').checked).toBe(true);
  for (const name of ['known', 'manual', 'cache-blank', 'broken']) { expect(checkbox(`选择${name}`).disabled).toBe(true); expect(checkbox(`选择${name}`).checked).toBe(false); }
  await click(checkbox('选择normal')); expect(bulk().indeterminate).toBe(true); await click(bulk()); expect(bulk().checked).toBe(true);
  await click(bulk()); expect(bulk().checked).toBe(false); expect(bulk().indeterminate).toBe(false);
  expect(mock.describe).not.toHaveBeenCalled(); expect(mock.commit).not.toHaveBeenCalled(); expect(mock.seed).not.toHaveBeenCalled(); expect(mock.items[1].eligible).toBe(false);
});
it('keeps hidden selected rows and counts, selects reusable items without treating them as extra calls, rescans scope', async () => {
  mock.items = [item('missing'), item('cached'), item('older', { message: { id: 'older', inRange: false } as any })]; mock.cached.set('cached', { origin: 'generated', description: 'reuse' }); await mount();
  await filter('known'); expect(bulk().checked).toBe(true); await click(bulk()); expect(checkbox('选择cached').checked).toBe(false); expect(document.body.textContent).toContain('另有1项已选');
  await filter('missing'); expect(checkbox('选择missing').checked).toBe(true); await click(bulk()); expect(button('补全所选（0）').disabled).toBe(true);
  await filter('known'); await click(bulk()); expect(document.body.textContent).toContain('最多0种素材');
  await filter('all'); await filter('all', '图片扫描范围'); expect(document.body.textContent).toContain('已选3项');
  await click(bulk()); await click(button('重新扫描')); expect(bulk().checked).toBe(true);
});
it('disables bulk for empty lists, empty filters and only ineligible rows; library shares selection', async () => {
  await mount(); expect(bulk().disabled).toBe(true); expect(bulk().checked).toBe(false);
  mock.items = [item('known', { description: 'saved' })]; await click(button('重新扫描')); expect(bulk().disabled).toBe(true);
  await filter('failed'); expect(document.body.textContent).toContain('当前筛选没有'); expect(bulk().disabled).toBe(true);
  mock.items = [item('library')]; await mount(true); await filter('all'); expect(bulk().checked).toBe(true); await click(bulk()); expect(checkbox('选择library').checked).toBe(false);
});
it('locks selection while loading, editing, generating and stops without late writes, then success exits selection', async () => {
  mock.items = [item('normal')]; await mount(); await click(button('编辑描述')); expect(bulk().disabled).toBe(true); expect(checkbox('选择normal').disabled).toBe(true); await click(button('取消编辑'));
  let release!: () => void; mock.describe.mockImplementationOnce((_item, _config, signal) => new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('cancelled')))));
  await click(button('补全所选')); expect(bulk().disabled).toBe(true); expect(checkbox('选择normal').disabled).toBe(true); await click(button('停止补全')); expect(mock.commit).not.toHaveBeenCalled(); expect(bulk().disabled).toBe(false);
  await click(button('补全所选')); expect(mock.commit).toHaveBeenCalledTimes(1); expect(bulk().disabled).toBe(true); expect(bulk().checked).toBe(false); expect(button('补全所选（0）').disabled).toBe(true);
  mock.read.mockImplementationOnce(() => new Promise(resolve => { release = () => resolve([]); })); await click(button('重新扫描')); expect(bulk().disabled).toBe(true); await act(async () => release()); expect(bulk().disabled).toBe(true);
});
it('failed filter affects only failed rows and retry submits exactly its selected failures', async () => {
  mock.items = [item('good'), item('failed', { message: { id: 'failed', inRange: true, metadata: { visionPreflightErrors: { image: 'prior failure' } } } as any })]; await mount();
  await filter('failed'); await click(bulk()); expect(document.body.textContent).toContain('另有1项已选'); expect(button('补全所选（1）')).toBeTruthy();
  await click(bulk()); await click(button('仅重试所选失败项')); expect(mock.describe).toHaveBeenCalledTimes(1); expect(mock.describe.mock.calls[0][0].id).toBe('failed'); expect(button('补全所选（1）')).toBeTruthy();
});
it('direct mode rereads only the frozen image and automatically completes it once', async () => {
  const message = { id: 7, charId: 'test', role: 'user', type: 'image', content: 'data:image/png;base64,one', timestamp: 1 };
  mock.items = [item('7:image', { ref: message.content, message: { ...message } as any })];
  await mountDirect(message);
  expect(mock.readOne).toHaveBeenCalledWith(7); expect(mock.read).not.toHaveBeenCalled();
  expect(mock.describe).toHaveBeenCalledTimes(1); expect(mock.commit).toHaveBeenCalledTimes(1);
  expect(document.querySelector('select[aria-label="图片扫描范围"]')).toBeNull();
  expect(document.querySelector('input[aria-label^="选择"]')).toBeNull();
  await act(async () => root.render(null)); await mountDirect(message);
  expect(mock.describe).toHaveBeenCalledTimes(1); expect(mock.commit).toHaveBeenCalledTimes(1);
  expect(button('重试补全')).toBeTruthy();
});
it('direct mode reuses an existing description without generating and rejects a stale frozen source', async () => {
  const known = { id: 8, charId: 'test', role: 'assistant', type: 'image', content: 'data:image/png;base64,known', timestamp: 1 };
  mock.items = [item('8:image', { ref: known.content, description: '已有画面', message: { ...known } as any })];
  await mountDirect(known);
  expect(document.body.textContent).toContain('已有画面'); expect(mock.describe).not.toHaveBeenCalled(); expect(mock.commit).not.toHaveBeenCalled();
  const stale = { ...known, id: 9, content: 'data:image/png;base64,old' }; mock.items = [item('9:image', { ref: 'data:image/png;base64,new', message: { ...stale, content: 'data:image/png;base64,new' } as any })];
  await mountDirect(stale);
  expect(document.body.textContent).toContain('消息原图或归属已变化'); expect(mock.describe).not.toHaveBeenCalled();
});
