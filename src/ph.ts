// Product Hunt 每日热门: GraphQL API v2(Developer Token, 对齐 Decohack 的票数/介绍/官网)优先,
// 官方 Atom feed 免 key(约 50 条/日)作零配置兜底, Worker 内直拉——无需 HN 那套 Actions 重管线。
// /ph: 当日缓存(ph:<date>)秒回; miss → GraphQL(有 token)/Atom 拉取 top10 → translateBatch 译中
// → renderProductMessage 产品卡 → Telegraph 页 + 榜单存档(ph-<date>.md, 同日覆盖) → 发送。拉取失败回 ⚠️ 提示。
import type { Env, SourceItem } from './types';
import { today } from './lookup';
import { isChinese, translateBatch } from './translate';
import { renderProductMessage, renderTelegraphNodes } from './render';
import { sendPerRepoMessages, sendTelegram } from './notify';
import { archiveToGitHub, createTelegraphPage } from './archive';

const FEED = 'https://www.producthunt.com/feed';
const GRAPHQL = 'https://api.producthunt.com/v2/api/graphql';

// 双链接条目: phUrl 携带 PH 讨论页(仅 GraphQL 路径, 存档 md 出 官网+PH 双链), 不动 SourceItem schema
type PhItem = SourceItem & { phUrl?: string };

const decode = (s: string): string =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

// ponytail: PH_API_TOKEN 暂以交叉类型读取(手写 Env 未列, wrangler types 重生成后并入 types.ts)
/** PH GraphQL API v2(免费 Developer Token)拉取每日热门: 票数/长介绍/官网齐备, 对齐 Decohack。
 *  env.PH_API_TOKEN 缺省返回 [](上层回落 Atom feed); 失败/字段缺失静默兜底, 绝不抛。 */
