# 二改仓库上游同步与手动部署维护记录

本文记录本二改仓库如何持续合并 `qegj567-cloud/SullyOS` 上游更新、保护本地二改，并在关闭自动部署的前提下手动发布稳定版本。

它不是某个原创功能档案，而是**仓库长期维护 / 发布流程**。

历史依据主要来自 2026-08-20、2026-08-27、2026-08-31、2026-09-01、2026-09-03、2026-09-10 的真实同步与部署现场。

## 当前事实优先级

执行任何同步 / 发布前，按以下优先级判断：

1. 当前根目录 `AGENTS.md`
2. 当前 `docs/handoff/CURRENT.md`
3. 当前工作树、分支、remote 与 Git 历史
4. 本文记录的长期经验
5. 历史 `skill-pull.md`

`skill-pull.md` 保存了早期安全 stash / merge 经验，但里面部分命令属于旧 Windows/Corepack 环境；如果和当前 `AGENTS.md` 冲突，以当前 `AGENTS.md` 为准。

当前仓库默认分支仍是：

`master`

不是 `main`。

历史上用户曾口头要求“最后保持在 main”，Agent 实查后确认仓库没有 `main`，`origin/HEAD` 指向 `origin/master`，因此最终正确停在 `master`。

## 维护目标

每次同步上游都要同时满足：

- 保留维护者的二改；
- 吸收上游新功能和修复；
- 不向上游仓库推送；
- 不 force-push 共享远端；
- 不误提交用户参考目录 / 本地资料；
- 冲突解决以业务语义为准，不机械 Accept Ours / Theirs；
- package / lockfile 变化后同步依赖；
- 生成产物发生冲突时优先从合并后的源码重新构建，而不是手拼 bundle；
- 最后将结果普通 push 到 `origin/master`；
- 发布和 Git 同步分开：push 仓库不等于自动部署。

## 同步前必须检查

### 1. 运行中的项目

历史 `skill-pull.md` 要求先确认本地开发服务器、后端代理、MCP / exe 等相关进程已经关闭。

原因不是形式要求：早期曾遇到被运行进程占用的未跟踪文件，使 `git stash --include-untracked` 无法完整移动文件，并带来未跟踪文件丢失风险。

### 2. 工作区和用户资料

至少检查：

- 当前分支；
- `git status`；
- 已有 stash；
- `origin` / `upstream`；
- 最近提交；
- 用户明确保护的未跟踪目录。

一个真实例子是：

`观影系统开发/`

2026-08-31 同步时它属于用户参考资料，必须保持：

- 未跟踪；
- 不修改；
- 不 stash；
- 不暂存；
- 不提交。

当前 `docs/handoff/CURRENT.md` 仍把它列在工作区边界中。

如果以后保护目录发生变化，以当前 handoff / 用户说明为准，不把这一目录名单写死成永久规则。

### 3. 先 fetch，再判断分叉关系

不要把“同步上游”自动理解成 fast-forward。

私有二改通常同时存在大量本地独有提交和上游独有提交，需要真实 merge。

## 2026-08-20：首次大规模上游合并与私有 fork 建立

这是后续双向维护流程的早期起点。历史现场中，本地 `master` 相对当时的 `upstream/master` 为 ahead 48 / behind 131；正式合并提交为：

`8ca77cc1 merge: sync upstream master`

这轮已经采用后来持续沿用的“按业务语义让双方能力共存”原则，而不是机械选 ours / theirs：

- 日记同时保留本地跨日记同步与失败提示，并接入上游 silent save；
- 自习室同时保留本地 `CharacterStudyRoom` 与上游 PDF 文件识别；
- `PhoneShell` 同时保留本地原创 App runtime 与上游 idle preload / browser-back guard；
- `OSContext` 同时保留本地 Blob 解析与上游陪伴语音资产备份；
- IndexedDB 在本地既有 v82 基础上吸收上游小红书 owned-post store，合并到 v83，并同时保留双方备份字段；
- Instant Push classifier 同时保留本地新闻卡格式归一化与上游日程变更 directive；
- 生成的 Worker bundle 以合并后的源码重新构建，不把压缩产物当作手工解决冲突的事实源。

