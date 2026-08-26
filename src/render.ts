import type { SourceItem } from './types';
import { isChinese } from './translate';

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
    const descLine = isChinese(it.descZh) ? `${esc(unesc(it.descZh!))}\n\n` : ''; // ponytail: 非中文/空 → 整行跳过, 不泄露 repo 英文一句话
    const body =
      `<b><a href="${esc(it.url)}">${esc(it.title)}</a></b>${stars}${langTag}\n\n` + // 标题层
      descLine + // 描述层(仅来自 zread/deepwiki 的中文)
      `<a href="https://deepwiki.com/${esc(it.title)}">deepwiki</a> · <a href="https://zread.ai/${esc(it.title)}">zread</a>` +
      (tags ? `\n\n${tags}` : '');
    // ponytail: wikiDesc 极端超长时仍可能超4096——截断到安全长度
    let msg = head + body + (i === items.length - 1 ? footer : '');
    if (msg.length > 4000) msg = msg.slice(0, 3999) + '…';
    return msg;
  });
}

// HN 新产品/开源项目消息(仿 trending 但独立)。无 deepwiki/repo — 标题直链 + 中文描述 + #product 标签。
export function renderProductMessage(dateStr: string, items: SourceItem[], telegraphUrl?: string): string[] {
  const header = `🚀 <b>HN 新品/开源</b> · ${dateStr}\n#product #d${dateStr.replace(/-/g, '')}`;
  const footer = telegraphUrl ? `\n\n📁 <a href="${esc(telegraphUrl)}">Telegraph 存档</a>` : '';
  return items.map((it, i) => {
    const score = it.stars ? ` ⭐ ${fmtK(it.stars)}` : '';
    const head = i === 0 ? `${header}\n\n` : `<b>${i + 1}/${items.length}</b> `;
    const descLine = isChinese(it.descZh) ? `${esc(unesc(it.descZh!))}\n` : '';
    let msg =
      `${head}<b><a href="${esc(it.url)}">${esc(it.title)}</a></b>${score}\n\n` +
      descLine +
      `\n#product`;
    if (msg.length > 4000) msg = msg.slice(0, 3999) + '…';
    return i === items.length - 1 ? msg + footer : msg;
  });
}

// GitHub 存档 markdown。ogPath 传入时用 og-images/ 相对路径(本地渲染), 否则回退远程 URL。
export function renderMarkdown(dateStr: string, items: SourceItem[], telegraphUrl?: string, ogPaths?: Map<string, string>): string {
  const rows = items
    .map(
      (it, i) =>
        `${i + 1}. **[${it.title}](${it.url})** ⭐ ${fmtK(it.stars)}${
          it.starsToday ? ` (+${fmtK(it.starsToday)})` : ''
        }${it.lang ? ` · ${it.lang}` : ''}${
          isChinese(it.descZh) ? `\n   - ${unesc(it.descZh!)}` : '' // 仅来自 zread/deepwiki 的中文, 双缺跳过
        }\n   - [deepwiki](https://deepwiki.com/${it.title}) · [zread](https://zread.ai/${it.title})\n\n   <img src="${ogPaths?.get(it.title) ?? `https://opengraph.githubassets.com/1/${it.title}`}" width="400" alt="${it.title} OG 卡">`,
    )
    .join('\n');
  return (
    `# Daily Digest · ${dateStr}\n\n` +
    (telegraphUrl ? `Telegraph: ${telegraphUrl}\n\n` : '') +
    rows +
    `\n\n---\n由 daily-digest bot 自动生成\n`
  );
}

// Telegraph Node 内容(官方 API 的 Node 数组)。描述守卫与 renderMessage 同规则: 仅中文 descZh, 双缺只留标题行。
export function renderTelegraphNodes(items: SourceItem[]): unknown[] {
  return items.flatMap((it) => [
    {
      tag: 'p',
      children: [
        { tag: 'a', attrs: { href: it.url }, children: [it.title] },
        // ponytail: 英文原文不上公开页面(中文硬约束), 与 renderMessage/renderMarkdown 一致
        ...(isChinese(it.descZh) ? [` — ${unesc(it.descZh!)}`] : []),
      ],
    },
    // OG 卡图(GitHub 动态生成, URL 引用零子请求; Telegraph 直显)
    { tag: 'figure', children: [{ tag: 'img', attrs: { src: `https://opengraph.githubassets.com/1/${it.title}` } }] },
  ]);
}
