# 当前交接

本仓库是基于上游 [SullyOS](https://github.com/qegj567-cloud/SullyOS) 的个人二改。许可文本仍是根目录 [LICENSE](../../LICENSE)，这里不改写，也不扩大许可范围。上游社区负责人已同意维护者分享这个个人二改仓库的链接，并自行管理自己的社区。这不表示可以使用上游的在线服务。

公开审核分支为 `public-audit-2026-10-20`，已推送至 `zhimaheiye/SullyOS`；本地整理分支为 `public-cleanup`。不要推送到 `upstream`，也不要部署现役 Worker。

## 这份公开版实际保留的行为

- 聊天只使用 API URL、API Key 和模型名。没有本机账号 CLI。
- 角色卡和预设使用 SullyOS 原生格式。查手机里的剧情「酒馆」小应用仍在。
- 私聊不能新建消息撤回。旧备份里的 `metadata.withdrawal` 仍按 `utils/messageWithdrawal.ts` 脱敏。
- 查手机保留联系人、好感、共同好友和真人双向同步。不能新建身份接管或代发。旧 provenance 只用于阅读旧记录。
- 生图只走 OpenAI Images 的 `POST /v1/images/generations`。场景提示词卡片走普通文本模型。说明见 [`docs/features/image-generation.md`](../features/image-generation.md)。
- 交换日记的新空白页可以选内置反思模板、自定义模板或真正空白。已有日记不被改写。
- 我的日程是自然语言时间轴、分类、归档和聊天卡同步。没有活动采集、睡眠同步或生活提醒。
- 任务工坊是任务盒、工具箱和角色来访。没有共享提醒控制台。
- 普通主动消息和用户自己配置的 MCP 仍在。没有角色自主生活调度。
- 彼方保留图书馆、听歌房、留言簿、娱乐室、剧院和 SAR。邮局、漂流瓶和信号坠落处已从公开版删除（面板、客户端、Prompt、Worker 和构建配置），只保留旧存档的导入导出兼容，不再连接任何共享后端。

## 网络与构建

- 发行方公共代理是 `https://zhima-public-proxy.sullyos-sxy10.workers.dev`，写在 `utils/proxyWorker.ts`，部署配置是 `worker/wrangler.public-proxy.toml`。设置里可以改成自己的 https 地址。代码拒绝上游公共代理主机名。
- 主动消息由使用者自己部署。本仓库不附带私人推送地址，也不附带上游美化库、使用统计或安卓更新地址。
- `.github/workflows/ci-build.yml` 在推送到 `master` 或 Pull Request 时只运行构建。`deploy-pages.yml` 和 `deploy-cloudflare-worker.yml` 只能手动运行。
- 本地打开用 `run.bat` 或 `open-local-web.bat`，地址是 `http://127.0.0.1:5183/`。`build-and-open-local-web.bat` 预览 `http://127.0.0.1:4183/`。

## 本轮没有做的验收

没有调用真实付费 API，没有用浏览器重走界面，也没有重新触发远程 GitHub Actions。