历史验证记录为相关 8 组、78 项测试通过，Vite production build 通过；当时整仓 TypeScript 仍有既存诊断，但人工合并路径没有新增诊断。这里记录的是 2026-08-20 的历史现场，不代表当前 HEAD 仍有这些类型错误。

同一天，维护者新建二改仓库。历史现场随后把 `origin` 指向该仓库，原项目 `qegj567-cloud/SullyOS` 保留为 `upstream`；`master` 首次推送后，本地与远端都核对为 `8ca77cc1`。拉取前临时保护的用户笔记和参考资源在合并后恢复，没有作为本次合并内容提交。当前 remote / 分支规则仍应以 `AGENTS.md`、实际 `git remote -v` 与当前 Git 状态为准。

同日后续用户明确确认 `MY_changes.md` 与 `MY_wishlist.md` 已不再需要，删除并非误删。正式提交 `92fb6679` 将两者删除，并同步从 `docs/handoff/CURRENT.md` 的工作区保护列表移除。以后看到旧 stash、旧聊天或旧提交里的这两个文件名，不应自动恢复；只有用户重新提出需要时再重建。

## 2026-08-27：第一次成熟的双向合并

历史上游：

`upstream/master@51eecc69`

历史合并提交：

`2a7f0912 merge: sync upstream master`

当时工作区干净、无 stash，直接 merge 上游后出现 8 个文本冲突。

### 伪冲突与换行规范化

`Character.tsx` 一度表现成整文件级大冲突，怀疑是换行 / 规范化造成。

曾安全中止未完成 merge，并尝试：

`git -c merge.renormalize=true merge upstream/master`

结果同一批冲突仍存在，说明不能把所有冲突简单归因给 CRLF/LF。

长期经验：

> **renormalize 可以作为诊断手段，但如果重试后冲突仍然存在，就应回到共同祖先做真正的三方语义合并，而不是继续把冲突当换行问题。**

### 实际采用的冲突策略

以最新上游为底，逐项重放本地相对共同祖先的实质改动。

当时典型合并包括：

- 日记：保留本地午夜滚动，同时接入上游主题；
- 社交头像：兼容上游二进制令牌，同时保留本地角色主页入口；
- HTML 卡片：采用上游折叠源码栏，同时复用本地剪贴板兼容；
- GitHub 备份：采用上游完整性 / 清理流程，同时保留本地失败清理测试。

这类冲突不能用“哪边更新”决定，应看两边功能是否可以同时成立。

#### 2026-08-27 已验证的逐文件三方重放配方

当冲突表现得像整文件换行噪声、但 `merge.renormalize=true` 重试后冲突清单不变时，可把 2026-08-27 的处理顺序作为**逐文件诊断与重放模板**。它不是“所有冲突都选 theirs”的通用命令，生成 bundle、二进制、删除/重命名冲突和双方能力需要共存的文件仍必须按语义处理。

```powershell
# 1) 如已有未完成 merge，先安全退出
git merge --abort

# 2) renormalize 只做一次诊断；若冲突集合不变，不再继续归因 CRLF/LF
git -c merge.renormalize=true merge upstream/master
git diff --name-only --diff-filter=U
git merge --abort

# 3) 固定本地合并前 tip 与共同祖先，量出真正的本地语义改动
$local = git rev-parse HEAD
$base = git merge-base $local upstream/master
git diff --ignore-all-space $base $local -- <path>
git diff --stat $base $local -- <path>
git diff --numstat $base $local -- <path>
git log --first-parent --oneline "$base..$local"

# 4) 重新开始 merge。仅对“上游版可作为基线”的单个冲突文件：
git merge upstream/master
git checkout --theirs -- <path>
git add -- <path>
git diff --ignore-all-space $base $local -- <path> |
  git apply --3way --ignore-space-change --whitespace=nowarn

# 5) 每批解决后先验收，仍有 U 状态就不要提交
git diff --name-only --diff-filter=U
git diff --check
git status --short --branch
```

这套配方的目的，是把“上游最新文件”与“本地相对共同祖先真正新增的语义改动”重新做三方合并，而不是隐藏冲突。任何 `git apply --3way` 再次产生冲突的文件都回到人工语义合并；不要批量 `checkout --theirs` 整仓。

