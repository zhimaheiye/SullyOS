# 小宇宙电脑端 App

2026-11-14 按维护者本次授权从私有实现选择性迁入。公开版只有普通角色上下文，不引入私有主线、私人 Meta 快照、账号 CLI 或生活代理。

## 使用

电脑本机以 run.bat／pnpm dev 打开 SullyOS，或构建后使用 pnpm preview。需要 Python 3。添加小宇宙单集链接，读取公开节目资料，播放公开音频或明确选择本机音频；导入时间戳 JSON 后可跟随、搜索、引用文稿。播放器跨 App 继续，音乐与播客互相暂停。

每位角色保存独立场次、进度和逐字讨论。自动材料只包含问题时点前实际完整播放过的文稿区间；跳过内容不会自动进入请求。显式引用可讨论未播放文字，但明确标成引用。角色请求复用公开版只读 ContextBuilder、当前角色 API 与人工接力，禁用工具，不发送整集音频。

失败可以重试原问题或跳过；生成成功但保存失败可再次保存原文，零模型调用。整理小结后仍须明确选择“带回聊天”，才幂等写入聊天卡，未分享文稿和讨论不进入普通聊天或记忆。

## 本机与在线边界

Netlify／GitHub Pages 仅发布前端，不提供 /api/xiaoyuzhou，也不会连接用户电脑或代管账号。在线网站可查看既有本地记录，本机导入与节目读取须使用电脑运行端。

运行端只接受回环地址及同源 Host／Origin，固定动作和 X-Sully-Podcast 标记。公开节目读取使用 Python 标准库并限制 HTTPS 主机；无需登录客户端。平台页面结构变化可能导致读取失败，未承诺接口永久可用。

可选兼容 podcast_tool.py 由使用者自行准备，不随本仓库分发。设置 SULLY_XIAOYUZHOU_DIR 指向其目录才可使用原客户端的扫码和在线文稿能力；不附带任何账号、令牌或加密文件。默认目录是本项目 podcast-data/tool，不指向开发者目录。其余环境变量：SULLY_XIAOYUZHOU_PYTHON（默认 python）、SULLY_XIAOYUZHOU_EXPORT_DIR（默认工具目录的“导出”）、SULLY_XIAOYUZHOU_MEDIA_DIR（默认 podcast-data/media）。整个 podcast-data 不进 Git。

本机音频支持单段 Range，导入最大1 GB；先写独立文件再切换清单，不覆盖用户原文件。音频不进系统备份，恢复后需重新关联。

## 持久化

公开版 DB v99 使用独立 podcast_records，并纳入完整／纯文字备份。角色、revision、epoch在同一事务核对；恢复备份更新 epoch 阻断迟到写入。进度合并实际区间但不推进讨论 revision。小结分享在消息、角色和播客事务内查重并校验范围。

入口：apps/XiaoyuzhouApp.tsx、apps/podcast、utils/podcast、server/xiaoyuzhou-middleware.ts、server/xiaoyuzhou_bridge.py。本批未进行实际连续试听、扫码、真实文稿服务和模型讨论验收；私有版历史验证不作为公开版结果。
