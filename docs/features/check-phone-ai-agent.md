# 查手机 · 智能体 / 发送前 AI 扩写

最后核验：2026-10-01  
核验基线：2026-10-01 的本仓库实现（开发期提交号不随公开历史提供）  
首版智能体提交：`0497dd6`（2026-06-26）  
发送前 AI 扩写提交：`952c283`（2026-08-29）

> 当前代码与 Git HEAD 是事实源。本档案把「查手机 → 智能体」的角色语义、发送前扩写边界和当前实现集中记录下来。尤其不要把真实 user、手机主人 char 和酒馆里的角色卡三者身份写反。

## 1. 功能定位

「智能体」位于「查手机」内部，用来查看并继续手机主人自己使用 AI 的记录。当前有三类服务：

- `assistant`：工具型 AI 助手，回答问题、查资料、给建议。
- `claude`：深度对话 / 树洞，偏情绪承接与分析。
- `tavern`：SillyTavern 式角色扮演；手机主人作为玩家，与自己创建的角色卡 / 世界卡对戏。

当前互动语义统一为：

- transcript 的 `我:` = **手机主人 char**。
- transcript 的 `对方:` = **char 正在使用的 AI / 酒馆角色卡**。
- 真正操作 SullyOS 的 user 是潜入这个 AI App 的人；user 在输入框里写的内容会作为下一条 `对方:` 发送。
- 发送后，现有 `handleAiSend()` 再让模型以 char 身份生成下一条 `我:`。

这层身份关系是所有 Prompt 和后续维护的前提。

## 2. 酒馆 OOC 的真实含义

酒馆模式里，char 认为自己是真人玩家，对面的角色卡只是 AI。

因此 char 在自己的 `我:` 楼层中写出的全角括号，例如：

```text
（下一段强势一点，不要再退。）
```

含义是：

> 人类玩家 char 正在给皮下 AI 下 OOC 表演要求。

user 当前扮演的是这个被下指令的 AI / 角色卡。

长期约束：

1. AI 扩写要读取这些 OOC，作为未明确部分的表演指导。
2. **当前输入框 sourceText 永远高于 OOC。** 即使 OOC 明确要求“不靠近”，user 本轮写“走过去抱住他”，扩写也必须保留“走过去抱住他”。
3. OOC 不能被扩写器回答成“（好的，我会……）”，也不能由扩写器自行新增。
4. OOC 只影响 sourceText 没有决定的语气、动作细节、节奏等部分。

Prompt 中当前采用的优先级是：

1. 本轮 sourceText。
2. char 的 OOC。
3. 当前角色卡 persona / scenario 与既有剧情事实。
4. 为表达自然度补充的细节。

## 3. 发送前 AI 扩写的产品语义

扩写不是“AI 替 user 决定下一步”。

它解决的是：

> user 已经知道自己大概想表达什么，但不想独立完成完整小说段落、专业回答或长篇情绪表达。

交互链路：

```text
当前输入框文字
→ 点击 Sparkle「AI 扩写」
→ LLM 生成扩写
→ 只回填输入框
→ user 可以继续编辑 / 再次扩写 / 删除重写
→ user 主动点击发送
→ 才进入原有 handleAiSend
```

硬边界：

- 扩写不能自动发送。
- 扩写不能直接改 transcript。
- 扩写不能写 DB。
- 扩写不能触发 `syncAiCardToChat` 或长会话总结。
- 输入框不保存“原始 A / 扩写 B”的额外身份；每次点击时，**当下输入框的文本就是新的 sourceText**。
- 因此 A → 扩写成 B → 再点扩写时，B 就是下一轮的输入源；如果 user 把 B 手改成 B2，再扩写则以 B2 为准。

## 4. 三种服务的扩写策略

纯 Prompt 构造集中在 `utils/aiInputExpand.ts` 的 `buildAiInputExpandPrompt()`。

### 4.1 Tavern：受约束的小说式扩写

目标是把 user 的关键词、口语、第一人称或简略动作转换成可直接作为角色卡下一层输出的第三人称小说 RP。

允许补：

- 微动作、神态、视线；
- 停顿、语气；
- 轻量环境反应；
- 情绪表现；
- 对白连接；
- 已明确动作的过程细节。

