// Product Hunt 每日热门测试: Atom 解析 + GraphQL v2(票数/介绍/官网, 对齐 Decohack) + /ph 管线(拉取→译中→发卡→缓存/存档缓冲) + 缓存命中。
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fetchProductHunt, fetchProductHuntGraphql, runProductHunt } from '../src/ph';
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

// PH GraphQL v2 fixture: 票数/长介绍/官网齐备(对齐 Decohack); 条目2 无官网 → 回落 PH 页
const GQL_BODY = JSON.stringify({
  data: { posts: { edges: [
    { node: { name: 'Cohere Parse 5', tagline: 'Turn complex docs into AI-ready data', description: 'Cohere Parse converts messy documents into structured, AI-ready data for your pipelines.', votesCount: 321, websiteUrl: 'https://cohere.com/parse', url: 'https://www.producthunt.com/posts/cohere-parse-5' } },
    { node: { name: 'DeFi 3', tagline: 'Decentralized finance for everyone', description: 'A wallet for all chains.', votesCount: 120, websiteUrl: '', url: 'https://www.producthunt.com/posts/defi-3' } },
  ] } },
});

// TranSmart 批量译文(须过 isChinese 守卫): 两次 translateBatch(tagline 批 + description 批)都走此桩
const ZH_MAP: Record<string, string> = {
  'Turn complex docs into AI-ready data': '把复杂文档变成AI可直接使用的数据',
  'Decentralized finance for everyone': '人人可用的去中心化金融平台',
  'Cohere Parse converts messy documents into structured, AI-ready data for your pipelines.': '将杂乱文档转换为结构化、AI就绪的数据,直接接入你的数据管道,支持批量处理与导出。',
  'A wallet for all chains.': '覆盖全部主流链的钱包,功能齐全且强大。',
};
const gqlFetcher = (gqlStatus = 200): typeof fetch =>
  (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('api.producthunt.com/v2/api/graphql')) return new Response(gqlStatus === 200 ? GQL_BODY : 'err', { status: gqlStatus });
    if (url.includes('transmart.qq.com')) {
      const { source } = JSON.parse(String(init?.body ?? '{}')) as { source: { text_list: string[] } };
      return new Response(JSON.stringify({ header: { ret_code: 'succ' }, auto_translation: source.text_list.map((d) => ZH_MAP[d] ?? '通用中文译文的测试内容') }), { status: 200 });
    }
    if (url.includes('api.telegram.org')) { tgCalls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) }); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
    if (url.includes('api.telegra.ph')) return new Response(JSON.stringify({ ok: true, result: { url: 'https://telegra.ph/ph-page' } }), { status: 200 });
    return new Response('{}', { status: 200 }); // 其余翻译链全挂 → 守卫拦截
  }) as typeof fetch;
// 存档缓冲 md(ph-<date>.md, base64 还原)
const pendMd = (): string => {
  for (const [, v] of store) {
    if (!v.includes('ph-')) continue;
    try {
      const item = JSON.parse(v) as { path: string; content: string };
      if (item.path.includes('/ph-')) return new TextDecoder().decode(Uint8Array.from(atob(item.content), (c) => c.charCodeAt(0)));
    } catch { /* 非存档缓冲条目 */ }
  }
  return '';
};

const tgCalls: any[] = [];
const store = new Map<string, string>();
const mkEnv = (extra: Record<string, unknown> = {}): any => ({
  BOT_TOKEN: 't', CHAT_ID: 'c', GH_ARCHIVE_REPO: 'gandli/daily-digest', TELEGRAPH_TOKEN: 'tg',
  CACHE: {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v); },
    list: async () => ({ keys: [] }),
  },
  ...extra,
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

describe('fetchProductHuntGraphql', () => {
  it('无 token → 零请求返回 [](回落 Atom 兜底)', async () => {
    let hits = 0;
    globalThis.fetch = (async () => { hits++; return new Response('{}', { status: 200 }); }) as typeof fetch;
    expect(await fetchProductHuntGraphql(mkEnv())).toEqual([]);
    expect(hits).toBe(0);
  });
  it('token + 成功 fixture → 官网优先/phUrl/票数/长介绍; 缺官网回落 PH 页', async () => {
    globalThis.fetch = gqlFetcher();
    const items = await fetchProductHuntGraphql(mkEnv({ PH_API_TOKEN: 'ph' }));
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('Cohere Parse 5');
    expect(items[0].url).toBe('https://cohere.com/parse');
    expect(items[0].desc).toBe('Turn complex docs into AI-ready data');
    expect(items[0].quote).toBe('Cohere Parse converts messy documents into structured, AI-ready data for your pipelines.');
    expect(items[0].stars).toBe(321);
    expect((items[0] as any).phUrl).toBe('https://www.producthunt.com/posts/cohere-parse-5');
    expect(items[1].url).toBe('https://www.producthunt.com/posts/defi-3'); // 无官网 → PH 页兜底
  });
  it('GraphQL 500 / 坏响应 → [](静默兜底, 绝不抛)', async () => {
    globalThis.fetch = gqlFetcher(500);
    expect(await fetchProductHuntGraphql(mkEnv({ PH_API_TOKEN: 'ph' }))).toEqual([]);
    globalThis.fetch = (async () => new Response('not json', { status: 200 })) as typeof fetch;
    expect(await fetchProductHuntGraphql(mkEnv({ PH_API_TOKEN: 'ph' }))).toEqual([]);
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
  it('GraphQL 成功 → 卡片带 ⭐票数/💬中文介绍/官网直链; 存档 md 含 官网+PH 双链接', async () => {
    globalThis.fetch = gqlFetcher();
    await runProductHunt(mkEnv({ PH_API_TOKEN: 'ph' }), 'c');
    const cards = tgCalls.filter((c) => c.url.includes('/sendMessage'));
    expect(cards.length).toBe(2);
    expect(String(cards[0].body.text)).toContain('⭐ 321');
    expect(String(cards[0].body.text)).toContain('💬');
    expect(String(cards[0].body.text)).toContain('将杂乱文档'); // description 译文进 💬 行
    expect(String(cards[0].body.text)).toContain('把复杂文档'); // tagline 译文进 📝 行
    expect(cards[0].body.link_preview_options?.url).toBe('https://cohere.com/parse'); // 官网直链
    const md = pendMd();
    expect(md).toContain('官网: https://cohere.com/parse');
    expect(md).toContain('PH: https://www.producthunt.com/posts/cohere-parse-5');
  });
  it('配 token 但 GraphQL 500 → 回落 Atom feed 出卡(回归不破坏)', async () => {
    globalThis.fetch = (async function (input: RequestInfo | URL, init?: RequestInit) {
      const url = String(input);
      if (url.includes('api.producthunt.com')) return new Response('err', { status: 500 });
      if (url.includes('producthunt.com/feed')) return new Response(FEED_XML, { status: 200 });
      if (url.includes('api.telegram.org')) { tgCalls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) }); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    const n = await runProductHunt(mkEnv({ PH_API_TOKEN: 'ph' }), 'c');
    expect(n).toBe(2);
    const cards = tgCalls.filter((c) => c.url.includes('/sendMessage'));
    expect(cards[0].body.link_preview_options?.url).toBe('https://www.producthunt.com/products/cohere-2'); // Atom 的 PH 页链接
  });
});
