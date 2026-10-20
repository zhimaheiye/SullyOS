# API 预设全局悬浮切换器

本文是 SullyOS「API 预设全局悬浮切换器」的长期开发档案。修改主 API 预设切换、悬浮按钮交互、主动消息凭据同步或悬浮设置持久化前，同时阅读根目录 `PRODUCT.md`、`docs/handoff/CURRENT.md` 与 `AGENTS.md`。

## 档案信息

- 类型：PhoneShell 级全局工具，不是独立 App。
- 当前状态：已实现；当前 HEAD 仍保留首版与后续交互修复。
- 首版日期：2026-08-27。
- 首版提交：`1cdfcf2d feat: add floating API preset switcher`。
- 交互修复：`d87cf2c3 fix: enable and soften floating preset switcher`。
- 当前复核基线：2026-10-01 的本仓库实现（开发期提交号不随公开历史提供）。
- 上游对照：2026-10-01，`qegj567-cloud/SullyOS@29ec8257`。上游已有 `configFromPreset` / `findActivePresetId` / `presetDiffersFromConfig` 这套预设语义，但没有本 fork 的全局悬浮组件、悬浮设置、共享 `apiConfigCommit` 或 Settings 悬浮窗开关；这些仍是二改需要保护的 fork 差异。

## 最初开发需求

用户已经在 Settings 中维护多套 API Preset，希望在 SullyOS 内任何解锁后的页面快速切换，而不是每次都返回设置页。

目标：

- Settings 增加「API 预设悬浮窗」总开关，默认关闭；
- 开启后在 Launcher、Chat、Forum、Settings、游戏和其它 App 中统一显示；
- BootSequence 和锁屏不显示；
- 这只是 PhoneShell 内部 Overlay，不使用 Android 系统悬浮窗权限；
- 收起状态是一个约 54px 的三横线圆钮；
- 支持 Pointer Events 拖动、6px 左右阈值、左右吸边、垂直位置按 `yRatio` 保存；
- 展开后只显示预设名和模型名，不显示 Base URL、API Key 或 emoji；
- 当前预设必须由现有 `findActivePresetId(apiPresets, apiConfig)` 动态计算，不新增伪 selected state；
- 点击预设时复用 `configFromPreset(preset)`；
- 正在生成中的请求不 abort、不重发，新配置只影响后续请求。

## 关键架构决定

### 1. 只挂一次：PhoneShell 全局 Overlay

组件：

`components/os/ApiPresetFloatingSwitcher.tsx`

由 `PhoneShell.tsx` 在解锁后的全局 Overlay 区统一挂载，不往各 App 分别插入。

因此：

- BootSequence / Lock Screen 利用 PhoneShell 原有 early return 自然排除；
- App 间切换时悬浮按钮继续存在；
- 不需要任何 Android 原生 Overlay 权限；
- z-index 保持低于通话条、Toast 与系统 Modal。

### 2. 主 API 配置只能走共享提交入口

首版最重要的技术约束不是“能切换 preset”，而是**不能绕过 Settings 已有的副作用**。

Settings 原来的 API 提交除了更新前台 `apiConfig`，还负责：

- `syncAmsgLlmCredentials`
- `ActiveMsgClient.refreshApiCredentialsForPendingTasks`
- 部分失败 Toast
- 原有 catch / 错误处理

因此首版抽出：

`utils/apiConfigCommit.ts`

并建立共享：

`commitApiConfig(...)`

Settings 和悬浮切换器都必须经过这一个入口。

这保证“切换聊天 API”时，主动消息 Worker 凭据与已经排程的存量任务也同步更新，不会出现前台已经换 Key、后台主动消息仍拿旧凭据的分裂状态。

当前实现仍保持：

- 先更新本机前台配置；
- 同步 AMSG 凭据；
- 对已排程任务做 best-effort 凭据刷新；
- 刷新部分失败不会撤销本地 API 切换，只提示用户稍后重试。

### 3. 不干扰当前已经发出的请求

`commitApiConfig` 只更新共享配置，不主动中止现有 fetch / stream。

因此：

- 已经开始生成的请求继续使用启动时读取到的旧配置；
- 下一次请求再使用新的 API；
- 悬浮切换不承担“取消当前回复”或“重发当前请求”的职责。

## 悬浮设置与同步

持久化实现：

`utils/apiPresetFloatingSettings.ts`

localStorage key：

`sullyos_api_preset_floating_v1`

结构：

```ts
{
  enabled: false,
  side: 'right',
  yRatio: 0.55
}
```

