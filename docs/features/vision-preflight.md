# 图片描述预检

## 当前行为

用户可以从本轮符合条件的新图片中选择一张或多张，先生成可检查的文字描述，再把确认后的描述交给聊天请求。照片与表情按各自语义处理；GIF 抽取有限的代表画面，不把整段动画或文件名当成画面内容。

每项描述绑定图片字节、消息、角色、聊天范围与运行代次。源图片被编辑或删除、用户取消、角色或归档范围变化、页面重置时，迟到结果不能写回。已确认描述可以随文字备份和完整备份往返，但旧图片不会因为后来开启功能而批量补识别。

## 边界

这是图片理解和描述，不包含生图、角色索图、场景图或提示词卡。只有用户明确发起并选中的图片进入这次预检；没有成功描述时不向后续文字接力伪装成已看图，也不因失败自动换用其它模型。

关键文件为 `utils/visionPreflight.ts`、`utils/visionFrames.ts`、`components/chat/VisionPreflightModal.tsx` 与私聊接线。验证见 `visionPreflight.test.ts`、`visionPreflightSelection.test.ts` 和 `visionFrames.test.ts`。
