import type { SourceItem } from './types';

const unesc = (s: string) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmtK = (n?: number) => (n === undefined ? '' : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

// Telegram HTML 消息。返回分段(≤4096),v1 单源通常 1 段。
export function renderMessage(dateStr: string, items: SourceItem[], telegraphUrl?: string): string[] {
  const header = `📊 <b>Daily Digest</b> · ${dateStr}\n#digest #d${dateStr.replace(/-/g, '')}\n`;
  const body = items
    .map((it, i) => {
      const langTag = it.lang ? ` · #${it.lang}` : '';
      const today = it.starsToday ? ` (+${fmtK(it.starsToday)} 今日)` : '';
      const stars = it.stars !== undefined ? ` ⭐ ${fmtK(it.stars)}${today}` : '';
      return (
        `${i + 1}. <b><a href="${esc(it.url)}">${esc(it.title)}</a></b>${stars}${langTag}\n` +
        `${esc(unesc(it.descZh || it.desc))}\n` +
        `<a href="https://deepwiki.com/${esc(it.title)}">📖 deepwiki</a> · <a href="https://zread.ai/${esc(it.title)}">🦾 zread</a>`
      );
    })
    .join('\n\n');
  const footer = telegraphUrl ? `\n\n📁 <a href="${esc(telegraphUrl)}">Telegraph 存档</a>` : '';
  const full = header + '\n' + body + footer;
  if (full.length <= 4096) return [full];
  // ponytail: 按条目贪心切段,超长描述不截断——10条远够4096,真超了再优化
  const chunks: string[] = [];
  let cur = header;
  for (const line of body.split('\n\n')) {
    if (cur.length + line.length > 4000) {
      chunks.push(cur);
      cur = '';
    }
    cur += (cur ? '\n\n' : '') + line;
  }
  chunks.push(cur + footer);
  return chunks;
}

// GitHub 存档 markdown
export function renderMarkdown(dateStr: string, items: SourceItem[], telegraphUrl?: string): string {
  const rows = items
    .map(
      (it, i) =>
        `${i + 1}. **[${it.title}](${it.url})** ⭐ ${fmtK(it.stars)}${
          it.starsToday ? ` (+${fmtK(it.starsToday)})` : ''
        }${it.lang ? ` · ${it.lang}` : ''}\n   - ${unesc(it.descZh || it.desc)}\n   - [deepwiki](https://deepwiki.com/${it.title}) · [zread](https://zread.ai/${it.title})`,
    )
    .join('\n');
  return (
    `# Daily Digest · ${dateStr}\n\n` +
    (telegraphUrl ? `Telegraph: ${telegraphUrl}\n\n` : '') +
    rows +
    `\n\n---\n由 daily-digest bot 自动生成\n`
  );
}

// Telegraph Node 内容(官方 API 的 Node 数组)
export function renderTelegraphNodes(items: SourceItem[]): unknown[] {
  return items.map((it) => ({
    tag: 'p',
    children: [{ tag: 'a', attrs: { href: it.url }, children: [it.title] }, ` — ${it.descZh || it.desc}`],
  }));
}