不允许为了“写得精彩”擅自新增重大决定，例如 user 没写的亲吻、告白、分手、离开、原谅、杀人、秘密揭露或重大关系变化。

人称不是机械替换。角色名与“他 / 她”等代词按正常小说语感自然混用。

### 4.2 Assistant：专业知识与结构补全

user 可以只给观点、方向、情感倾向或少量事实，扩写模型负责把它补成真正能回答 char 的内容。

允许补：

- 专业知识与解释；
- 结构化分点；
- 示例；
- 操作步骤与验证方式；
- 注意事项；
- Markdown 与 code block。

不能推翻 user 已明确的立场，也不能编造 user / char 的私人事实，或把不确定的版本、数据、政策和实时信息伪装成确定事实。

当前温度为 `0.6`。

### 4.3 Claude：表达与洞察补全

用于 user 已经知道核心感受 / 判断，但不想自己组织完整长回复的场景。

允许补：

- 情绪承接；
- 观点拆解；
- 温和分析；
- 可能性区分；
- 基于当前会话已有事实的重组；
- 必要且自然的追问。

禁止凭空编造 user 经历、char 过去、心理诊断或隐藏事实，也不能反转 user 的核心判断。

当前温度为 `0.72`；Tavern 当前为 `0.82`。

## 5. 当前上下文设计意图

扩写设计时明确要求：

```text
前情提要 recap
+ 当前未折叠 session.transcript
+ 当前 sourceText
+ Tavern 时的 card name / kind / persona / scenario
```

这应当是扩写器知道的全部会话内容。

原因是：user 此时扮演的是 char 正在使用的 AI。这个 AI 不应该因为 SullyOS 内部拥有统一角色上下文，就突然知道 char 从未在这段 AI 会话里透露的现实聊天、记忆宫殿、其它 App 内容或私人秘密。

`utils/aiInputExpand.ts` 目前仍把这条约束明确写进共享 Prompt。

长会话沿用已有 `recapOf(session)`：

- 已折叠历史只读 summaries / 前情提要；
- 当前未折叠部分读 `session.transcript`；
- 扩写不重新读取 archived 全文。

## 6. 当前实现

### 6.1 UI 与状态

`apps/CheckPhone.tsx` 当前输入区为：

```text
textarea → AI 扩写按钮 → 发送按钮
```

扩写按钮：

- 使用 `Sparkle`；
- 扩写期间显示独立 spinner；
- `aiExpanding || aiSending || !aiInput.trim()` 时禁用；
- 发送按钮在 `aiExpanding` 时同样禁用，防止旧输入在扩写未返回时被误发。

关键 state / ref：

- `aiExpanding`
- `aiExpandRequestRef`
- `aiInputRef`
- `selectedAiSessionIdRef`

### 6.2 异步覆盖保护

`handleAiExpand()` 开始时冻结：

- 当前 session；
- `sourceInput = aiInput`；
- 递增 request id。

返回后先检查：

1. request id 仍是最新；
2. 当前选中的 session id 仍然相同；
3. `aiInputRef.current` 仍等于请求开始时的 `sourceInput`。

如果 user 在等待期间手动编辑输入框，旧扩写结果不会覆盖新文字，并提示：

`输入内容已变化，本次扩写结果未覆盖`

如果切到其它会话，旧请求结果直接丢弃。

### 6.3 输出清理

`cleanAiInputExpansion()` 只做保守清理：

- 去掉“扩写结果：”“润色结果：”等明显违约前缀；
- Tavern 额外去掉误带的 `对方:` / `AI:` 前缀；
- **不删除 Markdown code fence**，避免 Assistant 的代码示例被破坏。

### 6.4 API

扩写复用查手机当前 `effectiveApiConfig`，没有单独 API 配置，也没有新增 schema / `AiSession` 字段。

## 7. 当前已确认的上下文隔离回归

### 7.1 历史实现

`952c283` 首次实现 AI 扩写时，`CheckPhone.callLLM(prompt, temperature)` 还是裸调用：

```ts
messages: [{ role: 'user', content: prompt }]
```

所以当时“扩写只看当前 AI 会话”的设计与实际请求层一致。