**GitHub 备份清理所有权（2026-10-05 复核）**：上传失败后的 Release / tag 清理由当前 `deleteReleaseAndTag()` 路径承担，并有现行测试覆盖；`utils/githubClient.ts` 中私有的 `discardFailedRelease()` 自 `2a7f0912` 合并后已无调用方，是可独立清理的历史残留，不代表“失败清理缺失”，也不应据此把旧调用链重新接回去。

### package / lockfile 变化

这一轮上游修改了：

- `package.json`
- `pnpm-lock.yaml`

因此冲突解决后先同步依赖，再做验证。

这条应视为同步流程固定检查项。

### 测试与类型检查的解释

当时相关测试最初 44 项中 43 项通过。

唯一失败来自本地旧测试仍断言“只有 3 次请求”，但上游已经增加附件完整性重试，再执行同样的 release/tag 清理。

正确处理是：

- 核对上游新契约；
- 放宽过时测试；
- 不为了旧断言回退上游业务逻辑。

TypeScript 全量检查还暴露出上游已有的一批严格类型债务；唯一明确位于本地/上游交界的是：

`MemoryNode.decayFactor`

上游已经删掉该字段，但本地批量导入器还在写。

因此只修这个兼容错误，没有趁 merge 扩张成全仓类型清理。

最后：

- 相关测试 44/44；
- Vite production build 成功，历史现场 6244 modules；
- merge commit 推送到私有 `origin/master`。

长期原则：

> **同步验收要区分“本次 merge 引入的问题”和“仓库原本就存在的基线问题”，不要借一次上游合并顺手重构整个项目。**

## 2026-08-31：保护未跟踪参考资料 + 可并存功能冲突

历史上游：

`upstream/master@c1461dbf`

历史合并提交：

`49784f1a merge: sync upstream master`

当时：

- 本地独有约 99 commits；
- 上游独有约 27 commits；
- `观影系统开发/` 是受保护的未跟踪参考目录。

在 merge 前先确认上游没有同名路径，避免 pull / checkout 意外覆盖这份资料。

### 四个冲突文件

- `Chat.tsx`
- `ChatModals.tsx`
- `types.ts`
- `chatPrompts.ts`

这些冲突不是二选一，而是两边在相邻位置各自加了功能：

本地：

- 最近会话 / 群成员隔离；
- 我的日程 / 心心相印等二改类型。

这次冲突记录里曾经出现过消息撤回。公开版已经不能新建撤回，以后同步时不要把撤回创建入口加回来。旧 `metadata.withdrawal` 的阅读和脱敏可以留在 `utils/messageWithdrawal.ts`。

上游：

- 协作空间；
- 语音语言；
- 聊天收藏搜索。

最终做法是：

- 保留双方 imports；
- 合并 Context 字段；
- 在本地完整 `MessageType` 联合类型上补入上游 `collaboration_file`；
- 不删除任何一侧功能。

验证：

- 定向 16 files / 105 tests 全过；
- Worker build 成功；
- Vite production build 成功，历史现场 6456 modules；
- TypeScript 只有交接文档已记录的既有诊断；
- 用户参考目录未进入提交。

这类冲突的长期判断方式：

> **同一个 union / Context / import 区域发生冲突时，先问“双方能力能否共存”，不要看到 conflict marker 就默认选一边。**

## 2026-09-10：源码冲突与生成 bundle 必须分开处理

历史上游：

`upstream/master@27987fbb`

历史合并提交：

`b67a4854272c9ee6c37d387cc5f90a3df6752cd6`

当时上游比此前多 41 commits，私有 master 有约 110 个独有 commits，涉及约 153 个路径。

merge 出现 8 个冲突，包括：

- `AGENTS.md`
- 聊天输入 / 后处理；
- `OSContext`
- sanitize；
- 多个生成的 Worker bundle。

### 源码做语义合并

当时同时保留：

- 本地表情快捷触发 + 上游强类型；
- 本地 Toast + 上游统计轮换；
- 本地撤回隐私语义 + 上游来源标签防泄漏；
- 双方文档导航。

### 生成 bundle 不手工合并

Worker bundle 属于构建产物。

正确流程是：

