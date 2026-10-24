# 林间聊愈室

## 档案信息

- 类型：独立桌面 App
- 当前状态：可用（0.1）
- 首版日期：2026-08-23
- 首版提交：`b958eb4ad7b75a7ea48a73c524559ca8df63eb48` — `feat: add forest healing room`
- 最近迭代：2026-08-23
- 最近代码核验：2026-10-03，归档前 `master@be4690955853d63ced1bf9bbfbf4b58793b7c790`

## 最初开发需求

新增一个以“安全表达、被理解、被长期记住”为核心的 AI 小手机内置软件。用户从现有角色中选择一位进入单次聊愈，角色保持神经链接中的身份、关系和口吻；所有角色在本 App 内共享一套以用户为主体的长期记忆，但普通聊天、普通记忆宫殿和其它 App 不得读取这套资料。

0.1 必须支持文字和图片聊天、角色选择、完整原文手记、自动记忆整理、跨角色召回、记忆浏览/搜索/删除、数据库升级和完整备份。语音、Live2D/VRM、读心卡、星语图和可操作的记忆导入明确留到后续版本；后三项首版只能展示本地占位说明，不能发起 API 请求。

## 初版实现

### 用户流程

1. 从桌面“聊愈”进入林间首页，按现有角色分组或名称选择一位角色；每次进入都会创建一段独立 session。
2. 聊天页上半部只展示角色现有静态立绘，下半部复用普通消息气泡；底部可发送文字或选择图片，不显示语音入口。
3. 用户消息先写入聊愈原始记录，再调用角色回复。请求失败时已写入的用户原话仍保留，AI 回复只写 `healing_messages`。
4. “疗愈手记”按 session 查看用户与角色的完整逐字记录和图片；整理记忆不会覆盖、摘要或删除原文。
5. “共享记忆”支持搜索、查看标签/来源和单条删除。删除记忆会在同一事务中删除对应向量，不会删除原始手记。
6. 读心卡、星语图和记忆导入按钮只打开“功能将在后续版本开放”的本地弹层。

### 角色上下文与记忆

- 角色对话复用 `ContextBuilder.buildCoreContext()`，因此继承现有角色身份、用户档案和关系语境；本 App 自己的短期上下文只来自当前 `healing_messages`。
- 这层共享记忆是额外的 Healing-only 用户背景，不替代角色自身的角色上下文；当前 `buildHealingChatPayload()` 先构造 `ContextBuilder.buildCoreContext()`，再追加聊愈模式与共享记忆块。为守住“围绕用户、只在聊愈可见”的所有权边界，不以固定/虚拟 `charId` 把它伪装成普通记忆宫殿节点，也不把 `healing_*` 注入全局 `ContextBuilder`。
- 聊愈长期记忆没有 `charId` owner。任一角色陪伴时形成的用户事实都可由另一位角色在聊愈场景按语义召回，默认 Top-K 为 6。
- 每个 session 以 `memoryProcessedThrough` 保存高水位。累计 10 条未处理消息时自动整理，离开聊天时强制处理尾部；意外退出留下的尾部在下次进入 App 时补处理。
- 抽取提示只允许保存用户明确表达、未来交流有帮助的事实、事件、理解和感受；允许返回空数组，禁止心理诊断、角色臆测和把 AI 回复当用户事实。程序还要求候选与用户原话存在可辨认的文字证据。
- 新记忆先做规范化与完全重复过滤；有向量服务时批量向量化，并用余弦相似度 `> 0.9` 去重。向量不可用或调用失败时仍保存文本，召回自动退化为关键词与最近记忆排序。
- `utils/healing/memoryImport.ts` 已提供未来文件/文本导入共用的统一入库入口；0.1 没有开放解析或写入 UI。

### 隐私与写回

- 聊愈原文和共享用户记忆是一个本机私密命名空间，只由林间聊愈室的服务读取。
- 普通 `messages`、普通聊天请求和记忆宫殿不会收到 `healing_*` 内容；聊愈也不会把会话、摘要或记忆自动写回任何角色的普通时间线。
- 角色共享的是用户事实，不是角色私密信息。记忆节点可记录来源角色与 session 以便回看，但来源角色不是所有权边界。
- 图片沿用本机 `blobref:` 素材链；发送给模型时才按当前请求解析为图片数据。
- 0.1 不是医疗产品：提示词禁止心理诊断和治疗承诺，界面不提供量表或临床结论。

### 数据、备份与恢复

- IndexedDB v86 新增四张表：
  - `healing_sessions`：单次聊愈的角色、时间和记忆处理高水位。
  - `healing_messages`：按 `sessionId` 索引的完整文字/图片原始消息，自增数字主键。
  - `healing_memory_nodes`：跨角色共享的用户中心文本记忆、标签、重要度、来源和访问统计。
  - `healing_memory_vectors`：以 `memoryId` 为主键的紧凑 Float32 字节与维度；不保存角色 owner。
