# AGENTS.md

给 Codex 的项目导航。SullyOS 是装在浏览器里的虚拟手机系统（React + TS + Vite，local-first，IndexedDB 存储）。详细介绍见 [`README.md`](./README.md)。

这份文件只做一件事：**告诉你遇到某类问题该去翻哪份文档**，别在代码里瞎逛。

> 包管理器统一用 **pnpm**：装依赖 `pnpm install`，别用 npm / yarn（仓库里是 `pnpm-lock.yaml`）。当前 Windows/Codex shell 已知不会稳定地把项目本地 `.bin` 注入 `pnpm <command>`；不要先重试已知会报“不是内部或外部命令”的 `pnpm vitest`。依赖已安装时直接运行仓库入口：测试 `.\node_modules\.bin\vitest.cmd run`、类型检查 `.\node_modules\.bin\tsc.cmd --noEmit`、生产构建 `.\node_modules\.bin\vite.cmd build`；Worker 构建用 `node .\scripts\build-workers.mjs`。

> **默认验证边界**：代码实现完成后，默认只做代码相关验证（已有单元/契约测试、类型检查、lint、编译或构建等），**不主动启动浏览器做 UI、可视化或交互测试**。只有用户在当前任务中明确要求时，才执行浏览器测试；不要因为历史任务曾做过浏览器验收就把它恢复成默认步骤。
>
> **受限进程下的 Vitest 结果不要直接当回归结论**：worker 创建失败并报 `spawn UNKNOWN` 属运行环境错误，不是测试断言失败。历史上 `vitest.CMD run --pool=threads --poolOptions.threads.singleThread=true` 可绕过 worker 创建，但强制单线程会让跨文件共享的 fake timers、`window`、时区等状态互相污染并制造假失败，因此只能用于诊断，不能建立整仓回归基线。最终基线应在允许标准并行 worker 的环境重跑，并逐条核对失败是否涉及本次修改文件；单文件定向运行若出现 `exit_code=1` 且无输出，也应先重试/确认运行器状态，不直接记作代码失败。

> **每次修改代码或项目文档前都执行导航读取**：先读 [`PRODUCT.md`](./PRODUCT.md) 与 [`docs/handoff/CURRENT.md`](./docs/handoff/CURRENT.md)，再按下表完整读取本次涉及的功能文档，最后检查 `git status` 与 `git log -10 --oneline`。这不是只在新对话或接手开发时执行的一次性步骤。

> 修复 bug 时，默认先直接阅读相关代码、确认根因后修改，不用先新增失败用例或专项回归测试。完成后仍运行已有的相关测试、类型检查或构建；只有用户明确要求时才补新测试。

> **验证结论必须区分“当前批次回归”和“仓库既有诊断”**：当前 `package.json` 的生产 `build` 不包含 `tsc --noEmit`，所以 Vite / Worker build 与 TypeScript strict check 是两套独立信号。若全仓类型检查非零，先与修改前基线比较，优先按“文件 + TS 错误码 + 稳定错误信息”识别新增项，不要只比较总数量；**本批新增诊断必须修，未触及路径的既有诊断只报告，不得为了“全仓清零”擅自扩散到无关文件**。拿不到可靠基线时应明确不确定性，不凭猜测大扫除。历史类型债清理必须作为独立任务 / 独立提交，遵循最小 diff，不顺手格式化、rename 或重构上游核心热点；详见 [`docs/upstream-sync-and-manual-deploy.md`](./docs/upstream-sync-and-manual-deploy.md) 的类型检查基线章节。

> **IndexedDB 迁移回归测试不要写死当前全局版本号**：旧库起点可以固定历史版本（例如 `indexedDB.open(..., 87)`），但升级结果必须断言 `upgraded.version === DB_VERSION`，不要新增 `expect(DB_VERSION).toBe(<数字>)`。`utils/db.test.ts` 中故意创建 v999 来验证“现有库版本高于当前 build 时的 VersionError 回退”属于另一种场景，不要按陈旧版本断言修改。

## 文档地图

静态资源、Service Worker 缓存、离线启动或网页更新：先读 [`docs/static-resource-cache.md`](./docs/static-resource-cache.md)。不得注销推送 SW、清应用数据库或按整个 `/assets/` 目录设置 immutable。

