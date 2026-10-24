/**
 * 主代理 Worker 地址 —— 中心配置（单一可信源）
 *
 * SullyOS 一票联网能力都通过同一个 Cloudflare Worker 代理转发，源码全在
 * `worker/index.js`（单文件）。涉及：
 *   - 联网搜索 / Brave 新闻回落                 → /search /news
 *   - WebDAV 云备份代理                         → /webdav
 *   - GitHub 云备份代理（玩家主动打开中转时）   → /github
 *   - Notion 集成                               → /notion/*
 *   - 飞书多维表格集成                          → /feishu/*
 *   - 麦当劳 / 瑞幸 点单 MCP                     → /mcp/mcd /mcp/luckin
 *   - Cloudflare API 中转（一键部署主动消息用）  → /cf-api
 *   - 网页读取、网易云、小红书 Lite              → /fetch-webpage /netease /api
 *
 * 本版本由发行方提供一份公共代理。仓库默认地址是已部署的
 * https://zhima-public-proxy.sullyos-sxy10.workers.dev。
 * 构建环境变量 VITE_PUBLIC_PROXY_URL 可以换成另一份 https 地址。
 * 两处都只接受 https，并且拒绝原作者的公共主机名。
 *
 * 玩家在「设置 → 网络代理」里另填的地址优先。清空之后回到发行方的公共地址。
 * 两边都没有可用地址时（测试里会故意清空），调用方必须先停下，不能拼出相对路径去打当前网页。
 *
 * 网易云音乐在播放器设置里另有一个服务地址：留空 = 跟随这里，填了则只有音乐走那个地址。
 * 小红书 Lite 的 serverUrl 在主代理可用之后指向「主代理 /api」；主代理空白时保持空白。
 */

/** 清空后的未配置哨兵。发行方真正的公共地址是 PUBLISHER_PUBLIC_PROXY_URL。 */
export const DEFAULT_PROXY_WORKER = '';

export const PROXY_WORKER_UNCONFIGURED_MESSAGE =
  '公共网络代理地址还没有填进这个版本。请等发行方完成配置，或由高级用户打开「设置 → 网络代理」填写自己的地址。普通聊天不需要这项。';

export class ProxyWorkerUnconfiguredError extends Error {
  constructor() {
    super(PROXY_WORKER_UNCONFIGURED_MESSAGE);
    this.name = 'ProxyWorkerUnconfiguredError';
  }
}

const LS_KEY = 'sully_proxy_worker_url_v1';
const SETTINGS_FOCUS_SESSION_KEY = 'sully_settings_focus_proxy_worker_v1';

// 原作者的公共代理。本版本读到这些地址时一律拒绝，
// 不能迁移到另一个作者域名，也不能继续使用。
const AUTHOR_PROXY_HOSTS = new Set([
  'proxy.friedsully.com',
  'sully-n.qegj567.workers.dev',
  'sullymeow.ccwu213.cc',
  'sullymeow.ccwu.cc',
]);

const normalize = (url: string): string => url.trim().replace(/\/+$/, '');

export const isAuthorProxyWorkerUrl = (url: string): boolean => {
  try { return AUTHOR_PROXY_HOSTS.has(new URL(url).hostname.toLowerCase()); } catch { return false; }
};

/** 历史调用名。作者的旧地址和当前公共地址都按同一规则停用。 */
export const isLegacyProxyWorkerUrl = isAuthorProxyWorkerUrl;

