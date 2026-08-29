// KV archive:idx:* → D1 archive_idx 一次性回填。需 wrangler 已登录(部署账号)。
// 用法: node scripts/backfill-d1-archive.mjs
// 语义: 与 src/d1.ts d1UpsertArchiveIdx 一致——repo_key=repo 小写, D1 列名 summary/summary_zh 避开 SQL 关键字。
import { execFileSync } from 'node:child_process';

const PREFIX = 'archive:idx:';
const DB = 'daily-digest-archive';
const run = (args) => execFileSync('npx', ['wrangler', ...args], { encoding: 'utf8' });
const esc = (v) => (v == null || v === '' ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);

const names = JSON.parse(run(['kv', 'key', 'list', '--binding=CACHE', '--prefix', PREFIX, '--remote']));
console.log(`keys: ${names.length}`);
if (!names.length) process.exit(0);

const rows = [];
for (const { name } of names) {
  const raw = run(['kv', 'key', 'get', name, '--binding=CACHE', '--remote']);
  try {
    const v = JSON.parse(raw);
    rows.push(`(${esc(name.slice(PREFIX.length))},${esc(v.repo)},${esc(v.date)},${esc(v.url)},${esc(v.desc)},${esc(v.descZh)},${esc((v.topics || []).join(','))})`);
  } catch {
    console.error('skip corrupt:', name);
  }
}
for (let i = 0; i < rows.length; i += 50) {
  const sql = `INSERT OR REPLACE INTO archive_idx (repo_key, repo, date, url, summary, summary_zh, topics) VALUES ${rows.slice(i, i + 50).join(',')}`;
  run(['d1', 'execute', DB, '--remote', '--command', sql, '-y']);
  console.log(`batch ${Math.floor(i / 50) + 1}: +${Math.min(50, rows.length - i)}`);
}
console.log(`backfill done: ${rows.length} rows`);
