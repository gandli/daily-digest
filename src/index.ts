import type { Env, SourceItem } from './types';
import { sources } from './sources';
import { resolveDescriptions } from './translate';
import { renderMessage, renderMarkdown, renderTelegraphNodes } from './render';
import { sendPerRepoMessages, sendTelegram, sendPhotoOrText, sendVideoOrText, registerCommands, safeEqual, sendTelegramKbd, answerCallbackQuery, editMessageKbd, type InlineKB } from './notify';
import { archiveToGitHub, archiveDatedToGitHub, createTelegraphPage } from './archive';
import { extractRepo, lookupRepo, seenToday, refreshLookupDescriptions, indexArchivedItems, archiveUrl, fanoutRepoRefs, shouldReprocess, archiveLinks } from './lookup';
import { extractUrl } from './urlmd';
import { extractTweet, fetchTweet, renderTweetHtml, type FxTweet } from './fxtweet';
import { summarizeZh, translateTextZh, translateBatch, isChinese } from './translate';

// 北京时间日期串 YYYY-MM-DD(UTC+8 无 DST,直接偏移即可)
export const shanghaiDate = (): string => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

const HELP = `📊 daily-digest 使用:
/trending — 获取今日 GitHub Trending
/search 关键词 — 搜索历史存档
/archive — 查看历史存档链接
发 GitHub 仓库链接 = 单仓查询(自动去重)。
发 X/Twitter 帖子链接 = 帖子存档。
发任意网页链接 = 转 markdown 存档。
每天 08:30(北京时间)自动推送一条。`;

// /search: 单键压缩索引(search:index)内存过滤。旧实现逐条 KV get 6076 次——免费版单请求
// 50 子请求上限直接打爆, /search 因此无响应。索引由 scripts/seed-search-index.ts 播种,
// 存档写入时增量追加(indexArchivedItems 同步维护)。
const SEARCH_PAGE = 10; // 每页条数
// 翻页 query 存 KV(short TTL)而非塞 callback_data——callback_data 仅限 64B, 长 query 会被截断解码残缺。
// callback_data: sch:<page>:<token>, KV 键 search:q:<token> 存 query。token 只含安全字符。
const S_TOKEN = () => Math.random().toString(36).slice(2, 8); // 6 位, ~7800^2 组合够个人用
const schStoreKey = (token: string) => `search:q:${token}`;