| 主题 | 文档 | 什么时候看 |
|------|------|-----------|
| **产品原则与跨 App 连续性** | [`PRODUCT.md`](./PRODUCT.md) | 改产品定位、隐私边界、角色身份连续性或跨 App 写回规则前必读 |
| **当前开发交接** | [`docs/handoff/CURRENT.md`](./docs/handoff/CURRENT.md) | 新对话、新工具或中断后继续开发时先读；随后检查 `git status` 与最近提交 |
| **提交范围** | [`docs/handoff/CURRENT.md`](./docs/handoff/CURRENT.md) | 公开工作区可以在本地分支提交。除非维护者明确要求，不要推送，也不要部署；不要推送到 `upstream` |
| **二改上游同步 / 手动部署** | [`docs/upstream-sync-and-manual-deploy.md`](./docs/upstream-sync-and-manual-deploy.md) | 拉取 `qegj567-cloud/SullyOS` 上游、解决二改冲突、判定类型检查基线/既有诊断、保护未跟踪参考资料、重建 Worker bundle、手动发布 Netlify 或排查 production-only 黑屏前必读 |
| **待办任务与已知问题** | [`TODO.md`](./TODO.md) | 查看或记录项目现存待修问题、交互缺陷与技术债待办 |
| **原创功能档案目录** | [`docs/features/README.md`](./docs/features/README.md) | 新增原创软件、继续上次功能开发或记录一次 Debug 前必读；每个原创功能一份长期档案 |
| **悬浮球与全局返回** | [`docs/navigation.md`](./docs/navigation.md) | 改快捷导航开关、拖动安全区、浏览器／Android 返回、美化子页退出前必读 |
| **iOS 27 主屏幕顶部白雾 / 状态栏底色** | [`docs/ios-status-bar-edge.md`](./docs/ios-status-bar-edge.md) | 改顶部取色、viewport 或 iOS 门禁前必读；manifest standalone 使用 contain，零安全区不回退 44px，异步高度收缩要重建基线；纯色接合不等于壁纸贯穿 |
| **3D 小屋 · 布局与功能分区** | [`docs/room3d-layout.md`](./docs/room3d-layout.md) | 设计或重排任何房间/样板房、自动摆家具前必读；先划功能区，再按家具组合摆放，保留连续动线，不能逐件随机找空位；本轮统一黑 × 绿 × 白 |
| **桌面收纳文件夹与空位** | [`docs/features/launcher-folder.md`](./docs/features/launcher-folder.md) | 改普通/动森桌面的应用收纳、空位、拖入/拖出、批量整理、文件夹改名或布局恢复前必读；Dock 与独立桌面皮肤保持各自边界 |
| **笔友会 · 小说共创与写作人格** | [`docs/features/pen-pal-writing.md`](./docs/features/pen-pal-writing.md) | 改 `NovelWriter` 三模式、空输入吐槽/分析、章节讨论上下文、虚构/现实边界、角色写作人格生成或处理上游同步冲突前必读 |
| **美化分享码与人工审核** | [`docs/beauty-share.md`](./docs/beauty-share.md) | 改美化投稿、作者身份、分享码领取或 `worker/beauty-share` 前必读；未审文件保持私有，更新通过后才替换已发布指针，仅作者明确授权且已审作品进入公开静态装扮库，未授权旧作不公开 |
| **角色默认对话 API** | [`docs/character-api.md`](./docs/character-api.md) | 改角色独立 API、API 预设分组或对话模型路由前必读；App 优先，单角色回复才使用角色默认，凭据整套选择 |
| **ElevenLabs 角色语音** | [`docs/elevenlabs-tts.md`](./docs/elevenlabs-tts.md) | 改 v4 / Turbo 语音、Audio Tags、模型参数或字幕前必读；v4 保留开放式标签，只发送稳定度与相似度，不自动降级 |
| **角色统计 / 上下文字数与 Token 估算** | [`docs/character-statistics.md`](./docs/character-statistics.md) | 改神经链接角色统计前必读；可读范围不等于实际请求，概率预览不得抽签，宫殿缓存单列 |
| **世界书管线、分组与角色绑定** | [`docs/worldbook-management.md`](./docs/worldbook-management.md) | 新增 App／角色生成请求或改世界书前必读；新入口使用 ContextBuilder.buildCharacterRequest，世界书自动随角色装载；绑定按 ID，库与角色缓存同事务更新 |
| **协同工作私聊衔接与转发** | [`docs/collaboration-chat-bridge.md`](./docs/collaboration-chat-bridge.md) | 改协同读取 ChatApp 范围或转发消息前必读；每轮读 DB，空范围不回退，多选只发当前窗口 |
| **开发调试面板 / 开关** | [`docs/dev-debug.md`](./docs/dev-debug.md) | 加 dev-only 开关、加调试日志、排查"角色怎么又不说话了"。含逐步指南 |
| **彼方 · 书库分类与阅读偏好** | [`docs/kanata-library.md`](./docs/kanata-library.md) | 改书籍归类、批量整理、角色选书轮换或书库备份前必读；按分类模式不得回退全书库 |
| **彼方 · 活动选择与自动范围** | [`docs/kanata-activities.md`](./docs/kanata-activities.md) | 改房间/SAR 随机选取、手动子玩法路由或高级排除设置前必读；自动全禁用不得回退，手动可绕过 |
| **记忆系统** | [`docs/memory-system-overview.md`](./docs/memory-system-overview.md) | 涉及长期记忆、月度总结、向量化记忆宫殿、情感空间。改记忆相关逻辑前必读 |
| **私聊 / 群聊输入与发送** | [`docs/chat-input.md`](./docs/chat-input.md) | 改输入偏好、回车/发送、自动回复、表情联想、屏幕伴聊或剪贴板图片直发前必读；paste 监听只挂当前聊天 textarea，图片来源复用既有发送入口 |
| **私聊心象自动译文** | [`docs/features/thinking-translation.md`](./docs/features/thinking-translation.md) | 改心象翻译开关、语言判断、副 API 路由、原文/译文切换、消息级缓存或自动触发时机前必读；原始 thinkingChain 不覆盖，历史不自动批量请求 |
| **主聊天最近会话 / 群成员可见范围** | [`docs/features/group-chat.md`](./docs/features/group-chat.md) | 改最近会话入口、私聊群聊混排、群成员邀请/移除、成员可见窗口、话题盒或群记忆隔离前必读 |
| **私聊 HTML 卡片快速修复格式** | [`docs/features/html-format-repair.md`](./docs/features/html-format-repair.md) | 改历史 HTML 手动修复、严格解析、有序复合消息、原子改写或上下文文字预览前必读；不涉及群聊和自动生成策略 |
| **心心相印 · 心理测试 / 问卷填写** | [`docs/features/heart-sync.md`](./docs/features/heart-sync.md) | 改心理单题深聊、问卷导入/补答/结算、聊天卡或记忆写回前必读；伴侣测试已删除，不要恢复 |
| **辩论赛** | [`docs/features/debate.md`](./docs/features/debate.md) | 改一对一/八人辩论、观点召回、排阵、主持人评分、赛后卡片或记忆写回前必读 |
| **角色生图（OpenAI Images 兼容）** | [`docs/features/image-generation.md`](./docs/features/image-generation.md) | 改通用文生图、提示词卡片或参考图说明前必读。不恢复已删除的参考图 edits 回退和多层响应解析；NovelAI 与多 API 抗限速仍是后续 |
| **表情包视觉理解** | [`docs/features/sticker-vision.md`](./docs/features/sticker-vision.md) | 改表情包读图能力（`utils/stickerVision.ts`、`STICKER_VISION_PROMPT` 物化管线、私聊/群聊 prompt 三态、转发快照、`metadata.stickerVision`）前必读；发送时资格冻结（旧消息永不补识别）与记忆隔离（description 不进记忆/总结）是两条铁律 |
| **API 预设全局悬浮切换器** | [`docs/features/api-preset-floating-switcher.md`](./docs/features/api-preset-floating-switcher.md) | 改 Settings 的 API 预设悬浮窗、PhoneShell 全局 Overlay、拖拽/吸边/右键、preset 切换、`commitApiConfig` 或主动消息凭据同步前必读 |
| **副 API 统一管理** | [`docs/features/secondary-api-management.md`](./docs/features/secondary-api-management.md) | 改文本副 API 功能注册表、独立 URL/Key/Model、角色覆盖、备份或辅助 LLM 路由前必读；主聊天与专用服务保持独立 |
| **桌游 / 骗子酒馆** | [`docs/features/board-game.md`](./docs/features/board-game.md) | 改桌游入口、骗子酒馆规则、视野隔离、角色行动、轮盘、存档、历史或结算写回前必读；TRPG 与桌游必须保持平行独立 |
| **自习室 · 角色学生 / 费曼课堂** | [`docs/features/character-study.md`](./docs/features/character-study.md) | 改角色选课、轻量聊天上下文、Markdown 黑板、每轮提问或私密课堂存储前必读 |
| **自习室 · 知识卡 / 知识图谱** | [`docs/features/study-knowledge.md`](./docs/features/study-knowledge.md) | 改 Markdown 知识卡、单章课堂复用、DAG 关系、AI 整理、节点删除或知识卡完成状态前必读 |
| **人生重映** | [`docs/features/life-replay.md`](./docs/features/life-replay.md) | 改日记解析、可复用过去事件、角色携记忆入场、过去的我/NPC 导演、私密演绎记录前必读 |
| **林间聊愈室 / 聊愈** | [`docs/features/healing.md`](./docs/features/healing.md) | 改聊愈原文、跨角色共享用户记忆、抽取/召回、静态陪伴画面、疗愈手记、图片或隔离备份前必读 |
| **只做一个改变** | [`docs/features/one-change.md`](./docs/features/one-change.md) | 改正式/冻结记录、稳定/重新稳定、增加资格、并行收缩、单任务观察、标准版本、历史补记或独立备份前必读 |
| **居委会** | [`docs/features/community-committee.md`](./docs/features/community-committee.md) | 改现实两难开题、1—3 人倾听、情绪剥笋、议事总结或默认聊天/记忆写回前必读；当前公开版桌面入口暂未挂载，功能代码与存储保留 |
| **任务工坊** | [`docs/features/task-workshop.md`](./docs/features/task-workshop.md) | 改任务盒、工具箱、多角色轮流来访、便签或聊天卡片前必读。公开版没有共享提醒控制台 |
| **时间胶囊** | [`docs/features/time-capsule.md`](./docs/features/time-capsule.md) | 改用户/角色胶囊、一年开启边界、主动邀请、前台轮换来访、到期开启或隐私边界前必读 |
| **我的日程** | [`docs/features/my-schedule.md`](./docs/features/my-schedule.md) | 改用户现实时间轴、自然语言时间解析、随笔原文、多角色收件控制或聊天卡同步前必读。公开版没有活动采集、睡眠同步或生活提醒 |
| **交换日记** | [`docs/features/exchange-journal.md`](./docs/features/exchange-journal.md) | 改跨角色用户页同步、可配置默认模板、角色回复生成、聊天卡或日记归档前必读 |
| **查手机 · PersonaSim / 生活记录** | [`docs/features/persona-sim.md`](./docs/features/persona-sim.md) | 改「成为 TA 的一段人生」演出生成、Director Prompt、日常/事件、tone / presence、生活噪音/变奏、演出脚本持久化或生活记录重播/发送回忆前必读；fork 已把生活碎片从硬模板改成场景优先的软灵感，上游同步时注意保护这项差异 |
| **查手机 · 自定义 App 跨手机批量安装** | [`docs/features/check-phone-custom-app-install.md`](./docs/features/check-phone-custom-app-install.md) | 改自定义 App 安装弹窗、跨角色一次性复制、默认全选、独立 App ID、同名共存或卸载边界前必读；只复制 App 配置，不建立持续同步关系 |
| **查手机 · 智能体 / 发送前 AI 扩写** | [`docs/features/check-phone-ai-agent.md`](./docs/features/check-phone-ai-agent.md) | 改智能体三服务、AI 扩写、酒馆 OOC 优先级、输入竞态、`callLLM` 上下文隔离或长会话 recap 前必读；扩写只应回填输入框，不自动发送 |
| **查手机 · 人际关系系统** | [`docs/relationship-system.md`](./docs/relationship-system.md) | 改「查手机」聊天/通讯录、角色联系人/好感、真假甄别、真角色双向对话、虚构 NPC 约束前必读 |
| **查手机 · 人格模拟与生活记录** | [`docs/persona-sim.md`](./docs/persona-sim.md) | 改「用 TA 的手机活一次」生成、保存、断点续播或完成效果前必读；生成即归档，通知不是唯一剧本，首次到结尾才加情绪效果 |
| **见面 · 观测协议 OBSERVE** | [`docs/date-observe.md`](./docs/date-observe.md) | 改见面（DateApp）的角色观测面板：提示词注入、掉格式解析容错（两层）、全息 HUD 渲染前必读 |
| **见面 · 剧情剧场 / 虚构剧情树** | [`docs/features/story-theater.md`](./docs/features/story-theater.md) | 改剧情楼层、父子拓扑、分支切换/删除、当前路径 prompt、事件盒/独立向量归档或剧情导出前必读；真实陪伴必须保持线性 |
| **捏人器 PSD 导入 / 部件投影层** | [`docs/char-creator-psd-import.md`](./docs/char-creator-psd-import.md) | 改捏人器素材管线、部件阴影（正片叠底预转）、PSD 图层组约定前必读 |
| **QQ捏人工坊（神经链接手办柜）** | [`docs/chibi-studio.md`](./docs/chibi-studio.md) | 改小小窝/彼方/520 三处 Q 版形象、捏人器 savedState 还原、`chibiStudio` 字段前必读 |
| **3D 小人 · 服装与衣橱** | [`docs/chibi-clothing-assets.md`](./docs/chibi-clothing-assets.md) | 改 3D 服装建模、肩袖/领口、蒙皮遮挡、版型参数、分类与缩略图前必读；使用当前 48 骨素体，复用认可母版，先查参考再局部制作，保留用户确定的窄肩/A 字袖规则 |
| **3D 小屋 · 家具素材与交互** | [`docs/room3d-furniture-assets.md`](./docs/room3d-furniture-assets.md)、[`docs/room3d-seating-assets.md`](./docs/room3d-seating-assets.md)、[`docs/room3d.md`](./docs/room3d.md) | 导入 GLB / 其他家具、改配色/优化/坐位/浇水前必读；清理图片贴图，自行上色，统一项目木色，拆分桌上摆件并验收 chibi 空间 |
| **角色自定义时区** | [`docs/character-timezone.md`](./docs/character-timezone.md) | **写任何跟时间有关的代码前先扫一眼**：prompt 里的「现在是」、角色作息/夜间判断、日期 key、界面上的钟。分清「角色那边几点」和「用户自己的时间」，别自己手搓时差。文末列了还没接时区的几处（主动消息 + 几块界面上的钟），**正式发版前记得过一遍** |
| **聊天时间连续性 / Temporal V2 实验** | [`docs/temporal-awareness.md`](./docs/temporal-awareness.md) | 改私聊消息时间语义、旧状态是否延续、手动生成 / reroll、时间间隔提示、主动消息 1.0 / AMSG2 时间语义，或准备恢复 `feat/temporal-awareness-v2` 前必读；文档明确区分 master 当前 Legacy 与已暂停实验分支 |
| **通用 MCP 工具服务器** | [`docs/mcp-client.md`](./docs/mcp-client.md)（开发者）、[`docs/mcp-user-guide.md`](./docs/mcp-user-guide.md)（用户教程，设置「?」弹窗跳转的就是它，改接入行为要同步） | 改用户自配 MCP 接入（设置板块、握手/session、工具循环、`?target=` 代理约定、worker/mcp-proxy）或排查「工具连不上/角色不调工具」前必读；主动消息 2.0 的后台 MCP 路径（配置上云 / fire 时注入 / worker 直连执行）也在这份 |
| **云端数据管理 / 角色删除** | [`plans/amsg2-cloud-data-management-contract.md`](./plans/amsg2-cloud-data-management-contract.md) | 改云端清单、按项清理、删除角色、停用与恢复前必读；清单以服务端实际资源为准，删除由云端持久操作执行，旧请求不可随恢复获得新代次 |
| **主动消息 2.0 · 即时对话** | [`plans/amsg2-instant-chat.md`](./plans/amsg2-instant-chat.md)（设计与取舍）、[`plans/amsg2-instant-chat-contract.md`](./plans/amsg2-instant-chat-contract.md)(端点/信封/fire_pack v7 契约) | 改「聊天在用户自己的 CF Worker 上生成」这条路（`POST /instant-chat`、`utils/amsgInstantChat.ts`、fire_pack 的 `chat` 段、chat_outbox 补收、「正在输入」超时）前必读 |
| **主动消息 2.0 · 后台任务（不说话的活儿）** | [`plans/amsg2-expansion.md`](./plans/amsg2-expansion.md) | 改「页面关着也能跑完」的后台活儿前必读：`metadata.amsgKind` → handler 注册表（`worker/amsg/src/fireKinds.ts`）、一次性输入的 `amsg:job` 命名空间与 TTL、`ctx.emitResult` 的结果回程与客户端分发（`utils/amsgResults.ts`）。文首「现状」是实况，正文是「还有哪些调用点值得搬、哪些不该搬」的取舍 |
| **主动消息 · 频率与额度** | [`docs/amsg2-pacing-limits.md`](./docs/amsg2-pacing-limits.md) | 改角色能自己排什么、连发/间隔/每日上限、重复消息没回就停、任务名额，或者改给角色看的「用户给你定的规矩」前必读；上限是代码硬闸，默认值只在 `utils/amsgLimits.ts` 定义一次 |
| **主动消息 2.0 · API 凭据引用 credRefs** | [`plans/amsg2-llm-credentials-contract.md`](./plans/amsg2-llm-credentials-contract.md) | 改凭据上云（`llm_credentials` 表、任务 `credRefs`、`utils/amsgLlmCredentials.ts` 的每角色三行）或排查「换 Key 后主动消息 401 / 不来了」前必读；文末「SullyOS 侧落地」是实况 |
| **使用统计** | [`docs/analytics.md`](./docs/analytics.md) | **加任何埋点前必读**。收什么/不收什么的边界、事件名与属性的规矩（属性只能是固定枚举）、构建时门禁与开关、完整事件清单。想加「某功能有多少人开了」看「加新埋点的规矩」第 5 条，别在配置页现场发 |
| **二改 / 加 App / 数据流 / 后端 Worker** | [`README.md`](./README.md) 「给想二改的人」一节 | 新增 App、build badge、sfworker 代理替换、开源协议 |

