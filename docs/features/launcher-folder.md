# 桌面收纳文件夹

## 档案信息

- 类型：Launcher 桌面功能
- 当前状态：代码完成；浏览器/真机操作待人工验收
- 首版日期 / 最近迭代：2026-10-02
- 首版提交：见 Git `feat: add launcher app folder and empty slots`

## 最初开发需求

用户希望像手机桌面的“大文件夹”一样，把最近不用的 App 收在一起，需要时可以直接使用或拖出来，放在桌面可用位置。用户提供的手机截图作为收纳缩略图与打开后应用网格的参考。

## 初版实现

### 用户流程与界面

1. 普通/动森桌面末尾自动出现“不太常用”文件夹，显示最多九个应用缩略图；也可长按把文件夹移到常用位置。
2. 点击打开，点“整理”勾选要收纳的应用，可修改文件夹名。取消勾选会放到桌面第一个空位。桌面长按后的工具条也提供“收纳”入口。
3. 长按桌面 App 拖到文件夹，松手才收纳；原位置保留为空格，不自动被其它 App 补上。
4. 文件夹内直接点击打开 App。长按后拖出面板边界，面板关闭；将 App 拖到桌面虚线空位松手，即放回指定位置。边缘停留复用跨页拖动，竖向边缘移动可滚动第三页。
5. 整理时桌面 App 仍可重排，文件夹内也可重排；“完成”退出拖拽模式。取消拖拽、无效目标、放到已占用的桌面位置不会移出文件夹。

首版为一个可改名文件夹，三列滚动内容，不限制收纳数量。不增加嵌套文件夹、多文件夹或自由像素定位。底部 Dock 保持独立；手游、电子宠物、陪伴桌面依旧使用其原有独立入口。

### 角色上下文、隐私与写回

只整理启动入口，不调用模型、不改应用数据、不写聊天/记忆/通知，也不新增埋点。应用通过原 `openApp` 路由打开，自定义图标继续支持 blobref。

### 数据、备份与恢复

- 复用 `OSTheme.launcherAppOrder`：空字符串表示保留空位，`launcher:folder` 是文件夹入口；每个可用 App 只出现在桌面或文件夹之一。
- 新增 `launcherFolderApps`（顺序）和 `launcherFolderName`（名称）。复用 `updateTheme → os_theme` 保存与 OSContext 的全量/文字备份和恢复路径，无新 store/schema。
- 旧顺序保持已有应用位置，文件夹追加到末尾；失效/重复 ID 清理，新应用追加一次。恢复时使用主题最新布局，不沿用旧内存顺序。
- 前两页各八个位置，第三页吸收其余位置并保留一行额外空位。归一化可重复执行，不把收纳应用重新补回桌面。

## 迭代与 Debug 记录

### 2026-10-02 · 首版

- 原 Launcher 按 AppConfig 连续渲染，没有可保留空位；抽出最小纯布局逻辑，三处网格共用文件夹/空位渲染，沿用 Pointer Events、拖拽影子与跨页计时器。
- `AppIcon` 的 memo 比较忽略 `onClick`，父级进入编辑后仍可能持有允许打开 App 的旧闭包；增加回调身份比较，确保编辑态的点击禁用同步。
- 松手重新读取落点，pointercancel / Escape 不提交，卸载清除影子和目标样式；文件夹支持系统返回、Escape、Tab 焦点约束及可键盘操作的整理复选框。
- 验证：6 文件 / 64 项通过，包含新增四项布局检查、已有桌面 blobref、App 预热、安全区及备份格式/往返回归；备份样本加入文件夹字段和空位。
- 整仓 TypeScript 修改前后日志完全一致：17 条未修改 Q 版资源/夹具诊断，本批零新增。Vite 生产构建成功；Worker 未修改。没有运行浏览器/UI 或真机测试。

## 当前状态与未完成项

- 已完成：单文件夹、改名、批量收纳/移出、拖入/指定空位拖出、内部打开/排序、持久化与备份接线。
- 人工验收待做：手机长按与滚动、跨页拖出、窄屏/横屏、安全区、自定义壁纸配色及取消手势的实际体验。

## 关键文件与接手入口

- 界面与 Pointer Events：`apps/Launcher.tsx`、`components/os/LauncherAppGrid.tsx`
- 纯布局与检查：`utils/launcherFolder.ts`、`utils/launcherFolder.test.ts`
- 类型/保存/恢复：`types.ts` 的 OSTheme、`context/OSContext.tsx` 的 updateTheme / exportData / importData
- 图标：`components/os/AppIcon.tsx`
- 备份检查：`utils/backupFormat.test.ts`、`utils/backupRoundtrip.test.ts`

## 修改后的最小验证

```bash
./node_modules/.bin/vitest.cmd run utils/launcherFolder.test.ts utils/launcherWidgetsBlobRef.test.ts utils/backupFormat.test.ts utils/backupRoundtrip.test.ts utils/appPreload.test.ts utils/safeAreaApps.test.ts
NODE_OPTIONS=--max-old-space-size=6144 ./node_modules/.bin/tsc.cmd --noEmit
NODE_OPTIONS=--max-old-space-size=6144 ./node_modules/.bin/vite.cmd build
```

类型检查按 `docs/upstream-sync-and-manual-deploy.md` 对比修改前基线；不得把未修改路径的旧诊断顺手清理。
