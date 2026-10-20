# 角色阅读表情包真实图片（表情包视觉理解）

## 档案信息

- 类型：现有 App 子模块（横切能力：私聊 Chat / 群聊 GroupChat / 设置 Settings / 转发 / 备份）
- 当前状态：可用；2026-09-25 已完成真实聊天端到端验收，确认角色能够读取表情包真实图片。该次验收未记录实际走的是独立 Vision API 还是主模型直读图路径，因此不据此宣称两条实网路径均已分别验证。
- 首版日期：2026-09-25
- 最近迭代：2026-09-25

## 最初开发需求

表情包消息（`Message.type === 'emoji'`）的 content 只存图床 URL / blobref 令牌，非识图模型在上下文里只能看到 `[表情包: XXX]` 占位符——角色"看不见"表情包画面，meme 语义全靠脑补。本功能让角色可以真正读到表情包的真实图片，同时明确知道"这是一张表情包、它叫什么"，绝不把表情包降级成普通图片。

核心约束（用户明确要求）：

1. 全局开关 `读取表情包图片` 默认关闭，独立持久化（`sully-sticker-vision-v1`），不绑定识图 API（VisionApiConfig.enabled）、不绑定 API 预设。
2. 三层配置：全局默认 → 角色 `stickerVisionMode: 'inherit'|'on'|'off'` → 群 `stickerVisionMode`（群级，不按成员）。
3. **发送时资格冻结（最关键）**：只有功能开启之后发送的表情包，才在落库那一刻写入 `metadata.stickerVision = { eligible: true, name: 发送时名称 }`。旧消息永不补识别；资格一旦写入就是永久历史事实， survives 功能关闭 / reroll / 重启。
4. 识别失败一律 fail-soft：降级回名称模式，只 console.warn，绝不挂掉聊天轮次。
5. 记忆隔离：`stickerVision.description` 只进聊天 prompt，绝不泄漏进记忆宫殿 / 总结 / 归档 / 话题盒 / 向量。
6. 转发必须保留表情包视觉语义（见下"转发"）。
7. 不做破坏性 migration，全部 optional 字段向后兼容；老备份导入安全降级。

## 初版实现

### 三层开关解析

```
resolveStickerVisionEnabled(globalEnabled, mode?)
  mode === 'on'  → true
  mode === 'off' → false
  其余（inherit/undefined）→ globalEnabled
```

全局开关存 localStorage `sully-sticker-vision-v1`，随完整备份导出/导入（`stickerVisionLocal` 段，走 mcpLocal 同款模式）；角色/群字段随既有实体备份走，无需新表。

### 发送时资格冻结

所有 emoji 落库入口统一经 `buildStickerVisionMetadata(name, enabled)`：开启 → `{ eligible: true, name }`，关闭 → `undefined`（完全不写 metadata——这就是"旧消息永不补识别"的基础）。已覆盖入口：

- 私聊用户发送（Chat.tsx `send-emoji` 面板动作）
- 私聊角色 sendEmojiBubble（applyAssistantPostProcessing.ts，主动消息 1.0 双语/普通两条路径同在此收口）
- 群聊用户发送（GroupChat.tsx `send-emoji`）
- 群聊 AI 成员表情（groupChat/dispatch.ts，导演与轮询模式共用）
- 主动消息（1.0 在 OSContext.tsx 两处 sendEmojiBubble；2.0 走 applyAssistantPostProcessing 同一收口）

资格写入后与后续开关无关：识别（description/recognizedAt/model）由物化管线事后补在同一个 `metadata.stickerVision` 上。

### 识图管线（有独立识图 API 时）

`materializeStickerVisionDescriptions`（visionApi.ts）在构造 prompt 前运行：`visionApi.enabled === true` 且配置完整时，对窗口内有资格、无描述的表情包用专用提示词 `STICKER_VISION_PROMPT`（强调 meme 语义 / 图上文字 / 语气，明确禁止按文件名猜画面，不把表情名喂给视觉模型）调现有 `/chat/completions` 识图代码；结果经 `DB.updateMessageMetadata` 写回 `{ description, recognizedAt, model }`。同批同资源只调一次；任一环节失败（网络 / URL 失效 / blobref 缺失 / 空响应）降级名称模式。普通 `image` 消息行为不变（`materializeVisionDescriptions` 照旧先跑）。

### 无独立识图 API（主模型直接读图）

有资格且无描述的表情包在 `buildMessageHistory` / `buildGroupHistoryBlock` 中走多模态 payload：文本部分 `[用户 发送了表情包: XXX。请结合随附的表情包图片理解它实际表达的语气和含义。]` + `image_url` 部分（支持 data: / http(s) / blobref，blobref 由 apiBlobRefs 出口还原）。群聊里表情包与普通图片竞争同一 `maxAttachedImages` 附带窗口。

