# 查手机 · 人际关系系统

> 给「查手机」(`apps/CheckPhone.tsx`) 的聊天能力：联系人簿、好感度、真假甄别、真角色之间双向同步对话、共同好友发现。AI 玩 AI 偷窥已独立为「智能体」子 App。
> 改这块逻辑前必读。公开版不能新建身份接管、自建身份代聊，或从被查手机向主聊天代发。

## 一句话

查 A 的手机时，TA 通讯录里的人可能是神经链接里**真实存在的角色 B**，也可能是按人设虚构的 **NPC**。真角色之间能背着用户私下对话，且对话会在双方手机里保持一致。
（AI 玩 AI / 智能体不在本系统内——那块单独做一个「智能体 App」。）

## 数据模型（`types.ts`）

通讯录、完整聊天原文和话题盒都存在角色的 `phoneState` 中，随完整备份 / 文字备份的 `characters` 分片一起导出与恢复，与 `sendToChat` 开关无关。仅媒体备份不包含聊天文字。真实对话异步完成时，`applyRealConversationToPhoneState` 必须在 `updateCharacter` 的函数式回调里基于最新状态合并，避免覆盖生成期间新增的其他联系人和记录。回归见 `utils/phoneConversationBackup.test.ts`。

- `PhoneContact`：联系人。新建联系人使用 `kind: 'real' | 'npc'`；`linkedCharId` 在 real 时绑定真实角色；`affinity`（机主对 TA 的好感，**-100..100**，负=反感）；`status: 'friend'|'pending'|'blocked'|'deleted'`。旧备份里可能还有 `kind: 'custom'` 和 `operatorIdentityId`，打开时只保留历史，不能再从这里代发。
  - `note`：**机主/用户手写的备注**——当「已确立的事实」用，prompt 里要求严格遵守，**不被自动生成覆盖**（见下）。
  - `learned`：**机主相处中「逐渐了解到」的认识**——由对话里 `[[了解:…]]` 累积而来。**和 note 分开**：这是「印象/判断」，来源是对方在聊天里自己说的，**未必属实**（对方可能在编）。
  - `topicBox?: ConvTopic[]`：**聊天话题盒**——这一侧第一人称、带主观色彩的「聊天记忆」，每聊满 100 条浓缩出一条；用作上下文（替代被归档的原文）。可长按改/删。
  - `archivedThru?: number`：**已归档原文条数水位线**——`record.detail` 里这之前的内容不再进上下文（只由话题盒代表），但原文仍保留供用户查看。
- `ConvTopic`：话题盒一条记忆（`text` 第一人称总结 / `createdAt` / `span` 浓缩了多少条原文）。
- `PhoneEvidence.contactId?`：聊天记录归属的联系人。`conversationTurns?` 是附加式结构化消息层；`detail` 继续是兼容文本表示。
- `CharacterProfile.phoneState.contacts?: PhoneContact[]`：机主通讯录。
- `CharacterProfile.phoneState.allowFictionalContacts?: boolean`：是否允许虚构 NPC（默认 true）。**关掉 = TA 只与神经链接里的真实角色来往**，生成时丢弃所有非真实联系人。

## 旧记录里的实际作者

公开版的真人对话只有双方自动回复。旧备份里如果已经存了 operator 回合，阅读时仍分开「世界里这条消息看起来是谁说的」和「系统记录的实际作者」。这些旧消息不会被改写成用户本人，角色上下文也不会把它们当成该角色自己说过的话。界面不再提供接管、冒充或代发入口。含旧 operator 回合的归档不会把代发总结成被冒充者的第一人称记忆。

## 输入契约（用户指定，统一用于所有生成）

每次为「指定关系人 X」生成内容时：

