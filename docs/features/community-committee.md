# 居委会

本文是“居委会”的长期开发档案。修改现实两难开题、多人倾听、情绪剥笋提示词、议事总结、聊天卡或记忆写回前，同时阅读根目录 [`PRODUCT.md`](../../PRODUCT.md)、[`docs/memory-system-overview.md`](../memory-system-overview.md)、[`docs/features/debate.md`](./debate.md) 与 [`docs/features/life-replay.md`](./life-replay.md)。

## 档案信息

- 类型：独立 App。2026-10-16 起桌面入口暂时注释，功能、存储和写回都保留，优化后再放回桌面。
- 当前状态：第一版业务完成，等待真实 API 使用验收。
- 首版日期：2026-08-15。
- 首版提交：`9e0daff3 feat: add community committee app`。
- 最近迭代：2026-08-16，改为自由倾诉开题、AI 张力整理与原文直接召回。

## 最初开发需求

用户在现实生活中会遇到一种不能用“站哪边”解决的痛苦：两边各有各的道理，用户能够理解故事里的其他人，却仍然受伤、矛盾或需要独自承担后果。普通群聊可以让多个角色依次回复，但缺少稳定的引导结构，容易变成轮流安慰、立刻给建议，或者把现实议题拉成辩论。

“居委会”要把这种讨论做成可以长期迭代的专门 SOP：用户先写下困境及两边为什么都说得通，再选择 1—3 位已经存在的角色。用户逐层说出感受、自己如何理解别人、理解之后仍然痛在哪里；角色不裁决对错，而是倾听、共情并把问题往事实、承担、需要、恐惧、边界和可行动空间推进。结束后默认把克制总结发送到参与角色的主聊天并写入记忆，使角色之后知道双方共同走过这段现实讨论。

它与两个近邻功能的边界是：

- 不同于“辩论赛”：没有正反阵营、主持人评分、胜负或攻防；两边的合理性是需要同时保留的事实。
- 不同于“人生重映”：不进入过去场景，不演 NPC、过去的我或导演，不试图改变模拟历史；讨论对象是用户当前现实生活中的矛盾。

## 初版实现

### 用户流程

1. 首页说明用途、现实议题边界和默认写回规则，按更新时间列出所有进行中与已结案记录。
2. 新建时只有一个长输入框。用户可以按真实思路连续倾诉，想到另一边时直接另起一段，不必先决定它属于哪一方。
3. 独立开题整理员只读取这份原文，把矛盾整理为互相压过彼此的两股力量，并按原文段落返回 `a / b / both` 初始归属；它不读取角色记忆，也不裁决或解决问题。
4. 预览页采用“原文在上、两股力量在下”的品字形结构。用户点按任意原文段落，可以在第一边、另一边、两边拉扯三种荧光标记之间切换，再按顺序选择 1—3 位角色。
5. 用户确认后，原文直接保存为第一条用户 turn，并立即让所选角色接力回应；不再进入现场后要求用户重复“把事情放到桌上”。
6. 后续每次用户补充形成一个新的“剥笋层”。每条用户发言和每个成功角色回复立即保存；中途 API 失败时，本轮已经成功的内容不丢失，“继续”只请求尚未回应的角色。
7. 角色按顺序逐个回应：第一位接住情绪，后续角色补充尚未被看见的矛盾、承担或需要，最后一位负责收束。提问不是固定格式，只有确实比陈述更能推进时才问，且整条回复最多一个问题。
8. 用户主动点击“我想先停在这里，整理并写回”，独立记录员生成四段总结。report 先落库，再按参与角色逐个写入聊天与普通记忆；重试不会重复已有卡片。
9. 结案页同时显示最终落点与完整逐字倾诉。进行中和已结束记录都可以删除；删除本机会话不会撤回已经写入聊天或记忆的结案内容。

### 情绪剥笋 SOP

首版在 [`utils/communityCommittee.ts`](../../utils/communityCommittee.ts) 固定五层方向，但不是要求用户机械完成五道题：

1. **听见两股力量**：用户的开题原文已经在进入现场前保存；角色直接回应其中反复互相压过的两股力量，不要求用户重述，并确认“理解别人”与“自己仍然痛苦”可以同时成立。
2. **看看痛落在哪里**：区分真实发生的事、用户替别人做出的解释，以及最具体的刺痛。
3. **再往里面问一层**：探索可能被威胁的需要、期待、关系位置或恐惧；模型只能提出假设并询问确认。
4. **辨认边界与承担**：分开用户的责任、他人的责任、可协商部分和不必继续吞下的部分。
5. **把手伸向下一步**：形成低压力、可撤回的行动选项，也允许暂时不行动。

超过五轮后继续使用第五层，但角色仍必须回应用户新说出的内容，不能重复模板。每次回复限制为 120—260 个中文字；提问前必须判断此刻更需要理解、澄清还是推进，禁止为了格式在结尾机械加反问或问号，确有必要时整条最多一个问题。继续禁止咨询师腔、量表、舞台动作、急着解决、逼迫选边或为了证明有记忆而硬提旧事。

