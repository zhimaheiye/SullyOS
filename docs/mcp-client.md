# 通用 MCP 客户端（远程 HTTP + 本机 stdio）

2026-10-20 待公开版本已撤下「我的日程」里的 Veglia 活动读取和睡眠 MCP 入口。通用 MCP 仍只服务用户自己配置的工具，不内置活动采集或健康数据读取。

> 改 MCP 接入路径、排查「工具连不上 / 角色不调工具」前必读。
> 这份文档讲的是**通用** MCP 客户端；小红书/麦当劳/瑞幸那三个写死的客户端不归这里管
> （它们分别在 `utils/xhsMcpClient.ts` / `mcdMcpClient.ts` / `luckinMcpClient.ts`）。

> 面向用户（和用户的 AI 助手）的自包含接入教程在 [`docs/mcp-user-guide.md`](./mcp-user-guide.md)，
> 设置里 MCP 板块的「?」帮助弹窗一键跳转/复制的就是它——改接入行为时记得同步更新。

## 用户视角

设置 →「MCP」→「管理」：

1. 「添加服务器」→ 选择 Streamable HTTP 或本机 stdio
2. HTTP 填 URL/鉴权；stdio 填启动命令、每行一个参数和可选环境变量
3. 点「测试连接」→ 客户端走 MCP 握手 + `tools/list`，工具清单持久化到本机
4. 打开开关 → 私聊、群聊或当前角色的协同工作里就能调这些工具
5. 「适用聊天」默认通用（所有私聊和群聊）；可把服务器绑定给指定角色或群聊
   （典型场景：游戏 MCP 只交给主持群，其他聊天看不到这批工具）

「聊天模型支持工具调用」默认开启。若你明确知道当前模型或中转不支持 OpenAI
function calling（例如携带 `tools` 就报 401），关闭它后首轮会直接走文字兼容模式，
不再先发送一次 `tools` 探测请求；即使保持开启，遇到常见 4xx 仍会自动降级一次。

## 设计意图与 fork 边界

这套通用 MCP 能力的产品目标是“让 SullyOS 接任意兼容服务器”，而不是按
filesystem / GitHub / 游戏工具等类别逐个写客户端。因此工具业务类型不应进入 transport
层；现有小红书、麦当劳、瑞幸专用客户端继续保留，stdio 扩展也不以“顺手重构旧客户端”
为目标。需要迁移时应单独验证，避免影响已经稳定使用的旧链路。

Claude Code / Claude Desktop / Cursor 在这里是**配置生态与验收参照**，不是 SullyOS 的
运行时依赖。用户可以先在这些客户端或终端确认某个 `command + args + env` 能正常启动，
再把同一组配置填进 SullyOS；SullyOS 不通过 Claude Code CLI 转发 MCP，也不依赖它的
agent loop。SullyOS 只负责启动已配置的进程与走 MCP 协议，**不会自动安装** Node.js、
Python、`npx` / `uvx` 或具体 MCP Server 包。

本 fork 的 stdio 需求边界明确是**电脑本机能力**：不要求 Android、手机、静态部署或
远程浏览器取得本机进程权限。当前实现因此放在 Vite 开发服务器的同源 middleware，
而没有把 SullyOS 整体改造成 Electron/Tauri 桌面程序，也没有额外依赖常驻 Claude Code。

### 与上游同步时保护这项差异

截至 2026-10-08 核验，`qegj567-cloud/SullyOS` 当前对应实现仍是 HTTP-only；
本 fork 的 stdio 支持由提交 `0d7915ce72c5cd014f85c26f0a477dfe0515a100`
（`feat: add local stdio MCP transport`）引入。同步上游时至少要保护并复核：

- `server/mcp-stdio-middleware.ts` 及其测试；
- `vite.config.ts` 的 `/api/mcp-stdio` middleware 注册与退出清理；
- `utils/mcpClient.ts` 的 `transport / command / args / env`、stdio 配置与停止逻辑；
- `components/settings/McpConnectionConsole.tsx` 的 HTTP / stdio 双模式 UI；
- 本文与 `docs/mcp-user-guide.md` 中的 stdio 使用和安全边界。

如果上游以后独立加入 stdio，先比较生命周期、Windows shim、进程树终止和本机访问限制，
确认语义等价后再去重，不能仅因为文件名/功能名相似就覆盖 fork 实现。

### 连不上？三种网络路径

浏览器直连远程 MCP 服务器经常被 CORS 拦（典型症状：测试连接时报
`Failed to fetch`）。按场景三选一：

