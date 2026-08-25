// 数据导入+打标管线: GitHub 星标 + Chrome 账号书签 → 打标 JSONL → KV bulk 导入。
// 一次性脚本(bun/tsx 均可跑), 输出 data/library.jsonl + data/kv-bulk.json, 不进 Worker 运行时。
//
// 用法:
//   gh auth token 已配 → bun scripts/ingest/import-library.ts stars
//   书签:   bun scripts/ingest/import-library.ts bookmarks
//   全量:   bun scripts/ingest/import-library.ts all
import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import os from 'node:os';

// bun/node 双跑: Web Crypto 不可用时落 node crypto
const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

type Entry = {
  key: string;            // kv key: lib:<src>:<id>
  value: {
    src: 'star' | 'bookmark';
    id: string;           // owner/repo 或 url
    name: string;
    url: string;
    folder?: string;      // 书签文件夹(用户手工分类=最准的标签)
    desc?: string;
    lang?: string;        // repo 主语言
    topics?: string[];
    stars?: number;
    tags: string[];       // 规则打标结果
  };
};

// ---------- 打标规则(纯规则零 AI) ----------
const LANG_MAP: Record<string, string> = {
  Rust: 'rust', Go: 'go', Python: 'python', TypeScript: 'ts', JavaScript: 'js',
  'C++': 'cpp', C: 'c', Java: 'java', Kotlin: 'kotlin', Swift: 'swift',
  Ruby: 'ruby', PHP: 'php', 'C#': 'csharp', Shell: 'shell', HTML: 'web', CSS: 'web',
  Lua: 'lua', 'Vim Script': 'vim', Zig: 'zig', 'Jupyter Notebook': 'ml',
};
const TOPIC_TAGS = [
  ['ai', ['ai', 'llm', 'gpt', 'agent', 'rag', 'machine-learning', 'deep-learning']],
  ['security', ['security', 'pentest', 'cve', 'exploit', 'red-team', 'malware', 'osint', 'ctf', 'reversing']],
  ['web', ['web', 'frontend', 'react', 'vue', 'nextjs', 'css']],
  ['browser-ext', ['chrome-extension', 'browser-extension', 'webextension']],
  ['devops', ['docker', 'kubernetes', 'ci-cd', 'devops', 'self-hosted']],
  ['scraper', ['scraper', 'crawler', 'spider', 'automation']],
];

function tagRepo(lang?: string, topics: string[] = [], stars = 0): string[] {
  const t = new Set<string>();
  if (lang && LANG_MAP[lang]) t.add(LANG_MAP[lang]);
  for (const [tag, keys] of TOPIC_TAGS)
    if (topics.some((x) => keys.some((k) => x.toLowerCase().includes(k)))) t.add(tag);
  if (stars >= 10000) t.add('popular');
  else if (stars >= 1000) t.add('known');
  return [...t];
}

// 域名规则表: 书签/网页打标
const DOMAIN_TAGS: [RegExp, string][] = [
  [/^github\.com$/, 'github'],
  [/news\.ycombinator\.com$/, 'hackernews'],
  [/(deepwiki\.com|zread\.ai|deepwiki\.)$/, 'wiki'],
  [/^x\.com$|^twitter\.com$/, 'tweet'],
  [/substack\.com$|ghost\.io$|medium\.com$/, 'blog'],
  [/youtube\.com$|^bilibili\.com$/, 'video'],
  [/\.(edu|ac\.[a-z]{2})$/, 'academic'],
  [/arxiv\.org$|papers?\./, 'paper'],
];

function tagUrl(host: string): string[] {
  const t: string[] = [];
  for (const [re, tag] of DOMAIN_TAGS) if (re.test(host)) t.push(tag);
  return t.length ? t : ['untagged'];
}