export async function searchArchive(env: Env, chatId: string, query: string, page = 0, messageId?: number): Promise<void> {
  try {
    const raw = await env.CACHE.get('search:index');
    if (!raw) {
      await sendTelegram(env.BOT_TOKEN, chatId, '⚠️ 搜索索引未初始化, 请联系管理员运行 seed 脚本。');
      return;
    }
    const entries = JSON.parse(raw) as [string, string, string, string, string?][]; // [src,name,url,hay,desc]
    const q = query.toLowerCase();
    // ponytail: 线性扫描 6076 条毫秒级; 索引超 5 万条再考虑分片
    type Hit = { src: string; name: string; url: string; desc?: string };
    const hits: Hit[] = [];
    for (const [src, name, url, hay, desc] of entries) {
      if (!hay.includes(q)) continue;
      hits.push({ src, name, url, desc });
    }
    // 分页渲染 + inline keyboard 翻页(复用 archive 同款模式: answerCallbackQuery 放 finally)
    const total = hits.length;
    const maxPage = Math.max(1, Math.ceil(total / SEARCH_PAGE));
    const p = Math.min(Math.max(0, page), maxPage - 1);
    const start = p * SEARCH_PAGE;
    const slice = hits.slice(start, start + SEARCH_PAGE);
    // 当页英文描述 → 批量译中(用户要求所有项目带中文描述)。失败保原文明示。
    const repo = env.GH_ARCHIVE_REPO || 'gandli/daily-digest';
    const needTs = slice.filter((h): h is Hit & { desc: string } => !!h.desc && !isChinese(h.desc)).map((h) => ({ title: h.name, url: h.url, desc: h.desc } as SourceItem));
    const zhMap = new Map<string, string>();
    if (needTs.length) {
      try {
        const t = await translateBatch(env, needTs);
        needTs.forEach((it, i) => { if (t[i]?.descZh) zhMap.set(it.desc, t[i].descZh); });
      } catch { /* 翻译失败保原文明示 */ }
    }
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const lines = slice.map((h) => {
      const d = h.desc ? (zhMap.get(h.desc) || h.desc) : '';
      if (h.src === 'arch') {
        const date = h.url; // url 槽存 date
        const link = `https://github.com/${repo}/blob/archive/archive/${date.slice(0, 4)}/${date}.md`;
        return `📄 <a href="${link}">${esc(h.name)} · ${date}</a>${d ? `\n   ${esc(d)}` : ''}`;
      }
      return `${h.src === 'star' ? '⭐' : '📑'} <a href="${h.url}">${esc(h.name)}</a>${d ? `\n   ${esc(d)}` : ''}`;
    });
    const eq = query.replace(/&/g, '&amp;').replace(/</g, '&lt;');
    // 翻页机制: token = query 哈希(确定, 幂等), 渲染时把 query 写 KV search:q:<token>(TTL 1h)。
    // callback_data 只带 sch:page:q<token> —— 64B 内, query 再长也不截断。
    const token = qToken(query);
    try { await env.CACHE.put(`search:q:${token}`, query, { expirationTtl: 3600 }); } catch { /* KV 额度忽略 */ }
    // 分页导航: 上一页 / 页码指示 / 下一页 + 快捷跳转(首/中/末, >4 页才显示)
    const cb = (pg: number) => `sch:${pg}:${token}`;
    const kb: InlineKB = { inline_keyboard: [] };
    const nav: { text: string; callback_data: string }[] = [];
    if (p > 0) nav.push({ text: '⬅ 上一页', callback_data: cb(p - 1) });
    nav.push({ text: `📄 ${p + 1}/${maxPage}`, callback_data: cb(p) });
    if (p < maxPage - 1) nav.push({ text: '下一页 ➡', callback_data: cb(p + 1) });
    kb.inline_keyboard.push(nav);
    if (maxPage > 4) {
      const jump: { text: string; callback_data: string }[] = [];
      if (p > 1) jump.push({ text: `⏮ 1`, callback_data: cb(0) });
      const mid = Math.floor(maxPage / 2);
      if (Math.abs(p - mid) > 1) jump.push({ text: `⏭ ${mid + 1}`, callback_data: cb(mid) });
      if (p < maxPage - 2) jump.push({ text: `⏭ ${maxPage}`, callback_data: cb(maxPage - 1) });
      if (jump.length) kb.inline_keyboard.push(jump);
    }
    const head = total ? `🔍 「${eq}」${total} 条命中 (第 ${p + 1}/${maxPage} 页)` : `🔍 没有找到「${eq}」`;
    const text = total ? `${head}:\n\n${lines.join('\n')}` : head;
    if (messageId) await editMessageKbd(env.BOT_TOKEN, chatId, messageId, text, kb);
    else if (kb.inline_keyboard.length) await sendTelegramKbd(env.BOT_TOKEN, chatId, text, kb);
    else await sendTelegram(env.BOT_TOKEN, chatId, text);
  } catch (e) {
    console.error('searchArchive failed', String(e).slice(0, 80));
    await sendTelegram(env.BOT_TOKEN, chatId, '⚠️ 搜索失败(网络异常), 请稍后再试。');
  }
}

