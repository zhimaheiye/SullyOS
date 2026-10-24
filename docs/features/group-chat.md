# 主聊天最近会话与群成员知识隔离

## 功能边界

本功能扩展现有 `Chat` 与 `GroupChat`，不创建新的 App、数据库表或主题系统。UI 参考 Ardot 文件 `719473023695597` 的五个屏幕：主聊天新增列表按钮、最近会话、群信息成员区、邀请成员和移除成员。

明确不做：群聊未读、未读持久化、置顶、搜索、会话删除、浏览器自动化验收，以及把加入前或离群期间的群史补发给角色。

## 产品交互原则

- “最近会话”是现有主聊天上的**第二条入口**，不是新的默认首页。普通打开 Chat 仍直接进入当前/上一次私聊，最近会话只通过聊天顶栏入口或来源感知返回进入；不要为了更像微信而把桌面聊天入口改成会话列表。
- 原“切换会话”面板继续保留，承担快速切换私聊角色；最近会话承担“按最近消息浏览私聊 + 群聊”的总览，两者互补而不是互相替换。这是为保留既有操作习惯做的刻意兼容。
- 独立 `GroupChat` App 继续保留。最近会话只读取同一份 `groups` 与消息数据，不复制群或另建会话实体；从独立群聊 App 新建的群会自然出现在最近会话中。
- Ardot 设计稿中的姓名首字头像只是视觉占位。运行时应优先显示 `CharacterProfile.avatar` / `GroupProfile.avatar`（当前 UI 通过 `TokenImg` 渲染），只有缺少真实头像时才回退首字/生成头像。

## 最近会话

- 入口位于主聊天顶部闪电按钮左侧，使用无内横线的粗体消息气泡；尺寸、按钮色与闪电动作按钮保持一致，并共享 `.sully-chat-trigger` 钩子以随顶栏和自定义聊天 CSS 同步变化。
- 私聊仅在存在聊天界面可见消息时出现；群聊始终出现，空群以创建时间参与排序并显示“暂无消息”。
- 私聊和群聊按最后一条可见消息时间倒序混排。图片、语音、表情、卡片和媒体引用只显示类型摘要，不把 URL、data URL 或 blob 引用放进预览。
- IndexedDB 通过 `charId` / `groupId` 索引的倒序游标查找最后一条符合条件的消息，不为列表读取完整消息表。
- 导航保留来源：最近会话进入私聊或群聊后返回最近会话；直接打开群聊 App 时仍走原有群列表。

### 私聊未读与实时刷新（2026-08-29 首次落地：`71865e69`）

- 这次迭代的产品目标是让最近会话从“静态排列页”变成真正可收件的入口：角色在用户没打开其具体私聊详情时发来消息，列表应立即显示未读、更新预览/时间并按最新时间重排。
- 最近会话直接读取 `OSContext.unreadMessages`，数字与原“切换会话”面板保持 `1…99+`；群聊不读取或显示未读。
- `ChatViewSnapshot` 的角色 ID 只表示当前真正可见的私聊详情。停留在最近会话时快照为 `chatOpen=true, charId=null`，最后选择的 `activeCharacterId` 不再被误判为正在阅读。
- 打开最近会话不会清未读；从最近会话、切换角色、通知或桌面入口真正进入私聊详情时，统一调用现有 `clearUnread(charId)`。
- `lastMsgTimestamp` 只负责触发最近会话重新使用 IndexedDB latest cursor 查询，因此页面停留期间预览、时间和 timestamp 排序会随消息落库更新，不从历史反推未读。
- 未读继续只保存在 React runtime state，刷新或重启后清空；不新增 store、index、DB 版本或 `lastReadMessageId`。

## 群成员管理

- 群设置顶部显示用户、当前 AI 成员、邀请和移除入口；成员数包含用户。
- 邀请页只列出未入群角色并支持多选；移除页只列当前 AI 成员并支持多选。
- UI 与状态层都强制至少保留 1 名 AI；无效或已在群的角色 ID 不会被加入。
- 成员变更继续保存完整 `GroupProfile`，现有完整备份中的 `groups` 自动携带新字段，无需新增 store、index 或 DB 版本。

## 成员可见窗口

`GroupProfile.memberVisibilityWindows?: Record<charId, GroupMembershipWindow[]>` 是唯一成员历史来源。窗口字段：

- `joinedAfterMessageId`：严格大于该消息 ID 的群消息才可见。
- `leftAtMessageId?`：存在时，小于等于该消息 ID 的内容可见；更晚消息不可见。
- 再次加入追加新窗口，不合并离群空窗期。

旧群没有该字段时，当前成员按 `[{ joinedAfterMessageId: 0 }]` 读取；首次成员变更时写回完整窗口。若旧话题盒没有 `deliveredMemberIds`，同一时刻把变更前的当前成员固化为旧盒子收件人，避免新成员继承旧总结。

## 知识隔离路径

统一 helper 位于 `utils/groupChat/membership.ts`，以下路径必须使用同一窗口判断：