// ---------- 来源 1: GitHub 星标 ----------
async function importStars(): Promise<Entry[]> {
  const entries: Entry[] = [];
  let page = 1;
  while (true) {
    const out = execSync(
      `gh api "users/gandli/starred?per_page=100&page=${page}" --jq '.[]'`,
      { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
    );
    const items = out.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
    if (!items.length) break;
    for (const r of items as any[]) {
      const tags = tagRepo(r.language, r.topics ?? [], r.stargazers_count ?? 0);
      entries.push({
        key: `lib:star:${r.full_name.toLowerCase()}`,
        value: {
          src: 'star', id: r.full_name, name: r.full_name.split('/')[1] ?? r.full_name,
          url: r.html_url ?? `https://github.com/${r.full_name}`,
          desc: r.description ?? undefined, lang: r.language ?? undefined,
          topics: r.topics ?? [], stars: r.stargazers_count, tags,
        },
      });
    }
    console.log(`stars page ${page}: cumulative ${entries.length}`);
    if (items.length < 100) break;
    page++;
  }
  return entries;
}

// ---------- 来源 2: Chrome 账号书签(AccountBookmarks) ----------
function importBookmarks(): Entry[] {
  const p = `${os.homedir()}/Library/Application Support/Google/Chrome/Default/AccountBookmarks`;
  if (!existsSync(p)) throw new Error(`AccountBookmarks not found: ${p}`);
  const d = JSON.parse(readFileSync(p, 'utf8'));
  const entries: Entry[] = [];
  const seen = new Set<string>();
  const walk = (n: any, folder: string) => {
    if (n.type === 'url') {
      let host = '';
      try { host = new URL(n.url).hostname.replace(/^www\./, ''); } catch { return; }
      if (seen.has(n.url)) return;
      seen.add(n.url);
      // 空标题书签用父文件夹名兜底, 不丢分类语义(Greptile P1)
      const name = n.name?.trim() || host;
      entries.push({
        key: `lib:bm:${sha256(n.url).slice(0, 32)}`, // 全量哈希前 32 hex——截断会碰撞覆盖不同 URL
        value: {
          src: 'bookmark', id: n.url, name, url: n.url,
          folder: folder || undefined, tags: [...new Set([tagUrl(host)[0], ...(folder ? [`f:${folder}`] : [])])],
        },
      });
    }
    for (const c of n.children ?? []) walk(c, n.type === 'folder' ? c?.name && n.name !== '书签栏' && n.name !== '其他书签' && n.name !== '移动设备书签' ? n.name : '' : folder);
  };
  for (const r of Object.values<any>(d.roots)) walk(r, '');
  return entries;
}

// ---------- main ----------
const mode = process.argv[2] ?? 'all';
if (!['stars', 'bookmarks', 'all'].includes(mode)) {
  console.error(`unknown mode: ${mode} (use stars|bookmarks|all)`);
  process.exit(2); // 先校验后写盘——坏参数不能覆盖已生成的产物
}
let all: Entry[] = [];
if (mode === 'stars' || mode === 'all') {
  all = all.concat(await importStars());
}
if (mode === 'bookmarks' || mode === 'all') {
  all = all.concat(importBookmarks());
}
// 去重: 同 key 后写覆盖前写
const dedup = new Map(all.map((e) => [e.key, e]));
const finalEntries = [...dedup.values()];
console.log(`total unique: ${finalEntries.length} (star=${finalEntries.filter((e) => e.value.src === 'star').length}, bm=${finalEntries.filter((e) => e.value.src === 'bookmark').length})`);

writeFileSync('data/library.jsonl', finalEntries.map((e) => JSON.stringify(e.value)).join('\n'));
// wrangler kv bulk 格式: [{key, value(string)}]
mkdirSync('data', { recursive: true }); // fresh clone 无 data/ 时自建(Greptile P1)
writeFileSync('data/kv-bulk.json', JSON.stringify(finalEntries.map((e) => ({ key: e.key, value: JSON.stringify(e.value) }))));
// 自检
const sample = finalEntries[Math.floor(finalEntries.length / 2)].value;
console.assert(sample.tags.length > 0, 'sample has no tags');
console.log('written: data/library.jsonl + data/kv-bulk.json');
