import type { SourceItem } from './types';

const unesc = (s: string) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmtK = (n?: number) => (n === undefined ? '' : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

// Telegram MarkdownV2 消息。一个项目一条消息(首条带头部+存档链接), 每条带 topics 标签行。
export function renderMessage(dateStr: string, items: SourceItem[], telegraphUrl?: string): string[] {
  const mdEscape = (s: string) => s.replace(/([_*[\]()~`>#+\-=|{}.!\\])/g, '\\$1');
  const header = `📊 *Daily Digest* · ${mdEscape(dateStr)}\n${mdEscape('#digest')} ${mdEscape('#d' + dateStr.replace(/-/g, ''))}\n`;
  const footer = telegraphUrl ? `\n\n📁 [Telegraph 存档](${telegraphUrl})` : '';
  return items.map((it, i) => {
    const langTag = it.lang ? ` · ${mdEscape('#' + it.lang)}` : '';
    const today = it.starsToday ? ` ${mdEscape(`(+${fmtK(it.starsToday)} 今日)`)}` : '';
    const stars = it.stars !== undefined ? ` ⭐ ${mdEscape(fmtK(it.stars))}${today}` : '';
    const head = i === 0 ? header + '\n' : `${mdEscape(`${i + 1}/${items.length}`)} `;
    const topicTags = (it.topics ?? []).map((t) => mdEscape('#' + t)).join(' ');
    const tags = [mdEscape('#trending'), topicTags].filter(Boolean).join(' ');
    const body =
      `*[${mdEscape(it.title)}](${it.url})*${stars}${langTag}\n` +
      `${mdEscape(unesc(it.descZh || it.desc))}\n` +
      (it.wikiDesc ? `${mdEscape(`📚 ${unesc(it.wikiDesc)}`)}\n` : '') +
      `[📖 deepwiki](https://deepwiki.com/${it.title}) · [🦾 zread](https://zread.ai/${it.title})${tags ? `\n\n${tags}` : ''}`;
    // ponytail: wikiDesc 极端超长时仍可能超4096——截断到安全长度
    let msg = head + body + (i === items.length - 1 ? footer : '');
    if (msg.length > 4000) msg = msg.slice(0, 3999) + '…';
    return msg;
  });
}

// GitHub 存档 markdown
export function renderMarkdown(dateStr: string, items: SourceItem[], telegraphUrl?: string): string {
  const rows = items
    .map(
      (it, i) =>
        `${i + 1}. **[${it.title}](${it.url})** ⭐ ${fmtK(it.stars)}${
          it.starsToday ? ` (+${fmtK(it.starsToday)})` : ''
        }${it.lang ? ` · ${it.lang}` : ''}\n   - ${unesc(it.descZh || it.desc)}${it.wikiDesc ? `\n   - 📚 ${esc(unesc(it.wikiDesc))}` : ''}\n   - [deepwiki](https://deepwiki.com/${it.title}) · [zread](https://zread.ai/${it.title})`,
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