1. `ContextBuilder.buildCoreContext(char, user, true)`
2. 记忆宫殿（若 `memoryPalaceEnabled`）：`injectMemoryPalace(char, recent, /*queryHint*/ X.name, user.name)` —— **query 用对方的人名**。
3. 最近上下文：`loadCharacterContextMessages(char)`，与聊天共用「自适应 / 手动」和用户起点。自适应读取水位线后原文；手动可读取已归档的最近 N 条。

## 真人私聊模式（2026-09-27）

真人联系人聊天详情页的生成按钮上方提供「自由聊天 / 共同好友」轻量切换；NPC 不显示。每次点击仍是 A 发一次、B 回一次，不自动续跑。

- **自由聊天（默认）**：`runRealConversation` 未传 `mode` 与显式 `'free'` 等价；沿用原 prompt、动机、本人上下文、好感、`[[了解]]`、双方镜像与落库语义。
- **共同好友（`'mutual-friend'`）**：双方确实认识同一个 SullyOS 用户属于导演事实，不能成为角色初始知识。两侧使用同一套发现规则，各自只读本人角色上下文、与用户的私聊/记忆/印象和原先对联系人的资料；对方的用户私聊不会进入本人的 prompt。只有当前 transcript 中亲口交换的线索可以发生碰撞；不同称呼也可凭具体信息认出，证据充分时可确认，已确认后不得重复认亲。角色仍保留自身人格与日常话题，但未确认前每轮回复都应自然贡献一点辨认进展。
- **真实测试后的节奏修复（2026-09-29）**：曾出现双方聊到 100+ 条仍完全没有认亲。根因是原 prompt 的“不要太快认出 / 不要求本轮推进”强于隐藏叙事目标，使普通闲聊成为可无限重复的安全选择。现在明确要求每轮从本人真实资料中给出具体、高辨识度线索，或比较、熟悉、追问、确认；泛泛赞美或“最近很忙”不算有效线索。回复前要求模型内部比对已经交换的信息，但不输出分析。按当前 A↔B transcript 的**连续说话人块**计算非持久化软节奏：起步给线索，约 2—4 个往返开始比较试探，约 4—8 个往返主动收束，更久则明确验证；同一人连发多行只算一个块，不将轮数写成硬性剧情脚本。已明确认亲后停止初次认亲压力。这个提示不新增 DB 字段、recognition state 或额外 LLM 调用。
- **发现隔离仅用于 prompt**：临时 `user` view 将名字改为内部占位符 `【你认识的那个人】`、清空 `bio`，最近用户消息标签改为「那个人」，同时覆盖 ContextBuilder 的结构标签和 `{{user}}` 展开。占位符不能说出口或充当证据。原有聊天、世界观和记忆正文中的姓名、昵称、经历照原文保留，不做全局替换；不修改全局 ContextBuilder。
- **召回不污染角色**：共同好友先复制 speaker 并清空 `memoryPalaceInjection` / `roomPlatesInjection`，只在副本上召回与构建上下文。真实角色的注入字段、用户档案不被临时代称覆盖；自由聊天仍走原对象链路。
- **不新增 learned**：共同好友可以读旧 `contact.learned`，但不要求产出新了解；模型意外输出的 `[[了解:...]]` 仍剥离，`aLearnedNew / bLearnedNew` 恒为空。好感、status、note、identity、topicBox 与 archivedThru 继续沿用既有机制；真人共享私聊的 phone_card / sendToChat 规则见下节。
- **按角色对持久化**：`utils/realConversationMode.ts` 在 `cp_real_conversation_modes_v1` localStorage map 保存偏好，key 为 `[aCharId, bCharId].sort().join('::')`，A→B 与 B→A 共用，不同 pair 独立。默认自由聊天；读取损坏/失败回退默认，写入失败仍可按当前 UI 选择聊天。模式不进 CharacterProfile、phoneState、DB 或完整/文字备份，无迁移。
- **清空重跑**：现有清空函数仍删除双方 chat record / phone_card、清 topicBox / archivedThru，保留模式、联系人及旧 learned/好感。共同好友本轮不会留下新的 learned 认亲事实；无 recognitionStage / recognizedUser 等持久状态，是否已认出由现有对话原文与既有归档表示。

