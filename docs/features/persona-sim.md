# 查手机 · PersonaSim / 生活记录

最后核验：2026-10-01  
核验基线：2026-10-01 的本仓库实现（开发期提交号不随公开历史提供）  
关键历史修复：`58ac30c`（`fix: soften PersonaSim life noise prompts`）

> 当前代码与 Git HEAD 是事实源。本档案记录 Persona Simulation 的长期产品边界、当前实现入口，以及 2026-09-04 已正式落地的生活噪音去模板化修复。不要把早期聊天里的旧 Prompt 当成当前实现。

## 1. 功能定位

Persona Simulation 位于「查手机」内，界面文案是“成为 TA 的一段人生”。用户不是旁观一段普通叙事，而是以目标角色第一人称，通过锁屏、通知、聊天、搜索、相册、音乐、备忘录、浏览器、天气、内心独白等 screenlife beat 体验一段日常或事件。

当前支持：

- 模式：`daily` / `event`。
- 用户存在感：`default` / `light` / `none`。
- 基调：`mix` / `depressive` / `darkhumor` / `cute`。
- 生成期间可以离开查手机去别的 App；`CheckPhone` 通过全局 `personaSimStore` 保存 loading / ready / error 状态。
- 演出到达 `end` 后自动保存到角色 `phoneState.simLogs`，保留完整 `script` 快照，可在「生活记录」原样重播。
- 重播不会再次写一份重复生活记录。
- 用户主动点击“作为回忆发送给 TA”时，才把压缩后的演出内容作为 `assistant / sim_card` 写入角色主聊天，使角色后续把它当作亲身经历。仅保存在生活记录中时不会自动进入主聊天。

## 2. 当前生成与上下文链路

当前 `apps/PersonaSim.tsx` 的生成链路已经经历后续上下文统一，不要再引用旧版 `buildCoreContext(...)` 作为现状。

`generatePersonaScript(...)` 当前流程：

1. 先调用 `injectMemoryPalace(...)`。
2. 用 `loadCharacterContextMessages(char)` 读取当前角色允许进入请求的聊天范围。
3. 构造 `characterContextInput`，包含角色、用户、详细记忆和记忆宫殿注入。
4. 将最近消息另外整理成 PersonaSim Director Prompt 中的“最近聊天上下文”。
5. 最终请求通过 `ContextBuilder.buildCharacterRequest(characterContextInput, [{ role: 'user', content: prompt }])` 进入统一角色上下文管线。
6. 请求参数当前仍为 `temperature: 0.98`、`max_tokens: 24000`。
7. 返回值由 `parsePersonaScriptApiResponse` 解析；`finish_reason=length`、安全中止、无法解析或最后一个 beat 不是 `end` 都直接报错，不伪造兜底结尾。

查手机 API 仍有自己的独立配置：

- `utils/checkPhoneApi.ts` 的 `getCheckPhoneApi()` 从本机 `localStorage` 读取 `check_phone_api`。
- 没有独立 `baseUrl` 时，`resolveCheckPhoneApi(...)` 跟随全局聊天默认 API。
- PersonaSim 使用 `CheckPhone` 当时解析出的 `effectiveApiConfig`。

## 3. 生活记录持久化

演出第一次自然走到最后一个 `end` 时，`persist()` 写入 `PhoneSimLog`：

- mode / theme
- title / summary / ending
- beatsCount
- `buildMemoryText(script)` 得到的可读梗概
- timestamp
- 完整 `script` 快照
- 若角色日程功能开启且脚本带 buff，还会保存对应情绪 buff 摘要，并按现有 active buffs 规则更新角色状态

写入时必须基于 `updateCharacter(charId, cur => ...)` 合并最新 `phoneState`，不能拿旧的 `targetChar` 快照整块覆盖，否则异步生成期间其它查手机数据可能被抹掉。

「生活记录」本身只是本机角色数据；发送回忆是另外一个明确动作。删除生活记录会删除该日志和重播脚本，但不会撤回此前已经发到主聊天里的 `sim_card`。

## 4. 2026-09 的生活噪音模板化问题

### 4.1 历史对话现场

用户实际使用时发现，不同主题和不同气氛下的演出经常生硬出现：

- 手机低电量 / 没电；
- 天已经黑了但角色还没开灯。

