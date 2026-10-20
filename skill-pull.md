# 技能文档：安全拉取项目更新与冲突解决流程 (Skill: Safe Git Pull & Merge)

> **当前维护说明（2026-09）**：本文保留早期 Safe Git Pull & Merge 的经验，但执行命令、pnpm/TypeScript/构建入口与最终主分支判断必须以根目录 `AGENTS.md`、`docs/handoff/CURRENT.md` 和 `docs/upstream-sync-and-manual-deploy.md` 为准。本文中的 `npm run type-check`、`npx -y pnpm@9 install` 等属于历史环境 / 故障绕过，不应机械作为当前默认命令。

在本地有大量未提交修改（包含新功能、Bug 修复）的情况下，直接拉取远程更新极易导致代码丢失或冲突。为了安全地合并远程更新并保留本地工作进度，必须遵循一套严格的暂存与拉取流程。

以下是标准操作流程以及我们在实践中积累的排错经验。

## 🛠️ 标准操作流 (Workflow)

### 0. 强制前置检查：关闭运行中的项目（AI 必读）
**AI 注意**：在协助用户执行本流程的更新操作前，**必须**主动提醒并确认用户已经彻底关闭了本地正在运行的项目（包括所有的开发服务器、后端代理进程、以及 MCP 相关的 `.exe` 等）。
- **原因**：因为后续有极大概率会使用 `git stash --include-untracked`，如果有相关文件（如启动脚本或二进制程序）正被运行中的进程占用（Lock），将导致 Git 文件移动操作直接崩溃，并进而引发严重的文件丢失隐患（详见下文坑点 2 和 5）。

### 1. 状态检查与准备
在执行任何操作前，永远先确认当前的工作区状态。
```bash
git status
```
- **注意**：观察有哪些文件是“已修改 (Modified)”状态，哪些是“未跟踪 (Untracked)”状态。未跟踪文件通常是新创建但还没被 Git 管理的文件。

### 2. 暂存本地修改 (Stash)
将当前的工作进度打包放入暂存区，使工作区恢复到干净状态。
```bash
# 如果你想连同新创建的未跟踪文件一起暂存：
git stash --include-untracked

# 如果未跟踪文件包含无法被操作的文件（如正在运行的 exe），上述命令会失败。
# 此时只需暂存已被追踪的文件即可：
git stash
```

### 3. 拉取远程更新 (Pull)
此时工作区是干净的，可以安全地将远程的最新代码合并过来。
```bash
# ⚠️ 注意：origin 现在指向自己的 fork（zhimaheiye/SullyOS），
# 上游原项目的更新必须从 upstream 拉取。
git pull upstream master
```

### 4. 恢复本地修改 (Pop)
将刚刚暂存的代码重新覆盖在刚刚拉取的最新的代码之上。
```bash
git stash pop
```
- **成功标志**：终端提示 `Dropped refs/stash@{0}`，说明暂存已经被成功合并并丢弃。
- **冲突标志**：终端提示 `CONFLICT (content): Merge conflict in...`，此时你需要手动解决冲突，且暂存不会被自动丢弃。

### 5. 验证与逻辑合并 (Verify)
**这是最重要的一步！** 即便 Git 提示合并成功，也必须进行代码级验证。
```bash
# 搜索是否存在残留的冲突标记
git diff --name-only --diff-filter=U 
# 或者全局搜索冲突符号
# grep "<<<<<<<" 

# 进行类型检查或构建测试
npm run type-check   # 或 npx tsc --noEmit
```

---

## ⚠️ 常见坑点与踩坑经验 (Gotchas & Troubleshooting)

### 1. “静默冲突”与“逻辑重复”（最容易犯的错）
**经验教训**：Git 只能判断**文本行**级别的冲突。如果远程代码和你本地代码在**相邻的位置但不同的行**添加了类似的功能（例如远程加了一个 `useState`，你本地也加了同样的 `useState`），Git 往往会完美合并它们，**不报任何冲突**！
- **后果**：代码中出现重复的变量声明，导致前端构建（如 Vite）直接报错崩溃（如我们之前遇到的 `isProcessingMemory` 变量冲突）。
- **对策**：不要盲目相信 `git stash pop` 的成功提示。合并后**必须**使用 `tsc` 或者运行一次 `dev` 环境，通过编译器来帮你找出这种“逻辑上的重复”。