1. 先解决真正源码；
2. 同步上游 package / lockfile 依赖；
3. 用项目脚本重新生成冲突 bundle；
4. 再验证生成结果。

不要手工在压缩 / bundle 产物里挑 conflict。

当时最终：

- 33 files / 636 tests 全过；
- Worker 构建通过；
- Vite production build 通过；
- TypeScript 仍只有既有类型债务；
- 私有 `origin/master` 推送成功；
- 本地最终停在 `master`。

## 类型检查、构建与既有诊断：用基线判断当前批次

这一规则不仅适用于 upstream merge，也适用于日常功能开发和 Bug 修复。

### 当前仓库的两个验证信号是分开的

截至 2026-10-01 当前 `master`：

- `package.json` 的 `build` 是 `node scripts/build-chat-preview-css.mjs && pnpm run build:workers && vite build`；
- 这条 build 链路**没有**执行 `tsc --noEmit`；
- `tsconfig.json` 仍是 `strict: true`，并用 `include: ["**/*.ts", "**/*.tsx"]` 覆盖整仓 TS / TSX。

因此：

> **production build 成功与整仓 TypeScript strict check 通过是两个独立结论。**

Vite / Worker build 成功不能证明所有 TypeScript 诊断都为零；反过来，单纯出现一个 strict 类型诊断，也不能在没有进一步证据时直接写成“当前功能运行失败”。

最近的 `docs/handoff/CURRENT.md` 已记录多个批次的整仓 TypeScript 零诊断 / 通过结果，所以历史同步记录里 2026-08、2026-09 曾存在的类型债，**不能继续当成当前 HEAD 的已知问题**。只有在当前分支重新跑出来，才能再次称为当前诊断。

### 非零类型检查的默认判定流程

如果未来某个功能分支、未提交工作树或 upstream merge 上再次出现全仓 TypeScript 错误：

1. **能在修改前跑基线，就先跑基线。**
2. 修改后比较错误身份，优先看：
   - 文件；
   - TypeScript 错误码；
   - 稳定错误信息；
   - 行号只作为辅助，因为代码插入会让行号漂移。
3. **当前批次新增的诊断必须修复。**
4. 修改前已经存在、且与本批路径 / 行为无关的诊断：
   - 可以报告；
   - 不应自动扩大当前任务范围；
   - 不因为“最后还有红字”就把已验证成功的功能重新判成失败。
5. 如果一个历史诊断虽然不是本批新增，但已经能证明会影响构建、运行、数据正确性 / 数据安全，仍应处理；只是最好拆成明确的独立修复任务，而不是伪装成本功能的附带清理。
6. 如果拿不到可靠的修改前基线，必须写明“无法确认是否既有”，不要靠错误总数或印象判断。

不要只比较：

`42 errors -> 42 errors`

因为旧错误减少 2 个、新功能新增 2 个时，总数仍然不变。真正要比较的是“哪些诊断是新增的”。

### 当前批次的完成标准

当基线本来就是零诊断时，正常要求仍然是保持零诊断。

只有在基线确实非零的分支 / merge 现场，才使用“零新增诊断”作为范围控制规则。此时功能是否完成，应综合判断：

- 本次修改相关测试；
- Worker / Vite production build（按涉及范围执行）；
- 当前功能的真实行为验证；
- 相比修改前没有新增 TypeScript 诊断。

这条规则的目的不是降低质量标准，而是避免把历史技术债和当前回归混成同一件事。

### 修历史错误时采用最小差异原则

修复历史错误**本身**不会天然导致以后更难同步上游。真正提高冲突概率的是：

> **私有 fork 与 upstream 对同一文件、同一代码区域产生了更多重叠 diff。**

因此二改仓库清理技术债时：

- 一次只处理一个明确主题 / 一组同源诊断；
- 与功能开发分开提交；
- 能改 3 行就不要为了“更漂亮”重写 300 行；
- 不顺手做全文件格式化、批量 rename、import 大整理或无关类型重构；
- 尤其谨慎修改上游长期高频变化的核心共享文件，例如大型 App、共享类型、Context、数据库和聊天主链路；
- 新增 fork 专属模块时尽量把独有逻辑收敛在自己的文件中，只在上游核心入口保留最小接线。