### 角色上下文与记忆

- 每位角色分别调用 [`buildChatRequestPayload()`](../../utils/chatRequestPayload.ts)，复用角色人设、用户档案、世界书、普通长期记忆、记忆宫殿召回和近期聊天；不创建 App 专属简化角色。
- `recallQueryHint` 聚焦本次困境、真正相关的共同经历、关系边界与彼此说话方式，并明确禁止捏造或强行搬入无关旧事。
- 每位角色只扮演自己，读取完整居委会公开 transcript，因此后一个角色能听见前一个角色本轮已经说了什么，并被要求补充而非复述。
- 独立议事记录员不调用 `buildChatRequestPayload()`，只读取开题内容和本次公开 turns；角色的其它私密记忆不会泄露到共同总结。

### 隐私与默认写回

- 困境原文、双方说明和逐字 turns 保存在本机 `community_committee` store；它们不会逐条进入聊天或普通记忆。
- 这个功能与默认私密的问卷、旅行不同：用户点击“结束倾诉”本身就是明确的结案与写回动作，不再增加第二个确认弹窗。
- 每位参与角色得到一条 `assistant / score_card`，metadata 为 `source: community_committee`、`communityCommitteeSessionId` 与 `type: community_committee_card`。
- 卡片只包含主题、双方合理处、参与者名字和用户已经确认的 report。`MessageItem` 负责可视化，`messageFormat` 与 `chatPrompts` 把它翻译成未来模型可读的共同经历，并明确完整逐字倾诉仍不可见。
- 普通记忆使用稳定 ID `mem-community-committee-<sessionId>-<charId>`；若角色启用且正确配置记忆宫殿，再异步处理最新聊天消息。单个角色失败不撤销已经成功的其他写回。
- `sharedMessageIds[charId]` 逐角色落库；服务还会按 session metadata 查找既有消息，覆盖“卡片已写入但 marker 尚未保存”的中断窗口。

### 安全边界

- 不做临床诊断、治疗承诺、人格定性或道德裁决。
- 不把“双方都有道理”偷换成必须和解、原谅、继续忍耐或各打五十大板。
- 不把模型推测写成事实；未得到用户确认的需要、动机和风险只能写为“可能、似乎、仍待确认”。
- 若用户描述当前正在发生的紧迫人身危险、自伤或他伤风险，角色停止继续深挖，优先建议联系身边可信任的人、当地紧急服务或专业支持。
- 首版不调用 MCP，不代替用户联系现实人物，也不声称已经执行任何现实行动。

### 数据、备份与恢复

- IndexedDB v81 新增 `community_committee`，主键为 session `id`。
- `CommunityCommitteeSession` 继续保存兼容旧会话的 `topic / sideA / sideB`，并为新会话增加可选 `openingText / openingSegments`；同时保存按顺序选择的 `charIds`、stage、全部 turns、report、生成时间和逐角色写回 marker。新增字段不要求升级 IndexedDB 或迁移旧记录。
- `utils/db.ts` 的完整对象备份字段为 `communityCommitteeSessions`；`context/OSContext.tsx` 的分 store 压缩备份也登记 `community_committee`。
- 首页按 `updatedAt` 新到旧排序；stage 为 `peeling` 时可继续，`summary` 时只读 report 和写回状态。

### 入口与界面

- AppID、图标、PhoneShell 懒加载、空闲/按下预取与安全区名单保留。桌面清单暂时注释，所以现在不出现在桌面，也不进入底部四个 Dock App。放回桌面后再参与长按换位。
- 视觉使用深青议事底、暖金主操作与冷白纸面；不复用辩论赛红蓝阵营和分数视觉。
- 开题页只保留一条主路径：自由倾诉 → AI 整理 → 段落换色 → 选人并直接召回。预览和现场都用原文在上、两股力量在下的品字形结构。
- 现场继续使用纵向剥笋时间线：用户层用暖色、角色回应用冷白与青色，越后的用户层轻微内缩，表达从外层困境向内层需要收束。新会话的开题原文只在顶部张力图显示一次，不在现场时间线重复；结案回看则完整显示全部 turns。
- 所有重要状态均有文字：空记录、无角色、1/3 选择计数、加载角色名字、部分回复失败、部分写回失败和已全部同步。

## 迭代与 Debug 记录

### 2026-08-15 · 首版业务完成

- 现象：普通群聊可以讨论现实困境，但缺少防止“立刻建议、争论对错、轮流重复安慰”的稳定流程，也没有默认结案写回。
- 根因：辩论赛和人生重映的主持人/导演结构都不适合现实两难；直接复用会分别把讨论推向胜负或场景演绎。
- 修复：新增独立现实议事 session、五层情绪剥笋方向、多角色接力提示词、逐回复落库、隔离总结和逐角色幂等写回；界面使用纵向剥笋记录而非赛场。
- 回归：`utils/communityCommittee.test.ts`、`utils/communityCommitteeService.test.ts`、`utils/communityCommittee.db.test.ts`、`utils/messageFormat.communityCommittee.test.ts`、`utils/safeAreaApps.test.ts` 共 9 项通过；6 组 Worker 与 Vite 生产构建通过。按用户偏好未做浏览器页面测试。
- 提交：`9e0daff3`（`feat: add community committee app`）。