| 路径 | 适用 | 操作 |
|------|------|------|
| **直连**（代理 URL 留空） | 服务器 CORS 配置正确 | 什么都不用做 |
| **本地代理** | 本地 MCP（如 xiaohongshu-mcp）、或临时试用 | `node scripts/mcp-proxy.mjs`，代理 URL 填 `http://localhost:18061` |
| **自己的 Cloudflare Worker** | 云端 MCP + 手机/不想在电脑跑东西 | 部署 [`worker/mcp-proxy/`](../worker/mcp-proxy/README.md) 到**自己的** CF 账号，代理 URL 填 Worker 地址，建议设 `PROXY_KEY` 防白嫖 |

stdio 不走这三种网络路径。它只在本机 `run.bat` / `pnpm dev` 启动的 Vite 服务中，
由同源 `/api/mcp-stdio/<serverId>` 中间件启动子进程并转发 JSON-RPC。局域网客户端、
手机和静态部署都会被拒绝，避免网页远程取得本机进程权限。

代理约定统一为 `<代理URL>?target=<url-encoded 服务器URL>`（可选 `X-Proxy-Key` 头）。
**刻意不走中心 sfworker**：MCP 流量含用户的 Bearer Token / 自定义鉴权头，不应该经过项目方服务器。

## 代码地图

| 职责 | 文件 |
|------|------|
| 协议客户端（握手/session/tools·list/call）+ 配置存储 | `utils/mcpClient.ts` |
| OpenAI 工具格式转换、跨服务器重名、系统提示块 | `utils/mcpToolBridge.ts` |
| 设置板块入口与帮助弹窗 | `apps/Settings.tsx` 的 `MCP_USER_GUIDE_URL` |
| MCP 管理面板 | `components/settings/McpConnectionConsole.tsx` |
| systemPrompt 注入（9d 段）+ `mcpChatActive` flag + 尾部 reminder | `utils/chatRequestPayload.ts` |
| tools 注入 + 客户端工具循环（与瑞幸共用骨架） | `hooks/useChatAI.ts` |
| 群聊 tools 注入 + 客户端工具循环 | `utils/groupChat/mcp.ts`、`apps/GroupChat.tsx` |
| 协同工作 tools 注入、结果回传与停止 | `features/collaboration/engine.ts`、`features/collaboration/mcp.ts` |
| 备份导出/导入 | `utils/db.ts`（`mcpLocal` 段）+ `types.ts` `FullBackupData.mcpLocal` |
| 本地 CORS 代理（支持 `?target=` 通用模式） | `scripts/mcp-proxy.mjs` |
| 本机 stdio 进程与 JSON-RPC 桥 | `server/mcp-stdio-middleware.ts` + `vite.config.ts` |
| 用户自部署 Worker 代理 | `worker/mcp-proxy/` |

## 设计要点（改之前必看）

- **两层容错（对标见面观测协议）**。第一层走 function-calling：工具以 OpenAI
  `tools` 参数注入，复用瑞幸聊天点单的客户端工具循环（`useChatAI.ts` 3.6 段），
  工具名命中 `mcpToolResolve` 映射 → 分发给对应服务器；没命中且瑞幸模式开着 →
  走瑞幸原逻辑，两类工具可同场。第二层兜"掉格式"（3.6b 段）：不支持 FC 的模型
  会把调用写成正文文字（`ask_question("SullyOS")` / `ask_question: SullyOS`），
  `extractTextFakedMcpCalls` 只认已启用服务器的真实工具名（暴露名/原名都认，
  括号/JSON/kwargs/冒号行四种形态），系统代为执行后把结果喂回去让角色重说，
  `executedSig` 防复读重执行。**所以不要求模型支持 function calling**，支持的
  走第一层（更稳），不支持的落第二层。
- **流式 tool_calls 必须重组**。`safeApi.ts` 的 `parseSseToCompletion` 会把
  `delta.tool_calls` 分片按 index 分组、arguments 逐片拼接——改这里时别弄丢，
  否则开 stream 的用户工具调用会被静默吞掉（症状就是"角色说要查但没动静"）。
- **工具清单读持久化结果，不在聊天路径发网络请求**。`tools/list` 只在设置里
  点「测试连接」时跑；服务器更新了工具需要用户重新点一次。
- **stdio 复用现有协议客户端，不另建工具循环**。浏览器先把 `command/args/env` 交给
  本机 Vite middleware，再把同一套 `initialize` / `notifications/initialized` /
  `tools/list` / `tools/call` 请求发到同源桥。桥按行收发 JSON-RPC，浏览器侧的工具名映射、
  危险操作确认、私聊/群聊调用和会话重连全部沿用 HTTP 路径。
  Windows 启动无扩展名命令或 `.cmd` / `.bat` shim 时会回退 shell；终止时必须结束整棵进程树
  （`taskkill /PID <pid> /T /F`），否则只退出 `npx.cmd` 等外壳可能留下真正的 MCP Server 子进程。
