// 覆盖缺口补测(index.ts 管线/回调 catch 分支 + lookup.ts 管线 + ph.ts 无 token 分支)。
// mock 风格对齐 webhook-routing.test.ts: worker.fetch + global fetch stub + 内存 KV。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchTrending } from '../src/sources/trending';
import {
  today, fanoutRepoRefs, lookupRepo, refreshLookupDescriptions,
  backfillDescriptions, archiveUrl,
} from '../src/lookup';
import { runProductHunt, fetchProductHunt } from '../src/ph';

vi.mock('../src/sources/trending', () => ({ fetchTrending: vi.fn() }));
vi.mock('../src/fxtweet', () => ({
  extractTweet: (text: string) => {
    const m = text.match(/(?:https?:\/\/)?(?:www\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,20})\/status(?:es)?\/(\d{2,25})/i);
    return m ? { handle: m[1], id: m[2] } : null;
  },
  fetchTweet: vi.fn(),
  renderTweetHtml: (_t: any, title: string, body: string, _zh: string, links: string) => `<b>${title || ''}</b> ${body.slice(0, 80)} ${links}`,
  articleToText: vi.fn().mockReturnValue(null),
  articleRefFixup: vi.fn().mockReturnValue(null),
}));

import worker from '../src/index';
import { fetchTweet, articleRefFixup } from '../src/fxtweet';

// ---------------------------------------------------------------------------
// 基础设施: 内存 KV(可注入故障) + 可控 fetch stub
// ---------------------------------------------------------------------------

type Call = { url: string; body: any };
const tg: Call[] = [];
const aux: Call[] = []; // telegraph / openrouter 等非 TG 捕获
const pending: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p); return p; } } as unknown as ExecutionContext;

function mkKv(extra: Array<[string, string]> = [], o: {
  failGet?: (k: string) => boolean;
  nullGet?: (k: string) => boolean; // 键在 store 但读为 null(幽灵条目)
  failPut?: (k: string) => boolean;
  failList?: (prefix: string) => boolean;
  peekGet?: (k: string, v: string) => string | undefined; // 有状态读值改写
} = {}) {
  const store = new Map<string, string>(extra);
  return {
    store,
    list: async ({ prefix, cursor }: { prefix: string; cursor?: string }) => {
      if (o.failList?.(prefix)) throw new Error('kv list failed');
      const all = [...store.keys()].filter((k) => k.startsWith(prefix)).sort().map((name) => ({ name }));
      const start = cursor ? Number(cursor) : 0;
      const page = all.slice(start, start + 3); // 每页 3 条 → listAll 翻页分支真实走到
      const next = start + page.length;
      return next < all.length
        ? { keys: page, list_complete: false, cursor: String(next) }
        : { keys: page, list_complete: true };
    },
    get: async (k: string) => {
      if (o.failGet?.(k)) throw new Error('kv get failed: ' + k);
      if (o.nullGet?.(k)) return null;
      const v = store.get(k);
      if (v === undefined) return o.peekGet?.(k, '') ?? null;
      return o.peekGet?.(k, v) ?? v;
    },
    put: async (k: string, v: string) => {
      if (o.failPut?.(k)) throw new Error('kv put failed: ' + k);
      store.set(k, v);
    },
    delete: async (k: string) => { store.delete(k); },
  };
}

// openrouter 固定中文输出(标题/翻译/摘要/标签共用, 各自校验都能过)
let openrouterContent = '覆盖测试中文标题输出';

function installFetch(o: {
  throwFor?: RegExp[];
  raw?: (u: string, init?: RequestInit) => Response | undefined;
  telegraphOk?: boolean;
} = {}) {
  const { throwFor = [], raw, telegraphOk = true } = o;
  tg.length = 0; aux.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input);
    for (const re of throwFor) if (re.test(u)) throw new Error('net down ' + u.slice(0, 60));
    const custom = raw?.(u, init);
    if (custom) return custom;
    if (u.includes('api.telegram.org')) {
      tg.push({ url: u, body: JSON.parse(String(init?.body ?? '{}')) });
      return new Response(JSON.stringify({ ok: true, result: { photo: [{ file_id: 'fid123' }] } }), { status: 200 });
    }
    if (u.includes('api.telegra.ph')) {
      aux.push({ url: u, body: JSON.parse(String(init?.body ?? '{}')) });
      return new Response(JSON.stringify({ ok: telegraphOk, result: { url: 'https://telegra.ph/gap-1', access_token: 'anon-tok' } }), { status: 200 });
    }
    if (u.includes('openrouter.ai')) {
      aux.push({ url: u, body: JSON.parse(String(init?.body ?? '{}')) });
      return new Response(JSON.stringify({ choices: [{ message: { content: openrouterContent } }] }), { status: 200 });
    }
    if (u.includes('transmart.qq.com')) {
      return new Response(JSON.stringify({ auto_translation: ['这是转译出来的中文描述内容'], header: { ret_code: 'succ' } }), { status: 200 });
    }
    if (u.includes('markdown.new/')) {
      return new Response(JSON.stringify({ success: true, content: '# 引用文章标题\n\n' + 'This is a fairly long english article body used for coverage testing of the reference extraction chain. '.repeat(3) }), { status: 200 });
    }
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
}

const TWEET = {
  url: 'https://x.com/fe2o3/status/123',
  text: 'Hello world, check out github.com/acme/tool it is neat',
  author: { screen_name: 'fe2o3', name: 'Fe' },
  created_at: '2026-08-27T00:00:00Z',
  likes: 10, retweets: 2, replies: 3,
  media: { all: [{ type: 'photo', url: 'https://x/photo.jpg' }] },
  translation: null, article: null,
};

const baseItems = [
  { title: 'owner/repo', url: 'https://github.com/owner/repo', desc: 'a rust cli tool' },
  { title: 'other/thing', url: 'https://github.com/other/thing', desc: 'a web server' },
];

let env: any;
beforeEach(() => {
  pending.length = 0;
  openrouterContent = '覆盖测试中文标题输出';
  vi.mocked(fetchTrending).mockReset();
  vi.mocked(fetchTrending).mockResolvedValue(baseItems as any);
  vi.mocked(fetchTweet).mockReset();
  vi.mocked(fetchTweet).mockResolvedValue(TWEET as any);
  vi.mocked(articleRefFixup).mockReset();
  vi.mocked(articleRefFixup).mockReturnValue(null as any);
  installFetch();
  env = {
    BOT_TOKEN: 'test', CHAT_ID: '944783507', WEBHOOK_SECRET: 'sec', GH_TOKEN: 'g',
    CACHE: mkKv([['search:index', JSON.stringify([['star', 'owner/repo', 'https://github.com/owner/repo', 'owner repo rust cli', 'a rust cli tool']])]]),
    AI: undefined, TELEGRAPH_TOKEN: 'tg', GH_ARCHIVE_REPO: 'gandli/daily-digest', OPENROUTER_API_KEY: undefined,
  };
});

async function post(update: unknown, e = env) {
  const res = await worker.fetch(new Request('https://x/telegram', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'sec' },
    body: JSON.stringify(update),
  }), e, ctx);
  await Promise.allSettled(pending);
  await Promise.allSettled(pending); // 二次清空: 内层 waitUntil(runProductThin→fanout) 在首次快照后追加
  return res;
}
const sent = () => tg.filter((c) => c.url.includes('/sendMessage'));
const photos = () => tg.filter((c) => c.url.includes('/sendPhoto'));
const texts = () => [...sent(), ...photos()].map((m) => String(m.body.text ?? m.body.caption ?? ''));

