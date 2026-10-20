import type { APIConfig } from '../types';
import { ActiveMsgClient } from './activeMsgClient';
import { syncAmsgLlmCredentials } from './amsgStateSync';

type ApiConfigCommitOptions = {
  apiConfig: APIConfig;
  patch: Partial<APIConfig>;
  updateApiConfig: (updates: Partial<APIConfig>) => void;
  addToast: (message: string, type?: 'success' | 'error' | 'info') => void;
};

/**
 * 提交主 API 配置的唯一入口。
 *
 * 除了更新前台配置，还要同步主动消息凭据并补刷已经排程的任务；调用方不等待补刷，
 * 因此正在生成的请求会继续用它启动时拿到的旧配置，只有后续请求使用新配置。
 */
export const commitApiConfig = ({
  apiConfig,
  patch,
  updateApiConfig,
  addToast,
}: ApiConfigCommitOptions): void => {
  const nextConfig = { ...apiConfig, ...patch };
  updateApiConfig(patch);
  // 支持凭据表的 Worker 上，任务只带引用，换 Key 只要覆盖云端那几行。
  syncAmsgLlmCredentials(nextConfig);
  // 存量内联任务仍冻结着排程时的凭据，继续走原有 best-effort 补刷路径。
  void ActiveMsgClient.refreshApiCredentialsForPendingTasks(nextConfig)
    .then((result) => {
      if (result.status === 'partial') {
        addToast(`API 已保存，但有 ${result.failed} 条已排程的主动消息没换上新凭据，稍后再保存一次可重试。`, 'error');
      }
    })
    .catch((error) => {
      console.warn('[Settings] 刷新已排程任务的 API 凭据失败', error);
      addToast('API 已保存，但已排程的主动消息凭据刷新失败，稍后再保存一次可重试。', 'error');
    });
};
