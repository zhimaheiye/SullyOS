# 桌游 · 骗子酒馆

本文记录与 TRPG 平行的“桌游”App、首个游戏“骗子酒馆”的规则事实权、玩家视野、角色上下文、存储与写回边界。修改前同时阅读根目录 [`PRODUCT.md`](../../PRODUCT.md) 与 [`docs/handoff/CURRENT.md`](../handoff/CURRENT.md)。

## 正式历史

- 首版：`11acafa88a87f0abaaf2074691147f80d2cabd7d` — `feat: add standalone board game app`。
- 双模式（`master`）：`1bd9907d6b53aee37ec3c9181708a11ed2b62dda` — `feat: add dual generation modes to liars bar`。
- 同一双模式补丁曾按用户当时的明确要求同步到 Temporal V2 实验分支：`d9a8c05899f4fe298f620edae74779fc773a4460`。这只是 2026-09-05 这一批功能的历史同步要求，不能泛化成“以后所有 master 修改都必须同步旧实验分支”；Temporal V2 的当前维护策略以 [`docs/temporal-awareness.md`](../temporal-awareness.md) 为准。

## 产品边界

- `AppID.Game = 'game'`、`GameApp.tsx`、`games` store 继续只属于 TRPG，禁止重命名、迁移或改造成桌游大厅。
- `AppID.BoardGame = 'board_game'` 是独立普通桌面 App；当前 catalog 只有 `liars_bar`，以后新增游戏时扩 union/catalog，不预建万能规则引擎。
- 桌游的核心是多个现有角色与用户进入同一套规则，掌握不同信息并直接彼此判断、欺骗、发言和对抗。角色仍沿用神经链接中的同一身份、聊天和长期记忆。

## 首版流程

桌游目录 → 骗子酒馆首页 → 选择三位角色与 AI 生成方式 → 四人牌桌 → 结算 → 仅保存或让参与角色记住。历史页可恢复进行中会话或查看已结束战报与完整公开记录；刷新不重新随机。

首版固定“用户 + 三位角色”。底层 actor 仍使用 `{ type: 'user' } | { type: 'character'; charId }`，没有把用户写死为唯一可扩展玩家类型。

## 规则

- 20 张：Q/K/A 各 6 张、Joker 2 张；每张都有稳定且唯一的 card id。
- 每轮给每名存活玩家 5 张，目标牌随机为 Q/K/A；暗出 1—3 张并公开声称它们全是目标牌。Joker 视为目标牌。
- 下一名玩家可出牌或质疑；没有手牌时只能质疑。质疑后翻开上一手：含非目标牌则出牌者受罚，否则质疑者受罚。
- 每人拥有独立六膛轮盘。`bulletIndex` 创建时只随机一次，`chamberIndex` 只在本人真正扣扳机时推进，跨 round 保留；枪响即淘汰，最后一名存活者获胜。
- 洗牌、目标、轮盘结果都先进入新 session 状态并写库，UI 只展示已确定结果。规则引擎支持注入 `RNG` 以便测试。

## 工程分层与权限

`utils/boardGame/liarsBar/engine.ts` 是纯 TypeScript：只接收 session/action/RNG，返回新 session，不依赖 React、OSContext、fetch 或 LLM。LLM 输出不能直接修改世界，只能经过 `parser.ts` 校验后交给 `applyLiarsBarAction()`。

角色调用路径：

1. `visibility.ts` 从完整 session 生成当前 actor 的 `LiarsBarPlayerView`。
2. `buildChatRequestPayload()` 恢复该角色自己的 system prompt、聊天、关系和长期记忆，固定 `stripImages: true`、`disableMcp: true`。
3. `prompt.ts` 只加入本人手牌、公开牌数/行动/发言和合法动作；`aiService.ts` 最多尝试三次合法 JSON。
4. `parser.ts` 校验动作、card id、数量、重复牌和 challenge 权限；本地托管只在用户明确点按后使用最小策略。

逐人模式每位角色独立请求；批量模式见下节。两者均没有 LLM 荷官/裁判。请求启动时记录 session id、revision、current actor；回包再次读取 IndexedDB 比较三者，写入时还在同一 readwrite transaction 内复核 revision、actor、进行中状态与页面取消信号。退出、卸载或切换会话使旧请求失效；重复点击与并发回包不能覆盖已提交的新回合。

