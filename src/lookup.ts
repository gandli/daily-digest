import type { Env, SourceItem } from './types';
import { resolveDescriptions, translateBatch, isChinese, summarizeZh } from './translate';
import { fetchDeepwikiOverview } from './deepwiki';
import { renderMessage, renderMarkdown } from './render';
import { sendPerRepoMessages, sendTelegram } from './notify';
import { archiveToGitHub, archiveOgImage } from './archive';
import { urlToMarkdown, extractOgImage } from './urlmd';

// 北京时间日期串(与 index.ts 一致; 独立内联避免循环依赖)
const today = (): string => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

/** 同一 repo 当日已查过 → 跳过重复回复与存档。TTL 48h(跨过午夜即视为新一天)。 */
export async function seenToday(env: Env, repo: string): Promise<boolean> {
  const key = `lookup:${today()}:${repo.toLowerCase()}`;
  const hit = await env.CACHE.get(key);
  if (hit) return true;
  await env.CACHE.put(key, '1', { expirationTtl: 172800 });
  return false;
}

/**
 * URL 重发语义: 记录上次处理质量, 决定重发时是否重跑全管线(翻译/描述/归档)。
 * 返回 'first'(首次, 正常处理) | 'retry'(上次翻译/描述有缺失, 重跑) | 'done'(上次成功, 跳过)。
 * ponytail: 单 KV 键存布尔对而非状态机; 处理方结束后必须 markProcessed 回填真实结果。
 */
export async function shouldReprocess(env: Env, url: string): Promise<'first' | 'retry' | 'done'> {
  const key = `reproc:${url}`;
  let prev: { translated?: boolean; descOk?: boolean } | null = null;
  try {
    const raw = await env.CACHE.get(key);
    if (raw) prev = JSON.parse(raw) as { translated?: boolean; descOk?: boolean };
  } catch {
    prev = null; // 损坏值视同首次
  }
  // 首次: 先占位(默认失败态, 处理方负责覆写为真实结果)——防并发双跑
  if (!prev || (prev.translated === undefined && prev.descOk === undefined)) {
    await env.CACHE.put(key, JSON.stringify({ ts: Date.now(), translated: false, descOk: false }), { expirationTtl: 7 * 86400 });
    return 'first';
  }
  return prev.translated && prev.descOk ? 'done' : 'retry';
}

/** shouldReprocess 的配对写: 处理结束后回填真实质量。 */
export async function markProcessed(env: Env, url: string, translated: boolean, descOk: boolean): Promise<void> {
  await env.CACHE.put(`reproc:${url}`, JSON.stringify({ ts: Date.now(), translated, descOk }), { expirationTtl: 7 * 86400 });
}

/** 提取文本中的 GitHub repo 引用(去重、滤文件路径、上限 3 个省子请求)。 */
export function extractRepoRefs(text: string): string[] {
  return [...new Set([...text.matchAll(/https?:\/\/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/g)].map((m) => m[1]))]
    .filter((r) => !/\.md$|\.js$|\.ts$|\.rs$|\.py$/i.test(r))
    .slice(0, 3);
}

/** 内容含 GitHub repo 链接 → 逐个走 repo lookup(去重防递归)。ctx 缺省(如 cron)不触发。 */
export async function fanoutRepoRefs(env: Env, chatId: string, text: string, ctx?: ExecutionContext): Promise<void> {
  if (!ctx) return;
  for (const r of extractRepoRefs(text)) {
    if (await seenToday(env, r)) continue;
    ctx.waitUntil(lookupRepo(env, chatId, r));
  }
}

/** 存档成功后写 /search 索引(archive:idx:<repo> → {repo, date, descZh})。 */
export async function indexArchivedItems(env: Env, items: SourceItem[], dateStr: string): Promise<void> {
  for (const it of items) {
    try {
      await env.CACHE.put(
        `archive:idx:${it.title.toLowerCase()}`,
        JSON.stringify({ repo: it.title, date: dateStr, desc: it.desc || undefined, descZh: isChinese(it.descZh) ? it.descZh : undefined }),
      );
    } catch {
      /* 索引失败不影响主流程 */
    }
  }
}

/** 从文本提取 GitHub 仓库链接或裸 owner/repo。优先 github.com 域; 兜底裸 owner/repo(排除文件名形态)。 */
export function extractRepo(text: string): string | null {
  const strip = (s: string) => s.replace(/[。.,,;；]$/, '');
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
  // 一条消息: OG 图做照片, 条目做 caption(优先自家 og-images 存档域, 规避官方域对 TG 出口的 IP 配额)
  const chunks = renderMessage(today(), [item]);
  await sendPerRepoMessages(env.BOT_TOKEN, chatId, chunks.map((html) => ({ html, repo: item.title })), env.GH_ARCHIVE_REPO || 'gandli/daily-digest');
  // 存档: OG 图入库 og-images/, markdown 引用相对路径(失败回退远程 URL)
  try {
    const ogPath = await archiveOgImage(env, item.title);
    const md = renderMarkdown(today(), [item], undefined, ogPath ? new Map([[item.title, ogPath]]) : undefined);
    const stamp = `${today()}-${Date.now() % 86400000}`; // 单次计算: 索引 date 必须等于实际文件名
    await archiveToGitHub(env, stamp, md);
    await indexArchivedItems(env, [item], stamp); // /search 索引
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
    // 重发质量记录: translated=中文摘要成功; descOk 网页无 deepwiki/zread 概念, 归档+摘要齐即 true
    ctx?.waitUntil?.(markProcessed(env, url, translatedOk, true));
    // 内容含 GitHub repo 链接 → 逐个走 repo lookup(去重防递归; 上限 3 个省子请求)
    await fanoutRepoRefs(env, chatId, clipped, ctx);
    const repo = env.GH_ARCHIVE_REPO || 'gandli/daily-digest';
    await indexArchivedItems(env, [{ title: new URL(url).hostname, url, desc: summaryZh, descZh: undefined } as SourceItem], stamp);
    // 统一格式化回复: 标题行 / 中文摘要 / 存档链接(HTML 转义)
    const host = new URL(url).hostname;
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const confirm = [
      `📄 <b>网页存档</b> · ${esc(host)}`,
      summaryZh ? `\n💬 ${esc(summaryZh).slice(0, 300)}` : '',
      `\n📁 <a href="https://github.com/${repo}/blob/archive/archive/${stamp.slice(0, 4)}/${stamp}.md">查看存档</a>`,
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