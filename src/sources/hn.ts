import type { SourceItem } from '../types';

// Hacker News 酷产品源(Show HN 文章)。仿 trending: 抓当日 Show HN → 取前 N。
// 用 Algolia HN search_by_date + tags=story,show_hn(Show HN 专属 tag)——一次请求直接返回当日新品,
// 比逐条扫 topstories(前60可能 0 条 Show HN) 高效且保证当日新品。免 key。
export async function fetchHackerNewsProducts(limit = 10): Promise<SourceItem[]> {
  const url = `https://hn.algolia.com/api/v1/search_by_date?tags=story,show_hn&hitsPerPage=${limit}`;
  const res = await fetch(url, { headers: { 'User-Agent': 'daily-digest' } });
  if (!res.ok) throw new Error(`hn algolia ${res.status}`);
  const j = (await res.json()) as { hits?: { title?: string; url?: string; story_text?: string | null; points?: number; objectID?: string; author?: string; created_at?: string }[] };
  const hits = j.hits ?? [];
  return hits.map((h) => ({
    title: h.title ?? '',
    url: h.url ?? `https://news.ycombinator.com/item?id=${h.objectID}`,
    desc: (h.story_text ?? '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 300) || '',
    stars: h.points,
    author: h.author,
    createdAt: h.created_at,
  }));
}