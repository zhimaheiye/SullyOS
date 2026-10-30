# 公开二改的上游同步与手动发布

本指南适用于公开工作区 `D:\sullyos-zhimaheiye`。当前任务与权限以维护者本次要求、AGENTS.md 和 [当前交接](handoff/CURRENT.md) 为准。历史任务中的发布授权不沿用。

## 同步前

1. 阅读 PRODUCT.md、当前交接和相关功能档案，检查 git status 与 git log -10。
2. 保存现有改动的范围和必要副本，包含未跟踪文件。工作区有改动是正常状态，不为清洁状态而 reset、clean 或提交。
3. 只读 fetch 官方上游并核对提交。公开 master 与本地 public-cleanup 可能不在同一提交上；先比较文件与共同祖先，不能直接 pull 覆盖。
4. 必要时在本工作区内的隔离 worktree 处理合入，不读写私人开发目录、现役 Worker、任务、密钥或数据库。

## 冲突与依赖

按行为合并，保护公开版已有的二改、数据格式和本次未提交工作。上游新增功能不记为个人原创更新。根据上游服务规则，官方后端应换成自己的服务或保持禁用；合入前端不表示可以接回官方实例。

依赖使用 pnpm 和锁文件，不引用私人 checkout 或本机绝对路径。生成的聊天 CSS、Worker bundle 应在源文件定稿后重建，不靠手工拼接产物解决冲突。构建 Worker 产物不等于更新线上 Worker。

暂存改动时先检查 stash 是否包含未跟踪文件及预期内容；恢复前核对目标和冲突。stash 操作失败不能证明备份无效，禁止先删 stash 再排查。只有内容已核验恢复、另有可靠副本且维护者明确需要丢弃时，才处理该副本。

## 验证

Windows/Codex 使用已安装的本地入口：

```text
node_modules\.bin\vitest.cmd run <相关测试>
node_modules\.bin\tsc.cmd --noEmit --pretty false
node scripts/build-chat-preview-css.mjs
node scripts/build-workers.mjs
node_modules\.bin\vite.cmd build
```

生产 build 不包含 strict 类型检查。类型诊断按文件、错误码与稳定信息同修改前基线比较；本批新增项必须修，未触及路径的既有诊断单列报告。2026-10-30 合入前的公开版基线为 645 项，它不是之后所有版本的固定数字。无法取得可靠基线时说明比较限制，不把非零简单归为本次回归，也不顺手全仓清零。

标准并行 worker 的测试结果才可作整仓基线；spawn UNKNOWN 属运行器故障。强制单线程只用于诊断，不能用共享状态污染后的结果建立回归结论。默认只进行代码验证；浏览器、设备、真实 API 与线上服务验收须单独说明。

## 发布

默认不提交、不推送、不部署，保留 origin 的禁推地址、push.default 与 pre-push hook。不得向 upstream 发版。需要发布时，先完成本地结果和审查，再按维护者明确指定的目标执行。

公开体验入口为独立 Netlify 静态站 `https://zhima-sullyos.netlify.app/`。根目录旧 `.netlify/state.json` 属私人站点关联，不得使用。不要继承私人环境变量或部署配置；发布快照排除凭据、个人数据、本地数据库、环境产物及执行过程文档。

静态资源和离线更新遵循 [缓存维护说明](static-resource-cache.md)：缺失脚本返回真实 404，不把 HTML 回退当脚本缓存，不按整个 /assets/ 目录设 immutable，不注销推送 SW、不清应用数据库。保留已验证的更新和保存提醒。

发布许可、代码来源和官方服务权限分别核对。干净的最新快照不等于旧敏感 SHA 已从 GitHub 删除；已泄露凭据与历史可访问性应单独处理。