// deepwiki RSC payload 页(Overview 英文)
const DW_HTML = 'self.__next_f.push([1,' + JSON.stringify(
  'Overview:Repo\n<details><summary>Relevant source files</summary><p>x</p></details>\n\n## Purpose and Scope\n\nThis project is a comprehensive sample repository used for verifying coverage of the description chain.\n\nSome trailing section.\n',
) + '])';

const PH_FEED = `<?xml version="1.0"?><feed>
  <entry><title>PH Product One</title><link rel="alternate" href="https://www.producthunt.com/products/one"/><content type="html">&lt;p&gt;Doc tool for teams&lt;/p&gt;&lt;p&gt;&lt;a href="x"&gt;Discussion&lt;/a&gt; | &lt;a href="y"&gt;Link&lt;/a&gt;&lt;/p&gt;</content><author><name>Anusha</name></author></entry>
  <entry><title>PH Product Two</title><link rel="alternate" href="https://www.producthunt.com/products/two"/><content type="html">&lt;p&gt;DeFi app&lt;/p&gt;</content><author><name>Bob</name></author></entry>
</feed>`;

// ---------------------------------------------------------------------------
// index.ts: webhook 分支补齐
// ---------------------------------------------------------------------------
describe('index webhook: help / preview / 缓存重放', () => {
  it('/help 文本含 /gt、/hn、/ph 三行命令说明', async () => {
    await post({ message: { chat: { id: 944783507 }, text: '/help' } });
    const help = texts().find((t) => t.includes('daily-digest 使用'));
    expect(help).toContain('/gt');
    expect(help).toContain('/hn');
    expect(help).toContain('/ph');
    expect(help).toContain('/search 关键词');
    expect(help).toContain('/archive');
  });

  it('/preview 无 GH_ARCHIVE_REPO → 自检 JSON 仍出(默认仓回落)', async () => {
    env.BOT_TOKEN = '';
    delete env.GH_ARCHIVE_REPO;
    const res = await worker.fetch(new Request('https://x/preview', { method: 'GET' }), env, ctx);
    expect(res.status).toBe(200);
    const j = await res.json() as any;
    expect(j.count).toBe(2);
  });

  it('digest 缓存为旧格式字符串数组 → 纯文字重放', async () => {
    const dateStr = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
    await env.CACHE.put(`digest:${dateStr}`, JSON.stringify(['<b>旧格式卡</b>']));
    await post({ message: { chat: { id: 944783507 }, text: '/gt' } });
    expect(texts().some((t) => t.includes('旧格式卡'))).toBe(true);
    expect(vi.mocked(fetchTrending)).not.toHaveBeenCalled();
  });

  it('digest 缓存坏 JSON → catch 吞掉按命中返回, 不重抓不崩', async () => {
    const dateStr = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
    await env.CACHE.put(`digest:${dateStr}`, '{bad json');
    await post({ message: { chat: { id: 944783507 }, text: '/gt' } });
    expect(vi.mocked(fetchTrending)).not.toHaveBeenCalled(); // 当前行为: 坏缓存吞掉后仍 return 0
  });

  it('/gt KV get 抛错 → 仍发占位并重抓(读取故障不阻塞)', async () => {
    env.CACHE = mkKv([], { failGet: (k) => k.startsWith('digest:') });
    await post({ message: { chat: { id: 944783507 }, text: '/gt' } });
    expect(texts().some((t) => t.includes('GitHub Trending 生成中'))).toBe(true); // 占位先出(管线 reject 由 waitUntil 吞掉)
  });
});

describe('index webhook: /run + cron 全管线(topics/Telegraph 兜底)', () => {
  it('/run POST 正确 token + cache=0 → 全新抓取, topics/作者/日期上卡, 返回 chunks', async () => {
    env.TELEGRAPH_TOKEN = undefined; // → createTelegraphAccount 匿名兜底
    env.GH_ARCHIVE_REPO = undefined; // → 默认仓回落分支
    env.OPENROUTER_API_KEY = 'sk';
    installFetch({
      raw: (u) => {
        if (u.includes('api.github.com/repos/owner/repo')) {
          return new Response(JSON.stringify({ topics: ['rust', 'cli'], created_at: '2024-01-01T00:00:00Z', owner: { login: 'owner' } }), { status: 200 });
        }
        return undefined;
      },
    });
    const res = await worker.fetch(new Request('https://x/run?cache=0', {
      method: 'POST', headers: { 'X-Runner-Token': 'sec' },
    }), env, { waitUntil: (p: Promise<unknown>) => Promise.resolve(p) } as any);
    expect(res.status).toBe(200);
    const j = await res.json() as { ok: boolean; chunks: number };
    expect(j.ok).toBe(true);
    expect(j.chunks).toBeGreaterThanOrEqual(1);
    expect(vi.mocked(fetchTrending)).toHaveBeenCalled();
    // createAccount 兜底命中(TELEGRAPH_TOKEN 缺失)
    expect(aux.some((c) => c.url.includes('createAccount'))).toBe(true);
    expect(aux.some((c) => c.url.includes('createPage'))).toBe(true);
    // topics API 命中 repo → 卡片带标签/作者/创建日期
    const cap = texts().find((t) => t.includes('owner/repo'));
    expect(cap).toContain('#rust #cli');
    expect(cap).toContain('👤 owner');
    expect(cap).toContain('📅 2024-01-01');
  });

  it('topics API: 一 ok 无 topics / 一 500 → 两分支都走, 不崩', async () => {
    installFetch({
      raw: (u) => {
        if (u.includes('api.github.com/repos/owner/repo')) return new Response('{}', { status: 200 }); // 无 topics/owner
        if (u.includes('api.github.com/repos/other/thing')) return new Response('nope', { status: 500 }); // !ok → return
        return undefined;
      },
    });
    const res = await worker.fetch(new Request('https://x/run?cache=0', {
      method: 'POST', headers: { 'X-Runner-Token': 'sec' },
    }), env, { waitUntil: (p: Promise<unknown>) => Promise.resolve(p) } as any);
    const j = await res.json() as { chunks: number };
    expect(j.chunks).toBeGreaterThanOrEqual(1);
  });
});