// query → 稳定 token(确定性哈希, 短)。callback 只需带它, query 本体存 KV search:q:<token>。
function qToken(query: string): string {
  let h = 5381;
  for (let i = 0; i < query.length; i++) h = ((h << 5) + h + query.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** KV list 分页遍历(archive:idx: 增量维护仍需遍历; lib: 已并入 search:index 不再逐键)。 */
async function listAll(env: Env, prefix: string): Promise<{ keys: { name: string }[] }> {
  const keys: { name: string }[] = [];
  let cursor: string | undefined;
  do {
    const page = await env.CACHE.list({ prefix, cursor });
    keys.push(...page.keys);
    cursor = page.list_complete ? undefined : (page as { cursor?: string }).cursor;
  } while (cursor);
  return { keys };
}

/** 存档成功后写搜索索引(lookup 单仓与 digest 批量共用)。实现见 lookup.ts(indexArchivedItems)。 */

/**
 * X 帖子存档: FxEmbed API 拉元数据 → 回复卡片 → archive 分支存档。
 * API 失败落回通用 URL→markdown 链(x.com 反爬, 多半也失败, 但给用户一致行为)。
 */
export async function archiveTweet(
  env: Env,
  chatId: string,
  handle: string,
  id: string,
  ctx?: ExecutionContext,
): Promise<void> {
  const tweet = await fetchTweet(handle, id);
  if (!tweet) {
    // ponytail: x.com 直抓基本被墙, 落通用链是诚实降级而非兜底表演
    await archiveUrl(env, chatId, `https://x.com/${handle}/status/${id}`);
    return;
  }
  // 正文翻译(非中文时; 失败回退原文)——必须在发卡片前算好, 否则🌐段无处安放。
  // 首选 FxEmbed 内嵌翻译(/zh-cn URL 后缀触发, Grok 引擎质量高); 空/失败落四级链
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const fxZh = tweet.translation?.text;
  const textZh = tweet.text
    ? (fxZh && isChinese(fxZh) && fxZh !== tweet.text ? fxZh : await translateTextZh(env, tweet.text).catch(() => null))
    : null;
  const hasZh = !!textZh && isChinese(textZh) && textZh !== tweet.text;
  const zhLine = hasZh ? `\n\n<b>🌐 中文翻译</b>\n${esc(textZh!).slice(0, 3500)}` : '';
  // 卡片媒体: video→sendVideo 内嵌播放(mp4 直链, 失败落缩略图卡); photo→直链图; 无媒体→帖内 repo og 图/s2 保底
  const media0 = (tweet.media?.all ?? [])[0];
  const repoRef = tweet.text?.match(/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/i)?.[1]
    ?? `x.com/${tweet.author?.screen_name ?? handle}`;
  const photo =
    (media0?.type === 'photo' ? media0.url : media0?.thumbnail_url) ??
    (tweet.text?.includes('github.com')
      ? `https://opengraph.githubassets.com/1/${repoRef}`
      : `https://www.google.com/s2/favicons?domain=x.com&sz=64`);
  if (media0?.type === 'video' && media0.url) {
    await sendVideoOrText(env.BOT_TOKEN, chatId, media0.url, photo, renderTweetHtml(tweet) + zhLine);
  } else {
    await sendPhotoOrText(env.BOT_TOKEN, chatId, photo, renderTweetHtml(tweet) + zhLine);
  }
  const stamp = `${shanghaiDate()}-${Date.now() % 86400000}`;
  const tUrl = tweet.url ?? `https://x.com/${handle}/status/${id}`;
  const md = [
    `# X Post · @${tweet.author?.screen_name ?? handle}`,
    '',
    `- 原链: ${tUrl}`,
    `- 作者: ${tweet.author?.name ?? ''} (@${tweet.author?.screen_name ?? handle})`,
    `- 时间: ${tweet.created_at ?? ''}`,
    `- 数据: ❤️ ${tweet.likes ?? '-'} · 🔁 ${tweet.retweets ?? '-'} · 💬 ${tweet.replies ?? '-'}`,
    '',
    '---',
    '',
    tweet.text ?? '',
    ...(hasZh ? [`\n---\n\n**🌐 中文翻译**\n\n${textZh}`] : []),
    ...(tweet.media?.all ?? []).map((m) => `\n![${m.type ?? 'media'}](${m.url ?? m.thumbnail_url})`),
    '',
    '---',
    '由 daily-digest bot 经 FxEmbed API 自动生成',
  ].join('\n');
  try {
    await archiveDatedToGitHub(env, stamp, md);
    // Telegraph 存档(单帖一页; 失败静默——增强非必需)
    let tgLine = '';
    if (env.TELEGRAPH_TOKEN) {
      const nodes: unknown[] = [
        { tag: 'p', children: [`@${tweet.author?.screen_name ?? handle} · ${tweet.created_at ?? ''}`] },
        { tag: 'p', children: [tweet.text ?? ''] },
        ...(hasZh ? [{ tag: 'h3' as const, children: ['🌐 中文翻译'] }, { tag: 'p', children: [textZh!] }] : []),
        ...(tweet.media?.all ?? []).map((m) => ({ tag: 'figure' as const, children: [{ tag: 'img' as const, attrs: { src: m.thumbnail_url ?? m.url ?? '' } }] })),
        { tag: 'p', children: [{ tag: 'a', attrs: { href: tUrl }, children: ['原帖'] }] },
      ];
      const pageUrl = await createTelegraphPage(env.TELEGRAPH_TOKEN, `X · @${handle} · ${stamp.slice(0, 10)}`, nodes);
      if (pageUrl) {
        tgLine = `\n📄 Telegraph: ${pageUrl}`;
        // 键用完整 stamp(含 ms, 唯一)——同日多条 X 帖互不覆盖, 也不覆盖 digest 的 archive:tg:<date>。
        // digest 用日期键(每天一条), X 帖用时间戳键(每帖一条)。
        try { await env.CACHE.put(`archive:tg:${stamp}`, pageUrl); } catch { /* KV 额度忽略 */ }
      }
    }
    // /search 描述: X 帖中文摘要(短帖直译; 长帖 CF Summarization 摘要后已是中文)——失败回退原文截断
    let tweetDescZh: string | undefined;
    if (tweet.text) {
      const s = await summarizeZh(env, tweet.text).catch(() => null);
      tweetDescZh = (s && isChinese(s) ? s : await translateTextZh(env, tweet.text.slice(0, 120)).catch(() => null)) ?? undefined;
    }
    await indexArchivedItems(env, [{ title: `x/@${handle}`, url: tweet.url ?? '', desc: tweetDescZh, descZh: tweetDescZh } as SourceItem], stamp);
    // 帖子正文含 GitHub repo 链接 → 联动查询(与 URL 存档同款扫描)
    await fanoutRepoRefs(env, chatId, md, ctx);
    const repo = env.GH_ARCHIVE_REPO || 'gandli/daily-digest';
    // 统一格式化回复(与网页存档同款三行式): 标题行 / 中文摘要 / 双存档链接
    const escT = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const confirm = [
      `🐦 <b>X 存档</b> · @${escT(handle)}`,
      tweetDescZh ? `\n📝 <b>摘要</b> ${escT(tweetDescZh).slice(0, 300)}` : '',
      `\n📁 ${archiveLinks(tUrl, tgLine ? tgLine.split(' ').pop() : undefined, `https://github.com/${repo}/blob/archive/archive/${stamp.slice(0, 4)}/${stamp}.md`)}`,
    ].join('');
    await sendTelegram(env.BOT_TOKEN, chatId, confirm);
  } catch (e) {
    console.error('archiveTweet store failed', String(e).slice(0, 100));
    await sendTelegram(env.BOT_TOKEN, chatId, `⚠️ 已取到帖子但存档失败(${String(e).slice(0, 120)})。请重发一次该链接重试。`);
  }
}

// 共享管线:cron 与 /trending 都走这里。
export async function runDigest(env: Env, useCache = true): Promise<number> {
  const dateStr = shanghaiDate();
  const cacheKey = `digest:${dateStr}`;

  if (useCache) {
    const cached = await env.CACHE.get(cacheKey);
    if (cached) {
      // 新格式 {chunks, repos}：用 sendPerRepoMessages 重放带 OG 图; 旧格式(纯 string[] 数组)回退纯文字
      try {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed)) {
          for (const chunk of parsed as string[]) await sendTelegram(env.BOT_TOKEN, env.CHAT_ID, chunk);
        } else if (Array.isArray(parsed.chunks) && Array.isArray(parsed.repos)) {
          await sendPerRepoMessages(
            env.BOT_TOKEN,
            env.CHAT_ID,
            (parsed.chunks as string[]).map((html, i) => ({ html, repo: parsed.repos[i] })),
            env.GH_ARCHIVE_REPO || 'gandli/daily-digest',
          );
        }
      } catch {
        /* 缓存坏格式忽略, 落到重抓 */
      }
      console.log('sent from cache', cacheKey);
      return 0;
    }
  }

  // 1. 抓取全部源(v1 仅 trending)
  let items: SourceItem[] = [];
  try {
    for (const s of sources) items = items.concat(await s.fetch(env));
  } catch (e) {
    console.error('fetch failed', e);
    await sendTelegram(
      env.BOT_TOKEN,
      env.CHAT_ID,
      `⚠️ daily-digest 抓取失败: ${String(e).slice(0, 100)}\n明日自动重试。`,
    );
    return -1;
  }

  // 2. 描述解析链: zread wiki 中文 → deepwiki Overview → 翻译成中文(顺序兜底)
  await resolveDescriptions(env, items);

  // 2.6 GitHub topics(GH_TOKEN 已配)——做消息标签。
  // ponytail: Worker 单次调用子请求上限50, 全链路已近顶——只拉前4个 repo 的 topics
  try {
    await Promise.all(
      items.slice(0, 4).map(async (it) => {
        const r = await fetch(`https://api.github.com/repos/${it.title}`, {
          headers: {
            Authorization: `Bearer ${env.GH_TOKEN}`,
            Accept: 'application/vnd.github+json',
            'User-Agent': 'daily-digest',
          },
          signal: AbortSignal.timeout(10000),
        });
        if (!r.ok) return;
        const j = (await r.json()) as { topics?: string[] };
        if (j.topics?.length) it.topics = j.topics.slice(0, 4);
      }),
    );
    console.log('topics fetched');
  } catch (e) {
    console.error('topics failed', String(e).slice(0, 80));
  }

  // 3. Telegraph 备份页(可选,失败静默)——索引 archive:tg:<date> 供 /archive 优先展示
  let telegraphUrl: string | null = null;
  if (env.TELEGRAPH_TOKEN) {
    telegraphUrl = await createTelegraphPage(env.TELEGRAPH_TOKEN, dateStr, renderTelegraphNodes(items));
    try {
      if (telegraphUrl) await env.CACHE.put(`archive:tg:${dateStr}`, telegraphUrl);
    } catch {
      /* KV 额度不影响主流程 */
    }
  }

  // 4. 渲染并发送: 每项目一条消息(OG 图做照片 + 完整条目做 caption), 头条带日期头, 末条带存档链接
  const chunks = renderMessage(dateStr, items, telegraphUrl ?? undefined);
  await sendPerRepoMessages(
    env.BOT_TOKEN,
    env.CHAT_ID,
    chunks.map((html, i) => ({ html, repo: items[i].title })),
    env.GH_ARCHIVE_REPO || 'gandli/daily-digest',
  );
  // 纯文字兜底副本不再发——sendPhoto 失败时 sendPerRepoMessages 内部已降级纯文字

  // 5. 缓存 + 存档(失败不影响已发消息)。缓存存 chunks+repos——重放(/trending 用缓存)能带 OG 图
  try {
    const repos = items.map((i) => i.title);
    await env.CACHE.put(cacheKey, JSON.stringify({ chunks, repos }), { expirationTtl: 86400 });
  } catch {
    // KV 额度/网络异常只损失当日缓存
  }
  await archiveToGitHub(env, dateStr, renderMarkdown(dateStr, items, telegraphUrl ?? undefined));
  await indexArchivedItems(env, items, dateStr); // /search 索引
  console.log('digest sent', dateStr, `${items.length} items`);
  return chunks.length;
}