### 真人共享私聊同步到主聊天

普通自动真人 A↔B 私聊是一项双方共同发生的共享事件。是否同步到双方主聊天，由本次查手机会话的 `targetChar.phoneState.sendToChat` 在生成开始时统一决定：开启则 A/B 各写一张自身视角的 `phone_card`，关闭则双方都只保留手机 records、不写新的主聊天卡片。B 自己此前的 `phoneState.sendToChat` 不参与这次共享事件的判断；编辑普通真人对话时也沿用当前 target 的同一规则刷新双方卡片。普通单角色手机内容、NPC 聊天和手工事后同步仍按原有单角色规则处理。

这样可避免真实角色 B 在 A↔B 私聊中形成的新认知或情绪只存在于双方手机镜像里，却没有进入 B 与用户的主聊天上下文，造成跨 App 连续性断裂。双方卡片仍保存各自视角的完整文本；续写会分别删除 A/B 的旧完整卡片，再把各自 record 更新为新卡片的 `systemMessageId`。清空联系人聊天继续读取双方 record 的 ID 删除对应卡片，并按原规则删除 records、清空 topicBox / archivedThru。旧 operator 回合只按上面的阅读规则保留，不会再被写成新的代发。

### 代码验证与人工验收

`utils/realConversationMode.test.ts` 与 `utils/relationshipChat.mutualFriend.test.ts` 覆盖角色对偏好、存储异常、UI 接线/清空边界、缺省与显式 free 等价、统一用户名隔离、双方私聊隔离、真实正文保留、召回副本、好感/镜像和 learned 剥离；共同好友还覆盖开场、发展、收束、明显拖延及已认亲后的 prompt。代码测试使用 mock LLM，不调用真实付费 API，也不代替模型表现的人工验收。

人工验收（待用户执行）：

1. 选两个不同世界观角色，默认「自由聊天」生成，确认原有表现；NPC 页面应没有模式开关。
2. 切「共同好友」点击一次，确认只有一个 A+B 往返；允许尚未发现，不应凭统一系统用户名第一句宣布认亲。
3. 手动连续点击几次，观察前几轮是否出现具体人物线索，约 2—4 个往返是否开始怀疑/试探，约 4—8 个往返能否自然确认；这只是体验目标，不是硬性脚本。已确认后继续聊不能重复认一次。
4. 使用不同称呼（例如一侧「广陵王」、另一侧昵称），观察通过经历/习惯等信息仍有机会认成同一人。关闭再打开、从 B 手机查看 A，模式应保持；换另一 pair 应独立。
5. 认亲后「清空这段对话」，确认双方原文/卡片/话题盒清空、水位线归零，模式仍为共同好友，两侧了解没有本模式新增的认亲事实；再次点击可重新开始。已有旧 learned/备注按原规则保留。

## 能力

