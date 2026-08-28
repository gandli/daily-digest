// webhook 全路由回归锁: 每个命令/文本分支都经 worker.fetch 真实走过(非直接调内函数)。
// 覆盖: /preview /run /trending /product /help /archive(含翻页) /search(含无 query) /repo 链 / X 帖 / URL 三态 / scheduled。
// mock: fetchTrending / fetchTweet 可控; global fetch 只放行 TG + GitHub + Telegraph + raw; 其余 404。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchTrending } from '../src/sources/trending';

vi.mock('../src/sources/trending', () => ({ fetchTrending: vi.fn() }));
vi.mock('../src/fxtweet', () => ({
  extractTweet: (text: string) => {
    const m = text.match(/(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,20})\/status(?:es)?\/(\d{2,25})/i);
    return m ? { handle: m[1], id: m[2] } : null;
  },
  fetchTweet: vi.fn(),
  renderTweetHtml: (t: any) => `<b>@${t.author?.screen_name}</b> ${(t.text ?? '').slice(0, 20)}`,
  articleToText: () => null,
}));

import worker from '../src/index';
import { fetchTweet } from '../src/fxtweet';

type Call = { url: string; body: any };
const calls: Call[] = [];
const pending: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p); return p; } } as unknown as ExecutionContext;

const TWEET = {
  url: 'https://x.com/fe2o3/status/123',
  text: 'Hello world, check out github.com/acme/tool it is neat',
  author: { screen_name: 'fe2o3', name: 'Fe' },
  created_at: '2026-08-27T00:00:00Z',
  likes: 10, retweets: 2, replies: 3,
  media: { all: [{ type: 'photo', url: 'https://x/photo.jpg' }] },
  translation: null, article: null,
};

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes('api.telegram.org')) {
    calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }
  if (url.includes('api.telegra.ph')) return new Response(JSON.stringify({ ok: true, result: { url: 'https://telegra.ph/x-1' } }), { status: 200 });
  if (url.includes('raw.githubusercontent.com')) {
    return new Response(JSON.stringify({
      date: '2026-08-27', telegraphUrl: 'https://telegra.ph/product-2026-08-27',
      items: [{ title: 'Show HN: cool tool', url: 'https://x.dev', descZh: '这是一个中文描述内容。', author: 'fe2o3', createdAt: '2026-08-26T00:00:00Z', photo: 'https://x.dev/og.png' }],
    }), { status: 200 });
  }
  if (url.includes('api.github.com/repos')) {
    return new Response(JSON.stringify({ full_name: 'owner/repo', description: 'a rust cli tool', stargazers_count: 12, language: 'Rust', topics: ['rust'] }), { status: 200 });
  }
  if (url.includes('api.github.com')) return new Response('{}', { status: 200 });
  // 其余(raw HTML 抓取/转换链) 空 → urlToMarkdown/htmlstrip 全失败 → 落四级后错误提示
  return new Response('<html><body><p>这是一段足够长的中文正文内容用来通过 html strip 兜底链路提取纯文本超过四十个字符的边界验证</p></body></html>', { status: 200 });
}) as typeof fetch;

function memKv(extra: Array<[string, string]> = []) {
  const store = new Map<string, string>(extra);
  return {
    list: async ({ prefix }: { prefix: string }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }),
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v); },
    delete: async (k: string) => { store.delete(k); },
    get store() { return store; },
  };
}

const baseItems = [{ title: 'owner/repo', url: 'https://github.com/owner/repo', desc: 'a rust cli tool' }];
let env: any;
beforeEach(() => {
  calls.length = 0;
  pending.length = 0;
  vi.mocked(fetchTrending).mockReset();
  vi.mocked(fetchTrending).mockResolvedValue(baseItems as any);
  vi.mocked(fetchTweet).mockReset();
  vi.mocked(fetchTweet).mockResolvedValue(TWEET as any);
  env = {
    BOT_TOKEN: 'test', CHAT_ID: '944783507', WEBHOOK_SECRET: 'sec', GH_TOKEN: 'g',
    CACHE: memKv([['search:index', JSON.stringify([['star', 'owner/repo', 'https://github.com/owner/repo', 'owner repo rust cli', 'a rust cli tool']])]]),
    AI: undefined, TELEGRAPH_TOKEN: 'tg', GH_ARCHIVE_REPO: 'gandli/daily-digest', OPENROUTER_API_KEY: undefined,
  };
});

