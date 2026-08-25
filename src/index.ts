import type { Env, SourceItem } from './types';
import { sources } from './sources';
import { resolveDescriptions } from './translate';
import { renderMessage, renderMarkdown, renderTelegraphNodes } from './render';
import { sendPerRepoMessages, sendTelegram, sendPhotoOrText, sendVideoOrText, registerCommands, safeEqual } from './notify';
import { archiveToGitHub, archiveDatedToGitHub, createTelegraphPage } from './archive';
import { extractRepo, lookupRepo, seenToday, refreshLookupDescriptions, indexArchivedItems, archiveUrl, fanoutRepoRefs, shouldReprocess } from './lookup';
import { extractUrl } from './urlmd';
import { extractTweet, fetchTweet, renderTweetHtml, type FxTweet } from './fxtweet';
import { summarizeZh, translateTextZh, isChinese } from './translate';

// 北京时间日期串 YYYY-MM-DD(UTC+8 无 DST,直接偏移即可)
export const shanghaiDate = (): string => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

const HELP = `📊 daily-digest 使用:
/trending — 获取今日 GitHub Trending
/search <关键词> — 搜索历史存档
/archive — 查看历史存档链接
发 GitHub 仓库链接 = 单仓查询(自动去重)。
发 X/Twitter 帖子链接 = 帖子存档。
发任意网页链接 = 转 markdown 存档。
每天 08:30(北京时间)自动推送一条。`;