### 2. 包含被占用的未跟踪文件导致 Stash 失败
**经验教训**：如果你使用了 `git stash --include-untracked`，而工作区里正好有一些被系统占用的未跟踪文件（如正在运行的后端程序、`.exe` 文件等），Git 会因为无法删除这些文件而报错。
- **后果**：Git 会创建一个“半成品”的 stash（可以通过 `git stash list` 看到），但工作区里的文件**并没有被真正清理**。如果你此时直接 `git pull`，会因为有本地修改而失败。
- **对策**：
  1. 先丢弃那个坏掉的暂存：`git stash drop stash@{0}`
  2. 换用普通暂存（仅暂存已追踪的代码修改）：`git stash`

### 3. 跨平台的终端兼容性
**经验教训**：习惯在命令中连写 `&&`（例如 `git stash drop && git stash`）在 Windows 早期的 PowerShell 中会报语法错误。
- **对策**：在 AI 代理或者 Windows 环境执行操作时，尽量将命令拆分为单独的执行步骤，以确保每一步的退出状态都能被准确捕获。

### 4. 冲突解决后的残留清理
如果在 `git stash pop` 后发生了文本冲突，你手动修复文件并 `git add` 后，那个 stash 记录仍然会保留在 `git stash list` 中，日积月累会导致暂存区混乱。
- **对策**：解决完冲突并提交后，别忘了手动执行 `git stash drop` 清理掉那一层旧的暂存。

### 5. 危险的 "git stash drop" 导致未跟踪文件丢失（“悬空提交”恢复法）
**经验教训**：接续第2点，如果 `git stash --include-untracked` 因为某些文件被占用而报错，**此时实际上 Git 可能已经成功把所有未被占用的未跟踪文件（Untracked files）移入了一个暂存记录中**。如果你直接执行 `git stash drop` 去丢弃这个“失败的半成品”，那么**你所有的未跟踪文件（如环境配置文件、启动脚本 `run.bat` 等）都会从工作区中彻底消失**。
- **后果**：以为没暂存成功，实则文件已经被卷入暂存区并被你随手 drop 删除了。
- **对策（紧急找回方案）**：
  1. 暂存记录即使被 drop，在 Git 底层依然是“悬空提交（dangling commit）”，不要慌。
  2. 找出被丢弃的 stash 哈希值（命令终端中 `Dropped stash@{0} (哈希值)` 会显示）。
  3. 执行 `git checkout <哈希值>^3 -- .` 或者通过 `git ls-tree -r <哈希值>^3` 查看（在暂存提交的第三个父节点 `^3` 中专门保存着所有 Untracked 文件）。
  4. 成功找回后，运行 `git restore --staged <文件名>` 将它们从 Git 的暂存区（Index）移回纯粹的未跟踪状态。

### 6. 并发操作引发的代码重复注入
**经验教训**：AI Agent 和人类开发者同时处理冲突时，如果人类开发者提前完成了冲突解决（比如点击了 VS Code 的 Accept Both 或手动处理后提交），Agent 如果仍基于旧的认识，强行用脚本去把“丢失”的远端代码再次注入，就会导致变量或导入被重复声明（如 `error TS2300: Duplicate identifier`）。
- **后果**：本已解决的冲突文件被二次破坏，填满了重复的变量声明和函数调用。
- **对策**：Agent 在准备手动注入代码或覆盖文件前，**必须再次检查该文件的最新状态（甚至直接检查 git log），确认用户是否已经处理了冲突**，不要盲目通过脚本执行强插操作。

### 7. 拉取后依赖未同步导致启动崩溃（Lockfile changed）
**经验教训**：当成功执行完 `git pull` 和合并后，远端可能引入了新的依赖包（如增加了 `@capacitor/push-notifications`）。此时直接启动开发服务器（`npm run dev`）会导致 Vite 抛出类似 `The following dependencies are imported but could not be resolved` 的错误。
- **后果**：开发环境无法启动。
- **对策（必做）**：在拉取并处理完冲突后，**必须要执行包安装命令同步依赖**。
  - 标准命令：`pnpm install`
  - 如果遇到 `corepack` 的签名校验错误（如 `Cannot find matching keyid` 或动态导入报错），可以使用 `npx -y pnpm@9 install` 临时绕过系统级 corepack 问题。
