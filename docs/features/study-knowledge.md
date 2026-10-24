# 自习室 · Markdown 知识卡与知识图谱

## 档案信息

- 类型：现有“自习室”App 的知识学习入口，不新增桌面 App，也不替代“角色自习室 / 费曼课堂”。
- 当前状态：可用。
- 首版日期：2026-08-31。
- 首版提交：`28ecc37a5374453dba9743cf34cd98cc2ba37c51`（`feat: add study knowledge graph`）。
- 最近归档复核：2026-10-01；当前 `master` 仍沿用首版的“单知识卡 + 多父 DAG + 既有课堂复用”核心模型。
- 数据基线：复用 `StudyCourse`、`StudyChapter`、`QuizSession` 与 `courses` IndexedDB store。

## 最初开发需求

这项功能不是为了给自习室再加一个“新玩具”，而是为了降低真实备考使用时的启动摩擦。

原流程需要先让外部 AI 整理结构化文档，再转成 PDF，最后导入自习室；而自习室又把整份文档当作一本课程，自动拆成 3—8 章。对于“我现在只想把一个知识点学懂”这种场景，这条链路太重，而且会把本来已经整理好的一张知识内容再次拆章。

因此首要目标被明确为：

1. 可以直接粘贴 Markdown，不再为了录入知识卡先转 PDF。
2. **一段 Markdown = 一张知识卡 = 一个完整学习单元**；内部的 `# / ## / ###` 只负责排版，永远不能再次拆章。
3. 不重做学习交互。继续使用原自习室已有的角色讲解、追问、重新生成、刷题、批改、错题追问和练习册。
4. 原 PDF 多章节课程必须继续保留；知识卡是并列入口，不是替代旧课程。
5. 创建知识卡时不强迫用户先决定“它属于哪个学科 / 文件夹”。刚开始学习时本来就可能不知道知识该怎么组织，录入和整理必须解耦。
6. 知识组织最终采用“关系图谱”而不是严格目录树：同一个知识可能同时属于多个知识体系，因此允许多个父节点。
7. 第一版不追求重型图编辑器。用户接受不做鼠标拖节点 / 拖线，关系通过明确的添加、解除操作维护。
8. 标题由用户手动填写；不从 Markdown H1 自动取名，也不让 AI 替用户决定标题。
9. 首版暂不提供已保存 Markdown 的二次编辑。
10. “学懂 / 完成”继续沿用现有自习室逻辑：学习后由现有刷题与用户操作推进，不额外建立一套 AI 自动判定掌握度的状态机。

## 关键产品决策与原因

### 学习单位变了，但课堂不变

真正需要变化的是“课程的最小单位”，不是交互方式。

普通 PDF 课程仍然是：

`一个文档 → 多个 StudyChapter`

知识卡则固定为：

`一个知识点 → 一个 StudyCourse(kind='knowledge') → 一个 knowledge-main StudyChapter`

这样可以继续复用成熟的课堂、角色上下文、讲义缓存、测验和练习册，不需要维护第二套容易漂移的教学系统。

### 录入与整理分开

新建知识卡只要求“标题 + Markdown”，不要求分类。非空内容保存后可以直接进入课堂；空 Markdown 则可以先保存成概念节点。

图谱整理是后续动作：知识积累到一定程度后，用户再手动整理，或主动调用“AI 整理”。这条边界是为了避免“先想好知识体系”重新变成学习启动前的摩擦。

### 为什么是 DAG，而不是严格树或任意图

严格树无法表达“一张知识卡属于多个上位概念”；任意知识图谱又会立刻引入关系类型、任意连线、复杂布局和编辑语义。

首版因此收敛为单一关系：

`上位知识 → 下位知识`

允许多父、多子和断开节点，但禁止形成环。它足够表达跨体系复用，又能继续使用确定性的拓扑校验和自动布局。

### AI 只整理关系，不拥有知识内容

AI 可以建议创建空概念节点、增加关系、解除关系，但不能改标题、改 Markdown、删除、合并、复制知识卡，也不能修改学习状态。模型输出只是 proposal；用户确认前不落库，确认时还要再走本地校验。

这是为了让 AI 帮忙“整理”，而不是把用户已经确认的学习资料重新解释成另一份事实源。

## 初版实现

### 用户流程

自习室书架保留角色助教、角色自习室、练习册和设置，并增加一级切换：

- **知识图谱**：当前默认 Tab；查看知识节点、创建知识卡、管理关系、调用 AI 整理。
- **课程**：保留原 PDF 导入和多章节课程书架。

新建知识卡：

1. 点击“+ 新建知识卡”。
2. 手动填写标题；Markdown 可为空。
3. Markdown 非空：保存后直接进入既有课堂。
4. Markdown 为空：只保存概念节点并返回图谱，不调用课堂 API。

有正文节点点击后进入课堂；空概念节点点击后进入关系管理。节点上的管理按钮始终可直接整理上下位关系。

### 数据与兼容

`types.ts` 在既有 `StudyCourse` 上做兼容性扩展：

