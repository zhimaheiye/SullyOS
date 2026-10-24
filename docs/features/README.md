# 原创功能档案库

这个目录专门保存 SullyOS 中由用户提出、在原项目基础上新增的软件或大型功能。它不是临时待办，而是跨对话、跨工具的长期开发档案。

## 使用方式

当用户说“继续上次进度”“修改之前做的软件”或提到某个原创功能时，接手者按以下顺序读取：

1. 根目录 [`AGENTS.md`](../../AGENTS.md)：找到对应档案。
2. [`PRODUCT.md`](../../PRODUCT.md)：确认隐私、角色连续性和写回原则。
3. [`docs/handoff/CURRENT.md`](../handoff/CURRENT.md)：了解当前尚未提交或尚未验证的工作。
4. 本目录中对应功能的专属档案：恢复最初需求、版本历史、Bug 记录和维护入口。
5. `git status`、`git log -10 --oneline`，再用档案中记录的提交查看实际差异。

文档只能帮助定位，Git 和当前代码才是最终事实。若档案与代码不一致，应先核对提交，再修正文档。

## 当前档案

- [`side-story-creation.md`](./side-story-creation.md)：私聊/群聊临时番外与明确发布的 HTML 卡片创作。
- [`manual-model-relay.md`](./manual-model-relay.md)：前台文字请求人工复制粘贴接力。
- [`murder-mystery.md`](./murder-mystery.md)：不附带第三方故事的通用剧本杀引擎、主持台与独立存档。
- [`real-places-character-schedule.md`](./real-places-character-schedule.md)：默认关闭、设备地图配置与隐私过滤的角色地点日程。

- [`launcher-folder.md`](./launcher-folder.md)：普通/动森桌面的收纳文件夹、可保留的空位、拖入/拖出、批量整理与主题备份。
- [`html-format-repair.md`](./html-format-repair.md)：私聊历史裸 HTML 的手动本地修复、严格完整性校验、有序复合消息与原子改写。

- [`persona-sim.md`](./persona-sim.md)：查手机 Persona Simulation / 生活记录；演出生成上下文、脚本持久化与回忆写回，以及生活噪音/随机变奏去模板化的产品边界和 fork 专属 Prompt 修复。
- [`check-phone-custom-app-install.md`](./check-phone-custom-app-install.md)：查手机自定义 App 跨手机批量安装；安装时默认全选其他角色并复制 App 配置，安装后各副本完全独立、内容仍按各角色上下文生成。
- [`check-phone-ai-agent.md`](./check-phone-ai-agent.md)：查手机「智能体」与发送前 AI 扩写；三种服务身份语义、酒馆 OOC 优先级、输入竞态保护、上下文隔离边界与 fork 专属接线。
- [`pen-pal-writing.md`](./pen-pal-writing.md)：笔友会小说共创；三模式空输入语义、当前章节完整讨论上下文、虚构/现实边界，以及与用户上下文隔离的 Character-only 写作人格。

