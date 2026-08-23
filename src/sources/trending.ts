import type { SourceItem } from '../types';

// 刮 github.com/trending overall/daily,HTMLRewriter 解析 top10。
// ponytail: 选择器绑定当前页面结构(article.Box-row + h2 a + stargazers/forks 链接),改版即修这里。
export async function fetchTrending(): Promise<SourceItem[]> {
  const res = await fetch('https://github.com/trending', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126 Safari/537.36',
      Accept: 'text/html',
    },
  });
  if (!res.ok) throw new Error(`trending fetch ${res.status}`);

  const items: SourceItem[] = [];
  type Row = { title?: string; url?: string; lang?: string; stars?: number; starsToday?: number; desc?: string };
  let cur: Row | null = null;

  const reToday = /([\d,]+)\s+stars\s+today/i;

  const pipeline = new HTMLRewriter()
    .on('article.Box-row', {
      element() {
        if (cur?.title && cur.desc) items.push(cur as SourceItem);
        cur = {};
      },
    })
    // h2 标题内唯一链接即仓库路径(/owner/repo)
    .on('article.Box-row h2 a', {
      element(el) {
        if (!cur) return;
        const href = el.getAttribute('href') ?? '';
        if (/^\/[^/]+\/[^/]+$/.test(href)) {
          cur.title = href.replace(/^\//, '');
          cur.url = `https://github.com/${cur.title}`;
        }
      },
    })
    .on('article.Box-row [itemprop="programmingLanguage"]', {
      text(t) {
        if (cur && t.text.trim() && !cur.lang) cur.lang = t.text.trim();
      },
    })
    // stars 与 forks 是独立的 /stargazers 与 /forks 链接,分别取数
    .on('article.Box-row a[href$="/stargazers"]', {
      text(t) {
        if (!cur || cur.stars !== undefined) return;
        const n = parseInt((t.text ?? '').replace(/[,\s]/g, ''), 10);
        if (!Number.isNaN(n)) cur.stars = n;
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
  // 必须消费转换后的流, handler 才会执行(workerd 语义)
  const voided = pipeline.transform(res);
  await voided.arrayBuffer();

  const last = cur as Row | null;
  if (last?.title && last.desc) items.push(last as SourceItem); // 最后一个 article 无闭合事件
  for (const it of items) if (it.desc) it.desc = it.desc.replace(/\s+/g, ' ').trim();
  return items.slice(0, 10);
}
