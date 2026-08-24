import type { SourceItem } from './types';

const unesc = (s: string) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmtK = (n?: number) => (n === undefined ? '' : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

// Telegram HTML 消息。一个项目一条消息(首条带头部+存档链接), 标题/描述/wiki 分层有区分度, 带 topics 标签。
export function renderMessage(dateStr: string, items: SourceItem[], telegraphUrl?: string): string[] {
  const header = `📊 <b>Daily Digest</b> · ${dateStr}\n#digest #d${dateStr.replace(/-/g, '')}`;
  const footer = telegraphUrl ? `\n\n📁 <a href="${esc(telegraphUrl)}">Telegraph 存档</a>` : '';
  return items.map((it, i) => {
    const langTag = it.lang ? ` · #${it.lang}` : '';
    const today = it.starsToday ? ` (+${fmtK(it.starsToday)} 今日)` : '';
    const stars = it.stars !== undefined ? ` ⭐ ${fmtK(it.stars)}${today}` : '';
    const head = i === 0 ? `${header}\n\n` : `<b>${i + 1}/${items.length}</b> `;
    const topicTags = (it.topics ?? []).map((t) => `#${t}`).join(' ');
    const tags = [`#trending`, topicTags].filter(Boolean).join(' ');
    const body =
      `<b><a href="${esc(it.url)}">${esc(it.title)}</a></b>${stars}${langTag}\n` + // 标题层
      `${esc(unesc(it.descZh || it.desc))}\n` + // 描述层
      `\n` + // wiki 已并入 descZh, 不再单独一层
      `<a href="https://deepwiki.com/${esc(it.title)}">deepwiki</a> · <a href="https://zread.ai/${esc(it.title)}">zread</a>\n` +
      (tags ? `${tags}` : '');
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
