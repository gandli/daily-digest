import type { Env, SourceItem } from './types';
import { resolveDescriptions, translateBatch, translateTextZh, isChinese, summarizeZh, generateTagsZh, generateTitleZh } from './translate';
import { fetchDeepwikiOverview } from './deepwiki';
import { renderMessage, renderMarkdown, esc } from './render';
import { sendPerRepoMessages, sendTelegram } from './notify';
import { archiveToGitHub, archiveOgImage, createTelegraphAccount, createTelegraphPage } from './archive';
import { urlToMarkdown, extractOgImage } from './urlmd';

// 北京时间日期串(与 index.ts 一致; 独立内联避免循环依赖)
const today = (): string => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

/** 同一 repo 当日已查过 → 跳过重复回复与存档。TTL 48h(跨过午夜即视为新一天)。 */
export async function seenToday(env: Env, repo: string): Promise<boolean> {
  const key = `lookup:${today()}:${repo.toLowerCase()}`;
  const hit = await env.CACHE.get(key);
  if (hit) return true;
  try {
    await env.CACHE.put(key, '1', { expirationTtl: 172800 });
  } catch {
    // ponytail: KV 额度/网络异常只损失去重标记(webhook 主路径, 原裸 put 曾把 bot 整个打挂)
  }
  return false;
}

/**
 * URL 重发语义: 记录上次处理质量, 决定重发时是否重跑全管线(翻译/描述/归档)。
 * 返回 'first'(首次, 正常处理) | 'retry'(上次翻译/描述有缺失, 重跑) | 'done'(上次成功, 跳过)。
 * ponytail: 单 KV 键存布尔对而非状态机; 处理方结束后必须 markProcessed 回填真实结果。
 */
export async function shouldReprocess(env: Env, url: string): Promise<'first' | 'retry' | 'done'> {
  const key = `reproc:${url.slice(0, 400)}`; // 与 markProcessed 同一截断, 保证读写对齐
  let prev: { translated?: boolean; descOk?: boolean } | null = null;
  try {
    const raw = await env.CACHE.get(key);
    if (raw) prev = JSON.parse(raw) as { translated?: boolean; descOk?: boolean };
  } catch {
    prev = null; // 损坏值视同首次
  }
  // 首次: 先占位(默认失败态, 处理方负责覆写为真实结果)——防并发双跑
  if (!prev || (prev.translated === undefined && prev.descOk === undefined)) {
    try {
      await env.CACHE.put(key, JSON.stringify({ ts: Date.now(), translated: false, descOk: false }), { expirationTtl: 7 * 86400 });
    } catch {
      // ponytail: KV 写失败按首次处理(重发会重跑管线, 幂等)
    }
    return 'first';
  }
  return prev.translated && prev.descOk ? 'done' : 'retry';
}

/** shouldReprocess 的配对写: 处理结束后回填真实质量。title/summary 供重复卡片渲染具体内容。 */
export async function markProcessed(env: Env, url: string, translated: boolean, descOk: boolean, mdStamp?: string, title?: string, summary?: string): Promise<void> {
  // ponytail: 键截断防 KV 512B 上限抛错(url 理论上可超长); 截断碰撞仅影响 7 天 TTL 去重, 可接受
  try {
    await env.CACHE.put(`reproc:${url.slice(0, 400)}`, JSON.stringify({ ts: Date.now(), translated, descOk, md: mdStamp, t: title?.slice(0, 120), s: summary?.slice(0, 300) }), { expirationTtl: 7 * 86400 });
  } catch {
    // 写失败只影响重发判定(下次按 retry 重跑), 不杀调用方
  }
}

/** 提取文本中的 GitHub repo 引用(去重、滤文件路径、剥 .git)。全量提取, fanout 顺序执行防超子请求。 */
export function extractRepoRefs(text: string): string[] {
  return [...new Set([...text.matchAll(/https?:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/g)].map((m) => m[1]))]
    .map((r) => r.replace(/\.git$/i, ''))
    .filter((r) => !/\.md$|\.js$|\.ts$|\.rs$|\.py$/i.test(r))
    .slice(0, 10);
}