/** 当日已查过的 repo: 回存档数据(索引里的描述+存档链接), 不再提示"已查询过"。 */
async function replyArchived(env: Env, chatId: string, repo: string): Promise<void> {
  const raw = await env.CACHE.get(`archive:idx:${repo.toLowerCase()}`);
  let it: { repo: string; date: string; desc?: string; descZh?: string } | null = null;
  if (raw) {
    try {
      it = JSON.parse(raw);
    } catch {
      it = null;
    }
  }
  if (!it) {
    // 索引缺失 = 上次归档失败(seenToday 已置位但 archive:idx 没写)。
    // 用户硬性要求返回存档信息——重新查询并归档, 而非回旧提示"已查询过"。
    await lookupRepo(env, chatId, repo);
    return;
  }
  const archiveRepo = env.GH_ARCHIVE_REPO || 'gandli/daily-digest';
  const link = `https://github.com/${archiveRepo}/blob/archive/archive/${it.date.slice(0, 4)}/${it.date}.md`;
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const d = it.descZh ?? it.desc;
    // 三链: Telegraph(当日有页) → web.archive(repo 源 URL) → GitHub md
    const tgUrl = (await env.CACHE.get(`archive:tg:${it.date}`).catch(() => null)) || '';
    const repoUrl = `https://github.com/${it.repo}`;
    const html =
      `♻️ <b>${esc(it.repo)}</b> · 今日已存档\n\n` +
      (d ? `${esc(d).slice(0, 300)}\n\n` : '') +
      `📁 ${archiveLinks(repoUrl, tgUrl || undefined, link)}`;
  const photo = `https://raw.githubusercontent.com/${archiveRepo}/archive/og-images/${it.repo.replace('/', '__')}.png`;
  await sendPhotoOrText(env.BOT_TOKEN, chatId, photo, html);
}

