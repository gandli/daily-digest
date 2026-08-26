import type { SourceItem } from '../types';

// Hacker News 新产品/开源项目源。仿 trending: 抓 HN topstories → 过滤"新产品/开源项目" → 取前 N。
// 过滤规则: 标题含 "Show HN"(新产品) 或 链接指向 github.com(开源项目), 其余跳过。
// ponytail: HN API 无鉴权免费, topstories 一次取 100 id, 逐条 get item(子请求多, 只取前 ~30 判定省量)。
export async function fetchHackerNewsProducts(limit = 10): Promise<SourceItem[]> {
  // 1. top stories ids
  const idsRes = await fetch('https://hacker-news.firebaseio.com/v0/topstories.json', {
    headers: { 'User-Agent': 'daily-digest' },
  });
  if (!idsRes.ok) throw new Error(`hn topstories ${idsRes.status}`);
  const ids = (await idsRes.json()) as number[];
  if (!Array.isArray(ids) || !ids.length) return [];

  // 2. 逐条拉详情, 过滤新产品/开源项目 (只扫前 30 个 top 够定位当天新品)
  const out: SourceItem[] = [];
  for (const id of ids.slice(0, 30)) {
    if (out.length >= limit) break;
    try {
      const r = await fetch(`https://hacker-news.firebaseio.com/v0/item/${id}.json`, {
        headers: { 'User-Agent': 'daily-digest' },
      });
      if (!r.ok) continue;
      const it = (await r.json()) as {
        title?: string; url?: string; text?: string; type?: string; score?: number; by?: string;
      };
      if (!it?.title || it.type !== 'story') continue;
      const title = it.title;
      const url = it.url ?? `https://news.ycombinator.com/item?id=${id}`;
      // 过滤: Show HN 新品 或 GitHub 开源项目
      const isShow = /show\s+hn|showhn/i.test(title);
      const isGithub = /^https:\/\/(github|www\.github)\.com\//i.test(url);
      if (!isShow && !isGithub) continue;
      // 去 GitHub 链接的 `https://` 前缀做裸 repo名 → 描述链可用
      const cleanUrl = isGithub ? url.replace(/^https?:\/\/(www\.)?github\.com\//i, 'https://github.com/') : url;
      const text = (it.text ?? '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 300);
      out.push({
        title, // HN 标题(new product / open-source repo)
        url: cleanUrl,
        desc: text || `HN score ${it.score ?? 0} by ${it.by ?? ''}`.trim(),
        stars: it.score, // 复用 stars 槽存 HN score
      });
    } catch {
      continue; // 单条失败跳过
    }
  }
  return out;
}