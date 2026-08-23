import type { Env, SourceItem } from './types';
import { sources } from './sources';
import { translateBatch } from './translate';
import { renderMessage, renderMarkdown, renderTelegraphNodes } from './render';
import { sendTelegram, safeEqual } from './notify';
import { archiveToGitHub, createTelegraphPage } from './archive';

// 北京时间日期串 YYYY-MM-DD(UTC+8 无 DST,直接偏移即可)
export const shanghaiDate = (): string => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

const HELP = `📊 daily-digest 使用:
/trending — 获取今日 GitHub Trending 中文摘要
每天 08:30(北京时间)自动推送一条。`;

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

  // 2. 批量翻译(内部三级回退,不抛出)
  const translated = await translateBatch(env, items);

  // 3. Telegraph 备份页(可选,失败静默)
  let telegraphUrl: string | null = null;
  if (env.TELEGRAPH_TOKEN) {
    telegraphUrl = await createTelegraphPage(env.TELEGRAPH_TOKEN, dateStr, renderTelegraphNodes(translated));
  }

  // 4. 渲染并发送
  const chunks = renderMessage(dateStr, translated, telegraphUrl ?? undefined);
  for (const c of chunks) await sendTelegram(env.BOT_TOKEN, env.CHAT_ID, c);

  // 5. 缓存 + 存档(失败不影响已发消息)
  await env.CACHE.put(cacheKey, JSON.stringify(chunks), { expirationTtl: 86400 });
  await archiveToGitHub(env, dateStr, renderMarkdown(dateStr, translated, telegraphUrl ?? undefined));
  console.log('digest sent', dateStr, `${translated.length} items`);
  return chunks.length;
}

// Telegram webhook 入口:验签 → 秒回200 → waitUntil 后台处理
export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === 'GET') {
      return new Response('daily-digest worker running\n', { headers: { 'content-type': 'text/plain' } });
    }
    if (url.pathname !== '/telegram' || req.method !== 'POST') {
      return new Response('not found', { status: 404 });
    }

    // a) 验签(常量时间比较)
    const got = req.headers.get('X-Telegram-Bot-Api-Secret-Token') ?? '';
    if (!(await safeEqual(got, env.WEBHOOK_SECRET))) {
      return new Response('forbidden', { status: 403 });
    }

    const update = (await req.json().catch(() => ({}))) as {
      message?: { chat?: { id?: number }; text?: string };
    };
    const chatId = String(update.message?.chat?.id ?? '');
    const text = (update.message?.text ?? '').trim();

    // c) 白名单外:不响应任何动作
    if (!chatId || chatId !== env.CHAT_ID) return new Response('ok');

    if (text.startsWith('/trending')) {
      ctx.waitUntil(runDigest(env, true));
    } else {
      ctx.waitUntil(sendTelegram(env.BOT_TOKEN, chatId, HELP));
    }

    // b) 立即应答,处理放后台
    return new Response('ok');
  },

  async scheduled(_event: ScheduledController, env: Env, _ctx: ExecutionContext): Promise<void> {
    await runDigest(env, false); // cron 不读缓存,保证每日新鲜抓取
  },
};
