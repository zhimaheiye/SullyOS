# 时间胶囊

## 档案信息

- 类型：独立桌面 App
- 当前状态：第一版代码完成，待真实 API 与移动端使用验收
- 首版日期：2026-08-13
- 首版提交：`ce2de175`（`feat: add time capsule app`）
- 需求参考：`timejiaonang/`（仅作原型参考，不是运行时依赖）

## 最初开发需求

用户希望新增一个很简单的“时间胶囊”软件：用户和既有角色都可以往里面封存内容，开启时间限制在一年以内。用户既可以主动指定一位角色立即写，也可以配置来访角色，让他们像任务工坊一样按来访时间轮流自己留下胶囊。

`timejiaonang/` 原型提供了以下核心意图：写入正文和开启时间、到期前不展示正文、到期后由用户开启、胶囊可以删除。原型里的 CryptoJS 密码、外部网络时间和独立 `localStorage` 没有直接移植：SullyOS 是 local-first 应用，第一版把“封存”定义为产品界面中的到期可见性，而不是对能访问本机 IndexedDB 的开发者提供密码学保险箱。

## 第一版产品规则

### 用户胶囊

- 用户填写封面题签、正文和精确到分钟的开启时间。
- 开启时间必须晚于当前时间，且不能晚于当前时刻的一年后。
- 封存后正文在 App 界面中隐藏，胶囊不可编辑但可以删除。
- 时间到达后不会自动展开，仍需用户点击“开启这枚胶囊”；首次开启后永久保持已开启状态。

### 角色胶囊

- “主动邀请”允许用户选择任意既有角色立即写一枚。
- 角色自己决定 1 至 365 天后的开启时间；到期前可见的题签不得剧透正文。
- 角色通过 `buildChatRequestPayload()` 继承主聊天中的同一身份、用户档案、近期聊天、长期记忆与相关记忆召回。
- 角色调用固定 `disableMcp: true`，不自动发主聊天、不写长期记忆，也不产生现实世界副作用。

### 自动来访

- 来访设置复用任务工坊的第一版原则：用户选择多位角色、调整轮换顺序、设置间隔和开关。
- `TimeCapsuleRuntime` 挂在 `PhoneShell`，每分钟检查一次；只在 SullyOS 已加载且页面可见时运行。
- 页面从后台恢复时至多补一次已经到期的来访，不追赶关闭或休眠期间错过的每个周期。
- 同一角色已经有一枚“自动来访且尚未被用户开启”的胶囊时，本轮会跳过 ta，避免自动内容无限累计；主动邀请不受此限制。
- 角色被删除后，设置里的失效 ID 会在下一次调度时清理。

## 数据、备份与入口

- IndexedDB v78 新增 `time_capsule` store。
- `TimeCapsuleEntry` 保存题签、正文、来源、作者快照、封存时间、开启时间和首次开启时间。
- `TimeCapsuleSettings` 保存自动来访开关、名单、间隔、轮换游标与上次来访时间。
- `FullBackupData.timeCapsuleRecords` 已接入完整导出与恢复。
- `AppID.TimeCapsule` 已接入普通桌面 App、长按换位、PhoneShell 懒加载、按压预加载、空闲预热、自理安全区和动森图标，不进入底部四个固定 Dock。
- `timejiaonang/` 中的 HTML、CryptoJS CDN、淘宝时间 API 和 localStorage key 均未被业务代码引用；参考目录可以在之后移走或删除。

## 隐私与连续性

- 胶囊正文默认只保存在本机 IndexedDB，并随用户主动执行的完整备份导出。
- 第一版没有“带到聊天”入口，也不会自动进入聊天或记忆。以后若增加分享，应只允许已开启胶囊由用户明确点击后写入结构化聊天卡片。
- 角色生成读取既有上下文与记忆只是为了保持身份连续性；本次写胶囊本身不反向更新记忆。
- “到期前隐藏”是 UI 规则，不等于端到端加密。若未来加入密码学加密，需要单独设计密钥丢失、备份恢复、网络时间可信度和多设备时钟策略。

## 初版验证

- `utils/timeCapsule.test.ts`：一年边界、用户胶囊创建、角色 JSON 容错、日期钳制、轮换和自动累计限制。
- `utils/timeCapsule.db.test.ts`：IndexedDB 保存、删除、完整备份导出与恢复。
- `utils/safeAreaApps.test.ts`：时间胶囊与自理安全区名单双向一致。
- 3 个测试文件共 6 项通过。
- 6 组 Worker bundle 构建成功；Vite 生产构建成功，6059 modules transformed，并生成独立 `TimeCapsuleApp` chunk。
- 全仓 `tsc --noEmit` 仍有项目原有的 MemoryPalace、ThemeMaker、MessageItem、CompanionHome 等类型错误；本轮新增代码在修正测试只读数组后没有留在错误列表中。

## 当前未完成与后续方向

- 待用户验证不同主模型写出的正文质量、题签是否剧透、角色选择的开启间隔是否自然。
- 第一版不支持密码、真正加密、外部网络时间、多设备同步或关闭 SullyOS 后的后台来访。
- 第一版不支持编辑已封存胶囊，也不支持把已开启内容带到聊天。
- 如果以后允许更多自动胶囊，应先增加全局容量、归档或清理策略，不能直接取消当前的每角色待开启上限。

## 关键文件与接手入口

- 业务界面：`apps/TimeCapsuleApp.tsx`
- 纯逻辑：`utils/timeCapsule.ts`
- 上下文/API：`utils/timeCapsuleService.ts`、`utils/chatRequestPayload.ts`
- 常驻调度：`components/timeCapsule/TimeCapsuleRuntime.tsx`
- 存储/备份：`utils/db.ts`、`types.ts`
- 系统入口：`constants.tsx`、`components/PhoneShell.tsx`、`components/os/appPreload.ts`、`components/os/acnhIcons.tsx`
- 测试：`utils/timeCapsule.test.ts`、`utils/timeCapsule.db.test.ts`、`utils/safeAreaApps.test.ts`

## 修改后的最小验证

```bash
pnpm vitest run utils/timeCapsule.test.ts utils/timeCapsule.db.test.ts utils/safeAreaApps.test.ts
pnpm build
```