async function post(url: string, body: unknown, token = 'sec') {
  const res = await worker.fetch(new Request(url, { method: 'POST', headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': token }, body: JSON.stringify(body) }), env, ctx);
  await Promise.allSettled(pending);
  return res;
}
async function postRaw(url: string, headers: Record<string, string> = {}) {
  const res = await worker.fetch(new Request(url, { method: 'POST', headers }), env, ctx);
  await Promise.allSettled(pending);
  return res;
}
async function get(url: string) {
  const res = await worker.fetch(new Request(url, { method: 'GET' }), env, ctx);
  await Promise.allSettled(pending);
  return res;
}
const sent = () => calls.filter((c) => c.url.includes('/sendMessage'));
const photos = () => calls.filter((c) => c.url.includes('/sendPhoto'));
const allMsgs = () => sent().concat(photos());
const texts = () => allMsgs().map((m) => String(m.body.text ?? m.body.caption ?? ''));
const kbs = () => allMsgs().filter((m) => m.body.reply_markup).map((m) => m.body.reply_markup as any[]);

describe('webhook 路由全分支', () => {
  // /run 位于 GET 分支内但内部要求 POST → GET 命中 method 检查返回 405(当前可达行为)。
  it('/run GET → 405 method not allowed(内部要求 POST)', async () => {
    const res = await get('https://x/run');
    expect(res.status).toBe(405);
  });
  it('/run POST → 404(不在 /telegram 路径)', async () => {
    const res = await postRaw('https://x/run', { 'X-Runner-Token': 'sec' });
    expect(res.status).toBe(404);
  });
  it('/preview 无凭证(BOT_TOKEN 空) → 抓取+描述+渲染 JSON', async () => {
    env.BOT_TOKEN = '';
    const res = await get('https://x/preview');
    expect(res.status).toBe(200);
    const j = await res.json() as any;
    expect(j.count).toBe(1);
  });

  it('/trending → 命中缓存时秒回卡片, 不重抓', async () => {
    const dateStr = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
    await env.CACHE.put(`digest:${dateStr}`, JSON.stringify({ chunks: ['cached-card'], repos: ['a/b'] }));
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: '/trending' } });
    expect(texts().some((t) => t.includes('cached-card'))).toBe(true);
    expect(vi.mocked(fetchTrending)).not.toHaveBeenCalled();
  });
  it('/trending 无缓存 → 先发占位再发卡', async () => {
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: '/trending' } });
    expect(texts().some((t) => t.includes('Trending 生成中'))).toBe(true);
    expect(vi.mocked(fetchTrending)).toHaveBeenCalled();
  });

  it('/product → 读到 JSON → 卡片发出, 不触发 dispatch', async () => {
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: '/product' } });
    const msgs = allMsgs();
    expect(msgs.length).toBe(1);
    expect(texts().some((t) => t.includes('by fe2o3'))).toBe(true);
    expect(calls.some((c) => c.url.includes('/dispatches'))).toBe(false);
  });

  it('/help → 注册命令 + 帮助', async () => {
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: '/help' } });
    expect(calls.some((c) => c.url.includes('/setMyCommands'))).toBe(true);
    expect(texts().some((t) => t.includes('daily-digest 使用'))).toBe(true);
  });
  it('空文本 → 帮助', async () => {
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: '' } });
    expect(texts().some((t) => t.includes('daily-digest 使用'))).toBe(true);
  });

  it('/archive 首屏 → 带 inline keyboard', async () => {
    for (let i = 0; i < 15; i++) {
      const repo = `org${i}/repo${i}`;
      await env.CACHE.put(`archive:idx:${repo}`, JSON.stringify({ repo, date: `2026-08-${String(i + 1).padStart(2, '0')}`, desc: `desc ${i}` }));
    }
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: '/archive' } });
    const msg = allMsgs()[0];
    expect(msg).toBeTruthy();
    expect(msg.body.reply_markup.inline_keyboard.length).toBeGreaterThan(0);
  });
  it('/archive 指定页码', async () => {
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: '/archive 2' } });
    expect(allMsgs().length).toBe(1);
  });

  it('/search 关键词 → 命中列表 + 分页 keyboard', async () => {
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: '/search rust' } });
    const msg = allMsgs()[0];
    expect(String(msg.body.text)).toContain('owner/repo');
    expect(msg.body.reply_markup.inline_keyboard.length).toBeGreaterThan(0);
  });
  it('/search 无 query → 用法提示', async () => {
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: '/search' } });
    expect(texts().some((t) => t.includes('用法'))).toBe(true);
  });

  it('GitHub 链接(已查过) → replyArchived 回存档信息', async () => {
    const date = '2026-08-27T120000';
    await env.CACHE.put('archive:idx:owner/repo', JSON.stringify({ repo: 'owner/repo', date, descZh: 'rust cli 工具', topics: ['rust'] }));
    await env.CACHE.put('lookup:2026-08-28:owner/repo', '1');
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: 'https://github.com/owner/repo' } });
    const msgs = photos();
    expect(msgs.length).toBeGreaterThanOrEqual(1);
    expect(texts().some((t) => t.includes('今日已存档'))).toBe(true);
  });
  it('GitHub 链接(未查过) → lookupRepo 发卡', async () => {
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: 'https://github.com/owner/repo' } });
    expect(texts().some((t) => t.includes('owner/repo'))).toBe(true);
  });
  it('X 帖链接 → archiveTweet 发卡', async () => {
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: 'https://x.com/fe2o3/status/123' } });
    expect(vi.mocked(fetchTweet)).toHaveBeenCalledWith('fe2o3', '123');
    expect(texts().some((t) => t.includes('@fe2o3'))).toBe(true);
  });
  it('X 帖 FxEmbed 失败 → 落通用 URL 存档链', async () => {
    vi.mocked(fetchTweet).mockResolvedValueOnce(null as any);
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: 'https://x.com/fe2o3/status/123' } });
    // 通用链 urlToMarkdown → 走 html strip 兜底 → 有正文 → sendPhoto/文字
    expect(allMsgs().length).toBeGreaterThan(0);
  });

  it('URL 首次处理 → archiveUrl 链', async () => {
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: 'https://example.com/page' } });
    expect(allMsgs().length).toBeGreaterThan(0);
  });
  it('URL 重发判定 done(有 md stamp) → 回已处理存档链接', async () => {
    await env.CACHE.put('reproc:https://example.com/page', JSON.stringify({ translated: true, descOk: true, md: '2026-08-27T120000' }));
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: 'https://example.com/page' } });
    expect(texts().some((t) => t.includes('此前已处理归档'))).toBe(true);
  });
  it('URL 重发判定 retry(上次未翻译) → 重跑 + 提示', async () => {
    await env.CACHE.put('reproc:https://example.com/page', JSON.stringify({ translated: false, descOk: false }));
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: 'https://example.com/page' } });
    expect(texts().some((t) => t.includes('上次处理不完整'))).toBe(true);
  });

  it('未知文本 → HELP', async () => {
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: 'random gibberish' } });
    expect(texts().some((t) => t.includes('daily-digest 使用'))).toBe(true);
  });

  it('未知路径 → 404', async () => {
    const res = await postRaw('https://x/nope');
    expect(res.status).toBe(404);
  });
  it('GET 根路径 → running 提示', async () => {
    const res = await get('https://x/');
    expect(await res.text()).toContain('daily-digest worker running');
  });

  it('scheduled cron → runDigest + refresh + backfill 不崩', async () => {
    await (worker as any).scheduled({} as any, env, ctx);
    expect(allMsgs().length).toBeGreaterThanOrEqual(1);
  });
});