const acceptUserProxyUrl = (url: string): string | null => {
  const trimmed = normalize(url || '');
  if (!/^https?:\/\//i.test(trimmed)) return null;
  if (isAuthorProxyWorkerUrl(trimmed)) return null;
  return trimmed;
};

/** 发行方公共地址只接受 https，并拒绝作者主机名。http、空值和非法值都变成空串。 */
export const sanitizePublicProxyUrl = (url: string): string => {
  const trimmed = normalize(url || '');
  if (!/^https:\/\//i.test(trimmed)) return '';
  if (isAuthorProxyWorkerUrl(trimmed)) return '';
  return trimmed;
};

/** 已部署的发行方公共代理。玩家不填地址时就用它。构建变量可以覆盖，但不能改成作者的地址。 */
export const PUBLISHER_PUBLIC_PROXY_URL = 'https://zhima-public-proxy.sullyos-sxy10.workers.dev';

const readVitePublicProxy = (): string => {
  try {
    const raw = import.meta.env?.VITE_PUBLIC_PROXY_URL;
    const fromEnv = sanitizePublicProxyUrl(typeof raw === 'string' ? raw : '');
    if (fromEnv) return fromEnv;
  } catch {
    /* 构建环境读不到变量时，使用下面写死的发行方地址。 */
  }
  return sanitizePublicProxyUrl(PUBLISHER_PUBLIC_PROXY_URL);
};

let builtInPublicProxy = readVitePublicProxy();

/** 当前生效的发行方公共地址。测试清空后是空串。 */
export const getBuiltInPublicProxyUrl = (): string => builtInPublicProxy;

/**
 * 替换构建期公共地址。测试用来注入一个明确的 https 地址。
 * 作者主机名、http 和空值都会变成「没有公共地址」。
 */
export const setBuiltInPublicProxyUrl = (url: string): void => {
  builtInPublicProxy = sanitizePublicProxyUrl(url || '');
};

// 非浏览器运行时（amsg worker 等）没有 localStorage，靠这个显式注入。
// 浏览器端不设置，保持 localStorage 懒读不变。
let runtimeOverrideUrl: string | null = null;

/**
 * 注入代理 worker 地址（无 localStorage 的运行时用，如 amsg worker 到点执行工具时）。
 * 传空串、作者公共地址或非法地址都会清除注入，接着再看玩家保存的地址和发行方公共地址。
 */
export const setProxyWorkerUrlOverride = (url: string | null): void => {
  runtimeOverrideUrl = acceptUserProxyUrl(url || '');
};

const readStoredProxyUrl = (): string => {
  try {
    return acceptUserProxyUrl(localStorage.getItem(LS_KEY) || '') || '';
  } catch {
    return '';
  }
};

/**
 * 读取当前生效的主代理 worker 地址（已去尾斜杠）。
 * 运行时注入优先，其次是玩家在设置里保存的地址，最后才是发行方的公共地址。
 * 作者地址和非法值会被跳过。都没有时返回空字符串。
 */
export const getProxyWorkerUrl = (): string => {
  if (runtimeOverrideUrl) return runtimeOverrideUrl;
  return readStoredProxyUrl() || builtInPublicProxy;
};

/** 已配置时返回地址；未配置时抛出中文说明，避免拼成相对路径。 */
export const requireProxyWorkerUrl = (): string => {
  const base = getProxyWorkerUrl();
  if (!base) throw new ProxyWorkerUnconfiguredError();
  return base;
};

/**
 * 写入玩家自己的 worker 地址。
 * 传空、非法值或作者公共地址 → 清掉本地覆盖，回到发行方公共地址（若构建里有）。
 * 写入成功后广播一个自定义事件，让「启动时快照配置」的消费者（如音乐播放器）能实时跟随。
 */
export const setProxyWorkerUrl = (url: string): void => {
  try {
    const accepted = acceptUserProxyUrl(url || '');
    if (!accepted) localStorage.removeItem(LS_KEY);
    else localStorage.setItem(LS_KEY, accepted);
    notifyProxyWorkerChanged();
  } catch {
    /* localStorage 不可用就当没有玩家覆盖处理 */
  }
};

/**
 * 中心 Worker 地址变更事件。同一标签页内改 localStorage 不会触发原生 'storage' 事件，
 * 所以用这个自定义事件通知那些「只在挂载时读一次配置」的模块（目前是音乐播放器）实时刷新。
 */
export const PROXY_WORKER_CHANGED_EVENT = 'sully:proxy-worker-changed';
const notifyProxyWorkerChanged = (): void => {
  try {
    if (typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      window.dispatchEvent(new Event(PROXY_WORKER_CHANGED_EVENT));
    }
  } catch {
    /* 非浏览器环境（测试 / SSR）忽略 */
  }
};

/** 玩家是否在设置里另存了一份地址。只用发行方公共地址时返回 false。 */
export const hasPlayerProxyOverride = (): boolean => readStoredProxyUrl() !== '';

/** 当前是否已经有可用的代理地址（玩家覆盖或发行方公共地址）。 */
export const isCustomProxyWorker = (): boolean => getProxyWorkerUrl() !== '';

/** 从公告等入口打开设置时，请设置页自动展开并定位到网络代理。 */
export const requestProxyWorkerSettingsFocus = (): void => {
  try {
    sessionStorage.setItem(SETTINGS_FOCUS_SESSION_KEY, '1');
  } catch {
    /* sessionStorage 不可用时仍可正常打开设置，只是不自动定位。 */
  }
};

/** 一次性读取定位请求，避免用户以后每次打开设置都被拉到页面底部。 */
export const consumeProxyWorkerSettingsFocus = (): boolean => {
  try {
    const requested = sessionStorage.getItem(SETTINGS_FOCUS_SESSION_KEY) === '1';
    if (requested) sessionStorage.removeItem(SETTINGS_FOCUS_SESSION_KEY);
    return requested;
  } catch {
    return false;
  }
};

/**
 * 把指向作者公共实例的 url 改写到当前生效的代理（保留路径和 query）。
 * 还没有任何可用地址时返回空字符串，不能把作者地址原样放回去。
 * 其余地址原样返回。给小红书 serverUrl 这类「自己存一份地址」的模块做存量迁移用。
 */
export const rewriteStaleWorkerUrl = (url: string): string => {
  if (typeof url !== 'string' || !url || !isAuthorProxyWorkerUrl(url)) return url;
  const base = getProxyWorkerUrl();
  if (!base) return '';
  try {
    const u = new URL(url);
    return `${base}${u.pathname === '/' ? '' : u.pathname}${u.search}`;
  } catch {
    return '';
  }
};
