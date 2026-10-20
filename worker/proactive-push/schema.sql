-- Proactive Push Accelerator — D1 schema (v2: 24/7 server-side AI)
--
-- schedules 表：每个角色在每个浏览器端点上的独立调度。
-- character_configs 表：每个角色的 systemPrompt 缓存，
--   客户端注册时写入，Worker cron 调 LLM 时读取。

CREATE TABLE IF NOT EXISTS schedules (
  endpoint        TEXT    NOT NULL,
  char_id         TEXT    NOT NULL,
  p256dh          TEXT    NOT NULL,
  auth            TEXT    NOT NULL,
  interval_ms     INTEGER NOT NULL,
  next_fire_at    INTEGER NOT NULL,
  created_at      INTEGER NOT NULL,
  PRIMARY KEY (endpoint, char_id)
);

CREATE INDEX IF NOT EXISTS idx_schedules_next_fire ON schedules(next_fire_at);

-- 角色人设缓存：subscribe 时写入，cron 调 LLM 时读取
CREATE TABLE IF NOT EXISTS character_configs (
  char_id       TEXT PRIMARY KEY,
  system_prompt TEXT    NOT NULL,
  updated_at    INTEGER NOT NULL
);
