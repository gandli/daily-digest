import type { SourceItem } from './types';
import { isChinese } from './translate';

const unesc = (s: string) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmtK = (n?: number) => (n === undefined ? '' : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));

// ISO 时间 → "about X hours ago" / "about X days ago"
const relTime = (iso?: string): string => {
  if (!iso) return '';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `about ${mins} minutes ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `about ${hrs} hours ago`;
  const days = Math.floor(hrs / 24);
  return `about ${days} days ago`;
};

// Telegram HTML 消息。一个项目一条消息(首条带头部), 标题/描述/wiki 分层, 带 topics 标签 + 存档三链。
// archiveRepo: GitHub 存档仓库(用于拼 md 链接); 三链 = Telegraph(当日页,有则) → web.archive → GitHub md。
export function renderMessage(dateStr: string, items: SourceItem[], telegraphUrl?: string, archiveRepo = 'gandli/daily-digest'): string[] {
  const header = `📊 <b>Daily Digest</b> · ${dateStr}\n#digest #d${dateStr.replace(/-/g, '')}`;
  const mdPath = `https://github.com/${archiveRepo}/blob/archive/archive/${dateStr.slice(0, 4)}/${dateStr}.md`;
  const links = (it: SourceItem): string => {
    const l: string[] = [];
    if (telegraphUrl) l.push(`<a href="${esc(telegraphUrl)}">Telegraph</a>`);
    const wb = `https://web.archive.org/web/2/${encodeURIComponent(it.url).replace(/%3A/g, ':').replace(/%2F/g, '/')}`;
    l.push(`<a href="${wb}">Wayback</a>`);
    l.push(`<a href="${esc(mdPath)}">Archive</a>`);
    return `\n\n📁 ${l.join(' · ')}`;
  };
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
    let msg = head + body + links(it);
    if (msg.length > 4000) msg = msg.slice(0, 3999) + '…';
    return msg;
  });
}

// HN 酷产品消息(仿 trending 但独立)。标题直链 + 中文描述 + #product + 领域标签 + 存档三链。
export function renderProductMessage(dateStr: string, items: SourceItem[], telegraphUrl?: string, archiveRepo = 'gandli/daily-digest'): string[] {
  const header = `🚀 <b>HN 酷产品</b> · ${dateStr}\n#product #d${dateStr.replace(/-/g, '')}`;
  const mdPath = `https://github.com/${archiveRepo}/blob/archive/archive/${dateStr.slice(0, 4)}/${dateStr}.md`;
  return items.map((it, i) => {
    const score = it.stars ? ` ⭐ ${fmtK(it.stars)}` : '';
    const head = i === 0 ? `${header}\n\n` : `<b>${i + 1}/${items.length}</b> `;
    // zeli 风格: 标题下作者 + 相对时间
    const meta = [it.author ? `by ${esc(it.author)}` : '', relTime(it.createdAt)].filter(Boolean).join(' · ');
    const metaLine = meta ? `\n👤 ${meta}` : '';
    const descLine = isChinese(it.descZh) ? `\n\n📝 ${esc(unesc(it.descZh!))}\n` : '';
    const quoteLine = it.quote ? `\n💬 "${esc(it.quote)}"\n` : '';
    const topicTags = (it.topics ?? []).map((t) => `#${t}`).join(' ');
    // 存档三链: Telegraph(当日页有则) → Wayback → Archive
    const links: string[] = [];
    if (telegraphUrl) links.push(`<a href="${esc(telegraphUrl)}">Telegraph</a>`);
    links.push(`<a href="https://web.archive.org/web/2/${encodeURIComponent(it.url).replace(/%3A/g, ':').replace(/%2F/g, '/')}">Wayback</a>`);
    links.push(`<a href="${esc(mdPath)}">Archive</a>`);
    let msg =
      `${head}<b><a href="${esc(it.url)}">${esc(it.title)}</a></b>${score}${metaLine}` +
      descLine +
      quoteLine +
      `\n#product ${topicTags}`.replace(/\s+/g, ' ') +
      `\n\n📁 ${links.join(' · ')}`;
    if (msg.length > 4000) msg = msg.slice(0, 3999) + '…';
    return msg;
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