## 双模式（2026-09-05）

双模式的产品动机不是单纯“省 token”，而是解决多人桌游在高频轮转时容易撞上 API 中转站 RPM / 并发速率限制的问题。它复用群聊现有“导演模式 / 轮询模式”的产品取舍：允许用户在“更少请求”与“更严格的人格/私有信息隔离”之间显式选择。但桌游不能照搬群聊的一次整轮预生成，因为用户会在牌局中间行动；这里的 batch 只生成**从当前状态开始，到再次轮到用户或本轮被 challenge/结束为止的一段连续 AI 行动**，绝不预测用户未来动作。

- `settings.generationMode` 为 `batch | individual`，新局默认 `batch`，与群聊默认 Director 的产品习惯一致；旧存档缺字段时保留原来的 `individual`，不重发牌、不改子弹、不偷偷降低既有隐私隔离。模式仅在开局选择，随 session 备份。
- `individual` 每个角色使用自己的统一 `buildChatRequestPayload()`、聊天、记忆、世界书、关系与 PlayerView，一次请求只生成自己的一手。
- `batch` 的 `getContinuousAiActorsUntilUser()` 按存活座位计算连续 AI 顺序，一次行动生成请求输出这段计划。用户淘汰后至多生成一圈，避免无界整局计划。角色上下文仍逐一调用同一个统一构建器，参考群聊成员块的组织方式，不另建简化 persona。
- `batchAiService.ts` 只接受 `buildLiarsBarBatchView()` 生成的 DTO：公共牌桌先剥离所有未公开 `play.cardRanks`，私有块仅包含本批角色各自手牌与条件合法动作。用户手牌、完整 session、已暗出的牌面、子弹位置不进入该请求。
- 批量模式中模型可以同时读取多个角色的私有块（包括各自私聊和记忆），所以提示词的分区约束不是安全隔离。开局页和牌桌持续提示串号/隐藏信息利用风险；需要严格隔离时选择逐人模式。一次行动请求代替连续三人的三次请求，不承诺统一记忆构建器可能触发的召回/Embedding 等辅助请求为零。
- `batch.ts` 中计划只在内存存在；逐条按新状态验证 actor、turn、动作、cardIds、数量与重复牌，再调用原引擎并立即事务落库。非法中间项保留已保存前缀，丢弃剩余项并停在当前回合供重试/明确本地托管；不回滚、不直接写入 Action[]。
- challenge、换轮、死亡、结束、轮到用户、取消或 revision 变化均中断剩余计划。下一轮从真实存档重新构建请求；整次 API 失败不改回合。两模式最多尝试三次，取消不重试。
- 每手保存后再呈现公开发言；质疑后的翻牌、轮盘和淘汰使用已保存事件显示轻量动画，用户确认后再继续下一轮/结算。动画不产生规则随机数。刷新直接恢复已保存事实，不重播未消费的 AI 计划。
- 本轮按 ponytail 原则复用既有引擎、统一上下文、store 和备份，没有 UniversalGameEngine、额外荷官或新依赖。

## 设计参考与取舍

以下仓库是首版设计时的参考实现，不是 SullyOS 当前事实源；以后维护仍以本仓库当前代码和本文件为准：