- `kind === 'knowledge'`：知识节点。
- `kind` 缺失或不是 `knowledge`：普通 PDF 课程；历史存档无需迁移。
- `knowledgeParentIds`：当前节点所有直接上位知识 id。
- 知识卡始终只有一个固定章节 `knowledge-main`。
- 已学习状态继续使用 `chapters[0].isCompleted` 与 `totalProgress`，不建立第二套进度字段。

没有新增 IndexedDB store，也没有因为该功能提升 DB version。

### 课堂与 Source Material

`createKnowledgeCourse()` 直接创建单章知识卡，完全绕过 `generateCurriculum()`。因此 Markdown 标题不会进入课程拆章逻辑。

`getStudySourceText()` 是讲解、追问和刷题的统一取材入口：

- 知识卡：返回完整 `rawText`。
- 普通课程：保留旧有的平均切片 + 2000 字重叠行为。

当前 `StudyApp` 的 `handleTeach()`、`handleAskQuestion()`、`generateQuiz()` 都通过该 helper 取材。知识卡不会再套用普通课程的按章节切片。

课堂 UI 复用原实现；知识卡隐藏章节目录，底部动作从“下一章”变为“完成学习”。完成后唯一章节置为完成、进度变成 100，并回到知识图谱。再次进入时继续读取既有讲义缓存，需要新解释时沿用“重新生成讲解”。

### 角色上下文与记忆

知识卡课堂不是独立私密会话，而是**继承普通课程当前的角色课堂语义**：

- 讲解和追问继续使用当前角色上下文，并沿用记忆宫殿注入与 `ContextBuilder` 请求构建。
- 完成知识卡时，当前 `handleFinishChapter()` 仍复用普通章节逻辑生成一条简短 `[教学]` 记忆并写回角色资料，然后返回知识图谱。
- 刷题继续复用 `QuizSession`、批改与错题追问；没有 `KnowledgeQuiz` 第二套模型。

只有“AI 整理知识图谱”明确脱离角色人格与角色记忆：它只使用自习室 `effectiveApi` 做资料结构整理。

因此以后修改普通自习室课堂 / 刷题行为时，应优先让知识卡继续继承当前实现，而不是复制一份知识卡专属 prompt。

### 图谱与关系

知识关系存储在 child 的 `knowledgeParentIds` 中：

`A → B` 表示 `B.knowledgeParentIds` 包含 `A.id`。

同一知识卡可以拥有多个 parent，但始终只有一个 `StudyCourse`、一份 Markdown、一份课堂缓存、一份学习状态和同一组 Quiz 归属。

`KnowledgeGraphView` 使用 React Flow + dagre：

- Top → Bottom 自动布局。
- 支持平移、缩放、适应视图。
- `nodesDraggable={false}`。
- `nodesConnectable={false}`。
- 不保存自由坐标。

关系管理面板提供添加上位知识、添加下位知识、解除关系。所有关系写入都必须经过本地校验：

- 节点存在。
- 双方都是 knowledge。
- 不是 self edge。
- 不是重复 edge。
- 添加后不会形成 cycle。

删除节点只删除节点本身及其它知识节点对它的直接引用，不级联删除上下游节点，也不自动把原父子补成新 edge。

### AI 整理

`studyKnowledgeOrganizer.ts` 把所有 knowledge node 的以下信息交给当前自习室 API：

- id
- title
- hasContent
- 正文预览
- parentIds

模型只允许返回：

- `createNodes`
- `addRelations`
- `removeRelations`

新建项只能是空正文概念节点。

UI 先展示操作和 reason。用户点击“确认应用”时，`validateOrganizerProposal()` 会基于当前课程集合重新模拟：

1. 解除关系。
2. 解析 / 创建临时节点。
3. 添加关系。
4. 检查引用、类型、同名、重复和 cycle。
5. 全部合法后才用 `DB.saveCourses()` 在同一 readwrite transaction 中批量保存。

模型 proposal 不是事实源，本地验证后的图才是。

### 空概念节点的首版边界

产品语义上，一个节点可以同时拥有自己的知识内容和子知识；但首版 UI 明确不提供“已保存正文编辑”。

因此：

- 用户创建时可以直接创建“有正文节点”，它同样可以继续拥有子节点。
- 用户或 AI 也可以创建“只有标题的空概念节点”，用于组织图谱。
- 当前空概念节点不能在 UI 中事后补 Markdown；这是已知的首版范围，而不是数据模型限制。

## 备份与恢复

完整备份继续直接导出 / 恢复 `courses` store，所以 `kind` 与 `knowledgeParentIds` 会和其它 `StudyCourse` 字段一起保存。

旧备份中的课程没有 `kind` 时继续按 PDF 课程解释；不需要专门的 knowledge backup，也不需要迁移脚本。

## 明确不做

首版明确不做：

- 已保存 Markdown 编辑与自动保存。
- 按 Markdown heading 拆卡、AI 自动拆分正文或生成新正文。
- 创建知识卡时强制分类。
- 拖节点、拖线、自由坐标。
- 多种关系类型、前置 / 相似 / 易混淆等语义边。
- 复杂图算法或任意环图。
- AI 自动修改标题 / 正文、删除 / 合并 / 复制已有知识卡。
- AI 未经确认直接落库。
- 独立课堂、独立测验、独立备份。
- 重构或合并 `CharacterStudyRoom`。

