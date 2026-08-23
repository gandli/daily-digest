import type { SourceItem } from '../types';

// 刮 github.com/trending overall/daily,HTMLRewriter 解析 top10。
// ponytail: 选择器绑定当前页面结构(article.Box-row),改版即修这里。
export async function fetchTrending(): Promise<SourceItem[]> {
  const res = await fetch('https://github.com/trending', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
      Accept: 'text/html',
    },
  });
  if (!res.ok) throw new Error(`trending fetch ${res.status}`);

  const items: SourceItem[] = [];
  type Row = { title?: string; url?: string; lang?: string; stars?: number; starsToday?: number; desc?: string };
  let cur: Row | null = null;
  let starsSeen = false;

  const reToday = /([\d,]+)\s+stars\s+today/i;

  await new HTMLRewriter()
    .on('article.Box-row', {
      element() {
        if (cur?.title && cur.desc) items.push(cur as SourceItem);
        cur = {};
        starsSeen = false;
      },
    })
    .on('article.Box-row h2 a', {
      element(el) {
        const href = el.getAttribute('href') ?? '';
        if (!cur || !/^\/[^/]+\/[^/]+/.test(href)) return;
        cur.title = href.replace(/^\//, '');
        cur.url = `https://github.com/${cur.title}`;
      },
    })
    .on('article.Box-row [itemprop="programmingLanguage"]', {
      text(t) {
        if (cur && t.text.trim() && !cur.lang) cur.lang = t.text.trim();
      },
    })
    // stars 与 forks 共用此 class,按出现顺序只认第一个
    .on('article.Box-row a.Link--muted.d-inline-block.mr-3', {
      text(t) {
        if (!cur || starsSeen) return;
        const n = parseInt((t.text ?? '').replace(/,/g, ''), 10);
        if (!Number.isNaN(n) && n > 0) {
          cur.stars = n;
          starsSeen = true;
        }
      },
    })
    .on('article.Box-row span.d-inline-block.float-sm-right', {
      text(t) {
        const m = t.text.match(reToday);
        if (cur && m) cur.starsToday = parseInt(m[1].replace(/,/g, ''), 10);
      },
    })
    .on('article.Box-row p.col-9', {
      text(t) {
        if (!cur) return;
        cur.desc = (cur.desc ?? '') + t.text;
      },
    })
    .transform(res);

  const last = cur as Row | null;
  if (last?.title && last.desc) items.push(last as SourceItem); // 最后一个 article 无闭合事件
  for (const it of items) if (it.desc) it.desc = it.desc.replace(/\s+/g, ' ').trim();
  return items.slice(0, 10);
}