| 能力 | 说明 | 入口 / 代码 |
|---|---|---|
| **联系人骨架** | 联系人模型 + 生成时注入真实角色名单做 **real/npc 甄别** + 通讯录 UI（好感条 / 备注 / 手动加删拉黑 / 虚构约束开关）+ 扫描通讯录 | `CheckPhone.handleGenerate('chat'\|'contacts')`、`renderContactsList` / `renderContactDetail` |
| **虚构约束** | `allowFictionalContacts` 关掉后，生成只取真实角色、丢弃所有 NPC —— TA 只和神经链接里的角色来往 | `CheckPhone.toggleAllowFictional`、`handleGenerate` 的 `fictionRule` |
| **真角色双向对话** | **双 LLM**：A 用 A 的 context 发、B 用 **B 自己的 context + 记忆宫殿(query=A 名) + B 的 contextLimit** 回。默认 **1 个往返 = A 发 1 次 + B 回 1 次 = 正好 2 次 LLM 调用**（`rounds` 可调）。好感变化折进各自回复末尾的 `[[Δ:+N]]`，解析后剥掉，**不再额外调用**。镜像进 B 的 `records`；本次共享事件是否写入主聊天只读取当前查手机 target 的 `sendToChat`，开启则 A/B 各写自身视角卡片，关闭则双方都不写。好感 -100..100，跌破 -60 角色自动删友、升过 +60 自动加回，变动播报进机主私聊 | `utils/relationshipChat.ts:runRealConversation`、`utils/phoneConversationSync.ts:commitRealConversationSide`、`CheckPhone.handleRealConversation` / `commitConversationSide` |
| **旧代发记录** | 不再提供接管、冒充或向主聊天代发。旧 structured turn 仍按原投影阅读，避免把历史代发改写成用户或角色本人 | `utils/phoneConversationProvenance.ts`、`utils/operatorMessageProvenance.ts` |
| **虚构 NPC 对话** | 机主按人设脑补出不存在的人，单 LLM 分饰两角生成聊天脚本（不镜像、不涉及真实角色） | `utils/relationshipChat.ts:runNpcConversation`、`CheckPhone.handleNpcConversation` |
| **用户删好友 → char 知情** | 用户在查手机里手动删好友/拉黑时，往机主私聊落一张 **`phone_card` 关系变动卡片**（`kind:'relationship'`，💔/🚫）：聊天里渲染成卡片、`content` 又带进角色上下文，让角色察觉「是用户干的」。角色自身的好感驱动增删则照常自发发生 | `CheckPhone.handleSetContactStatus`、`MessageItem.tsx` phone_card `relationship` 分支 |
| **真实时间感知** | 当前真实日期/星期/时段/时间统一在 `ContextBuilder.buildCoreContext` 注入，受 `char.timeAwarenessEnabled` 控制（**默认开**）。所有走 buildCoreContext 的路径（私聊/查手机/人际关系/通话/约会…）都有时间观念；关掉则全部不注入。同一段里还跟着一句分寸框定：时间是背景，话题聊到哪儿由对话本身决定（这句话在 `utils/timeFramingNote.ts`，即时对话在云端补时间时引的是同一份）。跟着一起收的还有另外两块会报钟点的注入：天气块的 `includeTime`、日程块的 `includeClock`，免得关掉之后钟从旁边漏出去。主动消息的排程清单不收——那是角色自己排的待办，看不见就会重复排同一件事 | `utils/context.ts` buildCoreContext「当前时间」块 |

## 备注 vs 了解（两份不同性质的「认识」）

| | `note` 备注 | `learned` 了解 |
|---|---|---|
| 谁写的 | 用户/机主**手写**（`handleSaveNote`） | 角色对话里**自动产出**（`[[了解:…]]`） |
| 性质 | **已确立的事实**，必须遵守 | **印象/判断**，来源是对方自己说的，**未必属实** |
| prompt 注入措辞 | 「必须当作真实情况严格遵守，不得与之矛盾」 | 「凭相处得来的印象，未必属实，可作参考别当铁证」 |
| 会被自动改吗 | 不会（`upsertContact` 保留已有非空 note） | 会累积（`appendLearned`，去重 + 留最近 8 条） |
| UI | 「备注」卡（可编辑） | 「了解」卡（虚线、只读、可一键清空） |

> 想让角色「认得」某人、按某关系演，写 **备注**；想看角色在交往里**自己摸索出的（可能被骗的）认识**，看 **了解**。

## 对话里的内联指令（写在回复末尾，引擎解析后剥掉，不再额外调 LLM）