describe('index webhook: callback catch/finally 与缺字段', () => {
  it('archive callback: 渲染抛错(KV list 故障) → answerCallbackQuery 仍在 finally 被调用', async () => {
    env.CACHE = mkKv([], { failList: (p) => p === 'archive:idx:' });
    await post({ callback_query: { id: 'cqE1', data: 'arch:pg:0', message: { chat: { id: 944783507 }, message_id: 41 } } });
    expect(tg.some((c) => c.url.includes('/answerCallbackQuery'))).toBe(true);
    expect(tg.some((c) => c.url.includes('/editMessageText'))).toBe(false);
  });

  it('search callback: 处理抛错(KV get 故障) → answerCallbackQuery 仍被调用', async () => {
    env.CACHE = mkKv([], { failGet: (k) => k.startsWith('search:q:') });
    await post({ callback_query: { id: 'cqE2', data: 'sch:1:tok', message: { chat: { id: 944783507 }, message_id: 42 } } });
    expect(tg.some((c) => c.url.includes('/answerCallbackQuery'))).toBe(true);
  });

  it('archive callback 无 messageId 但有数据 → sendTelegramKbd 新消息', async () => {
    await env.CACHE.put('archive:idx:owner/repo', JSON.stringify({ repo: 'owner/repo', date: '2026-08-27', descZh: 'rust cli 工具' }));
    await post({ callback_query: { id: 'cqE3', data: 'arch:pg:0', from: { id: 944783507 } } });
    const msg = sent().at(-1);
    expect(msg?.body.reply_markup?.inline_keyboard?.length).toBeGreaterThan(0);
    expect(tg.some((c) => c.url.includes('/answerCallbackQuery'))).toBe(true);
  });

  it('callback 无 id → 不调 answerCallbackQuery(仍正常处理)', async () => {
    await env.CACHE.put('archive:idx:owner/repo', JSON.stringify({ repo: 'owner/repo', date: '2026-08-27', descZh: 'rust cli 工具' }));
    await post({ callback_query: { data: 'arch:pg:0', message: { chat: { id: 944783507 }, message_id: 43 } } });
    expect(tg.some((c) => c.url.includes('/editMessageText'))).toBe(true);
    expect(tg.some((c) => c.url.includes('/answerCallbackQuery'))).toBe(false);
  });

  it('sch callback_data 无冒号分隔 → page/token 解析为空 → 查询过期提示', async () => {
    await post({ callback_query: { id: 'cqE4', data: 'sch:garbage', message: { chat: { id: 944783507 }, message_id: 44 } } });
    const edit = tg.find((c) => c.url.includes('/editMessageText'));
    expect(String(edit?.body.text)).toContain('查询过期');
  });

  it('search callback 无 id → 不调 answerCallbackQuery', async () => {
    await env.CACHE.put('search:q:tok9', 'rust');
    await post({ callback_query: { data: 'sch:0:tok9', message: { chat: { id: 944783507 }, message_id: 46 } } });
    expect(tg.some((c) => c.url.includes('/editMessageText'))).toBe(true);
    expect(tg.some((c) => c.url.includes('/answerCallbackQuery'))).toBe(false);
  });

  it('search callback 无 messageId 但 token 有效 → sendTelegramKbd 新消息', async () => {
    await env.CACHE.put('search:q:tok8', 'rust');
    await post({ callback_query: { id: 'cqE7', data: 'sch:0:tok8', from: { id: 944783507 } } });
    const msg = sent().at(-1);
    expect(msg?.body.reply_markup?.inline_keyboard?.length).toBeGreaterThan(0);
  });

  it('callback 无 chat 无 from → chatId 空串 → 直接 ok 零动作', async () => {
    const res = await post({ callback_query: { id: 'cqE5', data: 'arch:pg:0' } });
    expect(await res.text()).toBe('ok');
    expect(tg.length).toBe(0);
  });
});

describe('index webhook: /archive 与 /search 深分支', () => {
  it('/archive >40 条 → jump 快捷跳转行出现', async () => {
    for (let i = 0; i < 45; i++) {
      const repo = `o${i}/r${i}`;
      await env.CACHE.put(`archive:idx:${repo}`, JSON.stringify({ repo, date: `2026-07-${String((i % 28) + 1).padStart(2, '0')}`, desc: `d${i}` }));
    }
    await post({ message: { chat: { id: 944783507 }, text: '/archive' } });
    const kb = [...sent(), ...photos()].at(-1)!.body.reply_markup;
    expect(kb.inline_keyboard.length).toBe(2); // nav + jump
  });

  it('/archive 混入损坏/幽灵条目 → 跳过继续渲染好条目', async () => {
    await env.CACHE.put('archive:idx:good/one', JSON.stringify({ repo: 'good/one', date: '2026-08-01', descZh: '描述一内容' }));
    await env.CACHE.put('archive:idx:good/two', JSON.stringify({ repo: 'good/two', date: '2026-08-02', desc: 'desc two' }));
    await env.CACHE.put('archive:idx:corrupt/repo', '{corrupt{');
    env.CACHE = mkKv([...(env.CACHE as any).store], { nullGet: (k) => k === 'archive:idx:good/two' });
    await post({ message: { chat: { id: 944783507 }, text: '/archive' } });
    const t = texts().find((x) => x.includes('历史存档'));
    expect(t).toContain('good/one');
    expect(t).not.toContain('corrupt/repo');
    expect(t).not.toContain('good/two');
  });

  it('/archive KV list 故障 → ⚠️ 存档列表加载失败', async () => {
    env.CACHE = mkKv([], { failList: (p) => p === 'archive:idx:' });
    await post({ message: { chat: { id: 944783507 }, text: '/archive' } });
    expect(texts().some((t) => t.includes('存档列表加载失败'))).toBe(true);
  });

  it('/search arch 条目 → 📄 日期链接; lookup:desc zh 非中文 → 不采用', async () => {
    await env.CACHE.put('search:index', JSON.stringify([
      ['arch', '存档 2026-08-27', '2026-08-27', 'arch 2026-08-27 rust', '英文原文描述 not chinese'],
      ['lookup:desc:x', '', '', '', ''],
    ].slice(0, 1)));
    await env.CACHE.put('lookup:desc:存档 2026-08-27', JSON.stringify({ zh: 'english words only', ts: Date.now() }));
    await post({ message: { chat: { id: 944783507 }, text: '/search rust' } });
    const t = texts().find((x) => x.includes('🔍'));
    expect(t).toContain('archive/2026/2026-08-27.md');
    expect(t).not.toContain('english words only');
  });

  it('/search 翻到最后一页 → jump 行只含末页快捷(无 ⏭ 下一页分支)', async () => {
    const entries: unknown[][] = [];
    for (let i = 0; i < 45; i++) entries.push(['star', `o${i}/r${i}`, `https://github.com/o${i}/r${i}`, `o${i} r${i} rust`, `d${i}`]);
    await env.CACHE.put('search:index', JSON.stringify(entries));
    await post({ message: { chat: { id: 944783507 }, text: '/search rust' } });
    const kb = [...sent(), ...photos()].at(-1)!.body.reply_markup;
    const token = (kb.inline_keyboard[0][0].callback_data as string).split(':')[2];
    await post({ callback_query: { id: 'cqE8', data: `sch:4:${token}`, message: { chat: { id: 944783507 }, message_id: 47 } } });
    const kb2 = tg.filter((c) => c.url.includes('/editMessageText')).at(-1)!.body.reply_markup;
    expect(JSON.stringify(kb2)).toContain('⏮ 1');
    expect(JSON.stringify(kb2)).not.toContain('下一页');
  });

  it('/search lookup:desc get 抛错 → 描述回落索引原文, 列表照出', async () => {
    env.CACHE = mkKv([['search:index', JSON.stringify([['star', 'owner/repo', 'https://github.com/owner/repo', 'owner repo rust cli', 'a rust cli tool']])]],
      { failGet: (k) => k.startsWith('lookup:desc:') });
    await post({ message: { chat: { id: 944783507 }, text: '/search rust' } });
    const msg = [...sent(), ...photos()].at(-1);
    expect(String(msg?.body.text)).toContain('owner/repo');
  });

  it('/archive 走 D1 渲染(有 DB) → 列表含 D1 行 + nav 键盘', async () => {
    const db = {
      prepare: (sql: string) => ({
        bind: () => ({
          all: async () => ({ results: [{ repo: 'd1/only', date: '2026-08-30', url: 'https://github.com/d1/only', summaryZh: 'D1 中文摘要', topics: 'rust,ai' }] }),
        }),
        first: async () => ({ n: 3 }),
      }),
    } as never;
    env.DB = db;
    await post({ message: { chat: { id: 944783507 }, text: '/archive' } });
    const t = texts().find((x) => x.includes('历史存档'));
    expect(t).toContain('d1/only');
    expect(t).toContain('D1 中文摘要');
    expect(t).toContain('#rust');
    expect(t).toContain('共 3 条');
    const kb = [...sent(), ...photos()].at(-1)!.body.reply_markup;
    expect(JSON.stringify(kb)).toContain('arch:pg:');
  });

  it('/archive D1 空库回落 KV(无 DB / total 0) → 暂无存档记录', async () => {
    const db = {
      prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }) }), first: async () => ({ n: 0 }) }),
    } as never;
    env.DB = db;
    env.CACHE = mkKv();
    await post({ message: { chat: { id: 944783507 }, text: '/archive' } });
    expect(texts().some((x) => x.includes('暂无存档记录'))).toBe(true);
  });

  it('/archive callback 翻页 D1 越界 → 「已到最后一页」', async () => {
    const db = {
      prepare: () => ({
        bind: () => ({ all: async () => ({ results: [] }), first: async () => ({ n: 2 }) }),
        first: async () => ({ n: 2 }),
      }),
    } as never;
    env.DB = db;
    await post({ callback_query: { id: 'cqPg', data: 'arch:pg:1', message: { chat: { id: 944783507 }, message_id: 49 } } });
    const edited = tg.filter((c) => c.url.includes('/editMessageText')).at(-1)?.body.text ?? '';
    expect(edited).toContain('已到最后一页');
  });
});