用户同时说明，旧照片、打字又删除、搜索又删除、反复打开聊天框、快递、购物车、深夜失眠等意象虽然也会重复，但通常与场景结合自然，并不需要整体清除。

用户在四种 PersonaSim 基调下都观察到过问题；历史对话现场还涉及 Gemini 3 Flash、Gemini 3.1 Pro 等多个模型。这个观察只能证明“当时多模型都受同一 Prompt 影响”，不能外推成某个 Gemini 系列的固定模型缺陷。

### 4.2 已验证根因

旧版 Director Prompt 对这两个意象有多层直接诱导：

1. `buildVariation()` 把“从黄昏、天快黑了还没开灯”直接作为切入候选。
2. 同一个 variation 又把“来电 / 通知 / 没电”作为强制结构候选。
3. 旧“真实手机感”规则每场固定向模型展示“电量不足”等一整组具体例子。
4. variation 标题写成“必须严格遵守”，Prompt 末尾再次要求“严格贴合本场变奏”。
5. 旧规则同时要求 40～64 个 beat、“宁多勿少”和“环境碎片撒厚”，内容不足时会鼓励模型用现成生活碎片填满。
6. 旧收尾菜单还固定给出“关灯”等动作，继续提高灯光意象的显著性。

因此当时的判断是：

> 主要根因是 Prompt 设计，模型特性只是放大器。解决方式应是降低模板诱导，而不是换模型、降温度或在输出后屏蔽关键词。

## 5. 已确认的产品边界

这轮需求不是“把生活感删掉”，而是局部去模板化。

长期约束如下：

1. **生活噪音继续保留。** 无关的小通知、旧痕迹、手机行为仍然是 screenlife 真实感的重要组成部分。
2. **场景自然性优先。** 用户输入的体验内容 / 当前剧情 > 人设、关系、世界观 > 当前时间地点和行为气氛 > 本场基调 > 随机变奏和生活碎片。
3. **低电量和不开灯不是禁词。** 如果某场情境自然推导出这些事，模型仍可自行生成；只是 Prompt 不再主动把它们当高频示例喂给模型。
4. **不做跨场 motif 历史去重。** 当前没有读取过去 `simLogs` 来禁止最近用过的旧照片、聊天框、搜索等意象，也不需要为此扩数据结构。
5. **不做生成后关键词过滤或自动重生。** 不要加“出现低电量就替换”“出现不开灯就重试”这种后处理。
6. **不因为这项问题改模型或温度。** `temperature` 保持 0.98；API/model 选择逻辑保持原样。
7. **自然重复允许存在。** 旧照片、打字又删、反复打开聊天框等如果与剧情贴合，可以重复，不要为了追求每场绝对唯一而削弱表现力。
8. **演出长度服从内容。** 20～60 beat 只是宽松参考，不是配额；简单日常可更短，复杂事件可更长，不为凑数制造动作和碎片。

## 6. 正式修复：58ac30c

`58ac30c` 在 fork 中正式落地上述边界，主要改动：

### 6.1 大生活噪音池

`apps/PersonaSim.tsx` 新增 `LIFE_NOISE_POOL`，当前有 32 个候选，覆盖系统提示、普通通知、物流消费、浏览器/阅读/音乐、相册文件、待办备忘录、登录状态等不同类别。

`buildLifeNoiseHints()` 每次无重复随机抽 2～4 条，并明确写给模型：

- 只是可能的灵感；
- 可以一个都不用；
- 只有与当前时间、地点、角色状态、情绪和剧情自然兼容时才采用；
- 不要为了证明“这是现实生活”刻意插入设备状态或环境动作。

池中刻意不提供“没电 / 电量不足 / 天黑不开灯 / 忘记开灯”这些本次确认过度诱导的例子。

### 6.2 variation 从硬约束变软灵感

`buildVariation()` 当前标题是“本场变奏 · 可选导演灵感”。

- “天快黑了还没开灯”已替换为抽象的环境 / 注意力变化切入。
- “来电 / 通知 / 没电”已替换为“若场景自然需要，可被一个与当前情境相符的小插曲打断”。
- “主导表达”改成“表达方式灵感”。
- 具体锚点允许改写或舍弃。
- 与主题、人设、时间地点、基调不兼容时可以弱化或完全忽略。

