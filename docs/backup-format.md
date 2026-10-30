# 备份格式与媒体存储

当前实现以 `utils/backupFormat.ts`、`context/OSContext.tsx` 和 `utils/db.ts` 为准。

- ZIP 中的 `manifest.json` 描述模式、分片与媒体索引；数组分片放在 `stores/`，单例元数据放在 `metadata.json`。导入仍由 `DB.importFullData` 按各 store 的原有覆盖或合并规则处理。
- 数组按游标逐条转换、分片序列化，避免整表和单根超长 JSON 同时驻留内存。普通记忆与聊愈记忆的向量分别通过二进制旁路保存。
- `blobref` 令牌在 JSON 中保留，引用的二进制写入 `blobs/` 并附索引。不把本机绝对 URL 当作可迁移的内置资源路径。
- 纯文字备份剥除图片，保留文字活动及进度；媒体备份只补充现有对象的媒体，不覆盖正文和角色配置。哔哔、SAR、个人二改的独立 store 均须按各自模式纳入。
- TTS 缓存不作为用户资料全量复制；收藏语音和已保存陪伴设置所依赖的音频单独携带。Blob 不直接交给 JSON.stringify。
- 新增 store 时同时检查导出字段、导入路径、文字与媒体模式和往返测试；不要以更新数据库全局版本号作为迁移测试的固定预期。

验证入口：`utils/backupFormat.test.ts`、`utils/backupRoundtrip.test.ts`、`utils/activityBackup.test.ts`、`utils/sarReleaseBackup.test.ts` 及相关功能的 backup 测试。媒体 SDK 的版本以 package.json 和 pnpm-lock.yaml 为准，原始执行提示词不作为维护指令。
