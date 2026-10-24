import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PROXY_WORKER,
  getProxyWorkerUrl,
  setProxyWorkerUrl,
  isCustomProxyWorker,
  isAuthorProxyWorkerUrl,
  rewriteStaleWorkerUrl,
  requestProxyWorkerSettingsFocus,
  consumeProxyWorkerSettingsFocus,
  setProxyWorkerUrlOverride,
  requireProxyWorkerUrl,
  ProxyWorkerUnconfiguredError,
  setBuiltInPublicProxyUrl,
  getBuiltInPublicProxyUrl,
  hasPlayerProxyOverride,
  sanitizePublicProxyUrl,
  PUBLISHER_PUBLIC_PROXY_URL,
} from './proxyWorker';

const LS_KEY = 'sully_proxy_worker_url_v1';
const AUTHOR_URLS = [
  'https://proxy.friedsully.com',
  'https://proxy.friedsully.com/',
  'https://sullymeow.ccwu.cc/',
  'https://sullymeow.ccwu213.cc',
  'https://sully-n.qegj567.workers.dev',
];

describe('proxyWorker 中心配置', () => {
  beforeEach(() => {
    localStorage.clear();
    setBuiltInPublicProxyUrl('');
  });
  afterEach(() => {
    setProxyWorkerUrlOverride(null);
    setBuiltInPublicProxyUrl('');
  });

  it('仓库默认指向已部署的公共代理，测试里清空后才是未配置', () => {
    expect(PUBLISHER_PUBLIC_PROXY_URL).toBe('https://zhima-public-proxy.sullyos-sxy10.workers.dev');
    expect(isAuthorProxyWorkerUrl(PUBLISHER_PUBLIC_PROXY_URL)).toBe(false);
    setBuiltInPublicProxyUrl(PUBLISHER_PUBLIC_PROXY_URL);
    expect(getProxyWorkerUrl()).toBe(PUBLISHER_PUBLIC_PROXY_URL);
    expect(hasPlayerProxyOverride()).toBe(false);
    setBuiltInPublicProxyUrl('');
    expect(DEFAULT_PROXY_WORKER).toBe('');
    expect(getProxyWorkerUrl()).toBe('');
    expect(isCustomProxyWorker()).toBe(false);
    expect(() => requireProxyWorkerUrl()).toThrow(ProxyWorkerUnconfiguredError);
  });

  it('作者的公共地址一律当成未配置，不迁移到另一个作者域名', () => {
    for (const url of AUTHOR_URLS) {
      localStorage.setItem(LS_KEY, url);
      expect(getProxyWorkerUrl()).toBe('');
      expect(isAuthorProxyWorkerUrl(url)).toBe(true);
    }
    setProxyWorkerUrlOverride('https://proxy.friedsully.com');
    expect(getProxyWorkerUrl()).toBe('');
    setProxyWorkerUrl('https://sullymeow.ccwu.cc');
    expect(localStorage.getItem(LS_KEY)).toBeNull();
  });

  it('作者地址在玩家还没配置时改写成空，避免继续请求', () => {
    expect(rewriteStaleWorkerUrl('https://sullymeow.ccwu.cc/api?test=1')).toBe('');
    expect(rewriteStaleWorkerUrl('https://proxy.friedsully.com/api')).toBe('');
    expect(rewriteStaleWorkerUrl('https://sully-n.qegj567.workers.dev/api')).toBe('');
  });

  it('玩家配置了自己的地址后，旧的作者地址改写到自己的地址并保留路径', () => {
    setProxyWorkerUrl('https://my-own.example.com');
    expect(rewriteStaleWorkerUrl('https://proxy.friedsully.com/api?test=1')).toBe('https://my-own.example.com/api?test=1');
    expect(rewriteStaleWorkerUrl('https://sullymeow.ccwu213.cc/api')).toBe('https://my-own.example.com/api');
  });

  it('只是名字里带旧域名的自有地址不会被误伤', () => {
    setProxyWorkerUrlOverride('https://my-proxy.test');
    expect(getProxyWorkerUrl()).toBe('https://my-proxy.test');
    setProxyWorkerUrlOverride(null);
    setProxyWorkerUrl('https://sullymeow.ccwu.cc.example.com');
    expect(getProxyWorkerUrl()).toBe('https://sullymeow.ccwu.cc.example.com');
    expect(rewriteStaleWorkerUrl('https://own.example.com/path/sullymeow.ccwu.cc')).toBe('https://own.example.com/path/sullymeow.ccwu.cc');
  });

  it('设了自定义地址后读得到，且标记为已填写', () => {
    setProxyWorkerUrl('https://my-worker.example.com');
    expect(getProxyWorkerUrl()).toBe('https://my-worker.example.com');
    expect(isCustomProxyWorker()).toBe(true);
    expect(requireProxyWorkerUrl()).toBe('https://my-worker.example.com');
  });

  it('去掉首尾空格和结尾斜杠', () => {
    setProxyWorkerUrl('  https://my-worker.example.com///  ');
    expect(getProxyWorkerUrl()).toBe('https://my-worker.example.com');
  });

  it('传空字符串 → 清空存储', () => {
    setProxyWorkerUrl('https://my-worker.example.com');
    setProxyWorkerUrl('');
    expect(localStorage.getItem(LS_KEY)).toBeNull();
    expect(getProxyWorkerUrl()).toBe('');
  });

  it('非法地址（不带 http/https）→ 不写入', () => {
    setProxyWorkerUrl('my-worker.example.com');
    expect(localStorage.getItem(LS_KEY)).toBeNull();
    expect(getProxyWorkerUrl()).toBe('');
  });

  it('存量里如果是脏数据（非 http）→ 读取时当成未配置', () => {
    localStorage.setItem(LS_KEY, 'javascript:alert(1)');
    expect(getProxyWorkerUrl()).toBe('');
  });

  it('http（非 https）的自定义地址也接受', () => {
    setProxyWorkerUrl('http://localhost:8787');
    expect(getProxyWorkerUrl()).toBe('http://localhost:8787');
  });

  it('发行方的 https 公共地址在玩家没覆盖时生效，作者地址和 http 不会当成公共地址', () => {
    expect(sanitizePublicProxyUrl('http://public.example.com')).toBe('');
    expect(sanitizePublicProxyUrl('https://proxy.friedsully.com')).toBe('');
    setBuiltInPublicProxyUrl('https://zhima-public-proxy.example.workers.dev/');
    expect(getBuiltInPublicProxyUrl()).toBe('https://zhima-public-proxy.example.workers.dev');
    expect(getProxyWorkerUrl()).toBe('https://zhima-public-proxy.example.workers.dev');
    expect(hasPlayerProxyOverride()).toBe(false);
    expect(requireProxyWorkerUrl()).toBe('https://zhima-public-proxy.example.workers.dev');
  });

  it('玩家自己的地址优先；清空后回到发行方公共地址', () => {
    setBuiltInPublicProxyUrl('https://zhima-public-proxy.example.workers.dev');
    setProxyWorkerUrl('https://my-worker.example.com');
    expect(hasPlayerProxyOverride()).toBe(true);
    expect(getProxyWorkerUrl()).toBe('https://my-worker.example.com');
    setProxyWorkerUrl('');
    expect(hasPlayerProxyOverride()).toBe(false);
    expect(getProxyWorkerUrl()).toBe('https://zhima-public-proxy.example.workers.dev');
    expect(rewriteStaleWorkerUrl('https://proxy.friedsully.com/api?x=1')).toBe('https://zhima-public-proxy.example.workers.dev/api?x=1');
  });

  it('存着作者地址时改用发行方公共地址，而不是继续请求作者', () => {
    setBuiltInPublicProxyUrl('https://zhima-public-proxy.example.workers.dev');
    localStorage.setItem(LS_KEY, 'https://proxy.friedsully.com');
    expect(getProxyWorkerUrl()).toBe('https://zhima-public-proxy.example.workers.dev');
  });
});

describe('网络代理设置定位', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, String(value)); },
      removeItem: (key: string) => { store.delete(key); },
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it('公告发出的定位请求只消费一次', () => {
    expect(consumeProxyWorkerSettingsFocus()).toBe(false);
    requestProxyWorkerSettingsFocus();
    expect(consumeProxyWorkerSettingsFocus()).toBe(true);
    expect(consumeProxyWorkerSettingsFocus()).toBe(false);
  });
});

describe('rewriteStaleWorkerUrl', () => {
  beforeEach(() => {
    localStorage.clear();
    setBuiltInPublicProxyUrl('');
  });

  it('活地址 / 用户自部署地址 / 空值原样保留', () => {
    expect(rewriteStaleWorkerUrl('https://my-own.example.com/api')).toBe('https://my-own.example.com/api');
    expect(rewriteStaleWorkerUrl('')).toBe('');
  });
});