- v85 升级到 v86 时只补建新表和索引，旧角色及其它数据不迁移、不清空。
- 普通完整 JSON 导出/恢复包含四张表；OSContext v2 全量和纯文字备份也包含聊愈数据，向量使用独立 `healing_memory_vectors.bin` 与 index 旁路，不与普通记忆向量混用。
- 全量/媒体备份会解析 `healing_messages` 中可达的图片引用；导入继续复用现有素材恢复链。

### 入口与界面

- 桌面名“聊愈”，App 内品牌名“林间聊愈室”，使用纸白、苔绿、木色的安静林间视觉。
- 已接入 `AppID.Healing`、桌面配置、PhoneShell 懒加载/按压预取/空闲预热/渲染和自理安全区。
- 角色选择复用神经链接的现有角色与分组；头像、立绘和图片消息均兼容现有 blob 引用。
- 聊天只选择静态 companion portrait、约会立绘或角色头像，不初始化视频头像、语音或 3D 渲染链。

## 迭代与 Debug 记录

### 2026-08-23 · 0.1 初版

- 现象：普通聊天会把关系和记忆绑定到单一角色，缺少一处可保留完整原话、又让不同陪伴角色共同理解用户的私密空间。
- 根因：现有 `messages` 和记忆宫殿以角色为 owner；直接复用会让聊愈内容污染普通聊天，也无法表达“角色共享、只在聊愈可读”的边界。
- 修复：新增四张隔离表、共享用户记忆服务和独立聊天请求；只复用角色核心上下文、图片素材、消息气泡、Embedding 与备份基础设施。
- 回归：覆盖真实 v85→v86 升级、四表 CRUD、图片引用、普通/v2 备份、跨角色召回、普通聊天隔离、10 条缓冲与退出补处理、聊天落库、占位零请求和安全区接线。
- 提交：`b958eb4ad7b75a7ea48a73c524559ca8df63eb48` — `feat: add forest healing room`。

### 2026-10-03 · 删除旧开发对话前复核

- 首版提交仍是当前 `master` 的祖先；按归档前 `master@be4690955853d63ced1bf9bbfbf4b58793b7c790` 核验，当前代码仍保留 `healing_sessions`、`healing_messages`、`healing_memory_nodes`、`healing_memory_vectors` 四张聊愈表，以及 `HealingSession.memoryProcessedThrough`、跨角色共享用户记忆与独立向量旁路。
- 当前 `DB_VERSION = 94`。本文“IndexedDB v86 新增四张表”描述的是 2026-08-23 的历史迁移点，不代表当前数据库总版本仍停在 v86。
- `utils/healing/chatService.ts` 当前仍固定 `stream: false`，因此旧会话里“避免全局 SSE 开关让 v0.1 JSON 解析误读响应”的实现边界仍成立；如果未来要支持流式输出，应把它作为显式迭代，而不是直接继承全局 stream 开关。
- 旧对话中的 36 项专项、4232 项整仓测试和 79 行 TypeScript 既有诊断只属于当时的历史验证现场；当前状态以后续代码、测试与本档案为准，不把这些数字当作当前测试基线。

## 当前状态与未完成项

- 已完成：角色选择、每次独立 session、文字/图片聊天、静态角色画面、逐字疗愈手记、10 条自动/退出强制/进入补偿记忆整理、跨角色 Top-K 召回、关键词退化、记忆搜索/来源/删除、四表备份恢复和系统接线。
- 未完成：语音输入/朗读、视频头像、Live2D/VRM、读心卡、星语图、面向用户的记忆文件/文本导入、流式输出、记忆编辑。
- 仍需真实环境验证：不同兼容聊天/Embedding API 的图片格式与抽取质量；大量长会话的模型上下文效果；iOS/Android 实机安全区、键盘顶起和图片选择体验。

## 关键文件与接手入口

- 业务界面：`apps/HealingApp.tsx`、`components/healing/`
- 记忆抽取/入库/召回：`utils/healing/memoryExtraction.ts`、`utils/healing/memoryService.ts`、`utils/healing/memoryRetrieval.ts`
- 上下文/API：`utils/healing/chatService.ts`
- 未来导入入口：`utils/healing/memoryImport.ts`
- 静态立绘边界：`utils/healing/portrait.ts`
- 存储/备份：`types.ts`、`utils/db.ts`、`utils/backupFormat.ts`、`context/OSContext.tsx`
- 系统接线：`constants.tsx`、`components/PhoneShell.tsx`、`utils/safeAreaApps.ts`
- 测试：`utils/healing.db.test.ts`、`utils/healing.memory.test.ts`、`utils/healing.wiring.test.ts`、`utils/backupFormat.test.ts`

## 修改后的最小验证

```bash
pnpm vitest run utils/healing.db.test.ts utils/healing.memory.test.ts utils/healing.wiring.test.ts utils/backupFormat.test.ts utils/safeAreaApps.test.ts
pnpm build
```
