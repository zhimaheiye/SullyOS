# 主动消息维护入口

源码入口为 `utils/activeMsgClient.ts`、`utils/activeMsgRuntime.ts`、`worker/amsg/src/`；依赖版本以 package.json 与锁文件为准。

## 当前契约

- 后台消息的模型请求只使用 fire 时实际需要的云端上下文；客户端卡片渲染、表情解析等后处理仍留在客户端。
- 状态大值按现有分块协议读写；缺少字段、能力探测失败和读取错误不能作为可安全清空的空状态。
- 工具清单按 Worker 实际能力注入，不能暴露依赖前台临时数据而无法完成的后台工具。
- 所有持久任务、云端资源清理和恢复行为按 owner/generation 与幂等契约执行，旧请求不得因恢复而获得新代次。
- 模型凭据、聊天快照和用户登录会话不得写进源码、公开文档、示例配置或调试报告。

详情见 [MCP 客户端](mcp-client.md)、[频率与额度](amsg2-pacing-limits.md)、[即时对话](../plans/amsg2-instant-chat-contract.md)、[凭据引用](../plans/amsg2-llm-credentials-contract.md)、[云端管理](../plans/amsg2-cloud-data-management-contract.md)、[后台任务](../plans/amsg2-expansion.md)。旧设计背景见 [云端状态设计](../notes/amsg-fullbg-state-design.md)。

## 本地验证

修改 Worker 源码或 SDK 后运行 `node scripts/build-workers.mjs`，随后运行已有相关测试；需要本地 D1/推送协议模拟时使用 `node scripts/amsg2-e2e-harness.mjs`。它们不代表真实账号、私人部署或生产 Worker 已验收。

公开工作区的构建不会自动发布到现役 Worker。提交、推送、部署和真实云端数据操作以维护者当前明确授权为准，历史施工文档不提供持续授权。
