# 副 API 统一管理

公开版只为四项功能提供独立 URL、Key 和 Model：`emotion` 角色情绪、`memoryLight` 记忆轻量分析、`thinkingTranslation` 心象翻译、`myScheduleParse` 我的日程解析。设置注册表 `FEATURE_APIS` 只列这四项；没有账号 CLI、文字模型总分配器或生图配置。

每项可选沿用原来源或独立配置。选预设只载入当时快照，后续互不影响；完整凭据整套选择，不拼接不同来源的字段，不因失败换模型。角色情绪的角色专属 API 优先。心象翻译沿用旧记忆轻量 → 角色情绪，均缺失则停止；记忆轻量沿用旧配置 → 主 API。

配置保存在本机 `sully_feature_apis_v1`，全量与纯文字备份可往返。旧备份中其它功能的覆盖字段可保留，运行时不再应用，也不在列表中展示；这些任务继续使用原来的 App、角色或主 API。四项之外的任务不能借标记请求覆盖凭据。

关键代码是 `utils/featureApi.ts`、`components/settings/FeatureApiManager.tsx` 和 `utils/safeApi.ts`。Key 不写入提示词或调用日志。Worker 的主动消息凭据使用独立同步路径，本次没有修改现役云端配置。