describe('index webhook: repo 引用与 URL 重发深分支', () => {
  it('多 repo seen 探测 get 抛错 → 视为 fresh, fanout 照常发卡', async () => {
    env.CACHE = mkKv([], { failGet: (k) => k.startsWith('lookup:2026-') || k.startsWith(`lookup:${today()}:`) });
    installFetch({
      raw: (u) => {
        if (u.includes('api.github.com/repos/owner/repo') || u.includes('api.github.com/repos/other/thing')) {
          return new Response(JSON.stringify({ full_name: u.endsWith('owner/repo') ? 'owner/repo' : 'other/thing', description: 'a rust cli tool', stargazers_count: 1500 }), { status: 200 });
        }
        return undefined;
      },
    });
    await post({ message: { chat: { id: 944783507 }, text: 'https://github.com/owner/repo https://github.com/other/thing' } });
    expect(photos().length).toBe(2);
  });

  it('多 repo 摘要消息: 全部 seen → 「N 个仓库今日均已存档」', async () => {
    await env.CACHE.put(`lookup:${today()}:owner/repo`, '1');
    await env.CACHE.put(`lookup:${today()}:other/thing`, '1');
    await post({ message: { chat: { id: 944783507 }, text: 'https://github.com/owner/repo https://github.com/other/thing' } });
    expect(texts().some((t) => t.includes('2 个仓库今日均已存档'))).toBe(true);
  });

  it('replyArchived 索引坏 JSON → it=null 落 lookupRepo 重查', async () => {
    await env.CACHE.put('archive:idx:owner/repo', '{corrupt');
    await env.CACHE.put(`lookup:${today()}:owner/repo`, '1');
    installFetch({
      raw: (u) => (u.includes('api.github.com/repos/owner/repo')
        ? new Response(JSON.stringify({ full_name: 'owner/repo', description: 'a rust cli tool' }), { status: 200 })
        : undefined),
    });
    await post({ message: { chat: { id: 944783507 }, text: 'https://github.com/owner/repo' } });
    expect(texts().some((t) => t.includes('今日已存档'))).toBe(false);
    expect(photos().length).toBeGreaterThanOrEqual(1);
  });

  it('replyArchived archive:tg get 抛错 → 三链缺 Telegraph 照常渲染', async () => {
    const date = '2026-08-27T120000';
    await env.CACHE.put('archive:idx:owner/repo', JSON.stringify({ repo: 'owner/repo', date, descZh: 'rust cli 工具' }));
    await env.CACHE.put(`lookup:${today()}:owner/repo`, '1');
    env.CACHE = mkKv([...(env.CACHE as any).store], { failGet: (k) => k.startsWith('archive:tg:') });
    await post({ message: { chat: { id: 944783507 }, text: 'https://github.com/owner/repo' } });
    const cap = photos().at(-1)?.body.caption ?? '';
    expect(cap).toContain('今日已存档');
    expect(cap).not.toContain('Telegraph');
    expect(cap).toContain('Wayback');
  });

  it('URL done 但二次读 reproc get 抛错 → catch 兜底, 落重新归档路径', async () => {
    let reads = 0;
    const good = JSON.stringify({ translated: true, descOk: true, md: '2026-08-27T120000' });
    env.CACHE = mkKv([], {
      peekGet: (k) => (k.startsWith('reproc:') ? good : undefined), // 首读(shouldReprocess)得 done
      failGet: (k) => (k.startsWith('reproc:') ? reads++ > 0 : false), // 次读(rec)抛错
    });
    await post({ message: { chat: { id: 944783507 }, text: 'https://example.com/page' } });
    expect(texts().some((t) => t.includes('重新归档取回存档链接'))).toBe(true);
  });

  it('URL done + 无 GH_ARCHIVE_REPO + archive:tg get 抛错 → 三链缺 Telegraph 照出', async () => {
    env.GH_ARCHIVE_REPO = undefined;
    env.CACHE = mkKv([], {
      peekGet: (k) => (k.startsWith('reproc:') ? JSON.stringify({ translated: true, descOk: true, md: '2026-08-27T120000', t: '某标题内容', s: '某摘要内容足够长。' }) : undefined),
      failGet: (k) => k.startsWith('archive:tg:') || k.startsWith('og:'), // og: 抛错 → sendPhotoOrText 图床缓存兜底
    });
    await post({ message: { chat: { id: 944783507 }, text: 'https://example.com/page' } });
    const card = texts().find((t) => t.includes('某标题内容'));
    expect(card).toBeTruthy();
    expect(card).not.toContain('Telegraph');
  });

  it('URL done 但二次读 reproc 损坏 → catch 忽略, 落重新归档路径', async () => {
    let reads = 0;
    const good = JSON.stringify({ translated: true, descOk: true, md: '2026-08-27T120000' });
    env.CACHE = mkKv([], { peekGet: (k, v) => (k.startsWith('reproc:') ? (reads++ === 0 ? good : '{corrupt') : undefined) });
    await post({ message: { chat: { id: 944783507 }, text: 'https://example.com/page' } });
    expect(texts().some((t) => t.includes('重新归档取回存档链接'))).toBe(true);
    expect(reads).toBe(2);
  });
});

