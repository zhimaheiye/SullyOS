# 一键写 Obsidian 日记

## 当前行为

私聊输入区提供「一键写日记」。执行时读取当前角色与当前聊天范围，使用主聊天的文字完成链路整理日记，再交给既有 Obsidian 日记适配器写入用户已选择的目标。没有可用聊天、没有启用目标或写入失败时明确报错，不生成一条假的成功记录。

角色、页面与 Obsidian 目标在开始时冻结；生成期间切换角色、离开聊天或修改目标会取消或拒绝落地，防止把内容写到另一个人的日记。运行中按钮进入忙碌状态，避免重复请求。

## 边界

这项功能在产品上不依赖主线模式。私人版本曾复用主线作用域 token 作为异步防串线门禁，公开版改为直接核对当前角色、页面和目标快照，不引入私人主线代码。请求不进入普通 API 调用日志，但仍按当前聊天配置实际产生一次文字生成与一次日记写入。

关键文件为 `utils/manualObsidianDiary.ts`、`utils/obsidianDiary*.ts`、`components/chat/ChatInputArea.tsx` 与 `apps/Chat.tsx`。验证见 `manualObsidianDiary.test.ts`、`obsidianDiary.test.ts` 和 `obsidianDiaryAdapter.test.ts`。