约束：

- 默认关闭；
- `side` 只接受 `left | right`；
- `yRatio` clamp 到 `0..1`；
- JSON 损坏或非法值回退默认；
- 这里只保存悬浮 UI 状态，不保存 API Key / URL / model。

因为浏览器同一标签页修改 localStorage 不会触发自己的 `storage` 事件，所以实现同时使用：

- 自定义事件 `sullyos-api-preset-floating-settings-changed`：同标签页即时同步；
- `storage` event：跨标签页同步。

Settings 打开总开关后无需刷新即可显示 / 隐藏。

## 展开与拖动行为

当前组件仍采用：

- Pointer Events；
- 6px `DRAG_THRESHOLD`；
- 拖动时关闭面板；
- 松手根据按钮中心决定吸左 / 吸右；
- 保存 `side + yRatio`；
- resize 时重新按 `yRatio` 计算并 clamp；
- 面板朝屏幕内部展开；
- 面板高度受限，列表内部滚动；
- 点击外部收起；
- 点击某预设后立即提交并自动收起。

当前 preset 不匹配任何已保存 preset 时，不创建“自定义”假项，只是不显示任何“使用中”标记。

## 2026-10-01 · 当前 HEAD 复核与后续预设语义

删除旧开发对话前重新按当前仓库核验后，下面这些是 **current fact**，优先级高于早期聊天中的 UI 草案：

- `components/os/ApiPresetFloatingSwitcher.tsx` 的文件历史仍只有首版 `1cdfcf2d` 与交互修复 `d87cf2c3`；当前 HEAD 仍是后者确定的低饱和玻璃圆钮，而不是最初参考图里的高饱和蓝色实心圆钮。旧聊天里的蓝色按钮应视为历史视觉参考，不能据此回滚现状。
- 悬浮面板是**只读快捷切换器**：直接按 `apiPresets` 当前数组顺序渲染，不提供新增、编辑、删除或重新排序；这些管理动作继续只留在 Settings。
- 每条快捷卡当前只显示 preset 名称和 `preset.config.model`，两行都使用单行 `truncate`；Base URL、API Key 与 emoji 都不显示。早期讨论里“长模型名允许换行”没有进入当前实现，因此不再作为现行要求保存。
- 即使一条 preset 都没有，已开启的悬浮按钮仍存在；展开后显示“暂无 API 预设 / 请先前往设置中添加预设”，而不是静默消失。
- “使用中”仍只由 `findActivePresetId` 按归一化后的 URL + Key + Model 三件套判断。流式开关和 temperature **故意不参与 active 高亮**；但用户再次点击该 preset 时，`configFromPreset` 会把该 preset 实际保存的可选 `stream` / `temperature` 一并恢复。
- 后续 Settings 预设逻辑已经加入 `presetDiffersFromConfig`：当前配置即使仍被标成“使用中”，若只改了该 preset 明确保存过的 stream / temperature，Settings 保存时仍可判断“当前配置与原 preset 已有差异”并询问是否存回。不要为了让悬浮窗高亮与这个保存提示“完全一致”而把两套语义强行合并。
- 当前上游 `qegj567-cloud/SullyOS@29ec8257` 仍没有 `ApiPresetFloatingSwitcher.tsx`；同步上游时应保留本 fork 的 PhoneShell 挂载、Settings 开关、`apiPresetFloatingSettings` 和共享 `apiConfigCommit`，同时继续复用上游已经共有的 preset 纯逻辑。

## 2026-08-27 · 首版实现

首版提交：

`1cdfcf2d feat: add floating API preset switcher`

主要新增 / 修改：

- `components/os/ApiPresetFloatingSwitcher.tsx`
- `utils/apiConfigCommit.ts`
- `utils/apiPresetFloatingSettings.ts`
- `apps/Settings.tsx`
- `components/PhoneShell.tsx`
- `utils/apiPresetFloatingSettings.test.ts`
- `utils/apiPresetFloatingSwitcher.wiring.test.ts`
- 以及三个既有 API / AMSG wiring test 的共享 helper 适配。

代码层验证：

- 功能相关测试 51 项通过；
- 生产构建通过，Vite 当时转换 6248 个模块；
- 本批修改文件没有新增 TypeScript 诊断；
- 整仓当时仍有 Worldline 导出审计、HtmlCard 复制按钮等既有无关失败；
- 按用户要求未进行浏览器 / 交互测试。

这个现场后来证明了一个重要教训：

