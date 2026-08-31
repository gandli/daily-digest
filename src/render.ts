import type { SourceItem } from './types';
import { isChinese } from './translate';

const unesc = (s: string) => s.replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
export const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

// wiki 三链(单行 HTML)。renderMessage 与 ♻️重发卡/fanout 批量卡共用, 防某条路径漏链。
export const wikiLinks = (repo: string): string =>
  `<a href="https://deepwiki.com/${esc(repo)}">deepwiki</a> · <a href="https://zread.ai/${esc(repo)}">zread</a> · <a href="https://codewiki.google/github.com/${esc(repo)}">codewiki</a>`;

// Telegram HTML 消息。一个项目一条消息(首条带头部), 标题/描述/wiki 分层, 带 topics 标签 + 存档三链。
// archiveRepo: GitHub 存档仓库(用于拼 md 链接); 三链 = Telegraph(当日页,有则) → web.archive → GitHub md。
export function renderMessage(dateStr: string, items: SourceItem[], telegraphUrl?: string, archiveRepo = 'gandli/daily-digest'): string[] {
  const mdPath = `https://github.com/${archiveRepo}/blob/archive/archive/${yearOf(dateStr)}/${dateStr}.md`;
  const links = (it: SourceItem): string => {
    const l: string[] = [];
    if (telegraphUrl) l.push(`<a href="${esc(telegraphUrl)}">Telegraph</a>`);
    const wb = `https://web.archive.org/web/2/${encodeURIComponent(it.url).replace(/%3A/g, ':').replace(/%2F/g, '/')}`;
    l.push(`<a href="${wb}">Wayback</a>`);
    l.push(`<a href="${esc(mdPath)}">Archive</a>`);
    // wiki 三链在倒数第二行(存档三链之前), 存档在最后一行
    return `\n\n🗂 ${wikiLinks(it.title)}\n📁 ${l.join(' · ')}`;
  };
  return items.map((it, i) => {
    const langTag = it.lang ? ` · #${it.lang}` : '';
    const today = it.starsToday ? ` (+${fmtK(it.starsToday)} 今日)` : '';
    const stars = it.stars !== undefined ? ` ⭐ ${fmtK(it.stars)}${today}` : '';
    // 多条批量才编号(N/M); 单条卡(如 lookup 单仓)不显示 1/1 头
    const head = items.length > 1 ? `<b>${i + 1}/${items.length}</b> ` : '';
    const topicTags = (it.topics ?? []).map((t) => `#${t}`).join(' ');
    const tags = [`#trending`, topicTags].filter(Boolean).join(' ');
    const descLine = isChinese(it.descZh) ? `${esc(unesc(it.descZh!))}` : ''; // ponytail: 非中文/空 → 整行跳过, 不泄露 repo 英文一句话
    // 作者 = repo owner(title 前段), 有 createdAt 时显示创建日期(YYYY-MM-DD)
    const owner = it.author ?? (it.title.includes('/') ? it.title.split('/')[0] : undefined);
    const created = it.createdAt ? it.createdAt.slice(0, 10) : '';
    const metaLine = [owner ? `👤 ${esc(owner)}` : '', created ? `📅 ${created}` : ''].filter(Boolean).join(' · ');
    const body =
      `<b><a href="${esc(it.url)}">${esc(it.titleZh ?? it.title)}</a></b>${stars}${langTag}\n\n` + // 标题层(中文优先)
      (metaLine ? `${metaLine}\n\n` : '') + // 作者/创建日期层
      descLine + // 描述层(仅来自 zread/deepwiki 的中文)
      `\n\n${tags}`;
    // ponytail: wikiDesc 极端超长时仍可能超4096——截断到安全长度
    let msg = head + body + links(it);
    if (msg.length > 4000) msg = msg.slice(0, 3999) + '…';
    return msg;
  });
}

// HN 酷产品消息(仿 trending 但独立)。标题直链 + 中文描述 + #product + 领域标签 + 存档三链。
export function renderProductMessage(dateStr: string, items: SourceItem[], telegraphUrl?: string, archiveRepo = 'gandli/daily-digest', tag = 'product'): string[] {
  const header = `🚀 <b>${dateStr}</b>`;
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
      `${head}<b><a href="${esc(it.url)}">${esc(it.titleZh ?? it.title)}</a></b>${score}${metaLine}` +
      descLine +
      quoteLine +
      `\n#${tag} ${topicTags}`.replace(/\s+/g, ' ') +
      `\n\n📁 ${links.join(' · ')}`;
    if (msg.length > 4000) msg = msg.slice(0, 3999) + '…';
    return msg;
  });
}

// 从文件名/stamp 取年份: 兼容旧纯日期(2026-08-29)与新 repo 前缀名(repo__name-2026-08-29-ms), 取最后一个日期段
export const yearOf = (s: string): string => {
  const m = [...s.matchAll(/(20\d{2})-\d{2}-\d{2}/g)];
  return m.length ? m[m.length - 1][1] : s.slice(0, 4);
};

// GitHub 存档 markdown。ogPath 传入时用 og-images/ 相对路径(本地渲染), 否则回退远程 URL。
export function renderMarkdown(dateStr: string, items: SourceItem[], telegraphUrl?: string, ogPaths?: Map<string, string>): string {
  // 头部: 单条(repo 查询)带 repo 名 + 日期(archive 分支上可辨识); 多条(digest)保持纯日期头
  const head = items.length === 1 && items[0]?.title ? `# ${items[0].title} · ${dateStr}` : `# ${dateStr}`;
  const rows = items
    .map(
      (it, i) =>
        `${i + 1}. **[${it.title}](${it.url})** ⭐ ${fmtK(it.stars)}${
          it.starsToday ? ` (+${fmtK(it.starsToday)})` : ''
        }${it.lang ? ` · ${it.lang}` : ''}${
          isChinese(it.descZh) ? `\n   - ${unesc(it.descZh!)}` : '' // 仅来自 zread/deepwiki 的中文, 双缺跳过
        }\n   - [deepwiki](https://deepwiki.com/${it.title}) · [zread](https://zread.ai/${it.title}) · [codewiki](https://codewiki.google/github.com/${it.title})\n\n   <img src="${ogPaths?.get(it.title) ?? `https://opengraph.githubassets.com/1/${it.title}`}" width="400" alt="${it.title} OG 卡">`,
    )
    .join('\n');
  return (
    `${head}\n\n` +
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
