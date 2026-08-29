-- D1: daily-digest-archive (id efd8017f-03ee-46e2-bcde-0658986f23a3, APAC)
-- 应用: npx wrangler d1 execute daily-digest-archive --remote --file=scripts/d1-schema.sql
-- 语义: KV archive:idx:<repo小写> 的镜像(repo 键 upsert, /archive 列表数据源, D1 优先 KV 兜底)
--       + flush 成功后的 markdown 内容冗余备份(GitHub archive 分支为正本)。

-- 存档元数据: 与 KV archive:idx:<repo小写> 一键一条(最新时间戳覆盖), 按 date DESC 供 /archive 分页
CREATE TABLE IF NOT EXISTS archive_idx (
  repo_key TEXT PRIMARY KEY, -- repo 小写
  repo TEXT NOT NULL,        -- 原始标题(Owner/Repo 或域名 host)
  date TEXT NOT NULL,        -- 文件名时间戳(含 repo__ 前缀), 链接拼 GitHub blob 用
  url TEXT,                  -- 真实源 URL
  summary TEXT,              -- 英文/原始描述(列名避开 SQL 关键字 desc)
  summary_zh TEXT,           -- 中文描述
  topics TEXT,               -- 逗号分隔标签
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_archive_idx_date ON archive_idx(date DESC);

-- 存档内容冗余: flushArchivedPending 成功后按 path 写入(utf-8 markdown, 不存 base64 图片)
CREATE TABLE IF NOT EXISTS archive_files (
  path TEXT PRIMARY KEY,     -- archive 分支内相对路径(archive/<年>/<stamp>.md)
  content TEXT NOT NULL,     -- markdown 原文
  message TEXT,              -- commit message
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