### 6.3 Prompt 重新声明优先级

Director Prompt 现在显式写入【内容优先级】，并把“真实手机感”“环境碎片”从必须堆叠改成可有可无、少而准。

### 6.4 长度与结尾

旧 40～64 beat 硬配额已取消。当前为：

- 通常约 20～60 beat；
- 明确写成“参考范围，不是配额”；
- 禁止为了数量机械增加动作、独白、通知或环境碎片。

旧“环境碎片撒厚”改为“环境碎片少而准”。

收尾仍要求自然落地、最后必须是 `end`，但不再给“关灯”这类固定菜单；最终动作必须从本场情境自然长出来。

## 7. 回归保护

`utils/personaSimPrompt.test.ts` 是这项 fork 差异的直接回归保护，目前覆盖：

1. 连续抽样验证每场生活噪音为 2～4 条且无重复，提示中明确“可以一个都不用”，并禁止固定提示“没电 / 电量不足 / 天黑不开灯 / 忘记开灯”。
2. 验证 Director Prompt 保留软 variation、内容优先级和 20～60 非配额规则，并且不再出现旧 40～64、环境碎片撒厚、关灯等模板诱导。
3. 验证 daily / event × 四种 tone × 三档 presence 仍能正常构造完整 Prompt，并保留最后一个 beat 必须为 `end` 的协议。

以后调整 PersonaSim Prompt 时优先扩这份测试，不要通过删测试来重新引入旧硬模板。

## 8. 与上游的差异

截至 2026-10-01 核验，`qegj567-cloud/SullyOS` 当前 `master` 的 `apps/PersonaSim.tsx` 仍保留旧实现：

- “本场变奏 · 必须严格遵守”；
- “天快黑了还没开灯”；
- “来电 / 通知 / 没电”；
- 固定“电量不足”等真实手机感例子；
- 40～64 beat / 宁多勿少；
- “环境碎片撒厚”；
- 收尾示例中的“关灯”。

上游当前也没有 fork 的 `utils/personaSimPrompt.test.ts`。

因此这项修复是 **本二改仓库的专属行为差异**。以后执行上游同步时，如果 `apps/PersonaSim.tsx` 冲突或整段 Prompt 被上游覆盖，必须重新核对 `58ac30c` 和 `utils/personaSimPrompt.test.ts`，不能无意恢复旧模板。

同时注意：2026-09-04 修复之后，PersonaSim 的统一上下文链路又继续演进。当前 HEAD 已经使用 `loadCharacterContextMessages` + `ContextBuilder.buildCharacterRequest`；维护时应保留这个后续上下文实现，不能为了重放旧 Prompt 修复而把整个文件退回历史版本。

## 9. 维护入口

修改此功能前至少检查：

- `apps/PersonaSim.tsx`：演出 UI、生成链路、Director Prompt、生活噪音、variation、持久化、回忆发送。
- `apps/CheckPhone.tsx`：PersonaSim 后台生成入口、`personaSimStore`、查手机 API 解析、生活记录删除/深链。
- `utils/personaSimStore.ts`：跨 App 的生成状态。
- `utils/personaSimParser.ts`：模型 JSON 解析与容错。
- `utils/personaSimPrompt.test.ts`：Prompt 去模板化回归保护。
- `utils/checkPhoneApi.ts`：查手机独立 API / 跟随默认 API。
- `utils/chatContextRange.ts` 与 `utils/context.ts`：当前统一角色上下文。
- `types.ts`：`SimScript`、`SimBeat`、`PhoneSimLog` 等共享类型。

## 10. 下次调优时的判断顺序

如果以后又出现某个生活意象“每场都来一次”：

1. 先全文检查 Director Prompt、variation、JSON 示例和结尾规则里是否重复展示了这个具体意象。
2. 再检查是不是长度 / 密度规则迫使模型填充。
3. 看是否跨 tone、跨模型都出现；若是，优先怀疑共享 Prompt，而不是先归因某个模型。
4. 优先把具体例子抽象化、随机化或降为软灵感。
5. 只有在真实测试证明 Prompt 已无诱导但仍存在明显跨场机械重复时，再讨论 motif 去重；不要预先建设复杂历史状态。