describe('index webhook: /ph 与 /product 分支', () => {
  it('/ph → Product Hunt 卡片发出(#producthunt)', async () => {
    installFetch({
      raw: (u) => (u.includes('producthunt.com/feed') ? new Response(PH_FEED, { status: 200 }) : undefined),
    });
    await post({ message: { chat: { id: 944783507 }, text: '/ph' } });
    const card = texts().find((t) => t.includes('#producthunt'));
    expect(card).toBeTruthy();
    expect(card).toContain('PH Product One');
  });

  it('/product raw 404 → repository_dispatch 触发 + 生成中占位', async () => {
    installFetch({
      raw: (u) => {
        if (u.includes('raw.githubusercontent.com')) return new Response('not found', { status: 404 });
        if (u.includes('/dispatches')) { aux.push({ url: u, body: {} }); return new Response('{}', { status: 200 }); }
        return undefined;
      },
    });
    await post({ message: { chat: { id: 944783507 }, text: '/hn' } });
    expect(aux.some((c) => c.url.includes('/dispatches'))).toBe(true);
    expect(texts().some((t) => t.includes('生成中'))).toBe(true);
  });

  it('/product dispatch fetch 抛错 → ⚠️ 触发失败提示', async () => {
    installFetch({
      throwFor: [/dispatches/],
      raw: (u) => (u.includes('raw.githubusercontent.com') ? new Response('not found', { status: 404 }) : undefined),
    });
    await post({ message: { chat: { id: 944783507 }, text: '/hn' } });
    expect(texts().some((t) => t.includes('触发失败'))).toBe(true);
  });

  it('/product raw 坏 JSON → 同样落 dispatch 兜底', async () => {
    installFetch({
      raw: (u) => {
        if (u.includes('raw.githubusercontent.com')) return new Response('{oops', { status: 200 });
        if (u.includes('/dispatches')) { aux.push({ url: u, body: {} }); return new Response('{}', { status: 200 }); }
        return undefined;
      },
    });
    await post({ message: { chat: { id: 944783507 }, text: '/hn' } });
    expect(aux.some((c) => c.url.includes('/dispatches'))).toBe(true);
  });

  it('/product items 含 GitHub repo → 后台 fanout repo 卡', async () => {
    installFetch({
      raw: (u) => {
        if (u.includes('raw.githubusercontent.com')) {
          return new Response(JSON.stringify({
            items: [{ title: 'Show HN: gh tool', url: 'https://github.com/owner/repo', descZh: '这是一个中文描述内容足够长。', author: 'fe2o3' }],
          }), { status: 200 });
        }
        if (u.includes('api.github.com/repos/owner/repo')) {
          return new Response(JSON.stringify({ full_name: 'owner/repo', description: 'a rust cli tool' }), { status: 200 });
        }
        return undefined;
      },
    });
    await post({ message: { chat: { id: 944783507 }, text: '/hn' } });
    expect(texts().some((t) => t.includes('Show HN: gh tool'))).toBe(true);
    expect(photos().length).toBe(1); // 产品卡走 link_preview(无 photo), fanout repo 卡走 sendPhoto
  });
});

// ---------------------------------------------------------------------------
// index.ts: archiveTweet 深分支(fixupx 引用 / 稀缺字段 / Telegraph 失败)
// ---------------------------------------------------------------------------
describe('index webhook: X 帖深分支', () => {
  it('fixupx 引用帖: 首源失败落 fxtwitter, 标题用页首标题, 正文英译中, LLM 摘要+标签', async () => {
    env.OPENROUTER_API_KEY = 'sk';
    env.GH_ARCHIVE_REPO = undefined; // 默认仓回落分支
    openrouterContent = '这是一篇被引用文章的中文翻译摘要内容足够长';
    vi.mocked(fetchTweet).mockResolvedValueOnce({
      ...TWEET,
      text: 'Quoting a great article, no repo here',
      translation: null,
    } as any);
    vi.mocked(articleRefFixup).mockReturnValueOnce('https://fixupx.com/fe2o3/status/123' as any);
    installFetch({ throwFor: [/fixupx\.com/] }); // fixupx 抓取抛错 → fxtwitter 兜底(markdown.new 命中)
    await post({ message: { chat: { id: 944783507 }, text: 'https://x.com/fe2o3/status/123' } });
    const card = texts().find((t) => t.includes('这是一篇被引用文章'));
    expect(card).toBeTruthy(); // 英文正文 → 翻译段(mock renderTweetHtml 透传译文)
    expect(card).toContain('#archive');
    expect(texts().some((t) => t.includes('引用文章标题'))).toBe(true); // 页首标题即文章题(免 LLM)
  });

  it('稀缺字段帖(无 url/author/likes/media) → md 全落兜底值, s2 图保底', async () => {
    env.GH_ARCHIVE_REPO = undefined;
    vi.mocked(fetchTweet).mockResolvedValueOnce({
      text: 'just a plain post', translation: null, article: null, media: undefined,
    } as any);
    await post({ message: { chat: { id: 944783507 }, text: 'https://x.com/fe2o3/status/123' } });
    expect(tg.length).toBeGreaterThan(0); // 全兜底值构建 md 不崩, 卡片送达
  });

  it('X 视频帖 → 无 sendPhoto, link_preview 发送', async () => {
    vi.mocked(fetchTweet).mockResolvedValueOnce({
      ...TWEET,
      media: { all: [{ type: 'video', url: 'https://v.example/x.mp4', thumbnail_url: 'https://v.example/x.jpg' }] },
      text: 'watch this video about things',
    } as any);
    await post({ message: { chat: { id: 944783507 }, text: 'https://x.com/fe2o3/status/123' } });
    expect(photos().length).toBe(0);
    const msg = sent().at(-1);
    expect(msg?.body.link_preview_options?.url).toContain('telegra.ph'); // ogUrl 优先 Telegraph 页(视频不走实体图)
  });

  it('Telegraph createPage 返回 ok:false → 无 Telegraph 链, 卡片照发', async () => {
    installFetch({ telegraphOk: false });
    await post({ message: { chat: { id: 944783507 }, text: 'https://x.com/fe2o3/status/123' } });
    const card = texts().find((t) => t.includes('这是转译出来的中文描述内容'));
    expect(card).toBeTruthy(); // 卡片照发(正文为译文)
    expect(card).not.toContain('Telegraph');
  });
});

