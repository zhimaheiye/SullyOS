# 角色生图与场景提示词

公开版有两条分开的画面能力。一条调用用户自己的 OpenAI Images 兼容接口，只做文生图。另一条只用普通文本模型，保存可复制的画面摘要和完整提示词，不调用生图接口。

## 生图 API

入口是「设置 → 生图 API」。需要填写 Base URL、API Key 和模型。拉模型请求 `GET {base}/v1/models`，列表失败时可以手填。

实际生图只请求：

`POST {base}/v1/images/generations`

请求体包含 `model`、`prompt`、`n: 1`。`gpt-image` 系列不发送 `response_format`，尺寸用 `1024x1536`。`dall-e-3` 用 `1024x1792`，`dall-e-2` 用 `512x512`。认不出的模型不送 `size`，让服务端用自己的默认值。其它模型显式要求 `response_format: b64_json`。

地址规范化只做一轮：去掉尾部斜杠，若末尾是 `/v1/images/generations` 或 `/v1/images/edits` 就剥到主机根，再去掉尾部 `/v1beta` 或 `/v1`。不再循环剥 `/models`。

响应只接受 `data[]` 里的 `b64_json` 或 http(s) `url`。`b64_json` 会补成 `data:image/png;base64,...`；已经是 `data:image/` 的字符串保持原样。没有这两种字段时失败，提示「接口返回中没有找到图片」。不解析 `images`、`artifacts`、`output` 或裸 base64。

不调用 `/v1/images/edits`，也不在失败后改走另一条上传接口。可选的跨域代理与 MCP 相同：配置后请求变成 `<代理>?target=<编码后的地址>`。

## 角色 API 生图

角色设置里选择「API 生图」并打开开关后，私聊里的 `[[GENERATE_IMAGE]]` 控制块可以触发生图。控制块只取第一处，内容是 JSON，至少要有 `prompt`。`selfie` 缺省为真。API 模式下过长的 `prompt` 会截到 2000 字。损坏的 JSON 会从正文里去掉，并且不生图。

画面使用角色的文字外貌锚点和这段场景文字。参考图地址可以填写并在设置里预览，当前版本不会把这张图上传。生成结果写入聊天图片消息和相册，两条记录共用同一份图片数据。provider 标记为 `gpt-image`。长按已生成的图片可以再生成一张。失败写入本机生图日志，设置页可以查看；日志不保存 API Key。

## 提示词卡片

角色设置里选择「提示词模式」后，私聊索图不再调用生图 API。模型需要同时给出画面摘要和完整提示词。卡片类型是 `image_prompt`，聊天里显示摘要，完整提示词放在 `metadata.imagePrompt`，不进入后续普通对话上下文。私聊卡片使用该角色当前聊天 API。

见面里的「生成当前场景提示词」使用功能 id `dateScenePrompt`。它可以沿用主 API，也可以在「副 API 管理」里单独填写 URL、Key 和 Model。请求走普通 `chat/completions`。模型没有同时返回摘要和完整提示词时，提示重试，不保存半张卡片。

## 见面场景图

角色见面设置里的「每轮生成场景图」仍调用上面的文生图接口。它在本轮文字回复落库后异步生成一张双人场景图，失败不影响对话。提示词由外貌锚点、本轮可见场景和上一轮画面摘要组成，不上传参考图。场景图消息带 `metadata.sceneImage`，不会把图片数据送进下一轮对话。

这条开关和「生成当前场景提示词」是两件事。前者出图片，后者只出文字卡片。

## 代码入口

- `utils/imageGeneration.ts`：地址、请求体、响应解析和文生图请求
- `utils/imagePromptCard.ts`：提示词卡片与文本模型请求
- `utils/dateSceneImage.ts`：见面场景图
- `components/chat/ImageGenerationSettingsModal.tsx`：API 生图 / 提示词模式
- `utils/featureApi.ts`：`dateScenePrompt`

## 当前限制

- 没有 NovelAI，也没有多账号抗限速。类型里留下的 `novelai` / `legacy` 标记不表示已经接上。
- 参考图 URL 只作预览和提示词说明。
- 未配置生图 API 时，API 模式不能出图；提示词模式不依赖生图 API。
