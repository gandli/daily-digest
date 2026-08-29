// Product Hunt 每日热门: 官方 Atom feed 免 key(约 50 条/日), Worker 内直拉——无需 HN 那套 Actions 重管线。
// /ph: 当日缓存(ph:<date>)秒回; miss → 拉取 top10 → translateBatch 译中 → renderProductMessage 产品卡
// → Telegraph 页 + 榜单存档(ph-<date>.md, 同日覆盖) → 发送。拉取失败回 ⚠️ 提示。
import type { Env, SourceItem } from './types';
import { today } from './lookup';
import { translateBatch } from './translate';
import { renderProductMessage, renderTelegraphNodes } from './render';
import { sendPerRepoMessages, sendTelegram } from './notify';
import { archiveToGitHub, createTelegraphPage } from './archive';

const FEED = 'https://www.producthunt.com/feed';

const decode = (s: string): string =>
  s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

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
  const items = await fetchProductHunt(10);
  if (!items.length) {
    await sendTelegram(env.BOT_TOKEN, chatId, '⚠️ Product Hunt 拉取失败, 请稍后再试。');
    return -1;
  }
  // tagline 译中(descZh); 翻译失败保留原文
  const done = await translateBatch(env, items).catch(() => null);
  items.forEach((it, i) => { it.descZh = done?.[i]?.descZh || it.descZh; });
  // Telegraph 页(增强, 失败静默)
  const tgPageUrl = env.TELEGRAPH_TOKEN
    ? await createTelegraphPage(env.TELEGRAPH_TOKEN, `Product Hunt · ${dateStr}`, renderTelegraphNodes(items)).catch(() => null)
    : null;
  const chunks = renderProductMessage(dateStr, items, tgPageUrl || undefined, env.GH_ARCHIVE_REPO || 'gandli/daily-digest', 'producthunt');
  await sendPerRepoMessages(env.BOT_TOKEN, chatId, chunks.map((html, i) => ({ html, ogUrl: items[i].url })), env.GH_ARCHIVE_REPO || 'gandli/daily-digest', env.CACHE);
  // 榜单存档: 一天一份(ph-<date>.md 同日覆盖, 语义同 digest)
  const mdRows = items.map((it, i) => `${i + 1}. **[${it.titleZh ?? it.title}](${it.url})**\n   - ${(it.descZh ?? it.desc ?? '').replace(/\s+/g, ' ').slice(0, 200)}`).join('\n');
  const md = `# Product Hunt · ${dateStr}\n\n${tgPageUrl ? `Telegraph: ${tgPageUrl}\n\n` : ''}${mdRows}\n\n---\n由 daily-digest bot 自动生成\n`;
  await archiveToGitHub(env, `ph-${dateStr}`, md, dateStr.slice(0, 4)).catch(() => {});
  await env.CACHE.put(`ph:${dateStr}`, JSON.stringify({ chunks }), { expirationTtl: 86400 }).catch(() => {});
  console.log('producthunt sent', dateStr, `${chunks.length} items`);
  return chunks.length;
}
