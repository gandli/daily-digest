#!/usr/bin/env npx tsx
// product-digest 重管线(Actions 运行): 抓 HN → urlToMarkdown → 深摘要 → 渲染 → 落 archive → 直发 TG。
// 复用 src/ 全部逻辑, 唯一差异: env.AI(CF-only)用 stub 占位——translate.ts 内所有 AI 调用
// 都在 try/catch 里, stub 抛错即降级到 TranSmart/Google/MyMemory, 与 Worker 行为一致。
// 用法: OPENROUTER_API_KEY=.. BOT_TOKEN=.. CHAT_ID=.. GH_TOKEN=.. npx tsx scripts/product-digest.ts [dateStr]

import { fetchHackerNewsProducts } from '../src/sources/hn';
import { urlToMarkdown } from '../src/urlmd';
import { summarizeZhDeep, translateTextZh, isChinese } from '../src/translate';
import { renderProductMessage, renderMarkdown, renderTelegraphNodes } from '../src/render';
import { createTelegraphPage, archiveToGitHub } from '../src/archive';
import { sendPerRepoMessages } from '../src/notify';
import { topicsFromTitle, shanghaiDate } from '../src/index';
import type { Env, SourceItem } from '../src/types';

// CF-only AI binding 的 stub。translate.ts 内每次 AI.run 都在 try/catch 里 → 抛错即降级,不中断。
const stubAI = new Proxy({}, {
  get: (_t, prop) => {
    if (prop === 'run' || prop === 'toMarkdown') return async () => { throw new Error('AI stub: CF-only'); };
    return async () => { throw new Error('AI stub: CF-only'); };
  },
}) as unknown as Env['AI'];

function buildEnv(): Env {
  const requireEnv = (k: string) => {
    const v = process.env[k];
    if (!v) throw new Error(`missing env ${k}`);
    return v;
  };
  return {
    AI: stubAI,
    CACHE: {
      get: async () => null,
      put: async () => {},
      delete: async () => {},
      list: async () => ({ keys: [], list_complete: true }),
    } as unknown as Env['CACHE'],
    BOT_TOKEN: requireEnv('BOT_TOKEN'),
    CHAT_ID: requireEnv('CHAT_ID'),
    WEBHOOK_SECRET: 'unused-in-script',
    GH_TOKEN: requireEnv('GH_TOKEN'),
    TELEGRAPH_TOKEN: process.env.TELEGRAPH_TOKEN,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    JINA_API_KEY: process.env.JINA_API_KEY,
    GENEDAI_API_KEY: process.env.GENEDAI_API_KEY,
    GH_ARCHIVE_REPO: process.env.GH_ARCHIVE_REPO,
  };
}

async function main() {
  const env = buildEnv();
  const dateStr = process.argv[2] ?? shanghaiDate();
  const limit = Number(process.env.PRODUCT_LIMIT ?? 10);

  // 1. 抓 HN Show HN
  const items: SourceItem[] = await fetchHackerNewsProducts(limit);
  console.log(`[1/5] fetched ${items.length} HN items`);
  if (!items.length) throw new Error('no HN items');

  // 2. urlToMarkdown(有 url 的) — 无 30s 墙,串行逐篇,每篇内部 Jina/Genedai/..链
  const withUrl = items.filter((it) => !it.desc && it.url && /^https?:\/\//.test(it.url));
  for (const it of withUrl) {
    const md = await urlToMarkdown(env, it.url, {}).catch(() => '');
    const body = md.replace(/[#*>`|\!-]/g, '').replace(/\s+/g, ' ').trim().slice(0, 6000);
    if (body.length > 40) it.desc = body;
    console.log(`  url→md ${it.url.slice(0, 60)}: ${body.length} chars`);
  }

  // 3. 深摘要(OpenRouter,全量无 MAX_DEEP_PER_RUN=2 预算限制)
  for (const it of items) {
    if (!it.desc) it.desc = it.title;
    if (!isChinese(it.desc)) {
      if (env.OPENROUTER_API_KEY && it.desc.length > 40) {
        const deep = await summarizeZhDeep(env, it.desc).catch(() => null);
        if (deep) { it.descZh = deep.summaryZh; it.quote = deep.quote; }
        else it.descZh = (await translateTextZh(env, it.desc.slice(0, 500)).catch(() => null)) ?? undefined;
      } else {
        it.descZh = (await translateTextZh(env, it.desc.slice(0, 500)).catch(() => null)) ?? undefined;
      }
    } else if (!it.descZh) it.descZh = it.desc;
    it.topics = topicsFromTitle(it.title);
    console.log(`  summary ${it.title.slice(0, 40)}: ${(it.descZh ?? '').slice(0, 30)}`);
  }

  // 4. Telegraph + 渲染
  const telegraphUrl = env.TELEGRAPH_TOKEN ? await createTelegraphPage(env.TELEGRAPH_TOKEN, `product-${dateStr}`, renderTelegraphNodes(items)).catch(() => null) : null;
  const chunks = renderProductMessage(dateStr, items, telegraphUrl ?? undefined, env.GH_ARCHIVE_REPO || 'gandli/daily-digest');
  console.log(`[4/5] rendered ${chunks.length} messages${telegraphUrl ? `, telegraph: ${telegraphUrl}` : ''}`);

  // 5a. 落 archive 分支(JSON + markdown)
  const jsonPath = `product/${dateStr}.json`;
  const jsonPayload = JSON.stringify({ date: dateStr, items, telegraphUrl: telegraphUrl ?? undefined, generatedAt: new Date().toISOString() }, null, 2);
  await putToArchiveBranch(env, jsonPath, jsonPayload, `product: ${dateStr}`);
  const md = renderMarkdown(dateStr, items, telegraphUrl ?? undefined);
  await archiveToGitHub(env, dateStr, md);
  console.log(`[5a] archived ${jsonPath} + ${dateStr}.md`);

  // 5b. 直发 TG(Worker 已不在路径上, 由 Actions 直接发)
  await sendPerRepoMessages(env.BOT_TOKEN, env.CHAT_ID, chunks.map((html, i) => ({ html, ogUrl: items[i].url })), env.GH_ARCHIVE_REPO || 'gandli/daily-digest');
  console.log(`[5b] sent ${chunks.length} TG messages`);

  console.log(`product sent ${dateStr} ${items.length} items`);
}

// archive 分支通用 PUT(从 archive.ts 内联, 避免导出私有 putToArchiveBranch)
async function putToArchiveBranch(env: Env, path: string, content: string, message: string): Promise<boolean> {
  const repo = env.GH_ARCHIVE_REPO || 'gandli/daily-digest';
  const encoded = Buffer.from(content).toString('base64');
  let sha: string | undefined;
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/contents/${path}?ref=archive`, {
      headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'daily-digest' },
    });
    if (r.ok) sha = ((await r.json()) as { sha?: string }).sha;
  } catch { /* 无网/限流 → 走创建 */ }
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'daily-digest', 'content-type': 'application/json' },
    body: JSON.stringify({ message, content: encoded, branch: 'archive', ...(sha ? { sha } : {}) }),
  });
  if (!res.ok) console.error(`archive put ${path} ${res.status}: ${await res.text()}`);
  return res.ok;
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((e) => { console.error('FATAL:', e); process.exit(1); });