### 2026-08-15 · 部分失败与角色删除恢复

- 现象：三位角色串行回应或写回时，中途失败可能导致已成功内容重复；未完成会话关联的角色后来被删除，也可能让“待回应”永远无法清空。
- 根因：单一 loading 事务无法表达逐角色成功进度；纯 session 仍保留被删除角色 ID。
- 修复：每个成功 turn 和 message marker 单独保存，重试只取当前轮未回应且仍存在的角色；写回再以消息 metadata 兜底去重。缺失角色不会阻止下一层或结案。
- 回归：纯逻辑续传测试和 service 幂等测试覆盖主要中断窗口。
- 提交：`9e0daff3`（`feat: add community committee app`）。

### 2026-08-16 · 自由倾诉开题与逐字回看

- 现象：三块开题输入要求用户不断判断内容属于哪一边，拆断原本互相承接的思路；进入现场后第一层又让用户重新说一遍，结案页则只剩最终落点。角色提示词虽然写了“最多一个问题”，接力职责仍会把最后一位固定推向问句。
- 根因：首版把 `topic / sideA / sideB` 同时当作用户输入结构和模型理解结构，并让 turns 从空数组开始；结案页已有完整 turns 却没有渲染；最后一位接力文案显式要求提问。
- 修复：用户改为单输入自由倾诉，开题整理员返回两股力量和段落归属，用户用荧光标记修正后直接把原文保存为第一轮并召回角色；现场使用品字形张力图，结案页完整回放 turns；角色提示词明确提问可省略且禁止机械问句结尾。
- 兼容：旧会话缺少 `openingText / openingSegments` 时，以旧 topic 生成只读顶部回退，原本的首条用户倾诉仍保留在时间线；原有三字段、总结卡、写回与备份格式继续有效。
- 回归：`utils/communityCommittee*.test.ts`、`utils/messageFormat.communityCommittee.test.ts` 与 `utils/safeAreaApps.test.ts` 共 5 个文件 10 项通过；6 组 Worker 与 Vite 生产构建通过。界面机械检查无发现。按用户偏好未做浏览器页面测试。
- 提交：`b74a8106`（`feat: streamline community committee opening`）。

## 当前状态与未完成项

- 已完成：桌面入口、单输入自由开题、AI 两股力量整理、原文段落换色、1—3 人有序选择、开题直接召回、统一上下文、多轮剥笋、非强制提问、逐条保存、部分失败恢复、隔离总结、默认聊天/普通记忆写回、记忆宫殿后处理、聊天卡、完整逐字回看、完整备份、历史与删除。
- 首版刻意不做：主持人评分、双方阵营、NPC/导演、MCP 执行、自动联系现实人物、临床诊断、未结束会话自动写回、完整逐字倾诉写入普通记忆。
- 仍需真实环境验证：不同模型是否稳定保持“最多一个问题”、三角色接力是否足够互补、长会话 summary 是否忠实、真实 API 部分失败后的继续按钮体验。
- 后续方向：可以在真实使用后增加用户可编辑的 SOP 模板、阶段手动回退/跳转、结案总结编辑、现实沟通草稿与“本次不写回”例外；这些都不在第一版提前搭空架子。

## 关键文件与接手入口

- 业务界面：[`apps/CommunityCommitteeApp.tsx`](../../apps/CommunityCommitteeApp.tsx)
- 状态编排：[`hooks/useCommunityCommittee.ts`](../../hooks/useCommunityCommittee.ts)
- 纯逻辑：[`utils/communityCommittee.ts`](../../utils/communityCommittee.ts)
- 上下文/API/写回：[`utils/communityCommitteeService.ts`](../../utils/communityCommitteeService.ts)
- 存储/备份：[`utils/db.ts`](../../utils/db.ts)、[`context/OSContext.tsx`](../../context/OSContext.tsx)、[`types.ts`](../../types.ts)
- 聊天卡/上下文：[`components/chat/MessageItem.tsx`](../../components/chat/MessageItem.tsx)、[`utils/messageFormat.ts`](../../utils/messageFormat.ts)、[`utils/chatPrompts.ts`](../../utils/chatPrompts.ts)
- 测试：`utils/communityCommittee*.test.ts`、`utils/messageFormat.communityCommittee.test.ts`、`utils/safeAreaApps.test.ts`

## 修改后的最小验证

```bash
pnpm vitest run utils/communityCommittee.test.ts utils/communityCommitteeService.test.ts utils/communityCommittee.db.test.ts utils/messageFormat.communityCommittee.test.ts utils/safeAreaApps.test.ts
pnpm build
```

涉及真实 API 时还要人工验证：单角色和三角色语气、第二/第三位不重复、用户轮中途退出恢复、角色回应部分失败、总结成功但写回部分失败、重复点击写回不增卡、角色在会话期间被删除，以及结束后主聊天能自然继续但看不到完整逐字倾诉。
