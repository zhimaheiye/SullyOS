# 笔友会：小说共创与写作人格

## 档案信息

- 类型：现有 App 子模块（笔友会 / Novel）
- 当前状态：可用
- 首版来源：上游早期已有；本次归档未把“笔友会首版”错误归因到某个后续功能提交
- 本 fork 关键迭代：2026-08-28
- 当前复核基线：2026-10-01 的本仓库实现（开发期提交号不随公开历史提供）
- 上游对照：2026-10-01，`qegj567-cloud/SullyOS@29ec8257`；上游当前 `NovelWriter.tsx` / `novelUtils.ts` 尚不含本文三组 fork 修复
- 最近迭代：
  - `e0c8275d` — complete novel generation modes
  - `31dd2612` — separate novel fiction from character memory
  - `cac85ebc` — isolate writer persona from user context

> 当前代码是事实源。本文记录的是本 fork 需要长期保留的产品边界、上下文语义和上游同步保护点，不是聊天纪要。

## 最初开发需求

这轮二改集中解决笔友会三个互相关联的问题：

1. **“角色吐槽 / 深度分析”不应依赖用户先说一句废话。** 用户可以只选择生成模式、输入框留空，再点发送，让角色直接依据现有正文与讨论发表意见。
2. **小说讨论必须知道自己在讨论虚构作品。** 角色人格、现实关系和统一上下文可以影响语气、审美与判断，但不能把小说中的同名人物、事件或关系自动改写成现实共同经历。
3. **写作人格必须是 character-only 的稳定画像。** 它描述“这个角色如果成为作者，会天然怎么写”，不能被用户档案、聊天、近期记忆、当前项目或当前小说污染。曾出现角色自身与物联网无关，但写作风格被用户近期技术话题带出“自动化 / API / 数据库”等内容，这类污染必须被结构性阻断。

核心产品分层：

- **角色是谁**：统一角色人设与现实关系。
- **角色怎么写**：稳定的 `writerPersona`，只从角色自身稳定设定推导。
- **角色此刻怎么和用户讨论作品**：可以使用统一角色上下文与现实关系，但必须遵守虚构边界。

## 当前实现

### 1. 三种生成模式是可组合开关

`GenerationOptions` 继续保留三个独立布尔值：

- `write`：续写正文
- `comment`：角色吐槽
- `analyze`：深度分析

它们不是互斥 Tab，也不是点击模式按钮立刻请求。用户先选择任意组合，再点右侧发送按钮。

`hasSelectedGenerationTask()` 是发送合法性的唯一基础条件：

- 至少一项开启：即使输入为空也可发送；
- 三项全关：即使输入框有字也不能发空任务；
- 生成中：仍禁用发送。

`NovelWriter` 的 reroll 也要求当前至少存在一个生成任务，避免“无任务重随”。

### 2. “用户说了什么”与“用户想让 AI 做什么”已解耦

`createUserNovelSegment()` 根据模式决定用户输入的语义：

- `write === true`：用户文本保存为 `role: writer / type: story`；
- 未开启续写、但开启吐槽或分析：用户文本保存为 `role: commenter / type: discussion`；
- 输入为空：不创建任何用户 segment；
- 没有生成任务：不创建 segment。

因此“我觉得这里不是害怕”在纯吐槽/分析模式下是讨论，不再伪装成小说正文。

空输入也**绝不伪造**“元芳你怎么看”“请发表看法”等用户消息。模式选择本身就是本轮意图，`buildNovelTurnInstruction()` 只在 prompt 内把这个意图表达清楚。

### 3. 当前章节保留完整互动，历史章节只保留总结

`buildNovelInteractionContext()` 负责笔友会本轮上下文：

- 所有历史 `chapter_summary` 进入“前情回顾”；
- 最后一个章节总结之后的当前章节，按真实顺序保留正文、用户讨论、角色吐槽和角色分析；
- 历史章节的旧正文 / 旧讨论 / 旧分析不会重新全量灌入当前 prompt。

当前章节使用明确语义标签：

- `[正文｜作者]`
- `[讨论｜用户]`
- `[吐槽｜角色]`
- `[分析｜角色]`

这个边界既保证连续讨论，也避免章节越写越长时上下文无限膨胀。

### 4. 空输入的 mode-aware 指令

`buildNovelTurnInstruction()` 不再用统一的“用户未输入，请自然续写”兜底：

- 仅续写：自然续写正文；
- 续写 + 吐槽/分析：续写并完成对应附加任务；
- 仅吐槽：直接基于现有正文与讨论发表看法；
- 仅分析：直接分析现有正文与讨论；
- 吐槽 + 分析：一次请求同时返回两类结果；
- 纯讨论模式下明确“不要求用户补充或重新提出问题”。

## 虚构创作边界

### 设计原则

实际的小说生成仍通过 `ContextBuilder.buildCharacterRequest({ char, user })` 构建角色请求，因此角色可以保有统一身份、现实关系、聊天语气与动态人格。这是有意保留的：笔友会不是匿名文学工具，角色仍然应该“像自己”地和用户共创。