> **wiring test 能证明组件挂载、函数调用和源码接线存在，但不能证明真实浏览器里的 pointer-events / 交互层级一定可点击。**

## 2026-08-27 · 实机反馈：能显示，但不能点 / 右键，颜色过饱和

首版推送后用户实际打开页面发现：

- 悬浮圆钮能够正常出现；
- 但无论在哪个 App，单击和右键都没有反应；
- 蓝色实心按钮在页面上视觉饱和度过高、过于抢眼。

这不是 API 切换逻辑问题，而是悬浮触发器自身的输入命中与视觉样式问题。

### 根因与修复

修复提交：

`d87cf2c3 fix: enable and soften floating preset switcher`

修复包括：

1. 圆钮显式加入 `pointer-events-auto`，确保父容器 `pointer-events-none` 下按钮自身重新参与命中；
2. 鼠标右键在 `pointerdown` 阶段直接退出拖拽流程：
   `event.pointerType === 'mouse' && event.button !== 0`；
3. 增加 `onContextMenu={handleContextMenu}`，阻止浏览器默认菜单并让右键也可开关 preset 面板；
4. 保留拖动后的 click suppression，避免一次拖动结束又误触展开；
5. 将原来的高饱和蓝色：
   `bg-blue-500 / text-white / shadow-blue-900`
   改成低饱和玻璃样式：
   `border-slate-200/70 bg-white/60 text-slate-500 shadow-slate-900/10 backdrop-blur-md`；
6. wiring test 增加“按钮自身可命中、右键不进入拖动流程、低饱和样式”守卫。

当前 HEAD 中仍能看到这套修复。

## 可迁移开发经验

### 1. 全局悬浮层最容易漏的是 pointer-events 继承关系

为了让全屏 Overlay 不阻塞底层 App，父层使用 `pointer-events-none` 很合理。

但真正需要交互的子节点必须显式恢复：

`pointer-events-auto`

否则“组件渲染出来了”与“组件可以点击”是两回事。

### 2. Pointer Events 做拖拽时要区分鼠标按钮

`pointerdown` 不等于“用户准备左键拖动”。

如果不检查：

`event.pointerType === 'mouse' && event.button !== 0`

右键也可能被 pointer capture / drag state 抢走，导致 contextmenu 行为异常。

### 3. 纯源码 wiring test 不能替代一次真实交互验收

首版已有大量测试和成功 build，但仍漏掉了最基础的“按钮能不能点”。

以后改全局 Overlay、Portal、z-index、pointer-events、drag/click 竞争、touch-action 一类 UI 基础设施时，即使默认开发流程不跑浏览器，也应该至少在交付说明里明确：

**代码层验证通过 ≠ 真实交互已验收。**

若用户后续提供实机反馈，应以实机结果覆盖 wiring test 的乐观判断。

### 4. 视觉要求会在真实页面叠加后变化

最初需求明确写了“蓝色圆形按钮”，代码也忠实实现了。

但放进真实 SullyOS 页面后用户发现它太抢眼，于是改成低饱和玻璃样式。

这属于正常的实机视觉校准，不应理解成最初实现“没有按需求做”。

## 当前维护入口

- 全局组件：`components/os/ApiPresetFloatingSwitcher.tsx`
- Settings 总开关：`apps/Settings.tsx`
- 全局挂载：`components/PhoneShell.tsx`
- API 统一提交：`utils/apiConfigCommit.ts`
- 悬浮设置：`utils/apiPresetFloatingSettings.ts`
- API preset 纯逻辑：`utils/apiPresetSwitch.ts`
- 悬浮设置测试：`utils/apiPresetFloatingSettings.test.ts`
- 悬浮接线测试：`utils/apiPresetFloatingSwitcher.wiring.test.ts`
- 主 API / AMSG 接线守卫：`utils/apiPresetSwitch.wiring.test.ts`、`utils/activeMsgClient.wiring.test.ts`、`utils/amsgStateSync.wiring.test.ts`

## 修改时的基本红线

- 不把悬浮切换器分别插进每个 App；
- 不新增一份独立 selected preset state；
- 不在悬浮设置里存 API Key / URL / model；
- 不绕过 `commitApiConfig` 直接 `updateApiConfig(configFromPreset(...))`；
- 不让切换 API 顺便取消 / 重发当前请求；
- 不把 Android 系统 Overlay 权限引入这个功能；
- 修改 Overlay 命中层级后，至少检查 `pointer-events`、z-index、drag/click/contextmenu 三条交互路径。