// /search: 查 KV 存档索引(archive:idx:<repo> → {date, path, desc})。GitHub code search 只索引
// 默认分支, archive 分支搜不到——所以存档写入时同步维护这份索引。
export async function searchArchive(env: Env, chatId: string, query: string): Promise<void> {
  const repo = env.GH_ARCHIVE_REPO || 'gandli/daily-digest';
  const q = query.toLowerCase();
  try {
    // 库索引(lib:* 星标/书签)与存档索引(archive:idx:)合并搜索——导入的库数据也要能被搜到
    const [arch, lib] = await Promise.all([
      listAll(env, 'archive:idx:'),
      listAll(env, 'lib:'),
    ]);
    const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const hits: string[] = [];
    for (const k of arch.keys) {
      const raw = await env.CACHE.get(k.name);
      if (!raw) continue;
      const it = JSON.parse(raw) as { repo: string; date: string; desc?: string; descZh?: string };
      // ponytail: 全量线性扫描+子串匹配——个人规模(几百条)毫秒级; 上千条再考虑倒排索引
      if (it.repo.toLowerCase().includes(q) || (it.descZh ?? '').toLowerCase().includes(q)) {
        const year = it.date.slice(0, 4);
        const link = `https://github.com/${repo}/blob/archive/archive/${year}/${it.date}.md`;
        // 描述优先中文, 无则截英文原文——结果必须可读(用户硬性要求)
        const d = it.descZh ?? it.desc;
        hits.push(`📄 <a href="${link}">${esc(it.repo)} · ${it.date}</a>${d ? `\n   ${d.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').slice(0, 120)}` : ''}`);
      }
    }
    for (const k of lib.keys) {
      const raw = await env.CACHE.get(k.name);
      if (!raw) continue;
      const e = JSON.parse(raw) as { src: string; name: string; url: string; desc?: string; folder?: string; tags: string[] };
      const hay = `${e.name} ${e.desc ?? ''} ${(e.tags ?? []).join(' ')} ${e.folder ?? ''}`.toLowerCase();
      if (hay.includes(q)) {
        hits.push(`${e.src === 'star' ? '⭐' : '📑'} <a href="${e.url}">${esc(e.name)}</a>${e.tags?.length ? ` · ${esc(e.tags.join(','))}` : ''}${e.desc ? `\n   ${esc(e.desc).slice(0, 120)}` : ''}`);
      }
    }
    return done(env, chatId, query, hits);
  } catch (e) {
    console.error('searchArchive failed', String(e).slice(0, 80));
    await sendTelegram(env.BOT_TOKEN, chatId, '⚠️ 搜索失败(网络异常), 请稍后再试。');
  }
}

/** KV list 分页遍历(list 默认单页 ~1000 条, lib: 有 6041 条必须翻完)。 */
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

function done(env: Env, chatId: string, query: string, hits: string[]): Promise<void> {
  const eq = query.replace(/&/g, '&amp;').replace(/</g, '&lt;');
  if (!hits.length) return sendTelegram(env.BOT_TOKEN, chatId, `🔍 没有找到「${eq}」`);
  // Telegram sendMessage 上限 4096 字符——archive 与 lib 交替取样截断, 不让单一来源占满(Greptile P1)
  const archHits = hits.filter((h) => h.startsWith('📄'));
  const libHits = hits.filter((h) => !h.startsWith('📄'));
  let text = '';
  const total = hits.length;
  const push = (arr: string[]) => {
    for (const h of arr) {
      if (text.length + h.length + 1 > 3800) return false;
      text += (text ? '\n' : '') + h;
    }
    return true;
  };
  // 两来源交替取样: 各先取一条, 轮流填充——宽泛词下 archive 塞满预算时 lib 结果仍可见
  let ai = 0, li = 0;
  while ((ai < archHits.length || li < libHits.length) && text.length <= 3800) {
    if (ai < archHits.length && text.length + archHits[ai].length + 1 <= 3800) { push([archHits[ai]]); ai++; }
    if (li < libHits.length && text.length + libHits[li].length + 1 <= 3800) { push([libHits[li]]); li++; }
    if (ai >= archHits.length && li >= libHits.length) break;
    if (text.length + Math.min(archHits[ai]?.length ?? Infinity, libHits[li]?.length ?? Infinity) + 1 > 3800) break;
  }
  const omitted = total - ai - li; // 真实未展示数, 警告条件与截断事实绑定(Greptile P1)
  const note = omitted > 0 ? `\n\n⚠️ 结果过多已截断(${total} 条命中, 显示 ${total - omitted} 条), 请用更具体的关键词` : '';
  if (!text && total) {
    // 单条就超限的极端情况: 保底第一条的前 500 字符
    text = hits[0].slice(0, 500);
    return sendTelegram(env.BOT_TOKEN, chatId, `🔍 「${eq}」${total} 条命中:\n${text}\n\n⚠️ 已截断(${total} 条命中), 请用更具体的关键词`);
  }
  return sendTelegram(env.BOT_TOKEN, chatId, `🔍 「${eq}」${omitted > 0 ? `显示 ${total - omitted}/${total}` : total + ' 条命中'}:\n${text}${note}`);
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
      if (pageUrl) tgLine = `\n📄 Telegraph: ${pageUrl}`;
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
      tweetDescZh ? `\n💬 ${escT(tweetDescZh).slice(0, 300)}` : '',
      `\n📁 <a href="https://github.com/${repo}/blob/archive/archive/${stamp.slice(0, 4)}/${stamp}.md">查看存档</a>` +
        (tgLine ? ` · <a href="${tgLine.split(' ').pop()}">Telegraph</a>` : ''),
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
      for (const chunk of JSON.parse(cached) as string[]) await sendTelegram(env.BOT_TOKEN, env.CHAT_ID, chunk);
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

  // 3. Telegraph 备份页(可选,失败静默)
  let telegraphUrl: string | null = null;
  if (env.TELEGRAPH_TOKEN) {
    telegraphUrl = await createTelegraphPage(env.TELEGRAPH_TOKEN, dateStr, renderTelegraphNodes(items));
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

  // 5. 缓存 + 存档(失败不影响已发消息)
  try {
    await env.CACHE.put(cacheKey, JSON.stringify(chunks), { expirationTtl: 86400 });
  } catch {
    // KV 额度/网络异常只损失当日缓存
  }
  await archiveToGitHub(env, dateStr, renderMarkdown(dateStr, items, telegraphUrl ?? undefined));
  await indexArchivedItems(env, items, dateStr); // /search 索引
  console.log('digest sent', dateStr, `${items.length} items`);
  return chunks.length;
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
    };
    const chatId = String(update.message?.chat?.id ?? '');
    const text = (update.message?.text ?? '').trim();

    // c) 白名单外:不响应任何动作
    if (!chatId || chatId !== env.CHAT_ID) return new Response('ok');

    // 注册命令菜单(幂等)+ 分派命令
    if (text.startsWith('/trending')) {
      // 强制全管线(useCache=false), 保证带 OG 图——缓存命中只会回纯文本(无 photo)
      ctx.waitUntil(Promise.all([registerCommands(env.BOT_TOKEN), runDigest(env, false)]));
    } else if (text.startsWith('/help') || text === '') {
      ctx.waitUntil(Promise.all([registerCommands(env.BOT_TOKEN), sendTelegram(env.BOT_TOKEN, chatId, HELP)]));
      return new Response('ok');
    } else if (text.startsWith('/archive')) {
      const dateStr = shanghaiDate();
      ctx.waitUntil(
        sendTelegram(
          env.BOT_TOKEN,
          chatId,
          `📁 历史存档: https://github.com/gandli/daily-digest/tree/archive/archive/${dateStr.slice(0, 4)}`,
        ),
      );
      return new Response('ok');
    } else if (text.startsWith('/search')) {
      const query = text.slice('/search'.length).trim();
      if (!query) {
        ctx.waitUntil(sendTelegram(env.BOT_TOKEN, chatId, '用法: /search <关键词>\n例: /search rust cli'));
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
          ctx.waitUntil(sendTelegram(env.BOT_TOKEN, chatId, `♻️ ${repo} 今天已查询过, 存档未重复写入。`));
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
          await sendTelegram(env.BOT_TOKEN, chatId, '♻️ 该链接已完整处理过(已翻译已归档), 无需重复。');
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
