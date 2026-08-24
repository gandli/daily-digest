import type { Env, SourceItem } from './types';
import { resolveDescriptions, translateBatch, isChinese } from './translate';
import { fetchDeepwikiOverview } from './deepwiki';
import { renderMessage, renderMarkdown } from './render';
import { sendPerRepoMessages, sendTelegram } from './notify';
import { archiveToGitHub, archiveOgImage } from './archive';

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
  // 一条消息: OG 图做照片, 条目做 caption
  const chunks = renderMessage(today(), [item]);
  await sendPerRepoMessages(env.BOT_TOKEN, chatId, chunks.map((html) => ({ html, repo: item.title })));
  // 存档: OG 图入库 og-images/, markdown 引用相对路径(失败回退远程 URL)
  try {
    const ogPath = await archiveOgImage(env, item.title);
    const md = renderMarkdown(today(), [item], undefined, ogPath ? new Map([[item.title, ogPath]]) : undefined);
    await archiveToGitHub(env, `${today()}-${Date.now() % 86400000}`, md);
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