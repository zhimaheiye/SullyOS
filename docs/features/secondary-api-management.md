# 副 API 统一管理 V1

> 2026-10-20 待公开版本复核：副 API 管理里没有 Codex、Qoder、Antigravity 或本机账号 CLI 字段。普通 URL + API Key + Model 仍是唯一配置方式。自主生活的 `characterLife` 不再出现在设置列表，旧配置仍能随备份进出，运行时不再调用。新增 `dateScenePrompt`（线下见面场景提示词）沿用主 API，只走普通文本接口。

## 范围

「系统设置 → 副 API 管理」按功能保存独立的文本对话模型配置。每条配置是 URL、Key、Model 的完整快照，不引用会随主聊天切换的预设 ID。选预设只是把当时的配置载入该功能草稿；保存后各功能互不影响。Key 只存在本机配置和完整/纯文字备份，不进入提示词与 API 调用日志。

每项可选「沿用原有来源」或「独立配置」。独立配置保存后请求不会因 429 或网络错误改用另一项的模型。拉模型只请求该项 URL 的 `/models`；列表失败仍可手填模型，已选模型不会被刷新结果自动替换。通用模型选择器沿用 `DialogueApiFields` 与 `ModelPicker`。

## 路由与迁移

路由及注册表位于 `utils/featureApi.ts`。配置存于本机 `sully_feature_apis_v1`，在完整/纯文字备份的 `featureApiSettings` 字段导出和恢复。恢复没有该字段的旧整档时清除当前设备的功能覆盖，继续按备份中的旧规则运行；无需复制或重填旧 Key。配置格式归一化可重入。

优先级：角色情绪的角色专属覆盖先于全局功能独立配置；关闭角色覆盖后才回到功能配置。心象翻译原规则是完整的记忆轻量副 API → 完整的角色情绪副 API → 停止，绝不自动回退主 API。记忆宫殿原规则是旧 `memoryPalaceConfig.lightLLM` → 主 API。记忆宫殿旧设置页与集中管理页写同一份新功能配置，旧 `lightLLM` 只作为「沿用」来源保留。

设置列表就是 `utils/featureApi.ts` 的 `FEATURE_APIS`。`characterLife` 不在这张表里，也不会被调用。旧备份里的 `characterLife` 配置仍能读回，以免整档往返丢掉字段。

| featureId | 功能 | 沿用来源 |
| --- | --- | --- |
| `emotion` | 情绪评估、家园行为解释、电话/陪伴表演判断 | 角色覆盖 → 主 API |
| `thinkingTranslation` | 心象翻译 | 旧记忆轻量 → 角色情绪；均无则停止 |
| `memoryLight` | 记忆提取、关联、消化、门牌、召回判断与修复 | 旧记忆轻量 → 主 API |
| `characterSchedule` | 角色日程与意识流演化 | 主 API |
| `myScheduleParse` | 我的日程自然语言解析 | 主 API |
| `memorySummary` | 角色日记、月度记忆、印象归纳 | 主 API |
| `healingMemory` | 聊愈用户记忆抽取 | 旧记忆轻量 → 主 API |
| `storyArchive` | 剧情事件盒总结 | 主 API |
| `memoryImport` | 批量旧记忆导入 | 导入时选择的 API |
| `lifeReplayAnalysis` | 人生重映事件分析与结局整理 | 主 API |
| `communitySummary` | 居委会开题分析与议事总结（入口暂未挂载，配置仅兼容旧数据） | 主 API |
| `debateJudging` | 辩论赛主持评议与赛后总结 | 主 API |
| `dateScenePrompt` | 线下见面场景提示词，只走普通文本接口 | 主 API |

`safeFetchJson` 对已标记的旧式分析请求在发送边界换用该功能的完整 URL/Key/Model，保留原消息与任务参数。新入口直接调用 `resolveFeatureApi`。`ApiCallMeta.featureId` 落入原 API 调用记录，记录中已有请求模型、API 主机、HTTP 状态与耗时；设置页显示每功能最近一条，详细记录显示功能名。这里不创建新的请求日志或保存 Authorization。

## 不纳入文本副 API

普通私聊/群聊/电话正文、AMSG2 即时与正常主动回复、角色默认聊天 API、Embedding、Rerank、TTS、STT、识图、生图有各自协议或独立职责。世界线/人生重映的角色演绎正文、辩论发言、论坛帖文创作等属于这些玩法的正文模型调用，本轮保留原路由。协同工作归档总结使用当前协同会话的专属 profile，未改为全局功能配置，以免覆盖该会话选择的渠道。

## 验证边界

代码验证涵盖功能配置隔离、优先级、旧回退、实际标记请求的路由、心象翻译、剧情归档和生产构建。浏览器交互验收需用户按项目默认边界另行执行；刷新持久化可通过本机存储读写测试验证。Worker 端主动消息 2.0 的云端轻量记忆任务使用独立上传凭据，不经本机 `safeFetchJson`，本轮没有修改云端凭据同步。