/** 内容含 GitHub repo 链接 → 逐个走 repo lookup。分批串行(每批3个并发, 批间串行)防单请求 50 子请求上限; 全部解析不截断。ctx 缺省(如 cron)不触发。 */
export async function fanoutRepoRefs(env: Env, chatId: string, text: string, ctx?: ExecutionContext): Promise<void> {
  if (!ctx) return;
  const repos = extractRepoRefs(text);
  const fresh: string[] = [];
  // ponytail 修复: 不用 seenToday()(即读即置位)。只读 CACHE.get 过滤; 成功完成才 put → 中断/失败重发续跑。
  for (const r of repos) {
    const seen = await env.CACHE.get(`lookup:${today()}:${r.toLowerCase()}`).catch(() => null);
    if (!seen) fresh.push(r);
  }
  if (!fresh.length) return;
  // ponytail 方案A: 多 repo 用精简卡(GitHub 描述原文, 不 deepwiki/翻译/三链) —— 每 repo ~2 子请求, 全并发 9 ≈18 < 50
  // → 单请求能全出(完整 lookupRepo 5-6 子请求/个 ×9 >50 铁超)。单 repo 查询仍走完整 lookupRepo(其他调用)。
  const stamp = `${today()}-${Date.now() % 86400000}`;
  await Promise.all(
    fresh.map(async (r) => {
      try {
        const item = await fetchRepo(r, env.GH_TOKEN);
        if (!item) return;
        // 完整三段式: 标题⭐·语言 / 中文摘要(描述翻译) / 标签 / 存档三链 —— 对齐统一排版
        const stars = item.stars ? ` ⭐${item.stars >= 1000 ? (item.stars / 1000).toFixed(1) + 'k' : item.stars}` : '';
        const lang = item.lang ? ` · ${item.lang}` : '';
        // 描述优先 wiki 三链(fetchDeepwikiOverview 是 wiki 英文 Overview), 失败回退 GitHub desc
        let descZh = item.descZh ?? '';
        if (!isChinese(descZh)) {
          // 1. wiki: deepwiki Overview(英文) → 翻译
          const dw = await fetchDeepwikiOverview(r, 300).catch(() => null);
          if (dw && dw.length > 8) {
            const t = await translateTextZh(env, dw.slice(0, 500)).catch(() => null);
            descZh = (isChinese(t ?? '') ? t : null) ?? dw;
          } else if (item.desc) {
            // 2. 兜底: GitHub desc(英文)→翻译; 或已是中文
            if (isChinese(item.desc)) descZh = item.desc;
            else { const t = item.desc.length > 8 ? (await translateTextZh(env, item.desc.slice(0, 500)).catch(() => null)) : null; descZh = (isChinese(t ?? '') ? t : null) ?? item.desc; }
          }
        }
        const topicTags = (item.topics ?? []).slice(0, 4).map((x) => `#${x}`).join(' ');
        const mdLink = `https://github.com/${env.GH_ARCHIVE_REPO || 'gandli/daily-digest'}/blob/archive/archive/${today().slice(0, 4)}/${today()}.md`;
        const html =
          `<b><a href="${esc(item.url)}">${esc(item.title)}</a></b>${stars}${lang}\n\n` +
          (descZh ? `📝 ${esc(descZh).slice(0, 300)}\n\n` : '') +
          `#archive${topicTags ? ` ${topicTags}` : ''}\n\n` +
          // wiki 三链在倒数第二行(存档三链之前)
          `🗂 <a href="https://deepwiki.com/${esc(item.title)}">deepwiki</a> · <a href="https://zread.ai/${esc(item.title)}">zread</a> · <a href="https://codewiki.google/github.com/${esc(item.title)}">codewiki</a>\n` +
          `📁 ${archiveLinks(item.url, undefined, mdLink)}`;
        await sendPerRepoMessages(env.BOT_TOKEN, chatId, [{ html, photo: `https://opengraph.githubassets.com/1/${item.title}`, ogUrl: item.url }], env.GH_ARCHIVE_REPO || 'gandli/daily-digest', env.CACHE);
        // 仍索引(为 /search 可查)
        await indexArchivedItems(env, [item], stamp).catch(() => {});
        await env.CACHE.put(`lookup:${today()}:${r.toLowerCase()}`, '1', { expirationTtl: 172800 }).catch(() => {});
      } catch { /* 单个失败不影响其它 */ }
    }),
  );
}