但 `buildPrompt()` 中的 **Fiction Boundary** 把事实层严格分开：

- 现实角色与用户关系：只影响评论者人格、价值判断、关注点、亲疏和说话方式；
- 小说正文、人物、事件、关系：默认都是作品内部的虚构事实；
- 即使作品人物和现实角色 / 用户同名，也不能自动视为同一个人；
- 除非用户明确说明某段是现实事件的直接复现，否则不能说“你当时就是这样”“我经历过这件事”“这是我们以前发生过的”。

“以角色视角分析”指 **角色作为作者 / 读者的视角**，不是把角色变成剧中亲历者。

允许的表达：

- “作品里的我居然就这么让你走了？这写得不像我。”
- “这角色明显是在嘴硬。”
- “按我的理解，他这里不会这么做。”

不允许在没有现实映射声明时把正文改写成共同记忆。

### 吐槽与分析的交互边界

吐槽仍应保留角色感，而不是变成冷冰冰的文学评论：

- 可以亲近、嘴硬、吐槽、反驳用户；
- 可以承接上一轮讨论，不必每次做总评；
- 可以主动选择最想回应的一点；
- 第一人称表示“发表评论的人是角色本人”，不表示“小说事件由角色本人亲历”。

深度分析同样允许使用角色的知识、经验、价值观和审美，但分析对象是**作品人物与作品关系**。

## 写作人格：Character-only

### 稳定来源

`getStableWriterSource()` 只组合：

- `char.description`
- `char.systemPrompt`
- `char.worldview`

Deep Writer Persona 的 `buildWriterPersonaPrompt()` 也只把以下稳定角色设定发给模型：

- 姓名
- 基础描述
- 核心性格 / 行为设定
- 背景与世界观

明确排除：

- `userProfile`
- 用户 bio / 用户 persona
- 聊天历史
- `char.memories`
- 动态 `char.impression`
- 当前小说
- 当前讨论
- 最近现实事件 / 用户项目

`generateWriterPersonaDeep()` 的函数签名已经去掉 `userProfile`，并直接调用配置的 chat completion API，不经过 `ContextBuilder`。这是结构性隔离，不只是 prompt 里“提醒模型忽略用户”。

Simple Persona、写作标签、写作禁区和 few-shot 选择也改为使用稳定角色源，不再读取动态 impression / memories。

已保存的 `char.writerPersona` 仍属于稳定资料；手动编辑能力继续保留，实际 `buildPrompt()` 优先使用已保存 writer persona。

### Deep Persona 输出维度

当前深度分析使用 9 个稳定维度：

1. 写作能力
2. 语言风格
3. 表现手法
4. 叙事重心
5. 偏好与禁忌
6. 人物观
7. 叙事本能
8. 作者气质
9. 知识影响

“知识影响”只有角色稳定设定明确证明某领域知识时才允许填写；没有依据必须写“无明显专业知识影响”。不能为了显得个性化而给角色硬编职业知识。

### 为什么要隔离

写作人格描述的是长期“作者气质”，不是“最近聊了什么”。近期用户话题、心情或项目如果进入 writer persona，会让不同角色被同一个用户上下文拉向相似风格，并造成错误专业化。

现有回归测试故意构造了：

- Kiki 的稳定设定是温柔、细腻、海边小镇与绘画；
- memories / impression 则污染为“物联网、MCP、API、数据库、自动化”。

测试要求写作人格 prompt 完全不出现这些污染词，用来钉住这条边界。当前回归不是只检查示例中的 5 个技术词，而是明确钉住 7 个污染词：`芝麻`、`物联网`、`MCP`、`API`、`编程`、`数据库`、`自动化`。

同时还有第二条独立污染向量：把 memories / impression 整体改成“失恋 / 创伤疗愈”主题后，Deep prompt、Simple 分析、写作标签、禁忌和 few-shot 输入必须全部与修改前一致。它用来证明隔离规则针对的是**所有用户近期上下文**，不只是技术话题或某一批关键词。

## 入口与界面

`components/novel/NovelWriter.tsx`：

- 顶部三个模式按钮继续是独立 toggle；
- 发送按钮只看“是否有生成任务”和“是否正在生成”；
- 纯讨论用户消息复用现有 discussion 气泡；
- 用户正文仍显示正文纸张；
- 角色吐槽仍显示 discussion 气泡；
- 深度分析仍显示 analysis 卡片；
- PersonaPanel 支持手动编辑与“深度分析写作风格”。

本轮没有为讨论重新设计 UI，也没有新增数据库 schema。

## 数据与写回

核心数据仍是 `NovelBook.segments: NovelSegment[]`：

- 正文：`story / writer`
- 讨论：`discussion / commenter`
- 分析：`analysis / analyst`
- 章节总结：`focus: chapter_summary`

