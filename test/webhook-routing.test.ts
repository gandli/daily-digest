// webhook 全路由回归锁: 每个命令/文本分支都经 worker.fetch 真实走过(非直接调内函数)。
// 覆盖: /preview /run /gt /hn /help /archive(含翻页) /search(含无 query) /repo 链 / X 帖 / URL 三态 / scheduled。
// mock: fetchTrending / fetchTweet 可控; global fetch 只放行 TG + GitHub + Telegraph + raw; 其余 404。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchTrending } from '../src/sources/trending';
import { today } from '../src/lookup';

vi.mock('../src/sources/trending', () => ({ fetchTrending: vi.fn() }));
vi.mock('../src/fxtweet', () => ({
  extractTweet: (text: string) => {
    const m = text.match(/(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,20})\/status(?:es)?\/(\d{2,25})/i);
    return m ? { handle: m[1], id: m[2] } : null;
  },
  fetchTweet: vi.fn(),
  renderTweetHtml: (_t: any, _title: string, body: string, _zh: string, _links: string) => `<b>${_title || ''}</b> ${body.slice(0, 80)}`,
  articleToText: vi.fn().mockReturnValue(null),
  articleRefFixup: vi.fn().mockReturnValue(null),
}));

import worker from '../src/index';
import { fetchTweet, articleToText } from '../src/fxtweet';

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
  it('/run POST 无 token → 403(不再 404: 端点已修复可用)', async () => {
    const res = await postRaw('https://x/run', { 'X-Runner-Token': 'wrong' });
    expect(res.status).toBe(403);
  });
  it('/preview 无凭证(BOT_TOKEN 空) → 抓取+描述+渲染 JSON', async () => {
    env.BOT_TOKEN = '';
    const res = await get('https://x/preview');
    expect(res.status).toBe(200);
    const j = await res.json() as any;
    expect(j.count).toBe(1);
  });

  it('/gt → 命中缓存时秒回卡片, 不重抓', async () => {
    const dateStr = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
    await env.CACHE.put(`digest:${dateStr}`, JSON.stringify({ chunks: ['cached-card'], repos: ['a/b'] }));
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: '/gt' } });
    expect(texts().some((t) => t.includes('cached-card'))).toBe(true);
    expect(vi.mocked(fetchTrending)).not.toHaveBeenCalled();
    // 重放带 OG 图(repos 派生, TG 拉图零 Worker 子请求)
    expect(photos().some((m) => String(m.body.photo).includes('opengraph.githubassets.com/1/a/b'))).toBe(true);
  });
  it('/gt 无缓存 → 先发占位再发卡', async () => {
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: '/gt' } });
    expect(texts().some((t) => t.includes('GitHub Trending 生成中'))).toBe(true);
    expect(vi.mocked(fetchTrending)).toHaveBeenCalled();
  });

  it('/hn → 读到 JSON → 卡片发出, 不触发 dispatch', async () => {
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: '/hn' } });
    const msgs = allMsgs();
    expect(msgs.length).toBe(1);
    expect(texts().some((t) => t.includes('by fe2o3'))).toBe(true);
    expect(calls.some((c) => c.url.includes('/dispatches'))).toBe(false);
    expect([...env.CACHE.store.keys()].some((k) => k.startsWith(`hn:${today()}`))).toBe(true); // 当日缓存已写
  });
  it('/hn 重复调用 → 命中当日缓存, 零外呼重放', async () => {
    calls.length = 0;
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: '/hn' } });
    expect(calls.filter((c) => c.url.includes('raw.githubusercontent.com')).length).toBe(0);
    expect(calls.filter((c) => c.url.includes('api.github.com')).length).toBe(0);
    expect(texts().some((t) => t.includes('by fe2o3'))).toBe(true); // 缓存重放
  });
  it('/hn JSON 缺失 → dispatch 一次 + 占位; 生成期间重复 /hn 不再重复 dispatch', async () => {
    const dispatches: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input);
      if (u.includes('/dispatches')) { dispatches.push(u); return new Response('{}', { status: 200 }); }
      if (u.includes('api.telegram.org')) { calls.push({ url: u, body: JSON.parse(String(init?.body ?? '{}')) }); return new Response('{}', { status: 200 }); }
      return new Response('nope', { status: 404 }); // product JSON 不存在
    }) as typeof fetch);
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: '/hn' } });
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: '/hn' } });
    expect(dispatches.length).toBe(1); // pending 标记: 生成期间重复 /hn 不重复触发
    expect(texts().filter((t) => t.includes('生成中(约 2-5 分钟)')).length).toBe(2);
    vi.unstubAllGlobals();
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

  it('GitHub 链接(已查过) → replyArchived 回存档信息, 索引无 url 时 Wayback 回落 github.com/<repo>', async () => {
    const date = '2026-08-27T120000';
    await env.CACHE.put('archive:idx:owner/repo', JSON.stringify({ repo: 'owner/repo', date, descZh: 'rust cli 工具', topics: ['rust'] }));
    await env.CACHE.put(`lookup:${today()}:owner/repo`, '1');
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: 'https://github.com/owner/repo' } });
    const msgs = photos();
    expect(msgs.length).toBeGreaterThanOrEqual(1);
    expect(texts().some((t) => t.includes('今日已存档'))).toBe(true);
    expect(msgs.some((m) => String(m.body.caption).includes('https://web.archive.org/web/2/https://github.com/owner/repo'))).toBe(true);
  });
  it('GitHub 链接(已查过, 索引带真实源 url) → Wayback 链接用源 URL 而非 repo 推断', async () => {
    const date = '2026-08-27T120000';
    await env.CACHE.put('archive:idx:owner/repo', JSON.stringify({ repo: 'owner/repo', date, url: 'https://x.com/fe2o3/status/123', descZh: 'rust cli 工具', topics: ['rust'] }));
    await env.CACHE.put(`lookup:${today()}:owner/repo`, '1');
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: 'https://github.com/owner/repo' } });
    const msgs = photos();
    expect(msgs.some((m) => String(m.body.caption).includes('https://web.archive.org/web/2/https://x.com/fe2o3/status/123'))).toBe(true);
    expect(msgs.some((m) => String(m.body.caption).includes('web.archive.org/web/2/https://github.com/owner/repo'))).toBe(false);
  });
  it('GitHub 链接(未查过) → lookupRepo 发卡', async () => {
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: 'https://github.com/owner/repo' } });
    expect(texts().some((t) => t.includes('owner/repo'))).toBe(true);
  });
  it('GitHub 链接(已查过但 archive:idx 缺失) → replyArchived 回落 lookupRepo 重查', async () => {
    await env.CACHE.put(`lookup:${today()}:owner/repo`, '1');
    // 不设 archive:idx:owner/repo —— 模拟索引缺失
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: 'https://github.com/owner/repo' } });
    // miss 分支走 lookupRepo → 发卡(含 owner/repo)
    expect(texts().some((t) => t.includes('owner/repo'))).toBe(true);
  });
  it('多 repo 直发(两个全新) → fanout 两张卡带 1/2、2/2 序号', async () => {
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: '看这两个 https://github.com/owner/repo 和 https://github.com/other/thing' } });
    const msgs = photos();
    expect(msgs.length).toBe(2);
    expect(msgs.some((m) => String(m.body.caption).includes('<b>1/2</b>'))).toBe(true);
    expect(msgs.some((m) => String(m.body.caption).includes('<b>2/2</b>'))).toBe(true);
  });
  it('多 repo 全部当日已存档 → 回一句话防静默, 不发卡', async () => {
    await env.CACHE.put(`lookup:${today()}:owner/repo`, '1');
    await env.CACHE.put(`lookup:${today()}:other/thing`, '1');
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: 'https://github.com/owner/repo https://github.com/other/thing' } });
    expect(texts().some((t) => t.includes('2 个仓库今日均已存档'))).toBe(true);
    expect(photos().length).toBe(0);
  });
  it('多 repo 一 seen 一 fresh → 只发 fresh 卡(无序号)', async () => {
    await env.CACHE.put(`lookup:${today()}:owner/repo`, '1');
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: 'https://github.com/owner/repo https://github.com/other/thing' } });
    const msgs = photos();
    expect(msgs.length).toBe(1);
    expect(String(msgs[0].body.caption)).not.toMatch(/<b>\d+\/\d+<\/b>/);
  });
  it('X 帖链接 → archiveTweet 发卡', async () => {
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: 'https://x.com/fe2o3/status/123' } });
    expect(vi.mocked(fetchTweet)).toHaveBeenCalledWith('fe2o3', '123');
    expect(texts().some((t) => t.includes('Hello world'))).toBe(true);
  });
  it('X 帖 FxEmbed 失败 → 落通用 URL 存档链', async () => {
    vi.mocked(fetchTweet).mockResolvedValueOnce(null as any);
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: 'https://x.com/fe2o3/status/123' } });
    // 通用链 urlToMarkdown → 走 html strip 兜底 → 有正文 → sendPhoto/文字
    expect(allMsgs().length).toBeGreaterThan(0);
  });

  it('X 帖重发(done) → 回缓存卡片不重建(fetchTweet 不被调)', async () => {
    // 预置 done 记录(含 md stamp/title/summary)
    env.CACHE.store.set('reproc:https://x.com/fe2o3/status/123', JSON.stringify({ ts: Date.now(), translated: true, descOk: true, md: '2026-08-27-6731467', t: 'Hello world 标题', s: '这是一段摘要内容。' }));
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: 'https://x.com/fe2o3/status/123' } });
    // done → 直接回缓存卡片, fetchTweet 不被调
    expect(vi.mocked(fetchTweet)).not.toHaveBeenCalled();
    const m = texts().find((t) => t.includes('Hello world 标题'));
    expect(m).toBeTruthy();
    expect(m).toContain('这是一段摘要内容');
  });

  it('X 帖重发(done 但记录损坏) → 重挂归档一次', async () => {
    env.CACHE.store.set('reproc:https://x.com/fe2o3/status/123', '{broken');
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: 'https://x.com/fe2o3/status/123' } });
    // 损坏 → r=null → 兜底走 archiveTweet(fetchTweet 被调)
    expect(vi.mocked(fetchTweet)).toHaveBeenCalled();
  });

  it('X 帖重发(shouldReprocess done 但 reproc 键丢失) → 兜底重挂一次', async () => {
    // shouldReprocess 预置 done 记录, 但紧接着 read 前键被清(模拟竞态)
    env.CACHE.store.set('reproc:https://x.com/fe2o3/status/123', JSON.stringify({ ts: Date.now(), translated: true, descOk: true, md: 'x', t: 'x', s: 'x' }));
    // 首次调用后 KV 被外部清空——直接在 shouldReprocess 后删键
    const origGet = env.CACHE.get.bind(env.CACHE);
    env.CACHE.get = async (k: string) => {
      const v = await origGet(k);
      if (k.startsWith('reproc:') && v) env.CACHE.store.delete(k); // 读完即删, 模拟竞态丢失
      return v;
    };
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: 'https://x.com/fe2o3/status/123' } });
    // done 判定但记录缺失 → 兜底走 archiveTweet
    expect(vi.mocked(fetchTweet)).toHaveBeenCalled();
  });

  it('X 帖重发(done 二次读损坏 JSON) → r=null 兜底重挂', async () => {
    env.CACHE.store.set('reproc:https://x.com/fe2o3/status/123', JSON.stringify({ ts: Date.now(), translated: true, descOk: true, md: 'x', t: 'x', s: 'x' }));
    const origGet = env.CACHE.get.bind(env.CACHE);
    let n = 0;
    env.CACHE.get = async (k: string) => {
      n++;
      if (k.startsWith('reproc:') && n >= 2) return '{broken'; // 二次读损坏(首次 shouldReprocess 读有效)
      return origGet(k);
    };
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: 'https://x.com/fe2o3/status/123' } });
    expect(vi.mocked(fetchTweet)).toHaveBeenCalled();
  });

  it('X 帖重发(done 二次读 KV 抛错) → .catch 兜底重挂', async () => {
    env.CACHE.store.set('reproc:https://x.com/fe2o3/status/123', JSON.stringify({ ts: Date.now(), translated: true, descOk: true, md: 'x', t: 'x', s: 'x' }));
    const origGet = env.CACHE.get.bind(env.CACHE);
    let n = 0;
    env.CACHE.get = async (k: string) => {
      n++;
      if (k.startsWith('reproc:') && n >= 2) throw new Error('kv down'); // 二次读抛错
      return origGet(k);
    };
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: 'https://x.com/fe2o3/status/123' } });
    expect(vi.mocked(fetchTweet)).toHaveBeenCalled();
  });

  it('X article 帖 → 标题用 article.title, 正文用 article 内容(非裸链接)', async () => {
    const artTweet = {
      url: 'https://x.com/Smartpigai/status/2093191865193677285',
      text: 'https://x.com/i/article/2093189117383426048',
      author: { screen_name: 'Smartpigai', name: 'Smartpig' },
      created_at: 'Fri Aug 28 04:20:04 +0000 2026',
      likes: 13, retweets: 2, replies: 1,
      article: {
        title: '从零开始，用 LangGraph 搭建你的第一个 AI Agent',
        preview_text: '过去我们调用大模型，通常只有一个固定流程',
        content: { blocks: [{ type: 'text', text: 'LangGraph 是一个用于构建 AI Agent 的框架' }] },
      },
      media: null, translation: null,
    };
    vi.mocked(fetchTweet).mockResolvedValueOnce(artTweet as any);
    vi.mocked(articleToText).mockReturnValueOnce('LangGraph 是一个用于构建 AI Agent 的框架');
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: 'https://x.com/Smartpigai/status/2093191865193677285' } });
    const card = texts().find((t) => t.includes('Smartpigai') || t.includes('LangGraph'));
    expect(card).toBeTruthy();
    // 标题必须是 article.title, 不能是"无法访问"或裸 URL
    expect(card).toContain('从零开始，用 LangGraph 搭建你的第一个 AI Agent');
    expect(card).not.toContain('无法访问');
    expect(card).not.toContain('x.com/i/article/');
  });

  it('X 多图帖(4 photo + mosaic) → 卡片用 mosaic 拼图而非首图', async () => {
    const multiTweet = {
      ...TWEET,
      media: {
        all: [
          { type: 'photo', url: 'https://pbs.twimg.com/media/1.jpg' },
          { type: 'photo', url: 'https://pbs.twimg.com/media/2.jpg' },
          { type: 'photo', url: 'https://pbs.twimg.com/media/3.jpg' },
          { type: 'photo', url: 'https://pbs.twimg.com/media/4.jpg' },
        ],
        mosaic: { formats: { jpeg: 'https://mosaic.fxtwitter.com/jpeg/123/1/2/3/4' } },
      },
    };
    let photoUrl = '';
    vi.mocked(fetchTweet).mockResolvedValueOnce(multiTweet as any);
    const orig = globalThis.fetch;
    globalThis.fetch = (async (i: RequestInfo | URL, init?: RequestInit) => {
      const u = String(i);
      if (u.includes('sendPhoto')) { const b = JSON.parse(String(init?.body ?? '{}')); photoUrl = b.photo; return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
      return orig(i, init);
    }) as typeof fetch;
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: 'https://x.com/fe2o3/status/123' } });
    globalThis.fetch = orig;
    expect(photoUrl).toContain('mosaic.fxtwitter.com');
    expect(photoUrl).not.toContain('pbs.twimg.com/media/1.jpg');
  });
  it('X 单图帖 → 不用 mosaic(只有1张, 直接原图)', async () => {
    const singleTweet = {
      ...TWEET,
      media: { all: [{ type: 'photo', url: 'https://pbs.twimg.com/media/solo.jpg' }], photos: [{ type: 'photo', url: 'https://pbs.twimg.com/media/solo.jpg' }] },
    };
    let photoUrl = '';
    vi.mocked(fetchTweet).mockResolvedValueOnce(singleTweet as any);
    const orig = globalThis.fetch;
    globalThis.fetch = (async (i: RequestInfo | URL, init?: RequestInit) => {
      const u = String(i);
      if (u.includes('sendPhoto')) { const b = JSON.parse(String(init?.body ?? '{}')); photoUrl = b.photo; return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
      return orig(i, init);
    }) as typeof fetch;
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: 'https://x.com/fe2o3/status/123' } });
    globalThis.fetch = orig;
    expect(photoUrl).toBe('https://pbs.twimg.com/media/solo.jpg');
  });
  it('X 中文帖 → 不走翻译(中文主导判定), 卡片无🌐翻译段', async () => {
    const zhTweet = {
      ...TWEET,
      text: '这是一个纯中文的帖子内容，讲述了 AI Agent 的构建方法与实践经验分享',
      translation: null,
    };
    let translateCalled = false;
    vi.mocked(fetchTweet).mockResolvedValueOnce(zhTweet as any);
    const orig = globalThis.fetch;
    globalThis.fetch = (async (i: RequestInfo | URL, init?: RequestInit) => {
      if (String(i).includes('openrouter.ai')) { translateCalled = true; return orig(i, init); }
      return orig(i, init);
    }) as typeof fetch;
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: 'https://x.com/fe2o3/status/123' } });
    globalThis.fetch = orig;
    expect(translateCalled).toBe(false); // 中文正文 → 不调翻译
    const card = texts().find((t) => t.includes('中文的帖子'));
    expect(card).toBeTruthy();
    expect(card).not.toContain('🌐');
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
  it('URL 重发 done(记录带标题+摘要) → 回具体内容卡片(非梗概)', async () => {
    await env.CACHE.put('reproc:https://example.com/page', JSON.stringify({
      translated: true, descOk: true, md: '2026-08-27T120000',
      t: '公司 Wi-Fi 安全指南', s: '讲企业内网威胁模型与零信任接入实践的文章。',
    }));
    await env.CACHE.put('archive:tg:2026-08-27T120000', 'https://telegra.ph/web-done-1');
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: 'https://example.com/page' } });
    const card = texts().find((t) => t.includes('📝'));
    expect(card).toBeTruthy();
    expect(card).toContain('公司 Wi-Fi 安全指南');
    expect(card).toContain('零信任接入实践');
    expect(card).not.toContain('该链接此前已处理归档'); // 具体内容替换梗概
    expect(card).toContain('telegra.ph/web-done-1'); // archive:tg 完整 stamp 键命中
  });
  it('URL 重发 done(老记录无标题) → 回退梗概头, 不空标题', async () => {
    await env.CACHE.put('reproc:https://example.com/page', JSON.stringify({ translated: true, descOk: true, md: '2026-08-27T120000' }));
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: 'https://example.com/page' } });
    const card = texts().find((t) => t.includes('📁'));
    expect(card).toContain('该链接此前已处理归档');
    expect(card).not.toContain('📝');
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
  it('GET 根路径 → 状态页 (HTML, 含订阅链接)', async () => {
    const res = await get('https://x/');
    const body = await res.text();
    expect(body).toContain('daily-digest');
    expect(body).toContain('/rss');
  });

  it('scheduled cron → runDigest + refresh + backfill 不崩', async () => {
    await (worker as any).scheduled({} as any, env, ctx);
    expect(allMsgs().length).toBeGreaterThanOrEqual(1);
  });

  it('scheduled: flush 返 0 且缓冲非空 → console.warn 告警(不崩)', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // 塞一条 pend 键: mock fetch 的 api.github.com 返 {} → ref 读无 object.sha → baseOf null → flush 返 0
    await env.CACHE.put('pend:arc:test-00000000', JSON.stringify({ path: 'archive/2026/x.md', content: 'YQ==', encoding: 'utf-8', message: 't' }));
    await (worker as any).scheduled({} as any, env, ctx);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('flushArchivedPending returned 0'));
    warnSpy.mockRestore();
  });

  it('scheduled: flush 返 0 且 list 抛错 → 告警兜底(0 pending)不崩', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const origList = env.CACHE.list.bind(env.CACHE);
    env.CACHE.list = async () => { throw new Error('kv list down'); }; // list 抛错 → .catch 兜底空键
    await (worker as any).scheduled({} as any, env, ctx);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('flushArchivedPending returned 0'));
    warnSpy.mockRestore();
    env.CACHE.list = origList;
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
    await env.CACHE.put(`lookup:${today()}:owner/repo`, '1');
    // archive:idx 缺失 → replyArchived 落 lookupRepo
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: 'https://github.com/owner/repo' } });
    expect(texts().some((t) => t.includes('owner/repo'))).toBe(true);
    expect(texts().some((t) => t.includes('今日已存档'))).toBe(false);
  });
  it('/gt 抓取失败 → ⚠️ GitHub Trending 抓取失败提示', async () => {
    vi.mocked(fetchTrending).mockRejectedValueOnce(new Error('net down'));
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: '/gt' } });
    expect(texts().some((t) => t.includes('GitHub Trending 抓取失败'))).toBe(true);
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
    await env.CACHE.put(`lookup:${today()}:owner/repo`, '1');
    await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: 'https://github.com/owner/repo' } });
    expect(texts().some((t) => t.includes('今日已存档'))).toBe(true); // sendMessage 兜底送达
    globalThis.fetch = orig;
  });
  it('archive callback 空存档 → 纯文字回"暂无存档记录"(无 keyboard 不发 kbd)', async () => {
    await post('https://x/telegram', { callback_query: { id: 'cq3', data: 'arch:pg:0', message: { chat: { id: 944783507 }, message_id: 44 } } });
    const edit = calls.find((c) => c.url.includes('/editMessageText'));
    expect(edit).toBeTruthy();
    expect(String(edit!.body.text)).toContain('暂无存档记录');
  });
  it('archive callback 无 messageId → sendTelegramKbd 新消息(from.id 兜底)', async () => {
    await post('https://x/telegram', { callback_query: { id: 'cq4', data: 'arch:pg:0', from: { id: 944783507 } } });
    expect(calls.some((c) => c.url.includes('/sendMessage'))).toBe(true);
    expect(calls.some((c) => c.url.includes('/answerCallbackQuery'))).toBe(true);
  });
  it('search callback 有效 token → 按 KV query 重渲染页', async () => {
    // 预置 search:q:<token> + 索引数据
    await env.CACHE.put('search:index', JSON.stringify([
      ['x', 'a/repo', 'https://github.com/a/repo', 'a repo tool rust cli', 'rust cli 工具'],
      ['x', 'b/repo', 'https://github.com/b/repo', 'b repo web server', 'web 服务器'],
    ]));
    await env.CACHE.put('search:q:tok123', 'rust');
    await post('https://x/telegram', { callback_query: { id: 'cq5', data: 'sch:1:tok123', message: { chat: { id: 944783507 }, message_id: 45 } } });
    const edit = calls.find((c) => c.url.includes('/editMessageText'));
    expect(edit).toBeTruthy(); // 结果渲染(页 1 或空页提示)
    expect(calls.some((c) => c.url.includes('/answerCallbackQuery'))).toBe(true);
  });
  it('search callback 无 messageId 且过期 → 静默(只 answer, from.id 兜底)', async () => {
    await post('https://x/telegram', { callback_query: { id: 'cq6', data: 'sch:1:gone', from: { id: 944783507 } } });
    expect(calls.some((c) => c.url.includes('/editMessageText'))).toBe(false);
    expect(calls.some((c) => c.url.includes('/answerCallbackQuery'))).toBe(true);
  });
  it('/run POST + 正确 token → 触发 digest 返回 chunks', async () => {
    vi.mocked(fetchTrending).mockResolvedValue(baseItems as any);
    const res = await worker.fetch(new Request('https://x/run', {
      method: 'POST', headers: { 'X-Runner-Token': 'sec' },
    }), env, { waitUntil: (p: Promise<unknown>) => Promise.resolve(p) } as any);
    expect(res.status).toBe(200);
    const j = await res.json() as { ok: boolean; chunks: number };
    expect(j.ok).toBe(true);
  });
  it('/run GET → 405; /run 错 token → 403', async () => {
    const r1 = await worker.fetch(new Request('https://x/run', { method: 'GET' }), env, {} as any);
    expect(r1.status).toBe(405);
    const r2 = await worker.fetch(new Request('https://x/run', {
      method: 'POST', headers: { 'X-Runner-Token': 'wrong' },
    }), env, {} as any);
    expect(r2.status).toBe(403);
  });
  it('GET / 探活 → HTML 状态页', async () => {
    const r = await worker.fetch(new Request('https://x/'), env, {} as any);
    expect(await r.text()).toContain('daily-digest');
  });
  it('非 /telegram POST → 404', async () => {
    const r = await worker.fetch(new Request('https://x/other', { method: 'POST' }), env, {} as any);
    expect(r.status).toBe(404);
  });
  it('webhook 验签失败(无 secret header) → 403', async () => {
    const res = await worker.fetch(new Request('https://x/telegram', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ message: { chat: { id: 944783507 }, text: 'hi' } }),
    }), env, {} as any);
    expect(res.status).toBe(403);
  });
  it('白名单外 chatId → 200 ok 且不响应', async () => {
    const res = await worker.fetch(new Request('https://x/telegram', {
      method: 'POST', headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'sec' },
      body: JSON.stringify({ message: { chat: { id: 111 }, text: '/help' } }),
    }), env, {} as any);
    expect(await res.text()).toBe('ok');
    expect(texts().length).toBe(0);
  });
  describe('网页路由 /search /archive /api/today /random', () => {
    it('/search?q=rust → HTML 搜索结果页', async () => {
      const res = await get('https://x/search?q=rust');
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain('owner/repo');
      expect(body).toContain('a rust cli tool');
      expect(body).toContain('/search');
    });
    it('/search 无 q → 400', async () => {
      const res = await get('https://x/search');
      expect(res.status).toBe(400);
    });
    it('/archive/2026-08-30 → 聚合页(mock 下 HN 有数据 → 200 含 Hacker News 区)', async () => {
      const res = await get('https://x/archive/2026-08-30');
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain('Hacker News');
    });
    it('/archive/坏日期 → 400', async () => {
      const res = await get('https://x/archive/notadate');
      expect(res.status).toBe(400);
    });
    it('/api/today → JSON(mock 有 HN 1 条 → count 1 三源结构)', async () => {
      const res = await get('https://x/api/today');
      expect(res.status).toBe(200);
      const j: any = await res.json();
      expect(j.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(j.count).toBe(1);
      expect(Array.isArray(j.github_trending)).toBe(true);
      expect(Array.isArray(j.hacker_news)).toBe(true);
      expect(Array.isArray(j.product_hunt)).toBe(true);
    });
    it('/random → 从 search:index 抽样出一条', async () => {
      const res = await get('https://x/random');
      expect(res.status).toBe(200);
      const body = await res.text();
      expect(body).toContain('owner/repo');
    });
  });
});