### 7.2 后续变化

2026-09-22 的 `2546805`（统一世界书 / 角色请求上下文）把 `callLLM` 改成：

```ts
callLLM(prompt, temperature, withCharacter = true)
```

当 `withCharacter=true` 且存在 `targetChar` 时，它会：

1. 读取 `loadCharacterContextMessages(targetChar)`；
2. 用 `ContextBuilder.buildCharacterRequest(...)` 注入统一角色上下文；
3. 再把传入 prompt 作为最后一条 user message。

该提交同时把会话总结显式改成 `callLLM(prompt, 0.7, false)`，但 **`handleAiExpand()` 仍保留两参数调用**：

```ts
callLLM(prompt, temperature)
```

因此截至本次核验，AI 扩写虽然在 Prompt 文本里声明“不得知道现实聊天 / 记忆”，**实际请求层仍会额外获得角色统一上下文**。

这不是 8 月 29 日首版就存在的问题，而是后续上下文统一带来的回归。

### 7.3 当前测试为什么没有抓到

`utils/aiInputExpand.test.ts` 当前接线测试检查 `handleAiExpand` 片段中没有：

- `buildAiContext`
- `patchAiSession`
- `syncAiCardToChat`
- `maybeSummarizeSession`
- `DB.`

这些断言能保护“扩写不直接写会话 / DB”，但无法发现 `callLLM` 默认参数后来从裸调用变成 `withCharacter=true`。

对应未修项已登记到根目录 `TODO.md`。

## 8. 推荐修复边界

修复上下文隔离时应保持最小改动：

```ts
callLLM(prompt, temperature, false)
```

只改 `handleAiExpand()` 这一条扩写调用。

不要因此关闭：

- 智能体记录生成所需的角色上下文；
- `handleAiSend()` 中生成 char 真实反应所需的人设 / 角色上下文；
- 自动推进等已有角色演绎路径。

同时应补测试，直接锁住扩写路径显式传 `false`，避免未来再次因为 `callLLM` 默认值变化而回归。

## 9. 与上游 / SharkOS 的当前差异

截至 2026-10-01 核验：

- `qegj567-cloud/SullyOS` 当前 `master` 没有 `utils/aiInputExpand.ts`，`apps/CheckPhone.tsx` 也没有 `handleAiExpand` / “AI 扩写”接线。
- `shenqingmo3-dotcom/SharkOS` 当前默认分支同样没有这套发送前扩写实现。

因此 AI 扩写仍是 **本二改仓库的专属差异**。

以后同步上游时，如果 `apps/CheckPhone.tsx` 输入区或智能体 handler 冲突，必须保护：

- `utils/aiInputExpand.ts`；
- `handleAiExpand()`；
- `aiExpanding` 与三个 ref 的竞态保护；
- Sparkle 扩写按钮；
- 扩写期间禁用发送 / 自动推进；
- `utils/aiInputExpand.test.ts`。

## 10. 关键文件与维护入口

- `apps/CheckPhone.tsx`：智能体入口、会话 UI、`callLLM`、`handleAiExpand`、`handleAiSend`、自动推进、长会话总结、输入竞态保护。
- `utils/aiInputExpand.ts`：三种服务的纯 Prompt builder 与保守输出清理。
- `utils/aiInputExpand.test.ts`：Prompt 身份 / 优先级 / Markdown 与接线回归。
- `types.ts`：`AiServiceKind`、`AiSession`、`TavernCard` 与 `phoneState.aiAgent`。
- `utils/checkPhoneApi.ts`：查手机独立 API / 跟随默认 API。
- `utils/context.ts`、`utils/chatContextRange.ts`：当前统一角色上下文；修改 `callLLM` 时必须同时确认扩写是否应该绕开它们。

## 11. 修改后的最小验证

扩写 Prompt 或接线改动至少运行：

```bash
.\node_modules\.bin\vitest.cmd run utils/aiInputExpand.test.ts
```

若修改 `CheckPhone.callLLM`、统一上下文或其它智能体链路，还应按当前仓库基线执行相关测试、TypeScript 检查与生产构建；具体命令以根目录 `AGENTS.md` 的当前约定为准。