- 私聊提示词中的近期群活动，包括主动消息复用的 Chat prompt / fire pack。
- 群聊轮流回复的历史、世界书触发、成员合并时间线和记忆宫殿检索查询。
- Director 模式保留导演私有全局记录，但每个角色块只提供该角色可见群史和话题盒，并带最高优先级禁止泄漏规则。
- 话题盒按连续的可见成员集合分段总结，只把卡片投递给该段成员；全局高水位仍按原批次推进。
- 群记忆宫殿按同样的成员集合分段提取，只写入当时可见且启用记忆宫殿的角色。

删除群仍会扫描所有角色并清理该群旧话题盒卡片和群记忆，因为退群角色也可能持有合法的历史副本。

## 关键代码与验证

- UI：`components/chat/RecentConversationsView.tsx`、`components/groupChat/GroupInfoMembers.tsx`、`components/groupChat/GroupMemberPicker.tsx`
- 状态与导航：`context/OSContext.tsx`、`apps/Chat.tsx`、`apps/GroupChat.tsx`
- 数据与隔离：`utils/db.ts`、`utils/conversationList.ts`、`utils/groupChat/membership.ts`、`utils/groupChat/topicBoxes.ts`、`utils/memoryPalace/groupPipeline.ts`
- 回归：`utils/conversationList.test.ts`、`utils/conversationNavigation.wiring.test.ts`、`utils/groupChat/membership.test.ts`、`utils/groupChat/topicBoxes.test.ts`、`utils/groupChat/prompts.test.ts`、`utils/memoryPalace/groupPipeline.test.ts`

浏览器 UI 测试不属于默认验证范围；修改后至少运行上述定向测试、整仓 Vitest、TypeScript 检查和 Vite 生产构建。

## Debug 记录：私聊与群聊保留历史阅读位置（2026-09-27）

- 根因：原私聊在消息 ID、流式正文和媒体加载变化时直接滚到底；群聊也在消息变化时无条件滚动。刷新只保留最近固定条数，还可能把用户已加载的历史从 DOM 中移除。
- 两个聊天页共用 `hooks/useChatScroll.ts`，以距底部 96px 判断是否继续跟随。向上阅读会暂停跟随；普通更新、流式增长、图片加载和输入面板尺寸变化仅在跟随状态下贴底。滚轮、触摸及键盘向上意图也会取消按钮触发的平滑跳转。
- 暂停期间，只有超过本会话消息 ID 高水位的角色消息、或实际变化的非空私聊流式正文触发主题色「↓ 新消息」按钮；自己发送、历史 prepend、状态提示及旧消息编辑/删除不触发。按钮不计数、不持久化，也不参与现有最近会话未读。手动滚回底部或点击按钮恢复跟随并清除提示；多选期间隐藏按钮。
- 自己在历史窗口发送时保留窗口与阅读位置。按钮复用私聊 `handleBackToCurrent` 返回最新；进入或重新进入会话重置为跟随最新。普通 prepend 在 DOM 更新前记录高度与 scrollTop，更新后补偿高度差；既有收藏历史窗口的锚点流程继续使用原实现。
- 私聊/群聊近期查询增加可选 `keepFromId`，暂停阅读时保留当前可见的最早消息，避免后续刷新裁掉阅读位置；未传参数仍走原固定条数契约。不改变 DB schema、Worker、模型协议或版本号。
- 已有检查：首次整仓 Vitest **559/560 文件、6003/6004 项通过**，唯一失败是旧图片滚动接线断言依赖已移除实现，已改为检查共享 hook 与 ResizeObserver 接线，尚未复跑。开发过程中整仓 TypeScript 零诊断；随后的小幅收尾修改未复跑。用户明确要求停止后续验证，未执行生产构建。
- 在隔离本地数据和模拟 API 下，已观察私聊历史阅读时自身发送/连续角色消息/流式生成保持位置、流式中途上滑暂停跟随、普通 prepend 锚点补偿、延迟图片与输入面板变化、收藏历史窗口发送与按钮返回，以及群聊自身发送/输入状态/连续角色回复。群聊 prepend、完整会话切换/重入和多选/表情面板场景未完成验收；不宣称全场景通过。临时测试页、模拟服务器及浏览器页已清理，未调用真实付费 API。

## Debug 记录：最近会话入口触发 Hook 数量变化（2026-08-28）

- 现象：主聊天初次进入正常，点击顶部最近会话按钮后由错误边界捕获 `Rendered fewer hooks than expected`。
- 根因：`Chat` 在 `chatView === 'recent'` 时提前返回，但两个聊天样式 `useMemo` 仍位于该返回之后；从私聊切到列表时，同一组件本轮执行的 Hook 数少于上一轮。
- 修复：把两个既有 `useMemo` 移到所有条件返回之前，不改变最近会话、聊天样式或导航业务；接线回归同时约束最近会话返回必须位于最后一个 Chat Hook 之后。
- 验证：最近会话与群成员专项 6 文件 24 项通过，`storageOptimize` 独立 84 项通过，Vite 生产构建通过；整仓 TypeScript 仍只有既有无关诊断。按项目约定未执行浏览器测试。