如果某次清理唯一收益只是“让全仓红字少一点”，却会大面积改写上游核心热点，默认不应顺手做；把它留给独立技术债批次评估。

## Git 冲突处理的长期检查表

一次 upstream merge 至少检查：

- 是否仍有 `git diff --name-only --diff-filter=U`；
- 是否残留 `<<<<<<< / ======= / >>>>>>>`；
- `git diff --check`；
- import / union / Context / route 表是否发生“静默重复”；
- package / lockfile 是否变化；
- 生成文件是否应重新构建；
- 用户保护目录是否误入 index；
- 本地专项测试；
- TypeScript 报错是否属于本批；
- Worker build；
- Vite production build；
- merge commit 是否真的包含本地和上游两条历史；
- 只 push 私有 `origin/master`。

## 当前 Windows/Codex 验证命令以 AGENTS.md 为准

旧 `skill-pull.md` 曾记录：

- `npm run type-check`
- Corepack 异常时 `npx -y pnpm@9 install`

这些属于历史环境经验。

当前项目 `AGENTS.md` 已明确：

- 测试：`.\node_modules\.bin\vitest.cmd run ...`
- 类型检查：`.\node_modules\.bin\tsc.cmd --noEmit`
- Worker：`node .\scripts\build-workers.mjs`
- production build：`.\node_modules\.bin\vite.cmd build`

除非正在专门排查新的 Node / Corepack 问题，不要因为旧记录机械降回 pnpm 9。

## 自动部署为什么被关闭

维护者不希望每次 push 都消耗托管额度，因此后续把自动发布关闭。

当前仓库仍能确认：

### Netlify

`netlify.toml`

包含：

```toml
[build]
ignore = "true"
```

含义是 Git 连续部署保持跳过，需要时从本机手动发布。

### GitHub Pages

`.github/workflows/deploy-pages.yml`

当前只有：

`workflow_dispatch`

不再随 push 自动触发。

因此：

> **Git push 成功 ≠ 线上站点已经更新。**

需要公开 / 托管版本时，要单独执行发布流程。

### GitHub Pages 手动工作流的 pnpm 版本冲突

2026-08-20，提交 `af50c272`（`fix: stabilize qixi generation and workflow`）触发的 GitHub Pages 运行 `32390561598` 在 **Install pnpm** 阶段失败，依赖安装和 Vite build 都还没有开始。

Actions 原始日志明确报：

`Multiple versions of pnpm specified`

当时冲突的两个来源是：

- `.github/workflows/deploy-pages.yml`：`pnpm/action-setup@v4` 显式写了 `version: 10`；
- `package.json`：`packageManager` 声明 `pnpm@11.20.0`。

这不是七夕业务代码或本地 production build 的失败；同一批本地测试与 build 已通过。远端 CI 在工具链初始化阶段就提前退出。

截至 2026-10-03 当前 `master`，这两个版本声明仍同时存在。2026-08-25 的 `6ddb7d0f` 只关闭了 push 自动触发，保留 `workflow_dispatch`，并没有修复 pnpm 冲突。因此当前 Pages workflow 虽然只会手动运行，但在修正版本来源前**不能视为可用的手动发布通道**。

后续若恢复 GitHub Pages，先让 pnpm 版本只有一个权威来源或保证 action 与 `packageManager` 一致，再重新跑 workflow 验收；不要用“本地 build 成功”推断 Pages CI 也能通过。

## 2026-09-01：从稳定 master 手动发布 Netlify

当时本地正在：

`feat/temporal-awareness-v2`

该分支比稳定 master 多 6 个尚未合并 commits。

用户明确要求发布：

`master@49784f1a`

正确做法是：

1. 暂时切到 stable master；
2. 重新生成 Worker；
3. Vite production build；
4. 确认 HEAD 仍是目标稳定 commit；
5. 手动发布 `dist`；
6. 清理部署工具产生的工作树副产物；
7. 切回原功能分支。

这避免把未合并实验代码误发到生产站。

### Netlify CLI 的两个真实坑

当时没有全局 Netlify CLI，使用 pnpm 临时调用。

直接：

`pnpm dlx netlify-cli ...`

失败，因为 `netlify-cli` 同时暴露：