/** /archive [页码]: 最近存档列表, inline keyboard 翻页, Telegraph 链接优先。 */
const ARCHIVE_PAGE = 10; // 每页条数

// 渲染一页存档: 返回 {text, kb, total, notFound?}。纯函数便于复用(/archive N 与 callback_query 翻页共用)。
async function renderArchivePage(env: Env, page: number): Promise<{ text: string; kb: InlineKB; total: number; err?: string }> {
  const keys = await listAll(env, 'archive:idx:');
  if (!keys.keys.length) return { text: '📂 暂无存档记录', kb: { inline_keyboard: [] }, total: 0 };
  const sorted = keys.keys.sort((a, b) => b.name.localeCompare(a.name));
  const total = sorted.length;
  const maxPage = Math.ceil(total / ARCHIVE_PAGE);
  const start = page * ARCHIVE_PAGE;
  if (start >= total) {
    return { text: '📂 已到最后一页', kb: { inline_keyboard: [] }, total };
  }
  const pageKeys = sorted.slice(start, start + ARCHIVE_PAGE);
  const repo = env.GH_ARCHIVE_REPO || 'gandli/daily-digest';
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const lines: string[] = [];
  for (const k of pageKeys) {
    const raw = await env.CACHE.get(k.name);
    if (!raw) continue;
    let it: { repo: string; date: string; desc?: string; descZh?: string };
    try { it = JSON.parse(raw); } catch { continue; }
    const date = it.date;
        const link = `https://github.com/${repo}/blob/archive/archive/${date.slice(0, 4)}/${date}.md`;
        const tgUrl = (await env.CACHE.get(`archive:tg:${date}`)) || '';
        const d = it.descZh ?? it.desc;
        // 三链各给: repo 源 URL → web.archive, 当日 telegraph, github md
        const links = archiveLinks(`https://github.com/${it.repo}`, tgUrl || undefined, link);
        lines.push(`<a href="${link}">${esc(it.repo)} · ${date}</a>\n   ${links}${d ? `\n   ${esc(d).slice(0, 120)}` : ''}`);
  }
  const text = `📂 历史存档 (第 ${page + 1}/${maxPage} 页, 共 ${total} 条)\n\n${lines.join('\n')}`;
  return { text, kb: buildArchiveKeyboard(page, maxPage), total };
}