- `[[Δ:+N]]` —— 这段说完后说话人对对方的**好感变化**，N 为 -20~20 整数；没变写 `[[Δ:0]]`。`extract()` 累加并钳制。
- `[[了解:一句话]]` —— 说话人这次**新认识到**的关于对方的事（身份、在意什么、透露的关键信息…）。`extract()`（真人）/ `runNpcConversation`（NPC，从整段输出里抠出）解析出来，经 `appendLearned` 写进**说话人对对方**那条联系人的 `learned`。没有新认识就不写这行。
  - 真人双向：A 学到的进「A→B」的 learned，B 学到的进「B→A」的 learned，各记各的。
  - NPC：脑补出的设定也回写 learned，**让同一个虚构的人下次保持一致**。

## 动机（让「主动发消息」事出有因）

A 发起 / NPC 推进的 prompt 里给了一份**具体动机清单**（好奇这人怎么会在通讯录里、寒暄水聊、求助、打听/试探身份、报备近况、不满对峙…），可任选一种或几种，并要求：**贯彻动机、前后一致**，别「明明自己找上门却突然卑微讨好或反过来阴阳怪气」。角色被强调为**完整独立人格**，回应方也基于自身立场（不一味迎合、不无故敌对）。

## 话题盒 · 100 条总结归档（上下文压缩）

真人 A↔B 私聊会越聊越长，原文整段重喂会撑爆上下文。机制：

- **触发**：每聊满 `ARCHIVE_EVERY = 100` 条（气泡/行，非轮），`maybeArchiveConversation` 把待归档的那 100 条原文，**A、B 各自第一人称**浓缩成一条 `ConvTopic`（`summarizeConversation`，各一次 LLM），分别进各自 `topicBox`，`archivedThru += 100`。
- **上下文**：之后喂给 `runRealConversation` 的不再是整段原文，而是 `existingTurns = 近段未归档结构化消息`（水位线之后）+ `aSummary/bSummary = topicText(该侧 topicBox)`。即 **A 拿到「a 的话题盒 + 按 A 视角投影的近段」，B 拿到「b 的话题盒 + 按 B 视角投影的近段」**；旧数据会先从 detail 物化。
- 共同好友本轮只加强未归档 transcript 中的自然推进，不改话题盒 summarizer。若加强后仍频繁达到 100 条未认亲，再单独评估细微怀疑线索在归档中的保留。
- **原文不丢**：完整 turns 仍存在 `record.conversationTurns`，同时序列化整段 `record.detail` 供旧路径阅读；`handleRealConversation` 把归档 turns 与本轮结果拼回后落库，归档只影响**进上下文**的部分。
- **镜像一致**：A 存完整 `aFull` 后 `bFull = flipTranscript(aFull)` 给 B，两边原文一致；`archivedThru` 双方同步推进。
- **用户可改**：话题盒在资料抽屉「备注」下面，**长按某条记忆 → 改写 / 删除**（`topicEdit` + `Modal`）。删一条 = 角色忘掉那段总结（原文仍在，但不再进上下文）。`topicText` 进上下文时默认只取最近 10 条防膨胀。
- **优雅降级**：不满 100 条时 `archivedThru=0`、`topicBox` 空 → `existingDetail=整段`、无总结块，行为与历史完全一致。
- **NPC 暂未接**：`runNpcConversation` 仍喂整段（单视角），后续可同法接入。

## 真假甄别怎么做的

生成 `chat` / `contacts` 时，把**神经链接里其他真实角色名单**注进 prompt，要求 LLM 对每个联系人输出 `kind`（real/npc）+ `linkedName`。落库时再用 `matchRealChar()` 对名字做精确/包含兜底匹配，命中即绑定 `linkedCharId` 并置 `kind:'real'`，防 LLM 漏标。

## 关键文件