// ---------------------------------------------------------------------------
// lookup.ts: 管线直测
// ---------------------------------------------------------------------------
describe('lookup: fanoutRepoRefs 描述链', () => {
  const fanEnv = (o: Parameters<typeof mkKv>[1] = {}, extra: Array<[string, string]> = []) => ({
    BOT_TOKEN: 't', CHAT_ID: 'c1', GH_TOKEN: 'g', CACHE: mkKv(extra, o),
    TELEGRAPH_TOKEN: undefined, GH_ARCHIVE_REPO: 'gandli/daily-digest', OPENROUTER_API_KEY: undefined,
  } as any);
  const ghStub = (desc = 'a rust cli tool for testing') => (u: string) => {
    const m = u.match(/api\.github\.com\/repos\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)$/);
    if (m) return new Response(JSON.stringify({ full_name: m[1], description: desc, stargazers_count: 1500, language: 'Rust', topics: ['rust', 'cli'] }), { status: 200 });
    if (u.includes('deepwiki.com')) return new Response(DW_HTML, { status: 200 });
    return undefined;
  };

  it('多 repo → 全并发精简卡(原文desc不翻译); 两 repo 带 N/M 序号与 ⭐k 格式', async () => {
    installFetch({ raw: ghStub() });
    const e = fanEnv();
    const c = { waitUntil: (p: Promise<unknown>) => pending.push(p) } as any;
    await fanoutRepoRefs(e, 'c1', '看 https://github.com/aa/bb 和 https://github.com/cc/dd', c);
    await Promise.allSettled(pending);
    const caps = photos().map((m) => String(m.body.caption));
    expect(caps.length).toBe(2);
    expect(caps.some((t) => t.includes('<b>1/2</b>'))).toBe(true);
    expect(caps.some((t) => t.includes('<b>2/2</b>'))).toBe(true);
    expect(caps[0]).toContain('⭐1.5k');
    expect(caps[0]).toContain('📝 a rust cli tool for testing'); // 精简卡: 原文 desc, 不翻译
  });

  it('单 repo → 无序号; 原文 desc 上卡', async () => {
    installFetch({ raw: (u) => (u.includes('api.github.com/repos/aa/bb')
      ? new Response(JSON.stringify({ full_name: 'aa/bb', description: 'a rust cli tool for testing', stargazers_count: 50 }), { status: 200 })
      : undefined) }); // deepwiki 落默认 {} → null
    const e = fanEnv();
    await fanoutRepoRefs(e, 'c1', 'https://github.com/aa/bb', { waitUntil: () => {} } as any);
    await Promise.allSettled(pending);
    const caps = photos().map((m) => String(m.body.caption));
    expect(caps.length).toBe(1);
    expect(caps[0]).not.toMatch(/<b>\d+\/\d+<\/b>/);
    expect(caps[0]).toContain('⭐50');
    expect(caps[0]).toContain('📝 a rust cli tool for testing'); // 精简卡: 原文 desc
  });

  it('fetchRepo 非 200 / 无 full_name → 跳过该仓不崩', async () => {
    installFetch({
      raw: (u) => {
        if (u.includes('api.github.com/repos/aa/bb')) return new Response('nope', { status: 404 });
        if (u.includes('api.github.com/repos/cc/dd')) return new Response(JSON.stringify({ description: 'no full_name' }), { status: 200 });
        return undefined;
      },
    });
    const e = fanEnv();
    await fanoutRepoRefs(e, 'c1', 'https://github.com/aa/bb https://github.com/cc/dd', { waitUntil: () => {} } as any);
    await Promise.allSettled(pending);
    expect(photos().length).toBe(0);
  });

  it('索引/去重写 KV 抛错 → catch 静默, 卡片照发', async () => {
    installFetch({ raw: ghStub() });
    const e = fanEnv({ failPut: (k) => k.startsWith('search:index') || k.startsWith(`lookup:${today()}:`) });
    await fanoutRepoRefs(e, 'c1', 'https://github.com/aa/bb', { waitUntil: () => {} } as any);
    await Promise.allSettled(pending);
    expect(photos().length).toBe(1);
  });

  it('无 ctx → 直接返回零动作', async () => {
    installFetch({ raw: ghStub() });
    await fanoutRepoRefs(fanEnv(), 'c1', 'https://github.com/aa/bb', undefined);
    expect(tg.length).toBe(0);
  });
});

describe('lookup: lookupRepo 分支', () => {
  const ghOk = () => installFetch({
    raw: (u) => {
      if (u.includes('api.github.com/repos/aa/bb')) return new Response(JSON.stringify({ full_name: 'aa/bb', description: '一个纯中文的仓库描述内容' }), { status: 200 });
      if (u.includes('deepwiki.com')) return new Response(DW_HTML, { status: 200 });
      return undefined;
    },
  });

  it('无 TELEGRAPH_TOKEN → 照常发卡(无 Telegraph 链)', async () => {
    ghOk();
    const e = { BOT_TOKEN: 't', CHAT_ID: 'c1', GH_TOKEN: 'g', CACHE: mkKv(), TELEGRAPH_TOKEN: undefined, GH_ARCHIVE_REPO: 'gandli/daily-digest' } as any;
    await lookupRepo(e, 'c1', 'aa/bb');
    expect(photos().length).toBe(1);
    expect(String(photos()[0].body.caption)).not.toContain('Telegraph');
  });

  it('deepwiki 命中 + 翻译成功 → descZh 上卡并写 lookup:desc 缓存', async () => {
    ghOk();
    const kv = mkKv();
    const e = { BOT_TOKEN: 't', CHAT_ID: 'c1', GH_TOKEN: 'g', CACHE: kv, TELEGRAPH_TOKEN: 'tg', GH_ARCHIVE_REPO: 'gandli/daily-digest' } as any;
    await lookupRepo(e, 'c1', 'aa/bb');
    const cached = kv.store.get('lookup:desc:aa/bb');
    expect(cached).toBeTruthy();
    expect(JSON.parse(cached!).zh).toBe('这是转译出来的中文描述内容');
  });

  it('desc 缓存坏 JSON → 视为 miss; deepwiki miss + GitHub desc 已中文 → 直用', async () => {
    installFetch({
      raw: (u) => {
        if (u.includes('api.github.com/repos/aa/bb')) return new Response(JSON.stringify({ full_name: 'aa/bb', description: '一个纯中文的仓库描述内容' }), { status: 200 });
        return undefined; // deepwiki/zread 全 miss
      },
    });
    const kv = mkKv([['lookup:desc:aa/bb', '{corrupt']]);
    const e = { BOT_TOKEN: 't', CHAT_ID: 'c1', GH_TOKEN: 'g', CACHE: kv, TELEGRAPH_TOKEN: 'tg', GH_ARCHIVE_REPO: 'gandli/daily-digest' } as any;
    await lookupRepo(e, 'c1', 'aa/bb');
    const cap = String(photos()[0].body.caption);
    expect(cap).toContain('一个纯中文的仓库描述内容');
  });

  it('deepwiki 命中但翻译失败 → descZh 缺, 不写 desc 缓存; 无 GH_ARCHIVE_REPO 回落', async () => {
    installFetch({
      throwFor: [/transmart\.qq\.com/, /openrouter\.ai/],
      raw: (u) => {
        if (u.includes('api.github.com/repos/aa/bb')) return new Response(JSON.stringify({ full_name: 'aa/bb', description: 'an english description here' }), { status: 200 });
        if (u.includes('deepwiki.com')) return new Response(DW_HTML, { status: 200 });
        return undefined;
      },
    });
    const kv = mkKv();
    const e = { BOT_TOKEN: 't', CHAT_ID: 'c1', GH_TOKEN: 'g', CACHE: kv, TELEGRAPH_TOKEN: 'tg', GH_ARCHIVE_REPO: undefined, OPENROUTER_API_KEY: undefined } as any;
    await lookupRepo(e, 'c1', 'aa/bb');
    expect(kv.store.has('lookup:desc:aa/bb')).toBe(false);
    expect(photos().length).toBe(1);
  });

  it('repo 404 → ❌ 找不到仓库提示', async () => {
    installFetch({ raw: (u) => (u.includes('api.github.com/repos') ? new Response('nope', { status: 404 }) : undefined) });
    const e = { BOT_TOKEN: 't', CHAT_ID: 'c1', GH_TOKEN: 'g', CACHE: mkKv() } as any;
    await lookupRepo(e, 'c1', 'aa/bb');
    expect(texts().some((t) => t.includes('找不到仓库'))).toBe(true);
  });
});