## 迭代与验证记录

### 2026-08-31 · 首版落地

提交：`28ecc37a5374453dba9743cf34cd98cc2ba37c51`

首版一次性落地了：

- `StudyCourse.kind / knowledgeParentIds`。
- 单章知识卡和统一 Source Material helper。
- 知识图谱、关系管理、AI 整理预览与 DAG 校验。
- `DB.saveCourses()` 批量事务。
- React Flow + dagre 依赖。
- 知识卡专用逻辑与 StudyApp 接线测试。

该提交的交接记录显示：自习室专项 4 个文件 34 项测试通过，Worker 构建与 Vite 生产构建通过；当时没有执行浏览器测试。整仓当时仍有两项与本功能无关的既有失败。

### 2026-10-01 · 删除旧开发对话前复核

重新对照当前 `master`：

- `StudyCourse` 仍使用可选 `kind` 与 `knowledgeParentIds`，旧数据继续按普通课程兼容。
- `StudyApp` 仍以知识图谱为默认 Tab，知识卡仍绕过 `generateCurriculum()` 并复用现有课堂 / Quiz。
- `utils/studyKnowledge.ts` 仍负责单章模型、多父 DAG、cycle 检测和 organizer proposal 校验。
- `@xyflow/react` 与 `@dagrejs/dagre` 仍为当前依赖。
- AGENTS、PRODUCT、`docs/features/README.md` 和 `docs/handoff/CURRENT.md` 已有对应路由 / 当前实现摘要，因此本次只补充本长期档案中的**最初动机、设计取舍、角色记忆语义和首版边界**，不重复建立第二份归档。

本次只是文档归档复核，没有重新运行测试，也没有修改功能代码。

## 当前状态与未完成项

### 已完成

- Markdown 直接录入知识卡。
- 单知识 = 单 StudyCourse = 单固定章节。
- PDF 多章节课程并行保留。
- 既有讲解、追问、讲义缓存、刷题、批改、错题追问和练习册复用。
- 多父 DAG、自动布局、手动关系管理。
- AI 关系整理 proposal、预览确认与本地二次校验。
- 空概念节点。
- 节点删除关系清理。
- 旧课程 / 备份兼容。

### 暂未实现

- 已保存 Markdown 编辑，因此空概念节点也没有 UI 补正文入口。
- 拖拽式节点编辑 / 拖线建边 / 自由坐标。
- 多关系类型。
- AI 自动拆卡或内容改写。
- 更重型的知识图谱能力。

这些不是首版遗漏 Bug；除非后续需求明确改变，否则不要为了“更像知识图谱”擅自扩展。

## 关键文件与接手入口

- 主业务编排：`apps/StudyApp.tsx`
- 类型：`types.ts`（`StudyCourseKind`、`StudyCourse`）
- 纯逻辑：`utils/studyKnowledge.ts`
- AI 整理：`utils/studyKnowledgeOrganizer.ts`
- 数据持久化：`utils/db.ts`（`courses`、`saveCourse()`、`saveCourses()`）
- 图谱：`components/study/KnowledgeGraphView.tsx`、`KnowledgeGraphNode.tsx`
- 创建：`components/study/KnowledgeCardModal.tsx`
- 关系管理：`components/study/KnowledgeRelationModal.tsx`
- AI 预览确认：`components/study/KnowledgeOrganizerModal.tsx`
- 逻辑测试：`utils/studyKnowledge.test.ts`
- StudyApp 接线回归：`utils/studyKnowledge.wiring.test.ts`
- 相邻但独立功能：`docs/features/character-study.md` 与 `components/study/CharacterStudyRoom.tsx`

## 维护不变量

以后修改这块时至少守住：

1. `generateCurriculum()` 只服务 PDF 多章节导入，知识卡不能重新走自动拆章。
2. `handleTeach()`、`handleAskQuestion()`、`generateQuiz()` 继续统一通过 `getStudySourceText()` 取材。
3. 知识卡交互优先复用“当前的”自习室课堂 / Quiz；不要复制一份随后和主课堂漂移的实现。
4. 所有关系写入都经过 `validateKnowledgeRelation()` 或 `validateOrganizerProposal()`，不能只依赖 UI。
5. AI organizer 只整理结构，不接管用户知识正文。
6. 删除知识节点后清理其它节点的 `knowledgeParentIds`，但不得级联删除。
7. 旧 `StudyCourse` 没有 `kind` 时必须继续可读。

## 修改后的最小验证

当前 AGENTS 对 Windows / Codex shell 的建议是直接调用项目本地入口。至少运行：

```powershell
.\node_modules\.bin\vitest.cmd run utils/studyKnowledge.test.ts utils/studyKnowledge.wiring.test.ts
.\node_modules\.bin\vite.cmd build
```

如果改到了 `CharacterStudyRoom` 或共享自习室逻辑，再追加对应 character-study 测试。若改动 PDF 导入 / 解析链，也要追加相关 PDF 测试。