describe('webhook 分支补充(search 深路径 / X 帖失败 / URL 重挂)', () => {
  it('/search 命中 lookup:desc 中文缓存 → 描述用缓存(不翻译)', async () => {
    await env.CACHE.put('lookup:desc:owner/repo', JSON.stringify({ zh: '缓存里的中文描述内容', ts: Date.now() }));
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: '/search rust' } });
    const msg = allMsgs()[0];
    expect(String(msg.body.text)).toContain('缓存里的中文描述内容');
  });
  it('/search >40 条 → jump 快捷跳转行(>4 页, 页码1含 ⏮1)', async () => {
    const entries: unknown[][] = [];
    for (let i = 0; i < 45; i++) entries.push(['star', `org${i}/repo${i}`, `https://github.com/org${i}/repo${i}`, `org${i} repo${i} rust`, `desc ${i}`]);
    await env.CACHE.put('search:index', JSON.stringify(entries));
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: '/search rust' } });
    const kb = allMsgs()[0].body.reply_markup;
    expect(kb.inline_keyboard.length).toBe(2); // nav + jump
    // 翻到第 2 页(index 1): p>1 假 → 无 ⏮; 用 page 2(第 3 页)含 ⏮ 1
    const token = (kb.inline_keyboard[0][0].callback_data as string).split(':')[2];
    await post('https://x/telegram', { callback_query: { id: 'cq9', data: `sch:2:${token}`, message: { chat: { id: 944783507 }, message_id: 44 } } });
    const kb2 = calls.filter((c) => c.url.includes('/editMessageText')).at(-1)!.body.reply_markup;
    expect(JSON.stringify(kb2)).toContain('⏮ 1');
  });
  it('/search 索引损坏 → ⚠️ 搜索失败提示', async () => {
    await env.CACHE.put('search:index', 'not json {{{');
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: '/search rust' } });
    expect(texts().some((t) => t.includes('搜索失败'))).toBe(true);
  });
  it('/search 索引未初始化 → seed 提示', async () => {
    (env.CACHE as any).store.delete('search:index');
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: '/search rust' } });
    expect(texts().some((t) => t.includes('搜索索引未初始化'))).toBe(true);
  });
  it('search callback token 过期 → 编辑消息给过期提示', async () => {
    await post('https://x/telegram', { callback_query: { id: 'cq1', data: 'sch:1:expiredtoken', message: { chat: { id: 944783507 }, message_id: 42 } } });
    const edit = calls.find((c) => c.url.includes('/editMessageText'));
    expect(edit).toBeTruthy();
    expect(String(edit!.body.text)).toContain('查询过期');
    expect(calls.some((c) => c.url.includes('/answerCallbackQuery'))).toBe(true);
  });
  it('archive callback → 原地编辑 + 答回收', async () => {
    for (let i = 0; i < 15; i++) {
      const repo = `org${i}/repo${i}`;
      await env.CACHE.put(`archive:idx:${repo}`, JSON.stringify({ repo, date: `2026-08-${String(i + 1).padStart(2, '0')}`, desc: `desc ${i}` }));
    }
    await post('https://x/telegram', { callback_query: { id: 'cq2', data: 'arch:pg:1', message: { chat: { id: 944783507 }, message_id: 43 } } });
    expect(calls.some((c) => c.url.includes('/editMessageText'))).toBe(true);
    expect(calls.some((c) => c.url.includes('/answerCallbackQuery'))).toBe(true);
  });

  it('URL done 但无 md stamp(老记录) → 重新归档取回存档链接', async () => {
    await env.CACHE.put('reproc:https://example.com/page', JSON.stringify({ translated: true, descOk: true }));
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: 'https://example.com/page' } });
    expect(texts().some((t) => t.includes('重新归档取回存档链接'))).toBe(true);
  });
  it('replyArchived 索引缺失(seenToday 已置位) → 重新 lookupRepo 发卡', async () => {
    await env.CACHE.put('lookup:2026-08-28:owner/repo', '1');
    // archive:idx 缺失 → replyArchived 落 lookupRepo
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: 'https://github.com/owner/repo' } });
    expect(texts().some((t) => t.includes('owner/repo'))).toBe(true);
    expect(texts().some((t) => t.includes('今日已存档'))).toBe(false);
  });
  it('/trending 抓取失败 → ⚠️ Trending 抓取失败提示', async () => {
    vi.mocked(fetchTrending).mockRejectedValueOnce(new Error('net down'));
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: '/trending' } });
    expect(texts().some((t) => t.includes('Trending 抓取失败'))).toBe(true);
  });
  it('sendPhoto 失败 → 回落纯文字 sendMessage', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input);
      if (u.includes('api.telegram.org/sendPhoto')) return new Response('err', { status: 400 });
      if (u.includes('api.telegram.org')) {
        calls.push({ url: u, body: JSON.parse(String(init?.body ?? '{}')) });
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      return orig(input, init);
    }) as typeof fetch;
    const date = '2026-08-27T120000';
    await env.CACHE.put('archive:idx:owner/repo', JSON.stringify({ repo: 'owner/repo', date, descZh: 'rust cli 工具', topics: ['rust'] }));
    await env.CACHE.put('lookup:2026-08-28:owner/repo', '1');
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: 'https://github.com/owner/repo' } });
    expect(texts().some((t) => t.includes('今日已存档'))).toBe(true); // sendMessage 兜底送达
    globalThis.fetch = orig;
  });
});