/** 三链存档链接: Telegraph(有则主) → web.archive.org(有源 URL, 简称 Wayback) → GitHub md(兜底)。HTML 转义。纯文本链(调用方加前缀)。 */
export function archiveLinks(url: string | undefined, tgUrl: string | undefined, mdLink: string): string {
  const links: string[] = [];
  if (tgUrl) links.push(`<a href="${tgUrl}">Telegraph</a>`);
  // web.archive 兜底快照——用最近时间戳(web/2/ 重定向到最新快照)。简称 Wayback 省长度。
  if (url) links.push(`<a href="https://web.archive.org/web/2/${encodeURIComponent(url).replace(/%3A/g, ':').replace(/%2F/g, '/')}">Wayback</a>`);
  links.push(`<a href="${mdLink}">Archive</a>`);
  return links.join(' · ');
}

/** 存档成功后写 /search 索引(archive:idx:<repo> → {repo, date, descZh})。 */
export async function indexArchivedItems(env: Env, items: SourceItem[], dateStr: string): Promise<void> {
  for (const it of items) {
    try {
      await env.CACHE.put(
        `archive:idx:${it.title.toLowerCase()}`,
        JSON.stringify({ repo: it.title, date: dateStr, desc: it.desc || undefined, descZh: isChinese(it.descZh) ? it.descZh : undefined, topics: it.topics?.slice(0, 4) }),
      );
    } catch {
      /* 索引失败不影响主流程 */
    }
  }
  // 增量追加 search:index(单键 RMW; 个人 bot 并发极低, 丢条目概率近零)
  if (!items.length) return;
  try {
    const raw = await env.CACHE.get('search:index');
    const entries: unknown[][] = raw ? JSON.parse(raw) : [];
    const haySet = new Set(entries.map((e) => String(e[1]))); // 去重: 全量 name 集合
    for (const it of items) {
      if (haySet.has(it.title)) continue; // 幂等: 已存在跳过
      const name = it.title;
      const hay = `${name} ${it.desc ?? ''} ${it.descZh ?? ''} ${dateStr}`.toLowerCase();
      entries.push(['x', name, it.url ?? '', hay, (it.descZh ?? it.desc ?? '').slice(0, 120)]);
    }
    await env.CACHE.put('search:index', JSON.stringify(entries));
  } catch {
    /* search:index 增量失败不影响主流程 */
  }
}