> README 的「给想二改的人」区域信息量很大（数据流、ContextBuilder、sfworker 清单），动后端 / 加功能前先扫一遍。

用户定位、隐私区域、地点查询与位置提示词：先读 [`docs/user-location.md`](./docs/user-location.md)。中心坐标仅本机；命中隐私圈不得查地图；不得通过 Worker／代理转发定位，也不得把原始坐标写入提示词、日志、备份或云端状态。

## 什么时候改版本号

[`utils/appVersion.ts`](./utils/appVersion.ts) 里的 `APP_VERSION`（形如 `v3.0 (Ambient Presence)`）是手工维护的，**只有大功能更新才动它**：加了新 App、新系统，或者一整套用户能直接感知到的新玩法。

性能优化、bug 修复、文案调整、重构这些都不算，做完就是做完了，既不用改版本号，也不用在收尾时问一句「要不要顺便升个版本」。拿不准就照这条判断：用户在设置页看到版本号变了，能不能说出多了什么新东西——说不出来就是不该改。

它有三个用处：设置页底部显示的就是它；统计还拿版本号那半截当标签，面板按它切分数据；网页更新也看版本号那半截，变了才给正在用的人弹「新版本已准备好」，没变的更新等下次打开或刷新时悄悄换上。版本号跟着大功能走，标签才对得上「哪一版铺开到什么程度、这版的人在用什么」；小修小补也跳版本的话，标签会碎成一堆没法比的小格子。括号里的代号只在界面上显示，不进标签。构建 hash（`BUILD_LABEL`）是自动生成的，不用管。
