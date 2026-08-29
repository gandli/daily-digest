// Product Hunt 每日热门测试: Atom 解析 + /ph 管线(拉取→译中→发卡→缓存/存档缓冲) + 缓存命中。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchProductHunt, runProductHunt } from '../src/ph';
import { today } from '../src/lookup';

const FEED_XML = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom">
  <entry>
    <id>tag:www.producthunt.com,2005:Post/1</id>
    <link rel="alternate" type="text/html" href="https://www.producthunt.com/products/cohere-2"/>
    <title>Cohere Parse 5</title>
    <content type="html">&lt;p&gt;Turn complex docs into AI-ready data&lt;/p&gt;&lt;p&gt;&lt;a href="x"&gt;Discussion&lt;/a&gt; | &lt;a href="y"&gt;Link&lt;/a&gt;&lt;/p&gt;</content>
    <author><name>Anusha</name></author>
  </entry>
  <entry>
    <id>tag:www.producthunt.com,2005:Post/2</id>
    <link rel="alternate" type="text/html" href="https://www.producthunt.com/products/defi-3"/>
    <title>DeFi 3</title>
    <content type="html">&lt;p&gt;Decentralized finance for everyone&lt;/p&gt;</content>
    <author><name>Bob</name></author>
  </entry>
</feed>`;

const tgCalls: any[] = [];
const store = new Map<string, string>();
const mkEnv = (): any => ({
  BOT_TOKEN: 't', CHAT_ID: 'c', GH_ARCHIVE_REPO: 'gandli/daily-digest', TELEGRAPH_TOKEN: 'tg',
  CACHE: {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v); },
    list: async () => ({ keys: [] }),
  },
});
const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p); return p; } } as any;
const pending: Promise<unknown>[] = [];

beforeEach(() => {
  tgCalls.length = 0;
  store.clear();
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('producthunt.com/feed')) return new Response(FEED_XML, { status: 200 });
    if (url.includes('api.telegram.org')) { tgCalls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) }); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
    if (url.includes('api.telegra.ph')) return new Response(JSON.stringify({ ok: true, result: { url: 'https://telegra.ph/ph-page' } }), { status: 200 });
    return new Response('{}', { status: 200 }); // 翻译链/AI 兜底全部失败 → 保留原文
  }) as typeof fetch;
});

describe('fetchProductHunt', () => {
  it('Atom 解析: 标题/链接/tagline(剥 HTML+尾巴)/作者', async () => {
    const items = await fetchProductHunt();
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('Cohere Parse 5');
    expect(items[0].url).toBe('https://www.producthunt.com/products/cohere-2');
    expect(items[0].desc).toBe('Turn complex docs into AI-ready data');
    expect(items[0].author).toBe('Anusha');
  });
  it('limit 截断', async () => {
    const items = await fetchProductHunt(1);
    expect(items).toHaveLength(1);
  });
});

describe('runProductHunt', () => {
  it('缓存 miss → 拉取发卡(#producthunt 标签 + ogUrl 预览) + 缓存与存档缓冲落盘', async () => {
    await runProductHunt(mkEnv(), 'c');
    const cards = tgCalls.filter((c) => c.url.includes('/sendMessage'));
    expect(cards.length).toBe(2);
    expect(String(cards[0].body.text)).toContain('#producthunt');
    expect(cards[0].body.link_preview_options?.url).toBe('https://www.producthunt.com/products/cohere-2');
    // 当日缓存已写(重放用)
    expect(store.has(`ph:${today()}`)).toBe(true);
    // 榜单存档入缓冲(ph-<date>.md, flush 时批量推 archive 分支)
    expect([...store.keys()].some((k) => k.startsWith('pend:arc:'))).toBe(true);
  });
  it('缓存命中 → 重放缓存卡片, 零 feed 拉取', async () => {
    store.set(`ph:${today()}`, JSON.stringify({ chunks: ['<b>缓存卡</b>'] }));
    let feedHits = 0;
    globalThis.fetch = (async function (input: RequestInfo | URL, init?: RequestInit) {
      const url = String(input);
      if (url.includes('producthunt.com/feed')) { feedHits++; return new Response(FEED_XML, { status: 200 }); }
      if (url.includes('api.telegram.org')) { tgCalls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) }); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    await runProductHunt(mkEnv(), 'c');
    expect(feedHits).toBe(0);
    const cards = tgCalls.filter((c) => c.url.includes('/sendMessage'));
    expect(cards.length).toBe(1);
    expect(String(cards[0].body.text)).toContain('缓存卡');
  });
  it('feed 失败 → ⚠️ 提示, 返回 -1', async () => {
    globalThis.fetch = (async function (input: RequestInfo | URL, init?: RequestInit) {
      const url = String(input);
      if (url.includes('producthunt.com/feed')) return new Response('err', { status: 500 });
      if (url.includes('api.telegram.org')) { tgCalls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) }); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    const n = await runProductHunt(mkEnv(), 'c');
    expect(n).toBe(-1);
    expect(tgCalls.some((c) => String(c.body?.text ?? '').includes('⚠️ Product Hunt 拉取失败'))).toBe(true);
  });
});