- `netlify`
- `ntl`

pnpm 无法自动决定 binary。

需要显式：

`pnpm --package=netlify-cli dlx netlify ...`

之后又因为 monorepo / workspace 内检测到两个 Netlify 项目，在非交互终端要求选项目。

历史根应用 filter：

`aetheros-simulator`

因此发布时还需要指定正确 project filter。

这里的 package 名、filter 名和 Netlify CLI 行为都可能随未来仓库变化；恢复发布时先以当前 Netlify 配置为准，不要只复制旧命令。

### 部署工具会污染本地工作树

历史发布后 Netlify CLI 改写过 3 个已跟踪的本地构建缓存 / manifest 类文件。

这些只是发布副产物，不应该跟着功能分支提交。

长期规则：

> **手动 deploy 后必须再次检查 git status；只还原由部署命令产生的缓存漂移，不能顺手清掉用户自己的工作。**

## 2026-09-03：线上 HTTP 200 仍然可能首屏崩溃

一次手动发布后，域名本身可访问，但用户实际打开看到纯黑页面。

浏览器控制台第一个致命错误是：

`createBlobStore: prefix must be a non-empty string`

最初看起来像 Blob Store prefix 问题。

Agent 一度准备显式写回既有 `blobref:` 前缀。

但第一次修复后，验证又暴露第二个循环初始化错误：

React `createContext` 尚未就绪。

这说明 prefix 报错只是**循环 chunk 初始化顺序造成的第一个可见症状**，不是根因。

### 真正根因：Vite manualChunks 规则过宽

当时 `vite.config.ts` 的分包逻辑使用：

`id.includes('react')`

来判断 React 依赖。

这个条件过宽，会把“路径字符串里只是碰巧带有 react / React peer 信息”的非 React 包也归进 `vendor-react`。

同时又强制拆出 memory-palace chunk，最终形成：

`vendor ↔ vendor-react ↔ memory-palace`

循环加载。

真实修复提交：

`8ffecec2 fix: prevent circular production chunks`

最终只修改：

`vite.config.ts`

修复原则：

- React chunk 只匹配真正的：
  `node_modules/react`
  `node_modules/react-dom`
  `node_modules/scheduler`
- 不再强制把 memory palace 源码拆成独立 manual chunk。

当前 HEAD 仍保留更精确的正则：

`/[\\/]node_modules[\\/](?:react|react-dom|scheduler)[\\/]/`

### 这个 Bug 留下的关键经验

1. **production build 成功不代表浏览器一定能启动。**
2. HTTP 200 只证明静态文件能返回，不证明 JS 初始化成功。
3. 遇到首屏黑屏应看浏览器第一个 runtime fatal error，而不是先重部署。
4. 修掉“第一个报错”后必须继续真实启动验证，因为它可能只是被循环初始化放大的表象。
5. manualChunks / bundler 分包错误通常只能在 production bundle 的真实加载顺序下暴露，dev server 可能完全正常。

这也是少数应该把“真实 production 页面启动”作为验证的一类改动。

## Netlify 发布时的资源问题

2026-09-03 修复后第一次重新发布没有上线：

Netlify CLI 上传前又强制执行了一遍完整构建，本机第二次构建遇到：

`esbuild ENOMEM`

这不是新代码回归。

当时处理方式：

- 保留已经验证通过的 production 产物；
- 释放本地 preview 进程 / 内存；
- 再发布；
- 线上确认 SullyOS 锁屏可正常出现且没有新的 fatal error。

长期经验：

> **部署流程再次触发 build 时，要把“构建工具资源耗尽”和“业务代码构建失败”区分开；不要因为 ENOMEM 直接回滚正确代码。**

## 发布验收应该分四层

手动发布后至少区分：

1. **Git 层**：目标 commit / branch 是否正确；
2. **Build 层**：Worker + Vite production build 是否成功；
3. **Deploy 层**：Netlify 是否真的显示 deploy live；
4. **Runtime 层**：正式 URL 是否不仅 HTTP 200，而且页面能完成启动、控制台无 fatal error。

2026-09-03 的黑屏正说明只检查前三层还不够。

## 手账桌面入口