- [LYiHub/liars-bar-llm](https://github.com/LYiHub/liars-bar-llm)：主要吸收“本地规则引擎拥有唯一事实权、LLM 只做出牌/质疑决策”的边界，以及 20 张牌与六膛轮盘这一首版规则基线；不搬它的 Python 架构。
- [TangyKiwi/BluffMind](https://github.com/TangyKiwi/BluffMind)：主要吸收公开桌面状态与玩家私有手牌严格分层、行动同时带桌上 taunt 的体验设计。SullyOS 不另建 persona/aggression 参数，而是继续使用神经链接中的统一角色身份、聊天、关系与长期记忆。
- [VedalAI/neuro-liarsbar](https://github.com/VedalAI/neuro-liarsbar)：主要吸收狭窄且可验证的 AI Action surface——出牌只提交本人 cardIds，质疑是独立动作，所有动作先本地校验再进入引擎。

这些参考共同解释了当前结构为何是“Engine / PlayerView / Action parser / AI service”分层，而不是让模型同时扮演荷官、裁判和玩家。

## 信息隔离

完整 session 含规则真相，但绝不能直接 stringify 进 prompt。PlayerView 仅包含：

- 本人当前手牌；
- 所有玩家的姓名、存活、剩余牌数、公开扳机次数；
- 当前目标、上一手的公开声称、公开发言和公共事件；
- 当前合法动作。

它不包含他人手牌/card id、他人 `bulletIndex`、未翻开暗牌。`play` 事件在引擎内部保留真实牌用于裁决，但向其他玩家投影时删除 `cardRanks`；挑战产生的 `reveal` 才把牌面变成所有人可见的公共事实。

## 存储、备份与写回

- `board_game_sessions` 最早于 IndexedDB v87 新增，主键 `id`。2026-10-03 归档复核时仓库 `DB_VERSION = 94`；v87 是桌游 store 的历史迁移点，不代表当前数据库总版本。桌游仍复用同一 store，没有新增桌游 store/index；TRPG 的 `games` store 不变。
- 每次创建、发牌、出牌、质疑、翻牌、轮盘、换轮、淘汰和结束形成持久 session 状态与事件；规则相关随机结果不会在刷新后重算。
- `FullBackupData.boardGameSessions`、普通完整导入导出、OSContext v2 全量/纯文字分片备份均已接线。
- 结算默认只保存在桌游 session。用户确认后，每位参与角色分别获得一条 `score_card` 与稳定 memory id `mem-board-game-liars-bar-<sessionId>-<charId>`。
- 写回只使用公共事件、该角色自己的统计/行动与最终结果；无人质疑的他人暗牌继续不可知。消息通过 `source: board_game` + `boardGameSessionId` 二次查重，并逐角色保存 `sharedMessageIds`，支持中断后幂等重试。

## 关键文件

- `apps/BoardGameApp.tsx`、`apps/boardGame/LiarsBarApp.tsx`：目录、选角、牌桌、失败托管、历史、结算与写回。
- `utils/boardGame/catalog.ts`：最小桌游目录。
- `utils/boardGame/liarsBar/engine.ts`、`visibility.ts`：规则事实权与玩家投影。
- `utils/boardGame/liarsBar/aiService.ts`、`batchAiService.ts`、`batch.ts`、`prompt.ts`、`parser.ts`：统一角色上下文、双模式动作请求、计划执行与本地校验。
- `utils/boardGame/liarsBar/stats.ts`、`writeback.ts`：战报与逐角色幂等写回。
- `utils/db.ts`、`context/OSContext.tsx`：v87 store 与两套备份。

## 验证与未完成项

专项测试覆盖牌组、card id、发牌、合法动作、Joker、质疑、轮盘、跨轮状态、淘汰/胜利、玩家视野、严格 AI JSON、v87/备份、App/安全区、旧回包守卫和写回幂等。

双模式回归新增：真实请求体的角色分区、MCP 关闭、单次批量 completion、取消不再请求/重试、连续座位、用户淘汰后的有限计划、逐手落库、非法前缀保留、质疑/胜利中断、重复/过期响应、事务竞争、两种模式与旧存档备份，以及本地 bot 完整对局的逐步 JSON 恢复。

2026-09-05 验证：专项与备份 11 文件 73 项通过，5 个 Worker 与 Vite 构建通过。整仓 4983/4989 项通过；两项既有 Worldline 导出审计/HtmlCard 查询失败，另四项 storageOptimize 整仓负载失败在独立复跑 84 项全部通过。TypeScript 本批路径零诊断，保留其余既有问题；未做浏览器或真实 API 验收。

仍需真实兼容聊天 API 与移动端人工验收：三位角色连续自动行动、不同模型 JSON 稳定性、刷新/切后台恢复、键盘与安全区、长局性能和聊天卡视觉。后续新增狼人杀/阿瓦隆/UNO 时只扩 `BoardGameSession` union 与 catalog，各自拥有规则/视野/AI 模块，不抽象万能引擎。
