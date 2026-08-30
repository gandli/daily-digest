// RSS 2.0 feed 生成器
// ponytail: 纯字符串模板, 零依赖, 不处理 Atom/JSON Feed。加格式支持待需求明确。

export interface RssItem {
  title: string;
  url: string;
  desc: string;
  descZh?: string;
  author?: string;
  topics?: string[];
}

export function buildRssFeed(
  items: RssItem[],
  dateStr: string,
  siteUrl: string,
): string {
  const pubDate = new Date(dateStr + 'T00:00:00Z').toUTCString();
  const itemsXml = items
    .map(
      (it, i) => `    <item>
      <title><![CDATA[${i + 1}. ${it.title}]]></title>
      <link>${escapeXml(it.url)}</link>
      <guid isPermaLink="false">${escapeXml(dateStr)}-${i}</guid>
      <description><![CDATA[${escapeXml(it.descZh || it.desc || it.title)}]]></description>
      <pubDate>${pubDate}</pubDate>
    </item>`,
    )
    .join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>daily-digest: ${dateStr}</title>
    <link>${escapeXml(siteUrl)}</link>
    <atom:link href="${escapeXml(siteUrl)}/rss" rel="self" type="application/rss+xml"/>
    <description>GitHub Trending / HN / PH daily digest — ${dateStr}</description>
    <language>zh-CN</language>
    <lastBuildDate>${pubDate}</lastBuildDate>
    <ttl>1440</ttl>
${itemsXml}
  </channel>
</rss>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}