三组修复都复用既有 `NovelSegment` 数据模型，没有做 DB 迁移。

AI 返回仍使用原来的严格 JSON 结构：

- `writer`
- `comment`
- `analysis`
- `meta`

没有为了空输入或虚构边界改返回协议。

## 迭代与 Debug 记录

### 2026-08-28 · 空输入吐槽 / 分析与讨论上下文

- 现象：只选“角色吐槽”或“深度分析”时，空输入发送按钮被禁用；用户为了触发回复被迫输入无信息量句子。用户讨论还会被保存成正文，角色也看不到先前 discussion / analysis。
- 根因：UI 用 `inputText || write` 判断可发送；`handleSend` 把所有用户文字写成 story；上下文只筛 writer/story；空输入 prompt 统一解释成“自然续写”。
- 修复：引入生成任务判断、讨论 segment 分类、当前章节完整互动上下文和 mode-aware 空输入指令。
- 回归：`utils/novelUtils.interaction.test.ts`
- 提交：`e0c8275d`

### 2026-08-28 · 小说虚构事件被当成现实关系 / 记忆

- 现象：角色吐槽时容易把正文人物或事件当成现实自己、用户和双方真实经历。
- 根因：角色关系上下文和小说事实没有明确分层，“第一人称吐槽 / 角色视角”容易被模型解释成剧中亲历。
- 修复：增加 Fiction Boundary；明确“角色视角 = 作者/读者视角”，同名人物仍默认属于虚构层；吐槽与分析分别补充约束和允许 / 禁止示例。
- 回归：`utils/novelUtils.interaction.test.ts` 的同名人物虚构边界用例。
- 提交：`31dd2612`

### 2026-08-28 · 写作人格被用户上下文污染

- 现象：角色自身没有技术背景，但写作风格被用户近期的物联网 / 自动化话题污染。
- 根因：Deep Persona 曾读取 userProfile、近期 memories 与动态 impression；Simple / tags / taboos / few-shot 也读取动态 impression。
- 修复：统一改为角色稳定设定源；Deep Persona 去掉 user 参数并绕开 ContextBuilder；“剧情态度 / 互动模式 / 专业术语”改成稳定的“叙事本能 / 作者气质 / 知识影响”。
- 回归：`utils/novelUtils.writerPersona.test.ts`
- 提交：`cac85ebc`

## 上游同步保护点

2026-10-01 对照上游 `qegj567-cloud/SullyOS@29ec8257`：

- 上游 `utils/novelUtils.ts` 不含 `buildWriterPersonaPrompt`、`buildNovelInteractionContext`、Fiction Boundary；
- 上游 `components/novel/NovelWriter.tsx` 不含 `hasSelectedGenerationTask` 这套 fork 语义。

因此这些属于 **本二改仓库当前有效的 fork 差异**。以后同步上游时，尤其处理 `NovelWriter.tsx` 和 `novelUtils.ts` 冲突，不能因为“上游版本更新”把这些约束误删。

上游同步后的最小人工核对：

1. 纯吐槽 / 纯分析 + 空输入仍能发送；
2. 三模式全关不能发送；
3. 纯讨论输入仍保存为 discussion，不变成 story；
4. 当前章节讨论连续、历史章节只带 summary；
5. 同名小说人物仍不等于现实角色 / 用户；
6. Writer Persona 请求仍不含 userProfile、memories、dynamic impression；
7. 手动编辑的 writerPersona 仍优先进入实际写作 prompt。

## 当前状态与未完成项

- 已完成：本文描述的三组边界均已落入当前 fork 代码和专项单测。
- 未完成：本次知识归档没有重新调用真实付费模型做主观文本质量验收；未来若继续调 prompt，应保留现有确定性测试并另做真实模型观察。
- 注意：实际小说轮次仍会通过统一 ContextBuilder 读取角色现实上下文，这是产品需求；不要为了“写作人格隔离”误把实际共创也改成完全无关系上下文。

## 关键文件与接手入口

- 业务界面：`components/novel/NovelWriter.tsx`
- 纯逻辑 / Prompt：`utils/novelUtils.ts`
- 数据类型：`types.ts` 的 `NovelBook` / `NovelSegment`
- 讨论与虚构边界测试：`utils/novelUtils.interaction.test.ts`
- Writer Persona 隔离测试：`utils/novelUtils.writerPersona.test.ts`
- 历史章节聊天转发：`utils/messageFormat.novelCard.test.ts`

## 修改后的最小验证

按当前仓库 `AGENTS.md` 的 Windows/Codex 约定，依赖已安装时优先：

```powershell
.\node_modules\.bin\vitest.cmd run utils/novelUtils.interaction.test.ts utils/novelUtils.writerPersona.test.ts
.\node_modules\.bin\tsc.cmd --noEmit
.\node_modules\.bin\vite.cmd build
```

涉及历史章节转发时再补：

```powershell
.\node_modules\.bin\vitest.cmd run utils/messageFormat.novelCard.test.ts
```
