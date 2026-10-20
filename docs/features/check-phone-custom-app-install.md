# 查手机 · 自定义 App 跨手机批量安装

## 档案信息

- 类型：现有 App 子模块
- 当前状态：可用
- 首版日期：2026-08-28
- 首版提交：`08ad55b728373be6a5dc78cb641e6998567dbdd3`（`feat: install custom apps across phones`）
- 最近核验：2026-10-01，`master@248e43f0d85a73e48336c71d23df085e4edc150d`
- 核验结论：首版逻辑仍存在于当前 `apps/CheckPhone.tsx`，专项接线测试仍存在于 `utils/checkPhoneCustomAppInstall.wiring.test.ts`

## 最初开发需求

「查手机」允许为单个角色安装自定义 App，但很多 App 对多个角色都是通用的。用户不希望为每个角色重复填写同一套名称、图标、颜色、功能 Prompt 和界面样板，因此需要在**创建 App 的这一刻**把同一份配置一次安装到多个角色手机。

最终确认的产品边界：

- 当前正在查看的角色手机一定安装，不出现在同步目标列表里。
- 其他角色在打开安装弹窗时**默认全部选中**；用户可逐个取消，也可一键全选 / 取消全选。
- 选择列表只做头像 + 角色名 + 勾选，不做角色分组筛选；角色多时滚动即可。
- 同步只发生在安装瞬间。安装完成后，不保存「来源 App」「同步组」「关联角色」等关系。
- 被同步过去的是 App 配置，不是 App 内已经生成的记录。
- 同一个 App 在不同角色手机里看到的内容仍由各自角色的人设、记忆、聊天历史和当前上下文独立生成。
- 安装完成后每份 App 都是独立副本：可以单独卸载，后续不会因为其中一份被改动或删除而传播到其他角色。
- 目标角色已有同名 App 时允许继续安装，不按名称去重、替换或合并。
- 以后新增的新角色不会自动补装过去已经批量安装过的 App。
- 不提供安装后的「管理同步设备 / 取消同步」页面；想移除时直接去对应角色手机卸载。

这里的「同步安装」本质是**一次性批量复制**，不是 Shared App、模板引用或持续同步系统。

## 初版实现

### 用户流程

入口仍是「查手机」里的两个 Add App 入口。点击后统一走 `openCreateAppModal()`：

1. 取当前机主以外的全部角色 ID，写入临时态 `syncTargetIds`，因此每次打开弹窗都会重新默认全选。
2. 用户照旧填写 App 名称、Emoji 图标、颜色、功能指令（AI Prompt）和 UI Style。
3. 弹窗底部新增「同步安装」区：
   - 显示已选择人数；
   - 提供全选按钮；
   - 逐角色显示头像、名称与勾选状态；
   - 列表 `max-h-56`，超出后滚动；
   - 底部按钮按实际目标数显示「安装到 N 台手机」，只有当前机主时仍显示「安装到桌面」。
4. 点击安装后，把「当前机主 + 仍存在的已选角色」组成最终目标列表，并分别追加一份新的 `PhoneCustomApp`。
5. 安装完成后清空临时选择；下次再次打开弹窗重新全选其他角色。

若没有其他角色，弹窗直接提示只会安装到当前手机。

### 角色上下文与内容隔离

`PhoneCustomApp` 本身仍只有：

- `id`
- `name`
- `icon`
- `color`
- `prompt`
- `layout`

批量安装只复制 `name / icon / color / prompt / layout`。

生成内容的入口仍是当前 `CheckPhone` 的 `handleGenerate()`。它以正在查看的 `targetChar` 为主体构造上下文，所以即使 A、B 两个角色安装了同名、同 Prompt 的 App，两人刷新后得到的记录也可以完全不同。

**不要**为了这个功能复制 `phoneState.records`，也不要让多个角色共享同一批生成结果。

### 独立 App ID

每个目标角色都会新建独立 App ID：

`app-${createdAt}-${index}-${randomSuffix}`

这不是单纯为避免 key 冲突，而是产品语义的一部分：安装完成后这些 App 就是彼此独立的软件副本。

因此不要改成「先建一个 `PhoneCustomApp` 对象，再把同一个 ID 塞给所有角色」。

### 存储、备份与恢复

本功能没有增加持久化 schema：

- 不修改 `PhoneCustomApp` 类型；
- 不新增 `sharedAppId / sourceAppId / syncGroupId / syncTargets` 等字段；
- 不新增全局模板表或共享 App 表；
- 不需要 IndexedDB migration；
- 不需要专门的导入 / 导出兼容层。

每份副本仍然放在对应角色自己的 `phoneState.customApps`。现有角色备份链自然覆盖这些数据。

写入使用函数式 `updateCharacter(charId, prev => ...)`，只向目标角色当前的 `customApps` 末尾追加副本，并保留该角色已有的 `phoneState.records` 和其它 phoneState 字段。

安装时还会用当前 `characters` 重新校验目标 ID；如果用户打开弹窗后某个角色已经不存在，不再尝试向它写入。

### 卸载与同名 App

现有 `handleDeleteApp(appId)` 保持角色局部删除：只从当前 `targetChar.phoneState.customApps` 删除指定 ID。

因此：

- A / B / C 同时安装后，B 卸载不会影响 A / C；
- 不存在「取消同步」操作；
- 同名 App 可以并存，因为身份依据是独立 ID，不是名字。