async function archiveList(env: Env, chatId: string, page: number): Promise<void> {
  try {
    const r = await renderArchivePage(env, Math.max(0, page));
    if (r.kb.inline_keyboard.length) await sendTelegramKbd(env.BOT_TOKEN, chatId, r.text, r.kb);
    else await sendTelegram(env.BOT_TOKEN, chatId, r.text);
  } catch (e) {
    console.error('archiveList failed', String(e).slice(0, 80));
    await sendTelegram(env.BOT_TOKEN, chatId, '⚠️ 存档列表加载失败, 请稍后再试。');
  }
}

function buildArchiveKeyboard(page: number, maxPage: number): InlineKB {
  const kb: InlineKB = { inline_keyboard: [] };
  const nav: { text: string; callback_data: string }[] = [];
  if (page > 0) nav.push({ text: '⬅ 上一页', callback_data: `arch:pg:${page - 1}` });
  // 页码指示(不可点, 但占位保证对齐)
  nav.push({ text: `📄 ${page + 1}/${maxPage}`, callback_data: `arch:pg:${page}` });
  if (page < maxPage - 1) nav.push({ text: '下一页 ➡', callback_data: `arch:pg:${page + 1}` });
  kb.inline_keyboard.push(nav);
  // 快捷跳转行: 首/中间/末(非当前页才显示, ≤4 页跳过——已有上一页/下一页够用)
  if (maxPage > 4) {
    const jump: { text: string; callback_data: string }[] = [];
    if (page > 1) jump.push({ text: `⏮ 1`, callback_data: `arch:pg:0` });
    const mid = Math.floor(maxPage / 2);
    if (Math.abs(page - mid) > 1) jump.push({ text: `⏭ ${mid + 1}`, callback_data: `arch:pg:${mid}` });
    if (page < maxPage - 2) jump.push({ text: `⏭ ${maxPage}`, callback_data: `arch:pg:${maxPage - 1}` });
    if (jump.length) kb.inline_keyboard.push(jump);
  }
  return kb;
}