export async function fetchProductHuntGraphql(env: Env, limit = 15): Promise<SourceItem[]> {
  const token = (env as Env & { PH_API_TOKEN?: string }).PH_API_TOKEN;
  if (!token) return [];
  try {
    // 免费额度按查询计: 单查询一次取全字段, 不做分页
    const res = await fetch(GRAPHQL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        query: `query { posts(first: ${limit}) { edges { node { name tagline description votesCount websiteUrl url } } } }`,
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const j = (await (res as Response).json()) as {
      data?: { posts?: { edges?: { node?: Record<string, unknown> }[] } };
    };
    const edges = j?.data?.posts?.edges;
    if (!Array.isArray(edges)) return [];
    const items: PhItem[] = [];
    for (const edge of edges) {
      const n = edge?.node;
      const phUrl = typeof n?.url === 'string' ? n.url : '';
      const website = typeof n?.websiteUrl === 'string' ? n.websiteUrl : '';
      if (typeof n?.name !== 'string' || !n.name || (!website && !phUrl)) continue;
      items.push({
        title: n.name,
        url: website || phUrl, // 官网直链优先(Decohack 结构); 缺失回 PH 页
        desc: typeof n.tagline === 'string' ? n.tagline : '',
        quote: typeof n.description === 'string' && n.description ? n.description : undefined,
        stars: typeof n.votesCount === 'number' ? n.votesCount : undefined,
        phUrl: phUrl || undefined,
      });
      if (items.length >= limit) break;
    }
    return items;
  } catch {
    return []; // 网络/解析失败 → 回落 Atom
  }
}

/** 拉取 PH 官方 Atom feed → 每日热门 topN(标题/产品链接/tagline/作者, 按热度序)。
 *  Atom 结构稳定, 正则解析免 XML 依赖; 失败返回 []。 */
export async function fetchProductHunt(limit = 10): Promise<SourceItem[]> {
  const res = await fetch(FEED, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(10000) }).catch(() => null);
  if (!res?.ok) return [];
  const xml = await (res as Response).text();
  const items: SourceItem[] = [];
  for (const entry of xml.split('<entry>').slice(1)) {
    const get = (tag: string): string => entry.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`))?.[1]?.trim() ?? '';
    const title = decode(get('title'));
    const link = entry.match(/<link rel="alternate"[^>]*href="([^"]+)"/)?.[1] ?? '';
    const author = entry.match(/<name>([^<]+)<\/name>/)?.[1];
    // content: HTML tagline + 'Discussion | Link' 导航尾巴 → 整体剥 <a> 锚点再剥标签取第一段
    const tagline = decode(get('content')).replace(/<a[\s\S]*?<\/a>/gi, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').split('|')[0].trim();
    if (!title || !link) continue;
    items.push({ title, url: link, desc: tagline, author: author || undefined } as SourceItem);
    if (items.length >= limit) break;
  }
  return items;
}

/** /ph: Product Hunt 每日热门。返回发卡数(-1 拉取失败)。 */
export async function runProductHunt(env: Env, chatId: string): Promise<number> {
  const dateStr = today();
  const cached = await env.CACHE.get(`ph:${dateStr}`).catch(() => null);
  if (cached) {
    try {
      const { chunks } = JSON.parse(cached) as { chunks: string[] };
      await sendPerRepoMessages(env.BOT_TOKEN, chatId, chunks.map((html) => ({ html })), env.GH_ARCHIVE_REPO || 'gandli/daily-digest', env.CACHE);
      return chunks.length;
    } catch { /* 坏缓存 → 重拉 */ }
  }
  // GraphQL(配 PH_API_TOKEN)优先: 票数/长介绍/官网齐备, 对齐 Decohack; 空则回落 Atom feed(零配置兜底, 行为不变)
  const gqlItems = await fetchProductHuntGraphql(env, 10);
  const items = gqlItems.length ? gqlItems : await fetchProductHunt(10);
  if (!items.length) {
    await sendTelegram(env.BOT_TOKEN, chatId, '⚠️ Product Hunt 拉取失败, 请稍后再试。');
    return -1;
  }
  // tagline 译中(descZh); 翻译失败保留原文
  const done = await translateBatch(env, items).catch(() => null);
  items.forEach((it, i) => { it.descZh = done?.[i]?.descZh || it.descZh; });
  // GraphQL 双字段翻译: description 也译中截 160 进 quote(💬 长介绍行); 非中文不出行, 保持 100% 中文输出
  if (gqlItems.length) {
    const qDone = await translateBatch(env, items.map((it) => ({ ...it, desc: it.quote ?? '' }) as SourceItem)).catch(() => null);
    items.forEach((it, i) => {
      const zh = qDone?.[i]?.descZh;
      it.quote = zh && isChinese(zh) ? zh.slice(0, 160) : undefined;
    });
  }
  // Telegraph 页(增强, 失败静默)
  const tgPageUrl = env.TELEGRAPH_TOKEN
    ? await createTelegraphPage(env.TELEGRAPH_TOKEN, `Product Hunt · ${dateStr}`, renderTelegraphNodes(items)).catch(() => null)
    : null;
  const chunks = renderProductMessage(dateStr, items, tgPageUrl || undefined, env.GH_ARCHIVE_REPO || 'gandli/daily-digest', 'producthunt');
  await sendPerRepoMessages(env.BOT_TOKEN, chatId, chunks.map((html, i) => ({ html, ogUrl: items[i].url })), env.GH_ARCHIVE_REPO || 'gandli/daily-digest', env.CACHE);
  // 榜单存档: 一天一份(ph-<date>.md 同日覆盖, 语义同 digest); GraphQL 条目出 官网+PH 双链接(对齐 Decohack)
  const mdRows = items
    .map((it, i) => {
      const ph = (it as PhItem).phUrl;
      const links = ph && ph !== it.url ? `\n   - 官网: ${it.url}\n   - PH: ${ph}` : '';
      return `${i + 1}. **[${it.titleZh ?? it.title}](${it.url})**\n   - ${(it.descZh ?? it.desc ?? '').replace(/\s+/g, ' ').slice(0, 200)}${links}`;
    })
    .join('\n');
  const md = `# Product Hunt · ${dateStr}\n\n${tgPageUrl ? `Telegraph: ${tgPageUrl}\n\n` : ''}${mdRows}\n\n---\n由 daily-digest bot 自动生成\n`;
  await archiveToGitHub(env, `ph-${dateStr}`, md, dateStr.slice(0, 4)).catch(() => {});
  await env.CACHE.put(`ph:${dateStr}`, JSON.stringify({ chunks }), { expirationTtl: 86400 }).catch(() => {});
  console.log('producthunt sent', dateStr, `${chunks.length} items`);
  return chunks.length;
}
