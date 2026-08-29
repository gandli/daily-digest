import type { Env, SourceItem } from './types';

/**
 * D1 存档镜像(冗余层): GitHub archive 分支为正本, KV 索引为主查询路径。
 * 所有 helper 失败静默——D1 故障绝不影响 GitHub/KV 主流程; DB 未绑定直接跳过,
 * 行为与旧版完全一致(测试与本地 dev 无需 binding)。
 *  schema 见 scripts/d1-schema.sql; 子请求预算: 每次调用 1 个(单条 batch)。
 */

/** /archive 分页行(date DESC)。topics 为逗号分隔原始串(D1 列原样), 调用方 split。 */
export type ArchiveIdxRow = {
  repo: string;
  date: string; // 文件名时间戳(链接拼 GitHub blob 用)
  url?: string;
  summary?: string;
  summaryZh?: string;
  topics?: string;
};

const UPSERT_IDX = `INSERT INTO archive_idx (repo_key, repo, date, url, summary, summary_zh, topics, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  ON CONFLICT(repo_key) DO UPDATE SET repo=excluded.repo, date=excluded.date, url=excluded.url,
    summary=excluded.summary, summary_zh=excluded.summary_zh, topics=excluded.topics, updated_at=datetime('now')`;

/** indexArchivedItems 的镜像写: repo 小写为主键 upsert(与 KV archive:idx 键语义一致, 最新覆盖)。 */
export async function d1UpsertArchiveIdx(env: Env, items: SourceItem[], dateStr: string): Promise<void> {
  if (!env.DB || !items.length) return;
  try {
    const db = env.DB;
    await db.batch(
      items.map((it) =>
        db
          .prepare(UPSERT_IDX)
          .bind(it.title.toLowerCase(), it.title, dateStr, it.url || null, it.desc || null, it.descZh || null, it.topics?.length ? it.topics.join(',') : null),
      ),
    );
  } catch (e) {
    console.error('d1 upsert archive_idx failed', String(e).slice(0, 80));
  }
}

/** flushArchivedPending 成功后的内容冗余(utf-8 markdown; base64 图片不存省空间)。按 path 幂等覆盖。 */
export async function d1PutArchiveFiles(env: Env, files: { path: string; content: string; message: string }[]): Promise<void> {
  if (!env.DB || !files.length) return;
  try {
    const db = env.DB;
    await db.batch(files.map((f) => db.prepare('INSERT OR REPLACE INTO archive_files (path, content, message) VALUES (?, ?, ?)').bind(f.path, f.content, f.message)));
  } catch (e) {
    console.error('d1 put archive_files failed', String(e).slice(0, 80));
  }
}

/** /archive 分页数据源(D1 优先): 返回 null 表示 D1 不可用/无数据 → 调用方回落 KV list。 */
export async function d1ArchivePage(
  env: Env,
  limit: number,
  offset: number,
): Promise<{ total: number; rows: ArchiveIdxRow[] } | null> {
  if (!env.DB) return null;
  try {
    const [page, count] = await Promise.all([
      env.DB.prepare('SELECT repo, date, url, summary, summary_zh AS summaryZh, topics FROM archive_idx ORDER BY date DESC, repo_key DESC LIMIT ? OFFSET ?')
        .bind(limit, offset)
        .all<ArchiveIdxRow>(),
      env.DB.prepare('SELECT COUNT(*) AS n FROM archive_idx').first<{ n: number }>(),
    ]);
    const total = count?.n ?? 0;
    if (!total) return null; // 空库视同不可用: 旧数据仍在 KV, 回落旧路径
    return { total, rows: page.results ?? [] };
  } catch (e) {
    console.error('d1 archive page failed', String(e).slice(0, 80));
    return null;
  }
}
