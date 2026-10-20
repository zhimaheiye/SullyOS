# 私聊心象自动译文

私聊已有的 `metadata.thinkingChain` 是模型原始思考链。本功能只增加用户可见的中文译文，不改变主聊天生成、流式心象或后续角色上下文。

## 入口与行为

- 「心象 · 设置」的「自动翻译外语心象」是全局开关，默认关闭，写入本机 `sully-thinking-auto-translate-v1`。普通聊天翻译开关保持独立。
- 新的本地回复在 `chat-gen-reply-arrived` 后、即时对话在 `active-msg-received` 已正式落库且标记为 instant 后，才尝试自动翻译。流式预览、进入聊天、历史加载、打开开关均不触发。每批最多两条并行；失败不自动重试。
- 中文为主的心象按本地字符比例跳过；混合文本保守处理，历史心象可以点「翻译」按需请求。卡片在原文与译文之间切换，无额外请求；长按复制当前可见语言。
- 自动翻译失败时，本次会话的卡片显示失败与重试入口；缺副 API 时自动路径安静跳过，手动点击后说明需要配置哪类副 API。失败不写空缓存。
- 「系统设置 → 副 API 管理」可为心象翻译单独保存 URL、Key、Model。选择「沿用原有来源」时，优先使用完整配置的 `memoryPalaceConfig.lightLLM`；否则使用当前角色完整配置的 `emotionConfig.api`。两者都不可用时只提示配置副 API，绝不借用主 API。请求只带这一条心象原文和翻译指令。功能独立配置失败时不自动换模型。

## 存储与失效

成功结果放在宿主消息 `metadata.thinkingTranslation = { version: 1, source, text }`。`source` 是原始思考链的版本化指纹；展示前必须与当前 `thinkingChain` 重算匹配。原文、消息正文和时间戳不变。写入使用 `DB.updateMessageMetadata`，只在对应角色和原文仍一致时合并，且等事务提交成功。

旧备份无此字段仍正常显示原文；已有消息 metadata 备份可携带译文。替换或删除心象时清理缓存，其他编辑路径即使未清理也会因指纹不符而失效。译文只供 `MessageItem` 显示，不进入对话历史、记忆、主动消息或其他 App。

## 维护入口

`utils/thinkingTranslation.ts` 管语言判断、路由、请求、指纹和持久缓存；`apps/Chat.tsx` 管新消息事件和全局开关；`components/chat/MessageItem.tsx` 管显示、切换与手势；`components/chat/ThinkingChainSettingsModal.tsx` 管设置。

回归：`utils/thinkingTranslation.test.ts`、`utils/thinkingTranslation.ui.test.ts`、`utils/messageItemModuleLayout.test.ts`、`utils/applyAssistantPostProcessing.test.ts`、`utils/db.test.ts`。本功能不需要新 IndexedDB 表或版本升级。
