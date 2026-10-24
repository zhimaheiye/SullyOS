const AUTHOR_SERVICE_SUFFIX = '.friedsully.com';
const AUTHOR_SERVICE_HOSTS = new Set([
  'friedsully.com',
  'beauty.friedsully.com',
  'beauty-library.friedsully.com',
  'stats.friedsully.com',
  'proxy.friedsully.com',
]);

/** 公开版本不使用作者的美化、统计或代理域名。环境变量若仍指向它们，也当成未配置。 */
export function publicServiceUrl(raw: string | undefined): string {
  const base = String(raw || '').trim().replace(/\/$/, '');
  if (!base) return '';
  try {
    const host = new URL(base).hostname.toLowerCase();
    if (AUTHOR_SERVICE_HOSTS.has(host) || host.endsWith(AUTHOR_SERVICE_SUFFIX)) return '';
  } catch {
    return '';
  }
  return base;
}

export const BEAUTY_SHARE_URL = publicServiceUrl(import.meta.env.VITE_BEAUTY_SHARE_URL);