### 隐私与写回

这个功能只改变「App 定义安装到哪些角色手机」，不改变查手机原有的内容生成、`sendToChat` 开关、聊天卡或记忆写回规则。以后修改这些行为时不要借「批量安装」顺手改变跨 App 写回边界。

## 关键设计决策

### 为什么不做共享 App / 模板库

用户要解决的是「同一个配置不要重复填很多次」，而不是「以后这些 App 永远联动」。

一次性复制有几个明确好处：

- 安装后各角色手机符合「各自拥有自己的软件」的直觉；
- 删除、同名共存和后续改动都不需要同步冲突规则；
- 不需要全局 App 定义表、引用计数、迁移或关系清理；
- 不会让以后新增角色自动获得用户没有明确为它安装的软件；
- 对现有 `phoneState.customApps` 数据模型侵入最小。

因此如果未来有人提议加入共享模板库，应把它视为**新的产品需求**，不要把本功能悄悄重构成持续同步。

### 为什么不做角色分组筛选

创建 App 是一次短操作，首版明确选择「默认全选 + 简单滚动列表」。这里没有复用查手机目标选择页的角色分组筛选器，避免为了少量勾选引入第二层导航。

若未来角色规模真的让列表难用，再单独评估筛选；当前行为不是遗漏。

## 迭代与 Debug 记录

### 2026-08-28 · 首版批量安装

- 现象：同一个自定义 App 只能在当前角色手机创建，多个角色需要重复填写相同配置。
- 决策：安装时一次性复制配置，安装后不保持关联。
- 实现：
  - `syncTargetIds` 只作为 Modal 临时态；
  - `openCreateAppModal()` 每次重新默认全选其他角色；
  - `handleCreateCustomApp()` 过滤仍存在的目标角色并逐个创建独立 ID；
  - 使用函数式 `updateCharacter` 追加副本；
  - 新增全选、逐角色选择、头像、滚动列表和动态安装数量。
- 回归：新增 `utils/checkPhoneCustomAppInstall.wiring.test.ts`，固定三项关键接线：
  1. 每次打开都重新默认全选；
  2. 只向有效目标角色追加独立 ID 的配置副本；
  3. UI 保留全选、逐角色选择、头像、滚动列表和动态数量。
- 提交：`08ad55b728373be6a5dc78cb641e6998567dbdd3`。

### 2026-10-01 · 删除旧开发对话前复核

- 当前 `master@248e43f0d85a73e48336c71d23df085e4edc150d` 仍保留上述安装逻辑。
- 当前 `PhoneCustomApp` 仍未增加任何共享 / 同步字段。
- 专项 wiring test 仍在仓库中。
- 结论：旧对话里的「Codex 执行规划」已经被正式实现，不应再记录为待办；长期只保留当前仍成立的产品边界、技术取舍和接手入口。

## 当前状态与未完成项

- 已完成：
  - 创建时默认全选所有其他角色；
  - 全选 / 取消全选 / 单角色勾选；
  - 当前机主始终安装；
  - 每个角色独立 App ID；
  - 同名 App 共存；
  - 安装后独立卸载；
  - 内容按各角色上下文独立生成；
  - 无 schema migration；
  - 专项接线测试。
- 明确不属于当前功能：
  - 已安装 App 的再次批量分发；
  - 安装后的同步关系管理；
  - 编辑一份 App 后传播到其他角色；
  - 新角色自动补装；
  - 全局 App 模板库；
  - App 生成记录跨角色同步；
  - 角色分组筛选。
- 仍需真实环境验证：无已知专项待验项；后续若改安装 Modal 或 `handleCreateCustomApp`，按下方最小验证执行。

## 关键文件与接手入口

- 业务界面：`apps/CheckPhone.tsx`
  - `syncTargetIds`
  - `openCreateAppModal`
  - `toggleSelectAllSyncTargets`
  - `toggleSyncTarget`
  - `handleCreateCustomApp`
  - Create App Modal 的「同步安装」区
- 数据类型：`types.ts` → `PhoneCustomApp`（本功能当前不扩字段）
- 角色持久化：`context/OSContext.tsx` → `updateCharacter`
- 内容生成：`apps/CheckPhone.tsx` → `handleGenerate`（继续按当前 `targetChar` 上下文生成）
- 卸载：`apps/CheckPhone.tsx` → `handleDeleteApp`
- 测试：`utils/checkPhoneCustomAppInstall.wiring.test.ts`
- 首版提交：`08ad55b728373be6a5dc78cb641e6998567dbdd3`

## 修改后的最小验证

Windows / Codex 环境按仓库 `AGENTS.md` 使用本地可执行文件：

```powershell
.\node_modules\.bin\vitest.cmd run utils/checkPhoneCustomAppInstall.wiring.test.ts
.\node_modules\.bin\tsc.cmd --noEmit
.\node_modules\.bin\vite.cmd build
```

手工至少复核：

1. 有多个角色时打开安装弹窗，其他角色默认全选。
2. 取消部分角色后安装，只有当前机主与仍勾选角色获得 App。
3. 取消全选后仍能只安装到当前机主。
4. 两个角色安装同一配置后分别刷新，生成内容不互相复制。
5. 一个角色卸载副本，其他角色不受影响。
6. 目标角色已经有同名 App 时，新的同名副本仍可并存。
7. 关闭再重新打开安装弹窗，选择恢复为默认全选。