- **stdio 是本机前台能力**。配置和环境变量保存在现有 localStorage/备份中，但不会进入
  `collectMcpFireServers()`，因此不会把本机命令或密钥上传给 amsg worker；含 stdio 工具的
  即时对话会留在浏览器本地执行。
- **暴露名 ≠ 真实工具名**。OpenAI 工具名只许 `[A-Za-z0-9_-]{1,64}`，MCP 工具
  名可能带点号；跨服务器还会重名。`buildMcpOpenAITools()` 返回
  `resolve: Map<暴露名, {server, toolName}>`，执行时必须经它换回真实名。
- **本地聊天路径的 MCP 模式本轮禁 thinking**
  （`toolModeActive`，Gemini 系 "thinking + tools" 同发会 400）——与
  瑞幸/麦当劳既有约束一致，设置卡片里已向用户说明。
- **即时对话路径下 MCP 由 amsg worker 云端执行**：主动消息 2.0 的即时对话（见
  `plans/amsg2-instant-chat-contract.md`）刻意不把 MCP 排除在外——worker fire 时自己解析 `tool_config`、直连用户配置的 MCP 服务器，
  工具说明块与凭据都由 worker 侧统一供给（客户端这次 POST 顺手把 `tool_config` 传上去）。
- **session 失效自动重连一次**：`tools/call` 遇 HTTP 400/404 会重握手重试
  （服务器重启后 `Mcp-Session-Id` 作废是常态）。
- **协议版本必须真实协商**：initialize 以 `2025-11-25` 发起，接受服务端回落到
  `2025-06-18` / `2025-03-26`；协商结果写进会话，之后通知、`tools/list`、
  `tools/call` 全部携带 `MCP-Protocol-Version`。`2024-11-05` 是旧 HTTP+SSE
  双端点，不能再用单端点客户端冒充支持；`2026-07-28` 是新的无握手生命周期，
  也不能只换版本号冒充支持。
- **配置改动要 `resetMcpSession`**：URL/token/代理任一变了旧 session 就不能用，
  设置卡片的 `update()` 已处理。
- **聊天绑定在 `getEnabledMcpServers(charId)` 一处收口**。历史字段名仍叫 `charIds`，
  但其中可以存角色 ID 或群聊 ID；空/缺省 = 通用，非空只对绑定聊天可见。
  私聊传 `char.id`，群聊传 `group.id`；**ID 缺省时绑定服务器一律不可见**
  （防止无聊天上下文的调用点泄漏专属工具）。

## 排查「角色把工具调用输出成文字」

1. 先确认是不是流式吞掉了 tool_calls（上面第二条）——开 DevTools 看响应里
   有没有 `delta.tool_calls`，有但界面没反应就是重组层出问题。
2. 模型不支持 FC / 中转剥了 `tools` 参数 → 属第二层容错的正常工作范围，
   假调用会被代执行 + 二次生成，用户最终看不到乱码。若还是漏，通常是模型
   编了不存在的工具名（只认已启用服务器的真实工具名，不认幻觉名）。

### 2026-10-14 · 任务调用后的「502 / 磷光后台」台词

- 用户提供的 DevDebug 导出记录了三次聊天模型请求：第一次 HTTP **503**，后两次 HTTP **200**。第二次响应请求调用 `create_task`，第三次响应才生成「502」「磷光后台」「任务回头再挂」等台词。导出中没有 MCP `tools/call` 的 HTTP 状态记录，不能把模型台词里的 **502** 当作已核实的工具错误，也不能据此断言任务已经创建或一定失败。
- 本轮请求的工具描述包含 `[phosphene]` 来源前缀；这是多台 MCP 服务器同时可见时 `buildToolDescription()` 加上的服务器名，system block 也会列服务器名。仓库未定义「磷光后台」这一服务名；这句话是模型把 `phosphene` 来源标签自行中文化并带进了角色台词，不能作为真实后端名称。
- 工具循环在 `hooks/useChatAI.ts` 中把 `callMcpTool()` 的成功结果或失败原因写成 `role: 'tool'` 再发给模型。导出默认把整个 `messages` 数组折叠；两次成功请求的消息数从 **280** 增至 **282**，符合工具调用及结果回填的路径，但折叠后看不到实际工具结果。要确认是否真有 MCP 502、具体错误和任务最终状态，需在复现前开启 DevDebug「记录完整内容」，只核对相关 `role: 'tool'` 项，并向任务服务读取该任务状态；注意完整日志可能含私密对话和鉴权信息，勿直接存入仓库。

## 协同工作

沉浸式与中度协同均按当前角色 ID 读取最新启用服务器，复用已有绑定、代理、鉴权、工具名映射和危险操作确认。窗口显示真实调用阶段；工具草稿不流入交付正文，只有工具处理完成后的最终回答参与文件解析与保存。无可用工具时保留普通流式与思考设置，有工具时不附加 thinking 参数。

