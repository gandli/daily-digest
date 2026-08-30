// 手动 flush: KV pend:arc:* → GitHub archive 分支(单 commit)。镜像 src/archive.ts flushArchivedPending。
// 用法: node scripts/manual/flush-pend.mjs <gh_token>
// 成功才删 pend 键; 失败保留下次再试。
import { execFileSync } from 'node:child_process';

const TOKEN = process.argv[2];
if (!TOKEN) { console.error('usage: node scripts/manual/flush-pend.mjs <gh_token>'); process.exit(1); }
const REPO = 'gandli/daily-digest';
const API = `https://api.github.com/repos/${REPO}/git`;
const KV_NS = '51e73f8381d34b9c95eaebdf4f7d8101';
const ACCT = '2a80b3b4d611671179333b6d60fdb881';
const CF_TOKEN = process.env.CLOUDFLARE_API_TOKEN || execFileSync('env', ['|', 'grep', 'CF'], { encoding: 'utf8' });
const CF = process.env.CLOUDFLARE_API_TOKEN;

const gh = async (path, opts = {}) => {
  const res = await fetch(`${API}/${path}`, {
    method: opts.method || 'GET',
    headers: {
      Authorization: `Bearer ${TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'daily-digest',
      ...(opts.json ? { 'content-type': 'application/json' } : {}),
    },
    ...(opts.body ? { body: JSON.stringify(opts.body) } : {}),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${path} ${res.status}: ${JSON.stringify(j).slice(0, 200)}`);
  return j;
};

const kvGet = async (name) => {
  const u = `https://api.cloudflare.com/client/v4/accounts/${ACCT}/storage/kv/namespaces/${KV_NS}/values/${encodeURIComponent(name)}`;
  const r = await fetch(u, { headers: { Authorization: `Bearer ${CF}` } });
  if (!r.ok) throw new Error(`kv get ${name} ${r.status}`);
  return r.json();
};
const kvDel = async (name) => {
  const u = `https://api.cloudflare.com/client/v4/accounts/${ACCT}/storage/kv/namespaces/${KV_NS}/values/${encodeURIComponent(name)}`;
  await fetch(u, { method: 'DELETE', headers: { Authorization: `Bearer ${CF}` } });
};
const kvList = async (prefix) => {
  const u = `https://api.cloudflare.com/client/v4/accounts/${ACCT}/storage/kv/namespaces/${KV_NS}/keys?prefix=${prefix}&limit=1000`;
  const r = await fetch(u, { headers: { Authorization: `Bearer ${CF}` } });
  return (await r.json()).result.map((k) => k.name);
};

const decodeB64 = (b64) => Buffer.from(b64, 'base64');

// 1. 列 pend
const keys = await kvList('pend:arc:');
console.log(`pend keys: ${keys.length}`);
if (!keys.length) process.exit(0);

// 2. 读全部, 按 path 去重(后写覆盖)
const byPath = new Map();
for (const name of keys) {
  try {
    const v = await kvGet(name);
    if (!v?.path) continue;
    byPath.set(v.path, { name, item: v });
  } catch (e) { console.error('skip corrupt', name, String(e).slice(0, 60)); }
}
const items = [...byPath.values()];
console.log(`unique paths: ${items.length}`);

// 3. base: ref → commit → tree
const ref = await gh(`ref/heads/archive`);
const baseSha = ref.object.sha;
const commit = await gh(`commits/${baseSha}`);
const baseTree = commit.tree.sha;
console.log(`base: ${baseSha.slice(0, 8)} tree ${baseTree.slice(0, 8)}`);

// 4. blob 逐文件(单 commit 内, 上限 40)
const FLUSH_BLOB_CAP = 40;
const batch = items.slice(0, FLUSH_BLOB_CAP);
const blobShas = [];
for (const { name, item } of batch) {
  const content = item.encoding === 'utf-8' ? decodeB64(item.content).toString('utf8') : item.content;
  const b = await gh(`blobs`, { method: 'POST', json: true, body: { content, encoding: item.encoding } });
  blobShas.push({ path: item.path, sha: b.sha });
  console.log(`  blob ${item.path} ${b.sha.slice(0, 8)}`);
}

// 5. tree → commit → ref
const tree = await gh(`trees`, { method: 'POST', json: true, body: { base_tree: baseTree, tree: blobShas.map((b) => ({ path: b.path, mode: '100644', type: 'blob', sha: b.sha })) } });
const newCommit = await gh(`commits`, { method: 'POST', json: true, body: { message: `archive: batch ${batch.length} items`, tree: tree.sha, parents: [baseSha] } });
await gh(`refs/heads/archive`, { method: 'PATCH', json: true, body: { sha: newCommit.sha, force: false } });
console.log(`committed ${batch.length} files: ${newCommit.sha}`);

// 6. 成功删键
for (const { name } of batch) await kvDel(name).catch((e) => console.error('del fail', name, String(e).slice(0, 60)));
console.log(`deleted ${batch.length} pend keys`);
