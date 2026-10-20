# 心心相印 · 心理测试 / 问卷填写

心心相印现在只保留心理测试和问卷填写。伴侣测试已删除：题库、20 题状态机、报告、共同记忆写回和显式聊天卡都不再存在。不要恢复伴侣测试，也不要把外部设计稿反向做成新的伴侣流程。

修改本 App 前同时阅读根目录 [`PRODUCT.md`](../../PRODUCT.md)。

## 当前入口

首页只有两张功能卡：心理测试、问卷填写。角色选择留在各自模块内部。

- [`apps/HeartSyncApp.tsx`](../../apps/HeartSyncApp.tsx)：两个模块的顶层入口。
- [`apps/heartSync/PsychTestModule.tsx`](../../apps/heartSync/PsychTestModule.tsx)：心理题库、盲答、默认答案、答案揭晓、深聊和历史。
- [`apps/heartSync/QuestionnaireModule.tsx`](../../apps/heartSync/QuestionnaireModule.tsx)：问卷导入、增量补答、结算和自动写回。
- [`utils/heartSyncPsych.ts`](../../utils/heartSyncPsych.ts)、[`utils/heartSyncQuestionnaire.ts`](../../utils/heartSyncQuestionnaire.ts)：纯函数与 prompt。
- [`utils/heartSyncService.ts`](../../utils/heartSyncService.ts)：公共模型请求与 chat-only 写回。`persistHeartSyncEvent()` 不创建 `MemoryFragment`，也不跑记忆宫殿。

## 不可破坏的约束

### 心理测试

- 一题一 session。角色初答只看到安全题面：选择题仅 key 与 label，不含默认答案或 `interpretation`。
- `partner` 盲答，`user` 由用户填写，`discussion` 揭晓后按原文无限追加 `turns`，`complete` 用 `sharedMessageId` 幂等写回主聊天。
- 删除原题后，历史 session 仍靠 `questionSnapshot` 回看，不能再从该历史 session 改默认答案。
- 聊天卡 `displayPayload` 与 `contextText` 都保留完整讨论，并刻意剥掉题库里的 `defaultAnswer`。

### 问卷填写

- 只导入 JSON v1 选择题。答题阶段 payload 不含 `scoringRules` / `resultGuide`。
- `answers` 是已冻结的部分答案。`getMissingQuestionnaireQuestions()` 是下一次请求的唯一题目来源。同值重复折叠，冲突或非法选项保持 missing，不猜测。
- 全部答案冻结后才结算。结算返回里的 answers 一律忽略。失败只允许重算，不清空答案，也不重新答题。
- `displayPayload` 保存完整问卷、冻结答案和规则，供用户展开。`contextText` 只保留问卷名、结果、紧凑答案编号和角色反应。主聊天 prompt 与 `messageFormat` 只消费 `contextText`。

### 上下文边界

`requestHeartSyncModel()` 默认带上主聊天上下文。心理测试和问卷的“盲答”只保证当前阶段的敏感字段不进入显式 prompt，不会抹掉主聊天里已经写回的旧事件。不要把这说成模型绝对看不到历史答案。

## 存储与旧数据

`heart_sync` 对象库继续存在，不升 `DB_VERSION`。保留的 kind 是 `psych_question`、`psych_session`、`questionnaire`、`questionnaire_session`。

旧伴侣记录的 kind 是 `settings` 和 `session`。数据库打开后会删掉这两种记录。新备份导出和导入都会丢掉它们，避免自定义题和冻结题面继续被带走。心理测试与问卷记录仍随 `heartSyncRecords` 往返。

历史聊天里的 `companion_test_card` 不再展示分数、分类或短笺，上下文也只剩一条通用系统卡片，避免旧卡片落到歌曲卡渲染或把摘要继续送进模型。

## 验证

```
.\node_modules\.bin\vitest.cmd run utils/heartSyncExtensions.test.ts utils/heartSyncService.extensions.test.ts utils/heartSync.db.test.ts utils/messageFormat.heartSync.test.ts utils/chatPrompts.heartSync.test.ts utils/safeAreaApps.test.ts
```
