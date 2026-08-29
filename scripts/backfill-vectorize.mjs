// KV search:index → Vectorize daily-digest-search 一次性回填。需 wrangler 已登录(读 KV)。
// 嵌入/写入走 REST API, 需环境变量: CLOUDFLARE_ACCOUNT_ID + CLOUDFLARE_API_TOKEN(AI、Vectorize 编辑权限)。
// 用法: CLOUDFLARE_ACCOUNT_ID=xxx CLOUDFLARE_API_TOKEN=yyy node scripts/backfill-vectorize.mjs
import { execFileSync } from 'node:child_process';

const INDEX = 'daily-digest-search';
const MODEL = '@cf/baai/bge-m3'; // 必须与 src/vec.ts EMBED_MODEL 一致(1024 维)
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
if (!ACCOUNT || !TOKEN) {
  console.error('缺环境变量: CLOUDFLARE_ACCOUNT_ID / CLOUDFLARE_API_TOKEN');
  process.exit(1);
}
const api = (path, body) =>
  fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCOUNT}${path}`, {
    method: 'POST',
    headers: { authorization: `Bearer ${TOKEN}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }).then((r) => r.json());

const hash36 = (s) => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return 'h' + h.toString(36);
};
const vecId = (name) => {
  const lower = name.toLowerCase();
  return Buffer.byteLength(lower) <= 90 ? lower : hash36(lower);
};

const raw = execFileSync('npx', ['wrangler', 'kv', 'key', 'get', 'search:index', '--binding=CACHE', '--remote'], { encoding: 'utf8' });
const entries = JSON.parse(raw);
console.log(`entries: ${entries.length}`);

let done = 0;
for (let i = 0; i < entries.length; i += 32) {
  const chunk = entries.slice(i, i + 32);
  const r = await api(`/ai/run/${MODEL}`, { text: chunk.map((e) => String(e[3]).slice(0, 2000)) });
  if (!r.success) { console.error('embed failed', r.errors); process.exit(1); }
  const vectors = chunk.map((e, j) => ({
    id: vecId(String(e[1])),
    values: r.result.data[j],
    metadata: { src: String(e[0]), name: String(e[1]), url: String(e[2]) },
  }));
  for (let k = 0; k < vectors.length; k += 100) {
    const u = await api(`/vectorize/v2/indexes/${INDEX}/upsert`, { vectors: vectors.slice(k, k + 100) });
    if (!u.success) { console.error('upsert failed', u.errors); process.exit(1); }
  }
  done += chunk.length;
  console.log(`+${done}/${entries.length}`);
}
console.log('backfill done');