2026-08-24，二改曾用 `dd8413bd feat: restore handbook desktop app` 把上游暂时隐藏的“手账”放回桌面。那不是把已删除的 App 移植回来：`HandbookApp` 与 `PhoneShell` 加载链一直都在，上游只在 `constants.tsx` 注释桌面项：

`// { id: AppID.Handbook, name: '手账', icon: 'Handbook', color: 'fuchsia' }, // Hidden temporarily, pending update`

2026-10-16 复核公开上游 `27f060c1`，这一行仍然注释。本公开工作区跟随上游，桌面入口继续注释，手账代码不删。不要因为旧的开发提交再把入口打开。

## 清理已被主线包含的旧分支

2026-09-05 清理旧 Forum 分支时出现过一次值得保留的判定陷阱：

`git rev-list --left-right --count master...旧分支` 当时返回 `139 0`。其中左侧 139 是 **master 相对旧分支新增的提交**，不能反过来理解成“旧分支有 139 个未合并提交”。删除前最终采用的安全证据是：

- `git merge-base --is-ancestor <旧分支> master` 成功；
- `git rev-list --count master..<旧分支>` 为 0；
- merge-base 与旧分支 HEAD 相同，且 `git branch --contains <旧HEAD>` 包含 master。

只有这类证据确认旧分支没有独有提交后，才使用 `git branch -d`（不是 `-D`）并删除远端分支；删除后再列出本地/远端 refs 验收。不要只看一组 ahead/behind 数字就判断分支是否安全可删。

## 恢复维护时的默认流程

以后用户说“把上游最新更新合进我的二改”时：

1. 读当前 `AGENTS.md`、`CURRENT.md` 和本文；
2. 检查当前 branch / status / remotes / stash / 受保护目录；
3. 确认需要占用文件的本地进程已经关闭；
4. fetch `origin` 与 `upstream`；
5. 判断是 fast-forward 还是双向 merge；
6. merge 上游；
7. 源码冲突做语义合并；
8. 生成 bundle 冲突从源码重建；
9. lockfile 变化后同步依赖；
10. 跑与冲突相关的定向测试；
11. 运行当前 AGENTS 指定的 TypeScript / Worker / Vite 验证；
12. 区分本批错误和既有基线；
13. 审计 staging，确保用户资料没进入提交；
14. 创建 merge commit；
15. 普通 push 私有 `origin/master`；
16. 核对工作区、远端 HEAD 与最终分支。

如果用户还要求“发布到 Netlify”，再另起发布步骤；不要默认 push 后自动部署。

## 相关历史提交

- `8ca77cc1` — 2026-08-20，首次大规模 merge upstream master，并建立私有 fork 的 origin/upstream 拓扑
- `2a7f0912` — 2026-08-27，merge upstream master
- `49784f1a` — 2026-08-31，merge upstream master
- `8ffecec2` — 2026-09-03，修复 production circular chunks
- `b67a4854` — 2026-09-10，merge upstream master

这些提交仍存在于开发历史中，但涉及“当前实现”的问题仍应读当前 HEAD，不能把历史 merge 快照当现在的代码状态。


## 历史双分支同步：同一修改不要手工复制

交换日记开发阶段曾同时维护 `master` 与 `feat/temporal-awareness-v2`。同一组修改需要跨分支时，历史上验证过的安全顺序是：先用 pathspec 精确限定 `git stash push -m ... -- <逐个文件>`，切到 `master` 后恢复并只在 master 提交、验证一次，再用普通 `git merge --no-edit master` 把该提交带入实验分支；两个分支分别 push。推送前可用 `git ls-remote --heads` 核对远端分支状态。发生冲突时逐文件按语义解决，`docs/handoff/CURRENT.md` 这类分支状态文件保留各分支自己的内容，不机械覆盖。

这是**历史双分支维护方法**，不是当前分支拓扑要求。旧计划曾设想 Temporal V2 完成后整体合回 master，但该计划从未执行；当前 `docs/temporal-awareness.md` 已明确旧实验分支只留在远端且明显落后 master，**不得再把旧分支整体 merge 回 master**。因此今天若需要同步某个仍有价值的旧改动，应重新按当前 HEAD 判断具体提交/文件，而不是恢复当年的“最终整体合并”计划。
