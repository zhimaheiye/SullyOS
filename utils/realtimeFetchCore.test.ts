// utils/realtimeFetchCore.test.ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { performSearch } from './realtimeFetchCore';
import { setProxyWorkerUrl } from './proxyWorker';

const respond = (opts: { ok?: boolean; status?: number; body: string }) => ({
  ok: opts.ok ?? true,
  status: opts.status ?? 200,
  text: async () => opts.body,
});

const mockFetch = (value: unknown, reject = false) =>
  vi.spyOn(globalThis, 'fetch' as any).mockImplementation(
    reject ? (() => Promise.reject(value)) : (() => Promise.resolve(value)),
  );

// performSearch 的 success:false 一直是两种情况共用的：请求没跑通，和搜过了没结果。
// 调用方只看 success 就分不出来，于是「服务器没应答」被角色说成「我搜了下，没什么」。
// reached 是用来分这两种的，下面每条都在钉它的取值。
describe('performSearch 的 reached：请求到底跑到没有', () => {
  beforeEach(() => setProxyWorkerUrl('https://public-proxy.example.test'));
  afterEach(() => {
    setProxyWorkerUrl('');
    vi.restoreAllMocks();
  });

  it('搜到了 → reached', async () => {
    mockFetch(respond({
      body: JSON.stringify({ web: { results: [{ title: '标题', description: '摘要', url: 'https://x.test' }] } }),
    }));
    const r = await performSearch('猫', 'key');
    expect(r).toMatchObject({ success: true, reached: true });
    expect(r.results).toHaveLength(1);
  });

  // 这条是关键：真的搜过了、真的一条都没有。角色说「我搜了下没什么」是实话。
  it('搜过了但零结果 → 照样算 reached', async () => {
    mockFetch(respond({ body: JSON.stringify({ web: { results: [] } }) }));
    expect(await performSearch('猫', 'key')).toMatchObject({ success: false, reached: true });
  });

  it('断网 → 没 reached', async () => {
    mockFetch(new Error('network down'), true);
    expect(await performSearch('猫', 'key')).toMatchObject({ success: false, reached: false });
  });

  it('非 2xx → 没 reached', async () => {
    mockFetch(respond({ ok: false, status: 500, body: 'boom' }));
    expect(await performSearch('猫', 'key')).toMatchObject({ success: false, reached: false });
  });

  it('回了东西但不是 JSON → 没 reached（读不懂就不知道搜到了什么）', async () => {
    mockFetch(respond({ body: '<html>502 Bad Gateway</html>' }));
    expect(await performSearch('猫', 'key')).toMatchObject({ success: false, reached: false });
  });

  it('没关键词就没发请求 → 没 reached', async () => {
    const fetchSpy = mockFetch(respond({ body: '{}' }));
    expect(await performSearch('', 'key')).toMatchObject({ success: false, reached: false });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('没填个人 Key 时仍请求公共代理，且不附带 Key 头', async () => {
    const fetchSpy = mockFetch(respond({
      body: JSON.stringify({ web: { results: [] } }),
    }));
    expect(await performSearch('猫', '')).toMatchObject({ success: false, reached: true });
    expect(fetchSpy).toHaveBeenCalledOnce();
    const init = fetchSpy.mock.calls[0][1] as { headers: Record<string, string> };
    expect(init.headers['X-Brave-API-Key']).toBeUndefined();
    expect(String(fetchSpy.mock.calls[0][0])).toContain('https://public-proxy.example.test/search');
  });
});