### Prompt 三态渲染（资格看消息自己的 metadata，不看当前开关）

- Case A（无资格，旧消息）：`[用户 发送了表情包: XXX]`，与以前完全一致。
- Case B（有资格 + 已有描述）：`[用户 发送了表情包: XXX。画面内容：YYY]` 纯文本。**不依赖识图开关**——描述是发送后已冻结的语义，识图 API 关了也不消失。
- Case C（有资格 + 无描述 + 无独立识图）：文本 + image_url 多模态。
- 其余组合（有资格无描述但识图开着但没拿到结果等）→ 名称模式降级。

### 转发（Chat.tsx handleForwardToCharacter）

原来转发只序列化 role/type/content/timestamp，metadata 全丢，且 chat_forward 渲染表情为 `[表情]`。现改为转发快照只带 `stickerName` + `stickerVision: { eligible, description? }`（不整包倾倒 metadata）：

- 源消息有描述 → 目标看到 `[表情包: XXX。画面内容：YYY]`，即使目标自己的 stickerVisionMode 是 off（历史语义不得删）。
- 有资格无描述 → 保留名称/URL/资格，目标在主模型读图模式下能收到 image_url（文案标注"这是被转发聊天记录中的表情包"）。
- 无资格旧表情 → 只有 `[表情包: XXX]`，转发不触发补识别。

### 记忆隔离

记忆宫殿 sanitizer、`normalizeMessageContent`、群聊 `messageLogText`、手动归档、总结、话题盒、向量化继续把 emoji 当占位符处理——`stickerVision.description` 从不进入这些管线。隔离有单测钉住。

### 入口与界面

- 设置 → 表情包视觉理解：全局开关 + 固定三行说明文案（新表情可读图 / 旧表情不补识别 / 有识图 API 优先转文字描述，否则主聊天模型直接读图）。
- 私聊聊天设置 → 扩展功能：三态选择器（跟随全局 / 强制开启 / 强制关闭）+ `当前实际：开启（全局默认）` 生效值展示。
- 群聊设置：同款三态 + `本设置对整个群生效`。

## 关键文件与接手入口

- 配置层（纯逻辑，禁止 import visionApi——会造出 db→stickerVision→visionApi→db 循环）：`utils/stickerVision.ts`
- 物化管线 + 表情专用提示词：`utils/visionApi.ts`（`STICKER_VISION_PROMPT`、`materializeStickerVisionDescriptions`）
- 私聊 prompt 三态 + 转发渲染：`utils/chatPrompts.ts`
- 群聊 prompt 三态 + 附带窗口：`utils/groupChat/prompts.ts`
- 资格冻结入口：`apps/Chat.tsx`、`apps/GroupChat.tsx`、`context/OSContext.tsx`、`utils/applyAssistantPostProcessing.ts`、`utils/groupChat/dispatch.ts`
- payload 链：`utils/chatRequestPayload.ts`（先物化普通图片，再物化表情包）
- 类型与备份：`types.ts`（`stickerVisionMode` × 2、`stickerVisionLocal`）、`utils/db.ts`、`context/OSContext.tsx`
- UI：`apps/Settings.tsx`、`components/chat/ChatModals.tsx`、`apps/GroupChat.tsx`
- 测试：`utils/stickerVision.test.ts`（31 条：配置矩阵 / 冻结语义 / 物化成功去重降级 / 私聊三态 / 群聊 / 转发 / 记忆隔离）

## 当前状态与未完成项

- 已完成：全部三层 UI、六处冻结入口、识图 + 直读双管线、转发语义、备份、31 条测试 + 相关旧套件回归 + tsc + build 全绿。
- 真实验收：2026-09-25 用户在实际聊天中完成端到端测试，确认角色能够读到表情包真实图片；这是运行现场验证。由于本次对话没有记录当时走的是独立 Vision API 还是主模型直读图路径，不能把这次成功外推为“两条实网路径均已分别验证”。
- 仍需按路径分别验证：独立 Vision API 下不同端点 / 模型的表情描述质量；无独立识图 API 时各厂商主模型对 `image_url` 的实际兼容性。
- 明确不做：旧表情补识别；全局缓存系统（按用户要求不引入）；把表情包与普通图片在 UI 上混同。

## 修改后的最小验证

```bash
./node_modules/.bin/vitest.cmd run utils/stickerVision.test.ts
./node_modules/.bin/vitest.cmd run utils/visionApi.test.ts utils/messageFormat.sticker.test.ts utils/chatPrompts.emojiVisibility.test.ts utils/groupChat/prompts.test.ts utils/groupChat/dispatch.test.ts utils/applyAssistantPostProcessing.test.ts utils/chatRequestPayload.test.ts
NODE_OPTIONS=--max-old-space-size=6144 ./node_modules/.bin/tsc.cmd --noEmit
./node_modules/.bin/vite.cmd build
```