- [`group-chat.md`](./group-chat.md)：主聊天最近会话入口、私聊/群聊混排、群成员邀请与移除，以及按成员实际在群时段隔离的知识边界。
- [`thinking-translation.md`](./thinking-translation.md)：私聊心象的全局自动译文开关、副 API 路由、原文保留、消息级缓存和生成完成后的触发边界。
- [`heart-sync.md`](./heart-sync.md)：心心相印，包含单题心理测试深聊与两阶段问卷填写。伴侣测试已删除。
- [`debate.md`](./debate.md)：辩论赛，一对一与八人正式赛。
- [`sticker-vision.md`](./sticker-vision.md)：表情包视觉理解，三层开关（全局/角色/群）、发送时资格冻结（旧消息永不补识别）、识图 API 转文字描述或主模型直读图、转发语义保留与记忆隔离。
- [`api-preset-floating-switcher.md`](./api-preset-floating-switcher.md)：API 预设全局悬浮切换器，PhoneShell 全局 Overlay、拖拽吸边、共享 API commit 路径、主动消息凭据同步，以及首版 pointer-events / 右键 / 饱和度修复历史。
- [`secondary-api-management.md`](./secondary-api-management.md)：文本副 API 按功能独立配置、旧配置回退、真实请求路由、备份与调用记录边界。
- [`board-game.md`](./board-game.md)：与 TRPG 平行的桌游容器；首个游戏“骗子酒馆”由本地规则裁决，四名玩家各自保有隐藏信息并直接博弈。
- [`character-study.md`](./character-study.md)：自习室中的角色学生/费曼课堂。
- [`study-knowledge.md`](./study-knowledge.md)：自习室中的 Markdown 单知识卡、可编辑 DAG 与 AI 整理预览。
- [`life-replay.md`](./life-replay.md)：人生重映，把过去事件整理成可编辑预设，与角色共同进入并改变模拟走向。
- [`community-committee.md`](./community-committee.md)：居委会，让 1—3 位角色携共同上下文陪用户梳理现实两难，按情绪剥笋逐层倾诉并默认写回克制总结。当前公开版桌面入口暂未挂载，功能代码与存储保留。
- [`task-workshop.md`](./task-workshop.md)：任务工坊，多位角色轮流查看共享任务空间并留下有限建议；用户确认后才带到聊天或工具流程。
- [`time-capsule.md`](./time-capsule.md)：时间胶囊，用户与角色把内容封存到一年以内的未来；角色可被主动邀请或按前台来访顺序自己留下胶囊。
- [`my-schedule.md`](./my-schedule.md)：我的日程，用自然语言形成用户现实时间轴；随笔保持原文，并自动把新日程卡同步给控制中心所选角色。
- [`exchange-journal.md`](./exchange-journal.md)：交换日记。同日用户页同步保留；新的空白页可以使用内置、自定义或空白默认模板。
- [`healing.md`](./healing.md)：林间聊愈室，保留逐字私密手记，并在仅本 App 可读的空间中让所有陪伴角色共享以用户为主体的长期记忆。
- [`one-change.md`](./one-change.md)：只做一个改变，独立 local-first 习惯实验、标准版本、并行收缩、冻结观察和晚到补记。
- [`story-theater.md`](./story-theater.md)：见面中的剧情剧场、虚构剧情分支树、当前路径上下文、分支归档与独立向量隔离。

## 每次开发必须记录什么

新增原创软件时，复制 [`TEMPLATE.md`](./TEMPLATE.md) 建立一份专属文档，并在 `AGENTS.md` 文档地图中登记。之后每轮开发都在同一文件追加，而不是另开零散笔记。

至少记录：

- 最初需求：用户当时真正想解决什么、明确要求与明确不做的内容。
- 初版实现：入口、完整用户流程、上下文/记忆、隐私、存储和关键技术决策。
- 迭代与 Debug：现象、根因、修复方式、回归测试，以及对应日期/提交。
- 当前状态：已完成、未完成、尚未用真实 API 验证的部分。
- 接手入口：关键代码、数据表、测试和下次修改前必读资料。

小修复也应写入“迭代与 Debug”，但不要粘贴聊天流水账或大段源码。目标是让没有参与过原对话的开发者，读完一份档案就知道为什么这样设计、以前踩过什么坑、下一步从哪里开始。

## 三类文档的职责

- `docs/features/*.md`：一个仍在公开版里的原创功能一份档案，写当前行为和仍然有效的限制。已经删除的功能、不准备公开的第三方参考调查，不要留成整篇旧档案。
- `docs/handoff/CURRENT.md`：只写当前正在做、尚未提交或尚未验证的事情；完成后更新到下一个目标。
- `tasks/plan.md` 与 `tasks/todo.md`：本轮执行计划和勾选状态，可以随当前任务替换，不承担长期历史。