原生 tool_calls（包含 SSE 分片）与文字兼容调用共用有界循环；API 拒绝 tools 时降级，JSON 参数损坏、未知工具不执行，工具失败回填真实错误。相邻轮次相同调用不重复执行，连续两轮无推进或累计 12 次调用后收束；仍返回工具调用则明确报错，不冒充完成。停止信号传到模型请求和 MCP 握手/调用，取消后不再请求下一轮。原有上下文范围和两种协同模式不变。

验证：`utils/collaborationMcp.test.ts` 覆盖真实 SSE 解析与本地模拟 MCP 握手、工具结果回传、绑定隔离、降级、失败、取消和上限；未连接真实第三方账号。

## 已知边界

- 支持 handshake era Streamable HTTP（含 SSE 响应体解析）与本机 stdio；不支持旧版
  HTTP+SSE 双端点传输。`2024-11-05` 只对 stdio 放行，不能用于单端点 HTTP；stdio
  仅随本机 Vite 开发服务提供，不进入静态构建或手机端。
- 只用了 MCP 的 tools 能力；resources / prompts / OAuth 授权流未实现
  （静态 Bearer Token 与自定义 Header 均支持；OAuth 登录流仍未实现）。
- 当前完整支持的是 MCP handshake era 的 Streamable HTTP（2025-03-26 至
  2025-11-25）。2026-07-28 modern era 的 `server/discover` / 每请求 `_meta`
  尚未实现，遇到 modern-only 服务器会给出明确版本错误，不会静默错连。
- 工具结果回填上限 20000 字符（`formatMcpToolResult`，正常使用等于不截断，
  只防病态超长结果炸上下文；被截断时会标注全文长度）。瑞幸自己的工具仍是 1500。

## amsg2 后台路径

主动消息 2.0 的 worker 到点调 MCP，走与前台不同的一条链：

- **配置**：`mcpClient.collectMcpFireServers()` 把 enabled + 已发现工具 + 公网
  地址的服务器（含 token/customHeaders，剥代理字段）与「聊天模型支持工具调用」
  开关一起，作为 `tool_config.mcpServers` / `mcpUseNativeTools` 随 client_state
  加密通道上云（`activeMsgClient.buildToolConfigEntry` 是三条上传路径的唯一咽喉）。
  被服务端标成 destructive 的工具会从后台清单剔除，因为无人值守环境不能弹确认窗。
- **提示词与 tools**：worker 在 onBeforeFire 用 `mcpFireCore.buildMcpFireBlock` /
  `buildMcpFireTools` 从 tool_config 现场生成——与凭据同源，不经过 fire_pack，
  没有陈旧窗口。amsg-server 带 `agentic-fire-tools` feature 的版本起，fire 循环
  透传 tools 请求参数。
- **调用识别（与前台同构的两层）**：native tool_calls 优先；没有 native 时用
  前台「兼容模式」同一个解析器（`extractTextFakedMcpCalls`，`alsoMatchPrefix`
  选项认带前缀写法）从正文抠 `tool_name({...})`。统一 `mcp__` 前缀路由
  （`MCP_FIRE_NAME_PREFIX`，名映射预算 `MCP_FIRE_NAME_BUDGET` 由它算出）。
- **执行**：`executeToolCalls` 按前缀分流到 `runMcpFireTool`，worker 直连
  `server.url`（服务端 fetch 无 CORS）；单次调用 25s、单次 fire 内共享 120s
  总预算，预算尽了早退回喂而不是拖到轮次上限整条重跑。
- 纯逻辑都在 `utils/mcpFireCore.ts`（环境无关叶子，进 worker bundle，禁加
  浏览器依赖——有守卫测试扫 import）；浏览器侧 mcpClient/mcpToolBridge 委托
  同一份实现。
- **版本歪斜可见**：capabilities 的 `agentic-fire-tools` + 设置页版本门槛，
  老 worker 不会静默吞掉 MCP 配置。

回归守卫：`scripts/amsg2-e2e-harness.mjs` S8/S8b（mock MCP 服务器端到端）+
`worker/amsg/src/agentic.test.ts`、`index.test.ts`、`utils/mcpFireCore.test.ts`。

### 聊天中停止工具调用

聊天生成入口在执行工具时也可以停止。前台和主动消息 2.0 的 instant 路径都把本轮 `AbortSignal` 传入 MCP 的握手与 `tools/call` 请求；停止后取消网络等待，不再把取消当作工具失败送回模型继续生成。后台执行链通过任务租约心跳收到取消，本应用的检测间隔为 1 秒。

停止不能撤回工具服务端已经完成的操作；远端服务是否能停止自身执行取决于其实现。本应用会中断连接并阻止这一轮的后续调用。已经显示的聊天内容保留，尚未显示的结果不再写入聊天。