describe('lookup: refreshLookupDescriptions / backfillDescriptions', () => {
  it('过期缓存 + deepwiki 命中 → 刷新; 坏 JSON 条目跳过; list 故障不崩', async () => {
    installFetch({ raw: (u) => (u.includes('deepwiki.com') ? new Response(DW_HTML, { status: 200 }) : undefined) });
    const kv = mkKv([
      ['lookup:desc:aa/bb', JSON.stringify({ zh: '旧中文描述内容', ts: Date.now() - 8 * 86400_000 })], // 过期
      ['lookup:desc:cc/dd', '{corrupt'],
    ]);
    const e = { CACHE: kv } as any;
    await refreshLookupDescriptions(e);
    const fresh = JSON.parse(kv.store.get('lookup:desc:aa/bb')!);
    expect(fresh.zh).toBe('这是转译出来的中文描述内容');
    // list 抛错 → 外层 catch 不上抛
    const bad = { CACHE: { list: async () => { throw new Error('list down'); }, get: async () => null, put: async () => {} } } as any;
    await expect(refreshLookupDescriptions(bad)).resolves.toBeUndefined();
  });

  it('backfill: 非 star 跳过 / 空缓存防重试 / 已缓存跳过 / 成功计入 / limit 截断', async () => {
    installFetch({ raw: (u) => (u.includes('deepwiki.com/cc/dd') ? new Response(DW_HTML, { status: 200 }) : undefined) }); // 仅 cc/dd 命中
    const entries = [
      ['x', 'x/repo', '', '', ''], // 非 star → 跳过
      ['star', 'aa/bb', '', 'hay', ''], // 无 desc → deepwiki miss → 写空缓存防重试
      ['star', 'ee/ff', '', 'hay', ''], // 已有缓存 → 跳过
      ['star', 'cc/dd', '', 'hay', ''], // deepwiki 命中 + 翻译 → done=1
      ['star', 'gg/hh', '', 'hay', ''], // done>=limit → break
    ];
    const kv = mkKv([
      ['search:index', JSON.stringify(entries)],
      ['lookup:desc:ee/ff', JSON.stringify({ zh: '已有缓存', ts: Date.now() })],
    ]);
    const e = { CACHE: kv } as any;
    await backfillDescriptions(e, 1);
    expect(JSON.parse(kv.store.get('lookup:desc:aa/bb')!).zh).toBe('');
    expect(JSON.parse(kv.store.get('lookup:desc:cc/dd')!).zh).toBe('这是转译出来的中文描述内容');
    expect(kv.store.has('lookup:desc:gg/hh')).toBe(false);
  });

  it('backfill: search:index get 抛错 → 直接返回', async () => {
    const e = { CACHE: mkKv([], { failGet: (k) => k === 'search:index' }) } as any;
    await expect(backfillDescriptions(e, 5)).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// lookup.ts: archiveUrl og 预取降级链
// ---------------------------------------------------------------------------
describe('lookup: archiveUrl og 预取降级', () => {
  const archEnv = (o: Parameters<typeof mkKv>[1] = {}) => ({
    BOT_TOKEN: 't', CHAT_ID: 'c1', GH_TOKEN: 'g', CACHE: mkKv([], o),
    TELEGRAPH_TOKEN: 'tg', GH_ARCHIVE_REPO: 'gandli/daily-digest', OPENROUTER_API_KEY: undefined,
  } as any);

  it('og 预取 fetch 直接 throw → s2 favicon 保底, sendPhoto 照发', async () => {
    installFetch({ throwFor: [/example\.com/] });
    await archiveUrl(archEnv(), 'c1', 'https://example.com/page');
    const p = photos().at(-1);
    expect(p).toBeTruthy();
    expect(String(p!.body.photo)).toContain('s2/favicons');
    expect(String(p!.body.photo)).toContain('example.com');
  });

  it('页面无 og:image → apple-touch-icon HEAD 命中 image/png; Telegraph 失败不阻塞', async () => {
    installFetch({
      telegraphOk: false,
      raw: (u, init) => {
        if (String(init?.method ?? 'GET') === 'HEAD' && u.endsWith('/apple-touch-icon.png')) {
          return new Response(null, { status: 200, headers: { 'content-type': 'image/png' } });
        }
        if (u === 'https://example.com/page') return new Response('<html><body>plain</body></html>', { status: 200 });
        return undefined;
      },
    });
    await archiveUrl(archEnv(), 'c1', 'https://example.com/page');
    const p = photos().at(-1);
    expect(String(p!.body.photo)).toContain('apple-touch-icon.png');
    expect(aux.some((c) => c.url.includes('createPage'))).toBe(true);
  });

  it('favicon 仅 ico / HEAD 抛错 → 跳过, s2 保底', async () => {
    installFetch({
      throwFor: [/apple-touch-icon/],
      raw: (u, init) => {
        if (String(init?.method ?? 'GET') === 'HEAD' && u.endsWith('/favicon.ico')) {
          return new Response(null, { status: 200, headers: { 'content-type': 'image/x-icon' } });
        }
        if (u === 'https://example.com/page') return new Response('<html><body>plain</body></html>', { status: 200 });
        return undefined;
      },
    });
    await archiveUrl(archEnv(), 'c1', 'https://example.com/page');
    expect(String(photos().at(-1)!.body.photo)).toContain('s2/favicons');
  });

  it('md 全是链接行 → title 落 host(junk) → 无 LLM key 保底原样', async () => {
    installFetch({
      raw: (u) => {
        if (u.includes('markdown.new/')) return new Response(JSON.stringify({ success: true, content: 'https://x.com/a\nhttps://x.com/b\nhttps://x.com/c\nhttps://x.com/d' }), { status: 200 });
        if (u === 'https://example.com/page') return new Response('<html><body>plain</body></html>', { status: 200 });
        return undefined;
      },
    });
    await archiveUrl(archEnv(), 'c1', 'https://example.com/page');
    const cap = String(photos().at(-1)!.body.caption);
    expect(cap).toContain('example.com'); // host 兜底标题仍出卡
  });

  it('md 含标题/引用/列表/代码行 → Telegraph nodes 各类型生成; 无 GH_ARCHIVE_REPO 回落', async () => {
    const body = [
      '# Top Title', '## Second Heading', '### Third Level', '> quoted line here', '- list item one', '```code fence line```', 'plain paragraph line with enough words to pass the length guard',
    ].join('\n');
    installFetch({
      raw: (u) => {
        if (u.includes('markdown.new/')) return new Response(JSON.stringify({ success: true, content: body }), { status: 200 });
        if (u === 'https://example.com/page') return new Response('<html><body>plain</body></html>', { status: 200 });
        return undefined;
      },
    });
    const e = { BOT_TOKEN: 't', CHAT_ID: 'c1', GH_TOKEN: 'g', CACHE: mkKv(), TELEGRAPH_TOKEN: 'tg', GH_ARCHIVE_REPO: undefined, OPENROUTER_API_KEY: undefined } as any;
    await archiveUrl(e, 'c1', 'https://example.com/page');
    const page = aux.find((c) => c.url.includes('createPage'));
    const nodes = JSON.stringify(page?.body?.content ?? []);
    expect(nodes).toContain('"h3"');
    expect(nodes).toContain('"h4"');
    expect(nodes).toContain('"blockquote"');
    expect(nodes).toContain('"ul"');
    expect(nodes).toContain('"pre"');
  });

  it('titleZh LLM: 生成失败但原文非垃圾 → TranSmart 翻译兜底; 80k 内容截断', async () => {
    installFetch({
      throwFor: [/openrouter\.ai/],
      raw: (u) => {
        if (u.includes('markdown.new/')) {
          return new Response(JSON.stringify({ success: true, content: '# A Long English Article Title Here\n\n' + 'word '.repeat(20000) }), { status: 200 });
        }
        if (u === 'https://example.com/page') return new Response('<html><body>plain</body></html>', { status: 200 });
        return undefined;
      },
    });
    const e = { BOT_TOKEN: 't', CHAT_ID: 'c1', GH_TOKEN: 'g', CACHE: mkKv(), TELEGRAPH_TOKEN: 'tg', GH_ARCHIVE_REPO: 'gandli/daily-digest', OPENROUTER_API_KEY: 'sk' } as any;
    await archiveUrl(e, 'c1', 'https://example.com/page');
    const cap = String(photos().at(-1)!.body.caption);
    expect(cap).toContain('这是转译出来的中文描述内容'); // 标题经 TranSmart 译中
    // 缓冲内容已按 80k 截断(pend 键存在即可)
    expect([...e.CACHE.store.keys()].some((k) => k.startsWith('pend:arc:'))).toBe(true);
  });

  it('titleZh LLM 双失败 → 回落原英文标题', async () => {
    installFetch({
      throwFor: [/openrouter\.ai/, /transmart\.qq\.com/],
      raw: (u) => {
        if (u.includes('markdown.new/')) return new Response(JSON.stringify({ success: true, content: '# A Long English Article Title Here\n\n' + 'word '.repeat(60) }), { status: 200 });
        if (u === 'https://example.com/page') return new Response('<html><body>plain</body></html>', { status: 200 });
        return undefined;
      },
    });
    const e = { BOT_TOKEN: 't', CHAT_ID: 'c1', GH_TOKEN: 'g', CACHE: mkKv(), TELEGRAPH_TOKEN: 'tg', GH_ARCHIVE_REPO: 'gandli/daily-digest', OPENROUTER_API_KEY: 'sk' } as any;
    await archiveUrl(e, 'c1', 'https://example.com/page');
    expect(String(photos().at(-1)!.body.caption)).toContain('A Long English Article Title Here');
  });

  it('转换全失败(页面过短 + markdown.new 500) → ❌ 无法提取提示', async () => {
    installFetch({
      raw: (u) => {
        if (u === 'https://example.com/page') return new Response('<html></html>', { status: 200 });
        if (u.includes('markdown.new')) return new Response('err', { status: 500 });
        return undefined;
      },
    });
    await archiveUrl(archEnv(), 'c1', 'https://example.com/page');
    expect(texts().some((t) => t.includes('无法提取'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// ph.ts: 无 TELEGRAPH_TOKEN 分支与解析兜底
// ---------------------------------------------------------------------------
describe('ph: runProductHunt 无 TELEGRAPH_TOKEN(58 行分支)', () => {
  const phEnv = (o: Parameters<typeof mkKv>[1] = {}, extra: Array<[string, string]> = []) => ({
    BOT_TOKEN: 't', CHAT_ID: 'c1', CACHE: mkKv(extra, o),
    TELEGRAPH_TOKEN: undefined, GH_ARCHIVE_REPO: 'gandli/daily-digest',
  } as any);

  it('无 TELEGRAPH_TOKEN → 零 telegra.ph 调用, 卡片照发, md 无 Telegraph 行', async () => {
    installFetch({ raw: (u) => (u.includes('producthunt.com/feed') ? new Response(PH_FEED, { status: 200 }) : undefined) });
    const e = phEnv();
    const n = await runProductHunt(e, 'c1');
    expect(n).toBe(2);
    expect(aux.some((c) => c.url.includes('api.telegra.ph'))).toBe(false);
    expect(texts().filter((t) => t.includes('#producthunt')).length).toBe(2);
    // 榜单存档缓冲里不应有 Telegraph 行
    const pend = [...e.CACHE.store.entries()].find(([k]) => k.startsWith('pend:arc:'));
    expect(pend).toBeTruthy();
    expect(atob(JSON.parse(pend![1]).content)).not.toContain('Telegraph:');
  });

  it('缓存坏 JSON → 重拉 feed 照发', async () => {
    installFetch({ raw: (u) => (u.includes('producthunt.com/feed') ? new Response(PH_FEED, { status: 200 }) : undefined) });
    const e = phEnv({}, [[`ph:${today()}`, '{corrupt']]);
    const n = await runProductHunt(e, 'c1');
    expect(n).toBe(2);
  });

  it('CACHE.get 抛错 → 视为 miss 照常跑', async () => {
    installFetch({ raw: (u) => (u.includes('producthunt.com/feed') ? new Response(PH_FEED, { status: 200 }) : undefined) });
    const e = phEnv({ failGet: (k) => k.startsWith('ph:') });
    const n = await runProductHunt(e, 'c1');
    expect(n).toBe(2);
  });

  it('CACHE.put 抛错 → 缓存写失败静默, 卡片照发', async () => {
    installFetch({ raw: (u) => (u.includes('producthunt.com/feed') ? new Response(PH_FEED, { status: 200 }) : undefined) });
    const e = phEnv({ failPut: (k) => k.startsWith('ph:') });
    const n = await runProductHunt(e, 'c1');
    expect(n).toBe(2);
    expect([...e.CACHE.store.keys()].some((k) => k.startsWith('ph:'))).toBe(false);
  });

  it('fetchProductHunt: feed fetch 直接 throw → []', async () => {
    installFetch({ throwFor: [/producthunt\.com/] });
    await expect(fetchProductHunt()).resolves.toEqual([]);
  });

  it('fetchProductHunt: 缺 link / 缺 title / 缺 content 的 entry 全跳过或缺省', async () => {
    const xml = `<feed>
      <entry><title>Has Link</title><link rel="alternate" href="https://ph.com/a"/><content type="html">&lt;p&gt;desc a&lt;/p&gt;</content></entry>
      <entry><title>No Link</title><content type="html">&lt;p&gt;desc b&lt;/p&gt;</content></entry>
      <entry><link rel="alternate" href="https://ph.com/c"/><content type="html">&lt;p&gt;desc c&lt;/p&gt;</content></entry>
      <entry><title>No Content</title><link rel="alternate" href="https://ph.com/d"/></entry>
    </feed>`;
    installFetch({ raw: (u) => (u.includes('producthunt.com/feed') ? new Response(xml, { status: 200 }) : undefined) });
    const items = await fetchProductHunt();
    // 缺 link / 缺 title 跳过; 缺 content 保留(desc 空串)
    expect(items.map((i) => i.title)).toEqual(['Has Link', 'No Content']);
    expect(items[0].desc).toBe('desc a');
    expect(items[0].author).toBeUndefined();
    expect(items[1].desc).toBe('');
  });
});
