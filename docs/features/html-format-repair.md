# 私聊 HTML 卡片快速修复格式

## 需求与边界

这是用户在私聊历史消息的“消息操作”里手动点击的本地修复，不是未来回复的自动解析策略。群聊、HTML 模式设置、提示词和模型生成流程不变；点击不会调用 AI。所有私聊消息都显示“快速修复格式”入口，真正是否可修由解析器在点击后判断。

交互刻意保持“一键修复”：
- 不先弹预览或确认框；
- 已经是 `html_card` 时只提示“这条消息已经是 HTML 卡片”；
- 没检测到完整可恢复结构时只提示“未检测到可完整恢复的 HTML 卡片内容”，原记录不改；
- 成功后直接按实际卡片数提示结果；
- 当前角色即使已经关闭 `htmlModeEnabled`，历史修复仍然允许执行。

这个能力只负责恢复**已经真实保存在消息里的完整源码**。源码真实缺失时不调用模型补写、不根据样式猜结构，也不把“重新生成内容”伪装成“格式修复”。

## 典型故障形态与修复优先级

最常见的故障不是源码真的断掉，而是模型输出了一整份完整 HTML/CSS，却忘了外层 `[html]...[/html]`，于是整份源码作为**一条很长的普通 `text` 消息**显示。用户滚到长消息中段时，界面可能只看到 CSS 后半截或 `</style>`，不能据此判断数据库里的起始标签已经丢失。

因此 planner 的第一优先级始终是**先检查被点击的这一条消息本身**。如果单条已经包含完整可恢复卡片，就只修这一条，不为了“保险”吞并相邻普通对话。

跨消息恢复只是第二层兜底：只有选中的 assistant 文本本身不足以形成完整卡片、而相邻连续文本能共同证明完整结构时，才向前后扩展。当前实现要求同一角色、同一 role、私聊普通 `text`，排除撤回和已经修复过的复合消息；相邻时间差不超过 120 秒，并把搜索限制在点击位置附近最多 8 条范围内。用户或 system 消息第一版只做单条修复，不跨条合并。

如果同一次连续回复里存在多张完整卡片，点一次就修复当前可可靠识别到的全部卡片；如果完整卡和真正残缺源码同时存在，完整卡可以修，残缺部分继续作为普通文字保留。

## 识别

`utils/htmlFormatRepair.ts` 从真实原文提取有序的文字和 HTML 片段。接受：

- 完整的 `[html]...[/html]`；
- ```html ... ``` 代码围栏；
- 以 `div/html/section/article` 为根的裸 HTML；
- “普通台词 + HTML + 普通台词”；
- 同一回复里的多张完整 HTML 卡片；
- 能由连续 assistant text 真实拼回完整结构的跨条碎片。

解析器逐个扫描原始开始/结束标签，要求严格配对；不以浏览器自动补全的 DOM 作为完整性证明。普通 Markdown 围栏、语音/翻译标记、Tavern 状态 XML 和缺失开头或闭合的源码不转成卡片。破损外层里即使有一个内部 `<div>...</div>` 恰好闭合，也不会把内部片段擅自提升成卡片。

“普通台词 + HTML + 普通台词”必须保持原字符顺序，例如：

```text
给你看：
<div>...</div>
怎么样？
```

修复后仍是：

```text
给你看：
[HTML 卡片]
怎么样？
```

普通台词不能被塞进 iframe、删除或移动到对话末尾。

## 持久化与上下文

单张纯卡原地更新原 `Message` 为 `html_card`，保留 id、时间、role、引用和旧 metadata。混合文字、多卡或跨消息结果仍使用最早参与消息作锚点，`metadata.htmlRepairSegments` 按原顺序持久化文字/卡片片段；`MessageItem` 里的所有视觉片段共用锚点消息的菜单、选择、删除和引用行为，卡片继续用 `HtmlCard`。

这种锚点方案是为了避免“删除旧消息再 `saveMessage()` 多条新消息”导致新自增 id 跑到聊天末尾，并避免破坏引用、历史边界、搜索跳转和记忆宫殿高水位等按消息 id 建立的关系。

`content` 存语义摘要，`messageFormat` 依次输出普通台词和 `[HTML卡片]` 预览，不读 HTML 源码或 provenance。这样聊天上下文、归档和记忆宫殿看到的是用户实际看到的语义顺序，而不是整份 CSS/HTML。

`metadata.htmlFormatRepair` 保存原文、来源 id 和修复时间供本机追溯；这些 raw source 只作本地证据，不进入模型上下文。

`DB.applyHtmlFormatRepair` 在单个 `messages` readwrite transaction 中重新校验每个 source 的当前内容、类型、角色与状态，再更新锚点并删除已完全并入锚点的碎片；任何一项变动或失败都会整笔回滚。邻居读取使用 `getMessagesByCharId(charId, true)`，包含记忆宫殿高水位之前的旧消息。

无需新 store、数据库版本或特殊备份路径；现有 messages 备份自然带上修复结果。

## 为什么保持手动而不是自动兜底

仓库原本已经有 `looksLikeBareHtml()` 这类“看起来像裸 HTML”的启发式，但本功能没有把它接进未来回复的自动后处理。原因是这里处理的是**用户已经确认看见掉格式后的历史修复**，可以采用更保守的完整性校验；而自动把未来普通文本识别成 HTML 卡片会扩大误判面。

因此后续维护时不要把“快速修复格式”顺手演变成“所有裸 HTML 自动转卡片”。如果要改变未来生成链路，应作为单独需求重新评估。

## 接手入口

主要实现：
- `apps/Chat.tsx`：右键/长按菜单动作、读取完整私聊历史、执行 plan、toast；
- `components/chat/ChatModals.tsx`：所有私聊消息都显示“快速修复格式”；
- `components/chat/MessageItem.tsx`、`components/chat/HtmlRepairComposite.tsx`：纯卡和有序复合片段渲染；
- `utils/htmlFormatRepair.ts`：严格源码解析、单条优先、跨消息 plan、多卡处理；
- `utils/messageFormat.ts`：上下文只输出普通台词与卡片文字预览；
- `utils/db.ts`：`applyHtmlFormatRepair` 原子改写与 stale plan 防护。

回归：
- `utils/htmlFormatRepair.test.ts`
- `utils/htmlFormatRepair.render.test.ts`
- `utils/htmlFormatRepair.wiring.test.ts`
- `utils/htmlCard.test.ts`

现有回归已经锁定“一条完整裸 HTML 长消息”这一主场景、混合文字、多卡、跨三条 assistant 消息、残缺拒绝、协议标签防误判、HTML 模式关闭仍可修、原子事务和复合渲染顺序。
