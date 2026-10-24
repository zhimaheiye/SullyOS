# 剧本杀通用引擎

与 TRPG、桌游平行的独立 App。导入使用者有权使用的 JSON，先做 schema 与引用校验，再保存本机模板；角色映射和剧本在开局时冻结。公开发行包不提供第三方剧本。

主持人掌握完整资料。玩家/调查者只收到本机投影出的合法可见资料；主观信念不提升为客观事实，未发放线索和 GM 真相不得进入角色请求。V2 支持调查者、真人席、二/四选项回答、提问、阶段、能力审批和主持人确认。AI 只能提出规则允许的动作，旧 revision 回包不可覆盖新局面。

`murder_mystery_scripts`、`murder_mystery_sessions`、`murder_mystery_events` 独立持久化并纳入全量/分片备份。游戏正文不自动进入现实聊天和记忆；结束后用户明确选择才幂等写回共同游戏经历。

核心是 `utils/murderMystery/` 与 `apps/MurderMystery*.tsx`。JSON schema 和离线校验器在 `skills/murder-mystery-preprocess/`，可运行 `node skills/murder-mystery-preprocess/validate.mjs <json文件>`。仅提供通用格式；外部整理者应自行取得原文授权并报告来源、缺失和矛盾，不以结构校验代替剧情校对。
