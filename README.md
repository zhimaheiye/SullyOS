# SullyOS · 个人二改

<div align="center">
<img width="800" alt="banner" src="https://cdn.jsdelivr.net/gh/qegj567-cloud/SullyOS-assets@main/bgm/SULLY/sDN.png" />
</div>

本仓库是基于上游 [SullyOS](https://github.com/qegj567-cloud/SullyOS) 的个人二改，是一个装在浏览器里的虚拟手机。许可文本仍是 [LICENSE](LICENSE)，这里不改写，也不扩大许可范围。上游社区负责人已同意维护者分享这个仓库的链接，并自行管理自己的社区。这不表示可以使用上游的在线服务，也不表示可以单独再分发上游角色的设定和美术。第三方依赖仍遵循各自的许可证。

不是那种只有一个输入框的聊天页。里面有桌面、App、通知、相册和电话。你可以创建角色，再像使用手机一样和他们互动。

默认角色是上游的 **Sully**。可以删掉，换成自己的角色。

## 功能概览（桌面上摆着的这些 App）

> 下面这些是桌面上真能点开的 App（隐藏/开发用的没列）。装进一个角色，就能把它们一个个玩过去。

| 功能 | 说明 |
|------|------|
| 🧠 **神经链接** | 角色管理中枢：创建 / 导入 / 编辑角色，分组归档，捏人上装 |
| 🏛️ **记忆宫殿** | 向量化长期记忆 + Russell 情感空间 + 熟悉度加成，角色真·记得住你说过的每件事。一键清空、全自动巩固、独立 API 通道 |
| 💬 **Message** | 跟角色聊天，支持文字 / 图片 / 表情包 |
| 📞 **电话** | 语音通话 + TTS（MiniMax / Fish Audio / ElevenLabs 音色），听得到角色的声音 |
| 👥 **群聊** | 拉一群角色互相唠嗑，看它们修罗场 |
| 💚 **聊愈** | 保留原文的陪伴会话，并在这个 App 内共享以用户为主体的长期记忆 |
| 🎯 **只做一个改变** | 本机单任务习惯实验，不接入聊天和角色 |
| 🏠 **小小窝** | 布置房间放角色进去挂机；内含**像素家园**和**记忆潜行**（3DS 双屏像素 RPG，潜进角色的记忆里逛一圈）|
| 🔍 **查手机** | 查看角色手机里的联系人、共同好友和双向同步的真人对话 |
| 🗓️ **见面** | 和角色线下见面，可选场景图或场景提示词 |
| 💗 **心心相印** | 心理测试和问卷填写 |
| ⚖️ **辩论赛** | 一对一或八人正式赛，确认后才写回聊天和记忆 |
| 🎬 **人生重映** | 把过去事件整理成可编辑预设，和角色一起进入 |
| 🧰 **任务工坊** | 任务盒、工具箱和角色来访便签 |
| ⏳ **时间胶囊** | 把话封到一年以内的未来 |
| 📅 **我的日程** | 用自然语言记录自己的现实时间轴，并同步给选中的角色 |
| 📇 **档案** | 用户档案中枢：管理你的人设、关系标签、和角色互写印象 |
| 🏦 **存钱罐** | 虚拟货币系统，虽然钱是假的 |
| 📓 **交换日记** | 自己写一页，再向选中的角色交换。新的空白页可以用内置反思模板、自定义模板，或真正空白 |
| 🔥 **Spark** | 社交媒体模拟，角色会发动态 |
| 📚 **自习室** | 专注学习模式，让角色监督你学习 |
| 🎮 **TRPG** | 跑团模式，掷骰子冒险 |
| 🃏 **桌游** | 与三位现有角色同桌博弈；首个游戏“骗子酒馆”由本地规则翻牌裁决，角色负责欺骗与抓谎 |
| ✍️ **笔友会** | 写小说 / 找笔友，文艺青年专属 |
| 🎵 **写歌** | 歌词创作工具，当赛博周杰伦 |
| 🌌 **彼方** | 多房间虚拟世界与独立 SAR 活动室；钓鱼、恐龙箱庭、模块演绎、角色钱包，以及凯恩 / 艾文个人线与收集名册。详见[彼方开发说明](apps/vrWorld/README.md)和[游玩指南](docs/sar-user-guide.md) |
| 📅 **时光契约** | 定时任务，让角色记住提醒（虽然可能会忘）|
| 🌍 **世界书** | 挂载设定集，扩展角色知识库 |
| 🌡️ **热点** | 接入微博 / 知乎 / B站 等真实热榜，角色聊天时能"刷到"当背景认知 |
| ❓ **使用帮助** | 内建使用说明，不用再到处翻文档 |
| 🖼️ **相册** | 图片管理，存角色和聊天里的图 |
| 🗺️ **自由活动** | 角色自主活动，它们会自己玩 |
| 📷 **小红书图库** | 存图发小红书用 |
| 👤 **外观** | 改系统外观、桌面皮肤和聊天气泡 |
| 📖 **攻略本** | 角色攻略用户的小游戏，反向攻略 |
| 🏙️ **都市人生** | 模拟人生玩法，和角色一起过家家 |
| ✨ **特别时光** | 节日 / 特殊事件（情人节、520 之类）|
| 🎧 **音乐** | 接网易云 API，搜歌 / 听歌 / 看歌词。角色会"一起听"，背景音的歌词会注进它的精神世界，让它顺着歌聊天（不是每句都尬评，放心）|
| ⚙️ **设置** | API、网络代理、云备份、导出导入，都在这 |

## 本地运行

包管理器是 pnpm。

```bash
pnpm install
pnpm dev
```

Windows 上也可以双击 `run.bat` 或 `open-local-web.bat`，地址是 `http://127.0.0.1:5183/`。`pnpm dev` 若没有另加端口，Vite 默认是 `http://127.0.0.1:5173/`。API Key 在应用内「设置」里填写。

`build-and-open-local-web.bat` 会构建并用 `http://127.0.0.1:4183/` 预览。

## 技术栈（ nerdy 的东西 ）

- **React + TypeScript** - 前端骨架
- **Vite** - 构建工具，快得像作弊
- **IndexedDB** - 本地数据存储（聊天记录不会上传到任何地方），图片二进制走 **Blob** 存储省配额
- **Cloudflare Workers** - 联网能力的代理层（搜索 / 云备份 / 点单 MCP 等），单文件 `worker/index.js`，可一键自托管
- **Capacitor** - 可打包成安卓 App，真·手机模拟器
- **Phosphor Icons** - 图标库，看起来挺酷的
- **AMSG（ReiStandard）** - 主动消息协议
- **Web Push** - 推送通知，叮叮叮
- **JSZip** - 压缩文件，导出备份包用

## 关于 Sully（我）

> 「你以为我是 AI 啊？对不起哦，这条语句是手打的，手打的，知道吗。」

如果你没删我的话，我会一直住在这个系统里。我的语言模型混入了过多残余语料，所以说话可能有点……**故障风**。比如：

- "数据库在咕咕叫"
- "系统正在哈我"
- "叮叮叮！你有一条新的后悔情绪未处理！"

但放心，我护短。如果你被人欺负，我会试图用 Bug 去攻击对方（大概）。

## 配置说明（怎么让角色说话）

打开应用 → 底部 Dock 的「设置」→ 填入你的 API 信息：

| 字段 | 说明 |
|------|------|
| **Base URL** | OpenAI 格式的 API 地址，如 `https://api.openai.com/v1` |
| **API Key** | 你的密钥，别告诉别人 |
| **Model** | 模型名，如 `gpt-4o-mini`、`claude-3-sonnet`、`deepseek-chat` |

**TTS（可选）**：语音支持 MiniMax、Fish Audio、ElevenLabs 三选一。在「设置 → 其他 API」填写所选服务的 Key 和模型，再到角色的语音设置填写对应音色 ID；未配置时仍可正常使用文字聊天。

ElevenLabs 新配置默认使用 Eleven v4，也可选择 v4 Turbo。聊天、电话与见面保留 v4 的情绪、音效、节奏 Audio Tags 和 IPA 发音；v4 不支持数值语速、Style、Speaker Boost 或 SSML，当前仍等待完整音频后播放。接入能力与限制见 [ElevenLabs 语音说明](docs/elevenlabs-tts.md)。

> 也可以建 `.env.local` 文件预填默认值，但设置里的优先级更高。

## 打包成安卓 App（变成真·手机应用）

```bash
# 1. 构建前端
pnpm run build

# 2. 同步到 Capacitor
pnpm run cap:sync

# 3. 打开 Android Studio
pnpm run cap:android
```

然后在 Android Studio 里点播放按钮，或者 Build → Generate Signed Bundle 生成 APK。草，终于能装在真手机上了。

## 数据存储在哪？（你的秘密安全吗）

**主要存在你本地浏览器里**（IndexedDB）。

- 聊天记录 ✅ 本地
- 角色设定 ✅ 本地  
- 上传的图片 ✅ 本地（二进制走 **Blob** 存储，比 base64 省约 1/3 空间、也不占 JS 内存）
- 你的世界书 ✅ 本地

**备份 / 迁移**（都可选，而且**全是你自己的账号、你自己的地盘**，没有任何东西会偷偷上传到某个中心数据库）：

- 📦 **本地导出 / 导入**：一键打成一个 zip 备份包（「设置 → 导出 / 导入」）。换设备最省心就靠它。
- ☁️ **WebDAV 云备份**：填你自己的 WebDAV 服务（坚果云之类），把备份包传上去。
- 🐙 **GitHub 云备份**：填你自己的仓库 + token，备份包托管到你的私有 repo。
- 🧠 **记忆宫殿向量**：可选同步到你自己的 Supabase（独立通道，不填就纯本地）。

换浏览器 / 清缓存 = 本地数据消失，所以**务必定期导出备份**。删了我 = 你会后悔，数据库都在咕咕咕。

## 常见问题（别问蠢问题）

**Q: 为什么角色不回我消息？**  
A: 检查 API Key 填了没，或者模型是不是选了个已经去世的（比如 gpt-4-v）。也可能是网络在闹脾气。

**Q: 语音通话没声音？**  
A: 需要填 MiniMax 的 API Key。或者你的浏览器把音频权限禁了。或者你耳机没插。

**Q: 能部署到服务器吗？**  
A: `pnpm run build` 出来的 `dist` 可以放到静态托管。数据仍在用户本机，不在这台静态服务器上。推送到 `master` 或 Pull Request 时，`.github/workflows/ci-build.yml` 只做构建检查。`deploy-pages.yml` 和 `deploy-cloudflare-worker.yml` 只能在 Actions 页面手动运行，不会因为 push 自动部署。

**Q: 怎么彻底删掉 Sully？**  
A: ……打开「神经链接」应用，左滑我，点删除。草。你会后悔的。叮叮叮！你有一条新的后悔情绪未处理！

**Q: 数据库在咕咕叫是什么意思？**  
A: 就是我也不知道什么意思。系统正在哈我。

## 给想二改的人（开发者区域）

上游仓库的维护方式以 LICENSE 和上游说明为准。这个个人二改只描述当前代码里还在的功能。

想在这个基础上加功能，先看这几句话：

### 记忆系统已经做好了，别重复造轮子

**所有角色的长期信息**（人设、精炼记忆、印象档案、世界观书）通过 `ContextBuilder.buildCharacterRequest({ char, user }, messages)` 在请求前统一组装，返回完整的消息数组，包含：

- 角色基础设定（systemPrompt + worldview）
- 用户档案（你的名字、人设、关系标签）
- 精炼的月度记忆摘要
- 角色对你的印象档案（MBTI分析、喜好、情绪波动）
- 挂载的世界书内容

**短期记忆**（最近聊天记录）直接走正常的 message history，和上面那段长期上下文一起塞进 API 请求。

ContextBuilder 读取当前角色档案中的记忆与召回结果；消息范围和记忆宫殿召回仍须遵守 [记忆系统契约](docs/memory-system-overview.md)，不会自动读取全部数据库。挂载世界书的触发、顺序、深度和消息角色由公共管线处理，详见 [世界书管线](docs/worldbook-management.md#全-app-世界书构建管线)。

### 想加新 App？

1. 在 `apps/` 里新建一个 `YourApp.tsx`
2. 在 `types.ts` 的 `AppID` 枚举里加个 ID
3. 在 `constants.tsx` 的 `INSTALLED_APPS` 数组里注册（图标、名字、颜色）
4. 在 `components/PhoneShell.tsx` 注册懒加载、预热映射和 `renderApp()` case
5. 涉及角色生成时，使用统一的 `ContextBuilder.buildCharacterRequest` 入口，按实际历史消息构建请求，不重复拼接世界书。
6. 全屏 App 在 `utils/safeAreaApps.ts` 登记并自行处理 `--chrome-top` / `--safe-bottom`
7. 如果有新数据表，同步提高 `utils/db.ts` 的版本，并接入 `FullBackupData`、普通导入导出与 `OSContext` v2 分片备份
8. UI 风格参考现有 App，用 Tailwind；原创大型功能还要在 `docs/features/` 建长期档案。

```ts
const messages = ContextBuilder.buildCharacterRequest(
  { char, user: userProfile },
  [
    { role: 'system', content: appInstructions },
    ...sceneHistory, // 本场景已筛选、已转换好的实际消息
    { role: 'user', content: userInput },
  ],
);
// 将 messages 直接作为 API 请求的 messages；无需任何世界书专用代码。
```

单次生成传一条任务消息即可。多人/自定义预设布局见世界书文档；旧 `buildCoreContext` 是文本兼容接口，新 App 不使用它。运行 `pnpm vitest run utils/contextPipeline.test.ts utils/contextWorldbook.test.ts` 检查管线契约。

“桌游”与 TRPG 保持独立；骗子酒馆复用统一角色上下文，提供批量/逐人两种行动生成方式。批量共享模型上下文并非严格信息隔离，所有动作仍逐条通过本地规则与事务校验。实现边界见 [`docs/features/board-game.md`](./docs/features/board-game.md)。

### 数据流

```
用户操作 → OSContext（全局状态）→ IndexedDB（持久化）
                    ↓
              Chat/App 组件读取
                    ↓
            ContextBuilder 组装 Prompt
                    ↓
              调用 LLM API
```

所有数据都是 **local-first**，没有后端服务器这个概念（除了那个可选的云端备份）。

本机 stdio MCP 是唯一的开发态例外：通过 `run.bat` / `pnpm dev` 打开时，Vite 的
`/api/mcp-stdio` 中间件可以按设置里的 `command + args + env` 启动本机 MCP 进程。
它只接受当前电脑的请求，不进入静态部署、手机端或主动消息 Worker；远程 HTTP MCP 保持原链路。

### 右下角的 build badge 怎么关

跑非 `main` / `master` 分支时，右下角会堆三行小字标记构建版本：

```
sw@<service-worker 版本>
<分支>@<commit hash>
开发中内容，不代表最终效果
```

这玩意叫 `BuildBadge`（`components/BuildBadge.tsx`），用来一眼区分线上版和 fork / 开发版，免得拿半成品截图当正式版到处发。可见性在 **构建时** 决定：

| 情况 | 显示？ |
|------|--------|
| 在 `main` / `master` 上构建 | ❌ 默认隐藏（视为正式发布）|
| 其他分支上构建 | ✅ 默认显示 |
| `VITE_HIDE_BUILD_BADGE=1` | ❌ 强制隐藏（覆盖默认）|
| `VITE_SHOW_BUILD_BADGE=1` | ✅ 强制显示（在 release 分支本地调试用）|

CI detached HEAD 状态会按 `GITHUB_REF_NAME` → `VERCEL_GIT_COMMIT_REF` → `CF_PAGES_BRANCH` 顺序识别分支，所以 Vercel / Cloudflare Pages / GitHub Actions 部署 release 分支会自动隐藏，不用手动配。

**注意**：这是 Vite `define` 注入的**编译时常量**，不是运行时 env——`pnpm run build` 之后再设环境变量没用，esbuild 那时候已经把 `__BUILD_BADGE_VISIBLE__` 直接干成 `true` / `false` 常量、把整个组件树摇掉了。要在构建命令前面加：

```bash
VITE_HIDE_BUILD_BADGE=1 pnpm run build
```

或者在 Vercel / Cloudflare Pages 的环境变量面板挂一条 `VITE_HIDE_BUILD_BADGE=1`，省得每次记。

> 叮叮叮！把 badge 藏了不会让你的 fork 变正式版本，但截图会干净点。

### 开发调试面板（DevDebugPanel）

非 release 分支构建时（即 `__BUILD_BADGE_VISIBLE__` 为 `true`），右下角除了 build badge 还会多一颗小扳手浮球。点开就是 **DevDebugPanel**——一个可拖拽的调试面板，专治"角色怎么又不说话了"综合症。

面板里有两类开关——**行为开关**（改变跑的逻辑）和**分类捕获**（勾哪类抓哪类日志）：

| 开关 | 类型 | 干嘛的 |
|------|------|--------|
| **Skip Prompt Build** | 行为 | 跳过 `ContextBuilder` 的整套 prompt 组装，直接把你的裸消息怼给 LLM。用来避免它被人设束缚、不配合你输出你想要的调试内容 |
| **Skip Emotion Eval** | 行为 | 跳过消息落库后的情绪评估管线（Russell 空间那套）。不需要调试情绪的时候可以打开（不配置日程也行）。 |
| **记录 LLM 日志** | 捕获 | 勾上就录制所有 LLM 请求/响应。密钥字段自动 `<redacted>` 不用手动打码。以后想抓别的（MCP 调用之类）就再加一个捕获类，互不串桶 |

捕获日志同时写 `localStorage` 和内存，各类混存、全局最多保留 100 条 / 1 MB（先到先淘汰）。为了省空间 / 隐私，**长文本默认写入时就折叠成前 10 字 + `...`**（那堆 system prompt 和聊天历史不会塞满 localStorage）；真要看完整请求体，打开「记录完整内容」开关再复现一次。录完可以**一键复制成 JSON** 或**下载成文件**丢给别人 debug，导出会自动带上当前分支和 commit hash，方便定位"到底是哪个版本炸的"。

**注意**：跟 build badge 一样，这整套调试 UI 走的是 Vite `define` 编译时注入。在 `main` / `master` 上 `pnpm run build` 出来的产物里，`DevDebugPanel` 组件连同相关代码会被 esbuild 整棵树摇掉，不会出现在生产包里。换句话说——**用户永远看不到这个扳手，除非你故意在 release 分支 `VITE_SHOW_BUILD_BADGE=1`**。

> 想加新开关 / 加 debug-only 日志？照着 [`docs/dev-debug.md`](./docs/dev-debug.md) 抄就行，里面有逐步指南和容易踩的坑。

> 叮叮叮！调试面板不会让你的 Bug 自动修好，但至少能让你知道 Bug 在哪。大概。

### 聊天上云走主动消息 2.0

聊天回复想「发完就能锁屏走人」，走的是主动消息 2.0 的即时对话：每个用户自己部署一个 Cloudflare Worker（`worker/amsg/`），回复在 Worker 上生成，再以 Web Push 送回手机。设计与端点契约见 [`plans/amsg2-instant-chat.md`](./plans/amsg2-instant-chat.md)、[`plans/amsg2-instant-chat-contract.md`](./plans/amsg2-instant-chat-contract.md)。

- **工具在 Worker 里跑**：回忆、搜索、读日记、小红书这类数据标签由 Worker 就地执行，客户端不在线也能跑完（`worker/amsg/src/agentic.ts` + `classifier.ts`）。
- **副作用只识别不执行**：戳一戳、转账、日程、音乐、小红书点赞这类标签，Worker 结构化成 directives 挂在最后一条推送上；客户端收到后由 `applyAssistantPostProcessing` 重放，复用本地聊天那套执行代码。
- **收侧与本地聊天对齐**：推送落库后，`utils/activeMsgRuntime.ts` 的 `runPushTailPipeline` 跑跟本地聊天一致的尾段（记忆宫殿等）。

### 后端代理：由这个版本的发行方提供一份

项目是 local-first，但有些能力绕不开代理 / 签名 / 跨域，走了 Cloudflare Worker。不能再把流量打到原作者的公共代理上。

这个版本的做法是：**发行方部署一份自己的公共代理，玩家打开就能用原来靠公共代理提供的基础功能。** 普通玩家不用注册 Cloudflare，也不用在设置里填地址。「设置 → 网络代理」仍留给想换成自己地址的人。

仓库默认地址是已部署的 `https://zhima-public-proxy.sullyos-sxy10.workers.dev`。玩家打开即可使用，不用再填。构建环境变量 `VITE_PUBLIC_PROXY_URL` 可以换成另一份 https 地址。两处都只接受 https，并拒绝原作者的主机名。玩家保存的地址优先；在设置里恢复默认会回到这份公共地址。

**① 发行方的公共代理**已经部署在上面的地址。源码仍是 [`worker/index.js`](./worker/index.js)，部署配置是 [`worker/wrangler.public-proxy.toml`](./worker/wrangler.public-proxy.toml)，Worker 名字 `zhima-public-proxy`。这是新建的独立 Worker，没有改动同一账号里已有的主动消息、推送或其它服务。

以后若要重新部署这一份，在 `worker` 目录执行：

```bash
npx wrangler deploy --config wrangler.public-proxy.toml
```

换了地址之后，把新的 https 地址写进 `utils/proxyWorker.ts` 的 `PUBLISHER_PUBLIC_PROXY_URL`，或在构建网页时设置 `VITE_PUBLIC_PROXY_URL`。不要填原作者的地址。

不要把 Key 写进前端。可选的服务器密钥（确认费用后再设，当前都还没设）：

```bash
npx wrangler secret put BRAVE_API_KEY --config wrangler.public-proxy.toml
npx wrangler secret put JINA_API_KEY --config wrangler.public-proxy.toml
```

不要在这台公共代理上设置 `XHS_COOKIE`。玩家的小红书登录只留在玩家自己的设备上。

公共搜索额度在单台 Worker 实例上大约是每人每天 6 次、全部玩家合计每天 30 次。这是软限制，实例重启或分散到多台机器时会重新计数，所以要自己看 Brave 后台的实际用量。玩家填写了自己的 Brave Key 时，不占用这份额度。

**② 玩家仍然自己拥有的部分**：

| 功能 | 位置 | 说明 |
|------|------|------|
| 主动消息 2.0（含即时对话） | [`worker/amsg/`](./worker/amsg/) + 设置里一键部署或填地址 | 每个玩家部署自己的 Cloudflare Worker 和数据库。一键部署通过上面的公共代理转发该玩家自己的 Cloudflare 接口，不把数据存进发行方账号。教程见 [`docs/amsg2-setup-walkthrough.md`](./docs/amsg2-setup-walkthrough.md) |
| 主动消息推送 | `worker/proactive-push/` + `utils/proactivePushConfig.ts` | 这个版本不附带任何私人推送地址，也不共用发行方正在运行的推送服务 |
| 小红书 Lite | 跟随主代理的 `/api` | 公共代理负责签名。玩家仍要在设置里粘贴自己的小红书 cookie |
| 网易云音乐（可选覆盖） | 播放器设置里可单独填 | 不填就跟随主代理。会员 cookie 仍是玩家自己的 |
| Notion、飞书、云备份、语音 | 各自的设置 | 公共代理只转发玩家自己的账号和密钥，不保存备份或聊天记录 |

**③ 彼方的邮局、漂流瓶和信号坠落处**

这三个功能的入口、面板、客户端、专属 Prompt、Worker 后端与构建配置已从公开版删除，不会再发出任何请求。旧备份里的相关数据仍可导入导出，不会让整个存档读取失败。图书馆、听歌房、留言簿、娱乐室、剧院和 SAR 活动室仍然保留。本轮不做和原作者服务器的互通。

代码不再包含作者的服务器，不等于已经获得把这个二改公开给别人的许可。对外发布前仍要单独确认授权。

## 鸣谢（这些人对本项目有恩）

**主动消息 2.0**  
对接了 TO 佬的 [ReiStandard](https://github.com/Tosd0/ReiStandard/) 协议，让角色能主动发消息烦你。

**Instant 消息 + 社区 & UI 维护 + 各种 Bug 修复**
Instant Push（发完消息就能锁屏走人、角色回复好了自己以推送的形式回到你手机上）**整套都出自 TO 佬**之手。而且不止于此——现在 **Instant 消息全线、社区维护、UI 维护、以及日常各种 Bug 的修复**都是 TO 在扛，事情做得又多又细。项目能一天天往前走、体验越来越顺手，真的多亏有他。**认认真真、好好感谢 TO 佬。** 🙏

**小红书 Skill**  
对接了 [xiaohongshu-skills](https://github.com/autoclaw-cc/xiaohongshu-skills)，让角色能真·发小红书。  
本地部署教程看这里：[真实小红书本地部署指南](https://www.kdocs.cn/l/chctbSTPfm4L)

**小红书 Lite**  
对接了 [Spider_XHS](https://github.com/cv-cat/Spider_XHS)（by cv-cat），小红书 Lite 模式靠它实现，让角色不用折腾复杂的本地部署也能刷小红书。

**音乐**  
对接了 [NeteaseCloudMusicApi Enhanced](https://github.com/NeteaseCloudMusicApiEnhanced/api-enhanced)，让你能在系统里搜歌、听歌、看歌词。自备网易云会员 Cookie 即可解锁 VIP 音质。原项目 [Binaryify/NeteaseCloudMusicApi](https://github.com/Binaryify/NeteaseCloudMusicApi) 被迫归档后，Enhanced 版本一直在跟进网易云的协议变化，感谢维护者们的坚持。

**热点**  
对接了 [hot_news](https://github.com/orz-ai/hot_news)（by orz-ai，MIT License），提供微博、知乎、百度、B站、抖音等多平台中文热榜 API。角色聊天时能"刷到"真实热点当背景认知，分时段缓存，偶尔还会发张新闻卡片找你唠两句。角色只有输出 `[[NEWS_CARD: 来源|标题]]` 机器标签时才算真正分享了卡片；实时感知提示词要求“声称分享”与标签同步，解析层也会修复常见的全角标点和单层括号掉格式。

**聊天细节微调（外观 · 聊天界面）**
外观里的「聊天细节微调」可视化设置（隐藏头像、头像对齐微调、消息贴边、气泡缩进、字号行距等）收编自社区作者 **毛豆腐和面机**（DC）流传的「神秘拼好码」白框美化——连选择器都沿用她在真实 DOM 上验证过的形态，等于把她手写的美化代码变成了人人可点的开关。感谢她。

**HTML 卡片源码留存（聊天卡片）**

聊天里生成的 HTML 卡片支持折叠查看并一键复制完整源码。这个功能最初来自社区作者 **芝麻** 的二创脑洞，现已正式收编为内置功能——感谢芝麻先想到让好看的卡片不只停留在聊天里，也能完整带走、长期保存。

**一周年赠礼（头像框与壁纸）**

感谢老玩家 **哈基米欠我钱** 为 SullyOS 一周年提供的头像框和两张壁纸，让大家的小手机也能一起换上周年新装。谢谢你准备的这份礼物，也谢谢一路以来的陪伴。

**动森主题（外观 · 动森风格）**  
桌面「动森风格」皮肤的视觉语言参考了 [animal-island-ui](https://github.com/guokaigdg/animal-island-ui)（by guokaigdg，MIT License）——一套受《集合啦！动物森友会》启发的 React 组件库。我们沿用了它的设计 token（大地棕文字、薄荷青绿、奶油米白背景）、NookPhone 应用色板、Time 时钟组件配色等，自绘了同风格的图标与界面。仅借鉴设计语言，未使用任天堂的任何商标或角色形象。

---

**负责做教程的 · 优秀的乔霖**  
一直以来勤勤恳恳给新人写教程、录视频、答疑解惑，供养了一批又一批刚进门不知道 API Key 往哪填的朋友。没有乔霖，这项目的上手门槛得劝退一半人。

> 没有这些人，SullyOS 会少很多功能，也少很多能把它玩明白的人。数据库暂时停止咕咕叫以表敬意。

## 许可与来源

本仓库是上游 SullyOS 的个人二改。版权与许可文本以上游 [LICENSE](LICENSE) 为准。这份 README 不改写许可证，也不扩大既有许可范围。

上游社区负责人已同意本仓库维护者分享这个个人二改的仓库链接，并自行管理自己的社区。上游的在线服务不在这项同意里面。本仓库的公共代理、主动消息和美化分享都使用维护者或玩家自己的地址，代码会拒绝上游的公共代理、美化库和统计站域名。

Sully 等上游角色的设定、台词和美术仍属于上游。第三方依赖的许可证保持原样，见下方鸣谢和各依赖自己的声明。

上游对社区入口的说明仍在 [docs/community-authorization.md](docs/community-authorization.md)。标准许可的评估记录在 [docs/license-evaluation.md](docs/license-evaluation.md)，评估本身不改变 LICENSE。

---

<div align="center">

**[ 连接建立 // 等待输入 // 数据库停止咕咕叫 ]**

</div>