| 文件 | 职责 |
|---|---|
| `utils/relationshipChat.ts` | 联系人纯函数 + 对话引擎（`runRealConversation` 双 LLM / `runNpcConversation` 单 LLM / `summarizeConversation`） |
| `utils/phoneConversationProvenance.ts` | 旧 detail 物化、structured turns 序列化/镜像，以及旧记录的阅读投影 |
| `utils/phoneConversationSync.ts` | 真人双方函数式落库与 phone_card |
| `utils/operatorMessageProvenance.ts` | 识别旧代发 metadata，避免角色把它当成自己的发言 |
| `utils/relationshipChat.test.ts` | 纯函数单测 |
| `apps/CheckPhone.tsx` | 通讯录 UI + 全部 handler + 落库/镜像 |
| `types.ts` | `PhoneContact`（含 `note` / `learned` / `topicBox` / `archivedThru`）/ `ConvTopic` / `PhoneEvidence.contactId` / `phoneState.contacts` |

## UI 命名

- 该系统在「查手机」首页的入口卡叫 **「联系人」**（占据原 Message 主卡位）；旧的 Message 一对一聊天已废弃，收进「联系人」页里做一个不起眼的「旧版聊天归档」入口。内部代码/上下文里仍可能出现「人际关系」字样（语义等价）。

## 对话脚本格式（重要 · 多行不丢/不错位）

- `detail` 继续统一为「我:/对方:」逐行兼容格式。多行正文序列化时每行补前缀。旧 structured turn 的作者标记不会因展示拆行而丢失。
- 解析一律走 `parseTranscript()`：无前缀的续行**继承上一条说话人**，不会被误判给对方（修复「A 发的消息 UI 分给 B」）。渲染（`renderChatDetail`/`renderContactDetail`）、翻转（`flipTranscript`）、续写回解析都用它，保证无损。
- 模型或旧备份的脚本可能是数组/对象，不能直接 `.split()`。`phoneTranscriptToText` 保留字符串、兼容逐行数组和带 `role/content`、`speaker/text`、`isMe/text` 的消息；未知对象保留可读字段。智能体（含深度对话）的生成落库、历史会话读取和编辑回写统一经过 `normalizePhoneAiSession`，`parseTranscript` 也有兜底，避免一条异常记录拖垮列表；不要求用户删除原记录。
- `upsertContact` 合并时**只覆盖有值的字段**，且不动已有非空 `note`——扫描通讯录/对话回填不会把用户手填的备注抹掉（修复「角色不看备注」）。备注在 prompt 里以「必须遵守的已确立事实」注入。

## 注意

- `runRealConversation` 续写**只喂近段未归档 structured turns** + 话题盒总结；`handleRealConversation` 落库前把归档 turns 拼回去，同时替换 `conversationTurns` 与兼容 `detail`（**存的是完整原文和 provenance**，进上下文的才是压缩版）。
- `runRealConversation` 同时把好感 `[[Δ]]` / 了解 `[[了解:]]` 折进各自回复解析；总结归档是**另一步**（`maybeArchiveConversation` 在落库后按 100 条触发，单独 LLM）。
- 镜像写入对方 B 用的也是 `updateCharacter(b.id, …)`（函数式合并），不会覆盖 B 的 simLogs。
- 好感变化由 A/B 各自在回复末尾用 `[[Δ:+N]]`（-20~20）带出，`extract()` 解析并剥掉标记 —— 不另开 LLM 调用；模型没给则 delta=0。`[[了解:…]]` 同理（同一次解析里一起抠出）。
- `learned` 始终以「未必属实」的措辞注入，**别在别处把它当事实用**；要表达确定事实请走 `note`。
- 角色**自发**的关系变动（好感阈值触发自动加删友）会播报「我把 XX 删了」进机主私聊；**用户手动**删/拉黑则落 `role:'system'` 提示让角色知道是用户干的 —— 两者区分开。
- `phone_card` 同步到主聊天时只负责落卡片并进入后续上下文，不会在「查手机」App 内额外触发一次主聊天 LLM（避免用户只是浏览手机就被自动计费）。用户回到主聊天发送或引用回复后，卡片全文会随最近历史一起送给角色；`utils/chatPrompts.phoneCard.test.ts` 锁住这条链路。