/** 从文本提取 GitHub 仓库链接或裸 owner/repo。优先 github.com 域; 兜底裸 owner/repo(排除文件名形态)。 */
export function extractRepo(text: string): string | null {
  const strip = (s: string) => s.replace(/\.git$/i, '').replace(/[。.,,;；/>"]$/, '');
  const full = text.match(/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/i);
  if (full) return strip(full[1]);
  // 裸 owner/repo(无域名、斜杠二段、非路径分隔)——宽松匹配常见仓库形态
  const bare = text.match(/(?:^|\s)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:\s|$)/);
  if (!bare) return null;
  const cand = strip(bare[1]);
  // ponytail: 文件/路径误报排除(src/utils.ts、vite.config.js 等)——按扩展名黑名单, 新框架名不在表内会漏, 可换白名单
  if (/\.[a-z]{1,5}$/i.test(cand.split('/')[1])) return null;
  return cand;
}

/** 从 GitHub API 抓单 repo 详情 → SourceItem。网络/超时抛给调用方(由 lookupRepo 统一回复用户)。 */
async function fetchRepo(repo: string, ghToken: string): Promise<SourceItem | null> {
  const res = await fetch(`https://api.github.com/repos/${repo}`, {
    headers: {
      Authorization: `Bearer ${ghToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'daily-digest',
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as {
    full_name: string; description: string | null; stargazers_count?: number;
    language?: string | null; topics?: string[];
  };
  if (!j.full_name) return null;
  return {
    title: j.full_name,
    url: `https://github.com/${j.full_name}`,
    desc: j.description ?? j.full_name,
    stars: j.stargazers_count ?? undefined,
    lang: j.language ?? undefined,
    topics: (j.topics ?? []).slice(0, 4),
  };
}

/** 仓库查找: 描述 -> OG图 -> 回复 -> 存档。失败给用户明确回复, 不静默。 */
export async function lookupRepo(env: Env, chatId: string, repo: string): Promise<void> {
  // P1-B: fetch 超时/网络抖动会抛——包住并回复用户(webhook 已 200, 这里静默=用户无任何反馈)
  let item: SourceItem | null = null;
  try {
    item = await fetchRepo(repo, env.GH_TOKEN);
  } catch (e) {
    console.error('lookup fetchRepo failed', String(e).slice(0, 80));
    await sendTelegram(env.BOT_TOKEN, chatId, `⚠️ 查询 ${repo} 失败(网络异常)，请稍后再试。`);
    return;
  }
  if (!item) {
    await sendTelegram(env.BOT_TOKEN, chatId, `❌ 找不到仓库 ${repo}，请检查拼写或是否为公开仓库。`);
    return;
  }
  // 单 repo: 描述链 = KV 缓存(7天内) → deepwiki 概述(写入缓存) → resolveDescriptions(zread) → GitHub 描述翻译
  const cachedZh = await getFreshDesc(env, repo);
  if (cachedZh) {
    item.descZh = cachedZh;
    console.log('lookup: desc from cache');
  } else {
    // ponytail: deepwiki 对部分 repo 返回"架构"类描述——固定优先 deepwiki, 因 zread 偶发选中架构段
    try {
      const dw = await fetchDeepwikiOverview(repo);
      if (dw) {
        item.desc = dw;
        const done = await translateBatch(env, [item]);
        item.descZh = done[0]?.descZh;
        if (isChinese(item.descZh ?? undefined)) {
          await env.CACHE.put(descKey(repo), JSON.stringify({ zh: item.descZh!, ts: Date.now() } satisfies DescCache));
        }
      }
    } catch {
      /* deepwiki 失败落 zread */
    }
    if (!item.descZh) {
      try {
        await resolveDescriptions(env, [item]);
      } catch {
        /* 描述失败不阻塞发送 */
      }
    }
  }
  // 兜底: zread/deepwiki 都无索引(如新仓库) → GitHub repo 描述; 已是中文直接用, 否则翻译
  if (!item.descZh && item.desc) {
    if (isChinese(item.desc)) {
      item.descZh = item.desc; // GitHub 描述本身就是中文
    } else {
      const done = await translateBatch(env, [item]);
      item.descZh = done[0]?.descZh;
    }
    console.log('lookup: fallback to GitHub desc translation');
  }
  // 一条消息: ogUrl 触发 TG link_preview(GitHub repo → opengraph.githubassets 动态生成 OG 卡)
  const chunks = renderMessage(today(), [item]);
  await sendPerRepoMessages(env.BOT_TOKEN, chatId, chunks.map((html) => ({ html, photo: `https://opengraph.githubassets.com/1/${item.title}`, ogUrl: item.url })), env.GH_ARCHIVE_REPO || 'gandli/daily-digest', env.CACHE);
  // 索引独立写入, 不依赖 archive 成功(archive 抛错 → 索引仍落, 避免 seenToday 死循环)
  const stamp = `${today()}-${Date.now() % 86400000}`; // 单次计算: 索引 date 必须等于实际文件名
  try {
    await indexArchivedItems(env, [item], stamp); // /search 索引
  } catch {
    /* 索引失败不影响主流程 */
  }
  // 存档: OG 图入库 og-images/, markdown 引用相对路径(失败回退远程 URL)
  try {
    const ogPath = await archiveOgImage(env, item.title);
    const md = renderMarkdown(today(), [item], undefined, ogPath ? new Map([[item.title, ogPath]]) : undefined);
    await archiveToGitHub(env, stamp, md);
  } catch {
    /* 存档失败静默 */
  }
}

/**
 * 描述缓存(KV lookup:desc:<repo> → {zh, ts}): 7天内直接复用(省 deepwiki/zread/翻译子请求),
 * 过期由每日 cron 的 refreshLookupDescriptions 重跑上游同步。历史 .md 是快照不回写。
 */
const DESC_TTL_MS = 7 * 86400_000;
type DescCache = { zh: string; ts: number };
const descKey = (repo: string) => `lookup:desc:${repo.toLowerCase()}`;

async function getFreshDesc(env: Env, repo: string): Promise<string | null> {
  const raw = await env.CACHE.get(descKey(repo));
  if (!raw) return null;
  try {
    const c = JSON.parse(raw) as DescCache;
    return Date.now() - c.ts < DESC_TTL_MS ? c.zh : null; // 过期视为 miss(cron 会刷新)
  } catch {
    return null;
  }
}

/**
 * cron 每日对已查询过的 repo 重跑 deepwiki 描述链, 只处理缓存超过 7 天的条目。
 * ponytail: 只刷 KV 缓存, 不回写历史 .md——历史是快照, 追改破坏存档语义。
 */
export async function refreshLookupDescriptions(env: Env): Promise<void> {
  const refreshed: string[] = [];
  try {
    const page = await env.CACHE.list({ prefix: 'lookup:desc:' });
    for (const k of page.keys) {
      let old: DescCache;
      try {
        old = JSON.parse((await env.CACHE.get(k.name)) ?? '') as DescCache;
      } catch {
        continue;
      }
      if (!old?.ts || Date.now() - old.ts < DESC_TTL_MS) continue;
      const repo = k.name.slice('lookup:desc:'.length);
      try {
        const dw = await fetchDeepwikiOverview(repo).catch(() => null);
        let zh = '';
        if (dw) {
          const done = await translateBatch(env, [{ title: repo, url: '', desc: dw } as SourceItem]);
          zh = done[0]?.descZh ?? '';
        }
        if (!isChinese(zh)) continue; // 上游未命中/翻译失败 → 保持旧值等下次
        await env.CACHE.put(k.name, JSON.stringify({ zh, ts: Date.now() } satisfies DescCache));
        refreshed.push(repo);
      } catch {
        /* 单仓失败跳过 */
      }
    }
  } catch (e) {
    console.error('refreshLookupDescriptions failed', String(e).slice(0, 80));
  }
  if (refreshed.length) console.log(`lookup desc refreshed: ${refreshed.join(', ')}`);
}

/**
 * 每日低速增量: 补 search:index 里 star 仓的描述缺失/英文未译条目。
 * 逐条 deepwiki → 译中 → 写 lookup:desc:<repo>(兼做已处理标记, /search 渲染与后续 lookup 复用)。
 * 低速 = 每天限 limit 条 + 条间短延时, 避免打爆 Workers AI 额度与子请求上限。
 * ponytail: 只写 lookup:desc 缓存, 不回写 search:index(25MB 全量重写过贵); /search 渲染查它覆盖。
 */
export async function backfillDescriptions(env: Env, limit = 40): Promise<void> {
  const raw = await env.CACHE.get('search:index').catch(() => null);
  if (!raw) return;
  let entries: [string, string, string, string, string?][] = [];
  try { entries = JSON.parse(raw) as [string, string, string, string, string?][]; } catch { return; }
  let done = 0;
  for (const [src, name, url, , desc] of entries) {
    if (done >= limit) break;
    if (src !== 'star') continue; // 书签无 repo 可 deepwiki; 只补星标仓
    if (desc && isChinese(desc)) continue;
    const repoKey = `lookup:desc:${name.toLowerCase()}`;
    const cached = await env.CACHE.get(repoKey).catch(() => null);
    if (cached) continue; // 已有(含已译) → 跳过, 避免日复遍历全量
    try {
      const dw = await fetchDeepwikiOverview(name).catch(() => null);
      let zh = '';
      if (dw) {
        const t = await translateBatch(env, [{ title: name, url, desc: dw } as SourceItem]);
        zh = t[0]?.descZh ?? '';
      }
      if (!isChinese(zh)) { await env.CACHE.put(repoKey, JSON.stringify({ zh: '', ts: Date.now() } satisfies DescCache)).catch(() => {}); continue; }
      await env.CACHE.put(repoKey, JSON.stringify({ zh, ts: Date.now() } satisfies DescCache));
      done++;
      console.log(`backfill desc: ${name}`);
      // 低速: 每条间隔, 省额度
      if (done < limit) await new Promise((r) => setTimeout(r, 1500));
    } catch {
      /* 单仓失败记空缓存防重试, 下次跳过 */
    }
  }
  if (done) console.log(`backfill desc done: ${done}/${limit}`);
}

/**
 * 任意 URL 存档: 三级降级链转 markdown(见 urlmd.ts) → 回复确认 → archive 分支存档。
 * 与 repo lookup 同一套存档/索引设施; 失败给用户明确回复, 不静默。
 */
export async function archiveUrl(env: Env, chatId: string, url: string, ctx?: ExecutionContext): Promise<void> {
  // og:image 预取(与转换共用一次下载的代价可忽略; 失败静默——图是增强不是必需)
  let photo: string | undefined;
  try {
    const h = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) });
    if (h.ok) {
      const head = (await h.text()).slice(0, 100_000); // meta 在头部
      photo = extractOgImage(head) ?? undefined;
      // OG 缺失兜底: apple-touch-icon / favicon(HEAD 探活省流量)
      if (!photo) {
        const origin = new URL(url).origin;
        for (const fav of [`${origin}/apple-touch-icon.png`, `${origin}/favicon.ico`]) {
          const fr = await fetch(fav, { method: 'HEAD', signal: AbortSignal.timeout(5000) }).catch(() => null);
          const ct = fr?.headers.get('content-type') ?? '';
          // ICO 格式 Telegram sendPhoto 不收(JPG/PNG/WebP), 跳过留给 s2 保底(必返 PNG)
          if (fr && fr.ok && ct.startsWith('image/') && !ct.includes('icon')) {
            photo = fav;
            break;
          }
        }
      }
    }
    // 最终保底: Google s2 favicon(有 favicon 的站点必出 PNG 图; 真无图站点 404 → sendPhoto 失败自动落回纯文字)
    if (!photo && h?.ok !== false) {
      photo = `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64`;
    }
  } catch {
    // 页面拉取失败也走 s2 保底
    try {
      photo = `https://www.google.com/s2/favicons?domain=${new URL(url).hostname}&sz=64`;
    } catch { /* URL 都解析不了则纯文字 */ }
  }

  let md: string;
  try {
    md = await urlToMarkdown(env, url, { accountId: env.CF_ACCOUNT_ID, apiToken: env.CF_API_TOKEN });
  } catch {
    await sendTelegram(env.BOT_TOKEN, chatId, '❌ 无法转换该 URL(markdown 三级链全失败), 请稍后再试或换链接。');
    return;
  }
  if (!md) {
    await sendTelegram(env.BOT_TOKEN, chatId, '❌ 无法提取该 URL 内容(四级链全失败), 请稍后再试或换链接。');
    return;
  }
  // 截断保护: 超长页面只存前 ~80KB(GitHub 文件无硬限, 但 API PUT 体面优先)
  const clipped = md.length > 80_000 ? md.slice(0, 80_000) + '\n\n…(truncated)' : md;
  const stamp = `${today()}-${Date.now() % 86400000}`;
  // 中文摘要(非中文内容翻译; 失败回退原文截断)——回复与 /search 索引共用
  let summaryZh = await summarizeZh(env, clipped).catch(() => null);
  let translatedOk = false;
  if (!summaryZh) {
    const plain = clipped.replace(/[#>*`\[\]]/g, '').slice(0, 120);
    if (!isChinese(plain)) {
      const t = await translateBatch(env, [{ title: url, url, desc: plain } as SourceItem]);
      summaryZh = t[0]?.descZh ?? null;
      translatedOk = isChinese(summaryZh ?? '');
    } else { summaryZh = plain; translatedOk = true; }
  } else translatedOk = isChinese(summaryZh);
  try {
    await archiveToGitHub(env, stamp, `# Web Archive · ${url}\n\n${clipped}\n\n---\n由 daily-digest bot 自动生成`);
    const host = new URL(url).hostname;
    // 标题: md 首行非空非标点优先(页面标题), 否则原 URL 域名; 英文 → 中文
    let title = md.split('\n').map((l) => l.trim()).find((l) => l && !/^[#*>\-|`]/.test(l) && !/^https?:\/\//i.test(l)) ?? host;
    title = title.replace(/[#*>`[\]()!-]/g, '').trim().slice(0, 80);
    let titleZh = title;
    if (!isChinese(titleZh) && env.OPENROUTER_API_KEY) {
      titleZh = (await generateTitleZh(env, title).catch(() => null)) ?? (await translateTextZh(env, title).catch(() => null)) ?? title;
    }
    // Telegraph 存档(单页; 失败静默——增强非必需)
    let tgPageUrl = '';
    const tgToken = env.TELEGRAPH_TOKEN ?? (await createTelegraphAccount().catch(() => null));
    if (tgToken) {
      // markdown 转 telegraph nodes: 简易按行分段。Telegraph 仅支持 h3/h4(#/##→h3, ###→h4); li 须嵌 ul
      const nodes = clipped.split('\n').map((line) => {
        const l = line.trim();
        if (!l) return { tag: 'br' as const, children: [] };
        if (/^#{1,2} /.test(l)) return { tag: 'h3' as const, children: [l.replace(/^#{1,2} /, '')] };
        if (l.startsWith('### ')) return { tag: 'h4' as const, children: [l.slice(4)] };
        if (l.startsWith('> ')) return { tag: 'blockquote' as const, children: [{ tag: 'p', children: [l.slice(2)] }] };
        if (l.startsWith('```')) return { tag: 'pre' as const, children: [{ tag: 'code', children: [l] }] };
        if (l.startsWith('- ') || l.startsWith('* ')) return { tag: 'ul' as const, children: [{ tag: 'li', children: [l.slice(2)] }] };
        return { tag: 'p', children: [l] };
      });
      const pageUrl = await createTelegraphPage(tgToken, titleZh || host, nodes);
      if (pageUrl) {
        tgPageUrl = pageUrl;
        try { await env.CACHE.put(`archive:tg:${stamp}`, pageUrl); } catch { /* KV 额度忽略 */ }
      }
    }
    // 重发质量记录: translated=中文摘要成功; descOk 网页无 deepwiki/zread 概念, 归档+摘要齐即 true
    ctx?.waitUntil?.(markProcessed(env, url, translatedOk, true, stamp, titleZh, summaryZh ?? undefined));
    // 内容含 GitHub repo 链接 → 逐个走 repo lookup(去重防递归; 上限 3 个省子请求)
    await fanoutRepoRefs(env, chatId, clipped, ctx);
    const repo = env.GH_ARCHIVE_REPO || 'gandli/daily-digest';
    await indexArchivedItems(env, [{ title: host, url, desc: summaryZh, descZh: undefined } as SourceItem], stamp);
    // 统一印刷: 标题直链(中文优先) / 中文摘要 / 标签 / 存档三链——对齐 repo 卡的 renderMessage 三段结构
    // 标签: 无现成 topics 时用 LLM 生成领域标签
    let tagsZh: string[] | null = null;
    if (env.OPENROUTER_API_KEY) tagsZh = await generateTagsZh(env, (summaryZh ?? title).slice(0, 400)).catch(() => null);
    const tagLine = `#archive${tagsZh?.length ? ` ${tagsZh.map((t) => `#${t}`).join(' ')}` : ''}`;
    const confirm = [
      `<b><a href="${esc(url)}">${esc(titleZh)}</a></b>`,
      summaryZh ? `\n\n📝 ${esc(summaryZh).slice(0, 300)}` : '',
      `\n\n${tagLine}`,
      `\n\n📁 ${archiveLinks(url, tgPageUrl || undefined, `https://github.com/${repo}/blob/archive/archive/${stamp.slice(0, 4)}/${stamp}.md`)}`,
    ].join('');
    // 有 og:image → sendPhoto(图=OG 卡, caption=确认+链接); 无图/发送失败 → 纯文字
    if (photo) {
      const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendPhoto`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, photo, caption: confirm.slice(0, 1020), parse_mode: 'HTML' }),
      });
      if (res.ok) return;
      console.error(`archiveUrl sendPhoto ${res.status}, fallback text`);
    }
    await sendTelegram(env.BOT_TOKEN, chatId, confirm);
  } catch (e) {
    console.error('archiveUrl failed', String(e).slice(0, 120));
    await sendTelegram(env.BOT_TOKEN, chatId, '⚠️ 转换成功但存档失败(GitHub 写入异常), 请稍后再试。');
  }
}