// Telegram webhook 入口:验签 → 秒回200 → waitUntil 后台处理
export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'GET') {
      // /preview: 数据管线自检(抓取→翻译→渲染, 不发消息)。仅未配凭证时开放。
      if (url.pathname === '/preview' && !env.BOT_TOKEN) {
        const dateStr = shanghaiDate();
        let items: SourceItem[] = [];
        for (const s of sources) items = items.concat(await s.fetch(env));
        await resolveDescriptions(env, items);
        const nodes = renderTelegraphNodes(items);
        let telegraphUrl: string | null = null;
        if (env.TELEGRAPH_TOKEN) {
          telegraphUrl = await createTelegraphPage(env.TELEGRAPH_TOKEN, dateStr, nodes);
        }
        return Response.json({
          date: dateStr,
          count: items.length,
          translatedCount: items.filter((i) => i.descZh).length,
          translateErrors: [],
          message: renderMessage(dateStr, items, telegraphUrl ?? undefined),
          markdown: renderMarkdown(dateStr, items),
          items,
        });
      }
      // /run: 手动触发完整管线(含发送)。需 POST + X-Runner-Token header(token 不进 URL, 避免落日志)。
      if (url.pathname === '/run') {
        // fetch handler 入口已过滤 method==='GET', 此处 TS 收窄为 'GET'——运行时仍可能 POST, 用 as 断言
        if ((req.method as string) !== 'POST') return new Response('method not allowed', { status: 405 });
        const got = req.headers.get('X-Runner-Token') ?? '';
        if (!env.WEBHOOK_SECRET || got !== env.WEBHOOK_SECRET) {
          return new Response('forbidden', { status: 403 });
        }
        const n = await runDigest(env, url.searchParams.get('cache') !== '0');
        return Response.json({ ok: true, chunks: n });
      }
      return new Response('daily-digest worker running\n', { headers: { 'content-type': 'text/plain' } });
    }
    if (url.pathname !== '/telegram' || req.method !== 'POST') {
      return new Response('not found', { status: 404 });
    }

    // a) 验签(常量时间比较); secret 未配置时 fail-closed 全拒
    const got = req.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? '';
    if (!env.WEBHOOK_SECRET || !(await safeEqual(got, env.WEBHOOK_SECRET))) {
      return new Response('forbidden', { status: 403 });
    }

    const update = (await req.json().catch(() => ({}))) as {
      message?: { chat?: { id?: number }; text?: string };
      callback_query?: {
        id?: string;
        data?: string;
        message?: { chat?: { id?: number }; message_id?: number };
      };
    };
    const chatId = String(update.message?.chat?.id ?? update.callback_query?.message?.chat?.id ?? '');
    const text = (update.message?.text ?? '').trim();

    // c) 白名单外:不响应任何动作
    if (!chatId || chatId !== env.CHAT_ID) return new Response('ok');

    // c2) callback_query: inline keyboard 翻页(arch:pg:N) —— 同一条消息原地更新; 答回收必须放 finally(编辑抛错也消转圈)
    if (update.callback_query?.data?.startsWith('arch:pg:')) {
      const page = Number(update.callback_query.data.slice('arch:pg:'.length)) || 0;
      const messageId = update.callback_query.message?.message_id;
      const cqId = update.callback_query.id ?? '';
      ctx.waitUntil(
        (async () => {
          try {
            const r = await renderArchivePage(env, Math.max(0, page));
            if (messageId) await editMessageKbd(env.BOT_TOKEN, chatId, messageId, r.text, r.kb);
            else if (r.kb.inline_keyboard.length) await sendTelegramKbd(env.BOT_TOKEN, chatId, r.text, r.kb);
            else await sendTelegram(env.BOT_TOKEN, chatId, r.text);
          } catch (e) {
            console.error('archive callback failed', String(e).slice(0, 120));
          } finally {
            if (cqId) await answerCallbackQuery(env.BOT_TOKEN, cqId);
          }
        })(),
      );
      return new Response('ok');
    }

    // c3) callback_query: /search 翻页(sch:page:<token>) —— 凭 token 从 KV 读回 query, 重算 hits 原地更新页
    if (update.callback_query?.data?.startsWith('sch:')) {
      const rest = update.callback_query.data.slice(4); // 'page:<token>'
      const sep = rest.indexOf(':');
      const page = Number(rest.slice(0, sep < 0 ? 0 : sep)) || 0;
      const token = sep < 0 ? '' : rest.slice(sep + 1);
      const messageId = update.callback_query.message?.message_id;
      const cqId = update.callback_query.id ?? '';
      ctx.waitUntil(
        (async () => {
          try {
            const q = token ? await env.CACHE.get(`search:q:${token}`) : null;
            if (q) await searchArchive(env, chatId, q, page, messageId ?? undefined);
            else if (messageId) await editMessageKbd(env.BOT_TOKEN, chatId, messageId, '⚠️ 查询过期, 请重新 /search', { inline_keyboard: [] });
          } catch (e) {
            console.error('search callback failed', String(e).slice(0, 120));
          } finally {
            if (cqId) await answerCallbackQuery(env.BOT_TOKEN, cqId);
          }
        })(),
      );
      return new Response('ok');
    }

    // 注册命令菜单(幂等)+ 分派命令
    if (text.startsWith('/trending')) {
      // 用缓存(useCache=true): 当天 GitHub trending 固定不变, 无需每次重抓。
      // cron 早 08:30 已跑一次写 digest:<date> 缓存, /trending 当天后续读缓存秒回。
      // 首屏无缓存(如当天未到 cron)才触发完整抓取+描述链。缓存命中仅回纯文本(无 OG 照片),
      // 换取不等 10-30s 描述链。需带图可二次发 /archive 或等 cron。
      ctx.waitUntil(
        (async () => {
          const n = await runDigest(env, true);
          if (n < 0) await sendTelegram(env.BOT_TOKEN, chatId, '⚠️ Trending 抓取失败, 请稍后再试。');
        })(),
      );
    } else if (text.startsWith('/help') || text === '') {
      ctx.waitUntil(Promise.all([registerCommands(env.BOT_TOKEN), sendTelegram(env.BOT_TOKEN, chatId, HELP)]));
      return new Response('ok');
    } else if (text.startsWith('/archive')) {
      // /archive 或 /archive N: 最近存档列表(按 archive:idx 倒序), inline keyboard 翻页, Telegraph 优先展示
      ctx.waitUntil(archiveList(env, chatId, Number(text.split(/\s+/)[1]) || 0));
      return new Response('ok');
    } else if (text.startsWith('/search')) {
      const query = text.slice('/search'.length).trim();
      if (!query) {
        ctx.waitUntil(sendTelegram(env.BOT_TOKEN, chatId, '用法: /search 关键词\n例: /search rust cli'));
      } else {
        ctx.waitUntil(searchArchive(env, chatId, query));
      }
      return new Response('ok');
    } else {
      // GitHub 链接 → 单仓库 lookup; X 帖子 → FxEmbed API 存档; 任意 URL → 转 markdown; 都不是 → 帮助
      const repo = extractRepo(text);
      const tweet = extractTweet(text);
      const url = extractUrl(text);
      if (repo) {
        if (await seenToday(env, repo)) {
          ctx.waitUntil(replyArchived(env, chatId, repo));
        } else {
          ctx.waitUntil(lookupRepo(env, chatId, repo));
        }
      } else if (tweet) {
        ctx.waitUntil(archiveTweet(env, chatId, tweet.handle, tweet.id, ctx));
      } else if (url) {
        // 重发语义: first→处理; retry(上次未翻译或缺 deepwiki/zread 描述)→重跑+提示; done→跳过
        const verdict = await shouldReprocess(env, url);
        if (verdict === 'retry') {
          ctx.waitUntil(archiveUrl(env, chatId, url, ctx));
          await sendTelegram(env.BOT_TOKEN, chatId, '🔁 检测到上次处理不完整(未翻译或缺描述), 重新归档中…');
        } else if (verdict === 'done') {
          // 已完整处理过: 优先回 Telegraph 页(若有存档索引), 否则回 GitHub .md 存档链接。
          // 读 reproc 键里的 md stamp; 无 md(老记录)则重挂一次归档取回存档信息, 而非"无需重复"梗概。
          const rec = await env.CACHE.get(`reproc:${url.slice(0, 400)}`).catch(() => null);
          let stamp = '';
          try { stamp = rec ? (JSON.parse(rec)?.md ?? '') : ''; } catch { /* 忽略 */ }
          if (stamp) {
                      const repo = env.GH_ARCHIVE_REPO || 'gandli/daily-digest';
                      const link = `https://github.com/${repo}/blob/archive/archive/${stamp.slice(0, 4)}/${stamp}.md`;
                      const tgUrl = (await env.CACHE.get(`archive:tg:${stamp.slice(0, 10)}`).catch(() => null)) || '';
                      // 三链: Telegraph → web.archive(源 URL) → GitHub md
                      const links = archiveLinks(url, tgUrl || undefined, link);
                      await sendTelegram(env.BOT_TOKEN, chatId, `♻️ <b>该链接此前已处理归档</b>\n\n📁 ${links}`);
                    } else {
            // 老记录无 md——重挂一次归档补上存档信息, 回给用户(而非"无需重复")
            await sendTelegram(env.BOT_TOKEN, chatId, '♻️ 已识别此前处理过, 重新归档取回存档链接…');
            await archiveUrl(env, chatId, url, ctx);
          }
        } else {
          ctx.waitUntil(archiveUrl(env, chatId, url, ctx));
        }
      } else {
        ctx.waitUntil(sendTelegram(env.BOT_TOKEN, chatId, HELP));
      }
    }

    // b) 立即应答,处理放后台
    return new Response('ok');
  },

  async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    await runDigest(env, false); // cron 不读缓存,保证每日新鲜抓取
    await refreshLookupDescriptions(env); // 已查过的 repo 定期重跑 deepwiki/zread, 同步上游描述
  },
};
