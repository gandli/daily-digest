// archiveTweet 回归锁: FxEmbed 成功发卡+Telegraph+存档 / tweet 空落通用链 / 发送失败发⚠️。
// 依赖: mock global fetch(FxEmbed/TG/GitHub/Telegraph) + KV 内存 stub + ctx.waitUntil。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { archiveTweet } from '../src/index';

type Mode = 'ok' | 'tweet-empty' | 'fail-send' | 'fail-dispatch' | 'article-ref' | 'article-inline';
let mode: Mode = 'ok';
type Call = { url: string; body: any };
const calls: Call[] = [];
const pending: Promise<unknown>[] = [];

const TWEET_OK = { code: 200, status: {
  url: 'https://x.com/fe2o3/status/123',
  text: 'Hello world, check out github.com/acme/tool it is neat',
  author: { screen_name: 'fe2o3', name: 'Fe' },
  created_at: '2026-08-27T00:00:00Z',
  likes: 10, reposts: 2, replies: 3,
  media: { all: [{ type: 'photo', url: 'https://x/photo.jpg' }] },
  translation: null, article: null,
} };

// article 内嵌块(article.blocks 有内容): 触发 articleToText  truthy 分支, L255/L279 覆盖率
const TWEET_ARTICLE_INLINE = { code: 200, status: {
  url: 'https://x.com/fe2o3/status/126',
  id: '126',
  text: '本文有嵌套文章块',
  author: { screen_name: 'fe2o3', name: 'Fe' },
  created_at: '2026-08-30T00:00:00Z',
  likes: 5, reposts: 1, replies: 0,
  media: { all: [{ type: 'photo', url: 'https://x/art.jpg' }] },
  translation: { text: '本文有嵌套文章块', provider: 'deepl' },
  article: {
    title: '嵌套文章标题',
    content: { blocks: [
      { text: '第一段正文内容。', type: 'text' },
      { text: '第二段正文内容。', type: 'text' },
    ]},
  },
} };

// article 引用帖(真实故障 2093573946478305776): v2 API 不内嵌 article 对象, text 只是裸引用链
const TWEET_ARTICLE_REF = { code: 200, status: {
  url: 'https://x.com/fe2o3/status/125',
  id: '125',
  text: 'https://x.com/i/article/2093572549854855168',
  author: { screen_name: 'fe2o3', name: 'Fe' },
  created_at: '2026-08-29T00:00:00Z',
  media: { all: [] }, translation: null, article: null,
} };

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes('api.fxtwitter.com')) {
    if (mode === 'tweet-empty') return new Response('{}', { status: 404 });
    if (mode === 'article-ref') return new Response(JSON.stringify(TWEET_ARTICLE_REF), { status: 200, headers: { 'content-type': 'application/json' } });
    if (mode === 'article-inline') return new Response(JSON.stringify(TWEET_ARTICLE_INLINE), { status: 200, headers: { 'content-type': 'application/json' } });
    return new Response(JSON.stringify(TWEET_OK), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (mode === 'article-ref' && url.includes('r.jina.ai')) {
    // urlToMarkdown Jina 级返回 fixupx 全文(>40 字符过 viaJina 门槛)
    return new Response('# 钓鱼邮件分析报告\n\n本文依据原始邮件头与解码后的头部字段还原了完整攻击链, 包含诱饵文档与回连地址。', { status: 200 });
  }
  if (url.includes('api.telegram.org')) {
    const body = String(init?.body ?? '');
    if (mode === 'fail-send' && !body.includes('⚠️')) throw new Error('TG down');
    calls.push({ url, body: JSON.parse(body || '{}') });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }
  if (url.includes('api.telegra.ph/createPage')) {
    return new Response(JSON.stringify({ ok: true, result: { url: 'https://telegra.ph/x-post-1' } }), { status: 200 });
  }
  // GitHub API 存档 PUT / repo 详情 + markdown 转换回退链: 空 ok
  return new Response('{}', { status: 200 });
}) as typeof fetch;

const memKv = () => {
  const store = new Map<string, string>();
  return {
    list: async () => ({ keys: [] }),
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v); },
    delete: async (k: string) => { store.delete(k); },
    get store() { return store; },
  };
};

const mkEnv = (kv = memKv()): any => ({
  BOT_TOKEN: 'test', CHAT_ID: '944783507', WEBHOOK_SECRET: 'sec', GH_TOKEN: 'g',
  CACHE: kv, AI: undefined, TELEGRAPH_TOKEN: 'tg-token', GH_ARCHIVE_REPO: 'gandli/daily-digest',
});
const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p); return p; } } as any;
const sendMessages = () => calls.filter((c) => c.url.includes('/sendMessage'));

describe('archiveTweet', () => {
  beforeEach(() => { calls.length = 0; pending.length = 0; mode = 'ok'; });

  it('FxEmbed 命中 → 发卡 + Telegraph 存档 + /search 索引', async () => {
    const kv = memKv();
    await archiveTweet(mkEnv(kv), '944783507', 'fe2o3', '123', ctx);
    await Promise.allSettled(pending);
    // 单图帖走 sendPhoto(caption=卡片)
    const photoCall = calls.find((c) => c.url.includes('/sendPhoto'));
    expect(photoCall?.body?.caption?.toString() ?? '').toContain('Hello world');
    expect(photoCall?.body?.photo).toBe('https://x/photo.jpg');
    // Telegraph 页 URL 已存 KV(archive:tg:<stamp>)
    const tgKey = [...kv.store.keys()].find((k) => k.startsWith('archive:tg:'));
    expect(tgKey).toBeTruthy();
    expect(kv.store.get(tgKey!)).toBe('https://telegra.ph/x-post-1');
    // repo 索引 + search:index 已写
    expect([...kv.store.keys()].some((k) => k.startsWith('archive:idx:'))).toBe(true);
  });

  it('article 引用帖(v2 无 article 对象) → 转 fixupx 提取正文, 标题/链接转 fixupx', async () => {
    mode = 'article-ref';
    const env = { ...mkEnv(), JINA_API_KEY: 'j' };
    await archiveTweet(env, '944783507', 'fe2o3', '125', ctx);
    await Promise.allSettled(pending);
    const card = sendMessages().find((c) => String(c.body.text ?? '').includes('fixupx.com'));
    expect(card).toBeTruthy(); // 卡片存在且标题直链已转 fixupx
    const text = String(card!.body.text ?? '');
    expect(text).toContain('https://fixupx.com/fe2o3/status/125');
    expect(text).toContain('钓鱼邮件分析报告'); // 正文与标题来自 fixupx 提取
    expect(text).not.toContain('x.com/i/article/'); // 裸引用链不再出现
  });

  it('article 内嵌块 → 正文并入 MD + Telegraph 节点, 标题用 article.title', async () => {
    mode = 'article-inline';
    await archiveTweet(mkEnv(), '944783507', 'fe2o3', '126', ctx);
    await Promise.allSettled(pending);
    // 有 photo 走 sendPhoto(caption = renderTweetHtml, 含文章标题)
    const photo = calls.find((c) => c.url.includes('/sendPhoto'));
    expect(photo).toBeTruthy();
    const cap = String(photo?.body?.caption ?? '');
    expect(cap).toContain('嵌套文章标题'); // renderTweetHtml 用 article.title
  });

  it('article 引用帖(fixupx 提取失败) → fxtwitter.com 同源兜底, 展示链接仍 fixupx', async () => {
    mode = 'article-ref';
    const env = { ...mkEnv(), JINA_API_KEY: 'j' };
    const saves: string[] = [];
    try {
      vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
        const u = String(url);
        if (u.includes('api.fxtwitter.com')) return new Response(JSON.stringify(TWEET_ARTICLE_REF), { status: 200, headers: { 'content-type': 'application/json' } });
        if (u.startsWith('https://web.archive.org/save/')) { saves.push(u); return new Response('ok', { status: 200 }); }
        if (u.includes('api.telegram.org')) { calls.push({ url: u, body: JSON.parse(String(init?.body ?? '{}')) }); return new Response(JSON.stringify({ ok: true }), { status: 200 }); }
        if (u.includes('api.telegra.ph')) return new Response(JSON.stringify({ ok: true, result: { url: 'https://telegra.ph/x-post-1' } }), { status: 200 });
        if (u.includes('r.jina.ai') && u.includes('fixupx.com')) return new Response('nope', { status: 404 });
        if (u.includes('fxtwitter.com/fe2o3/status/125')) return new Response('# 备用域提取的文章标题\n\n' + '正文内容段落。'.repeat(12), { status: 200 });
        throw new Error(`unexpected ${u}`);
      }) as typeof fetch);
      await archiveTweet(env, '944783507', 'fe2o3', '125', ctx);
      await Promise.allSettled(pending);
      const card = sendMessages().find((c) => String(c.body.text ?? '').includes('fixupx.com'));
      expect(card).toBeTruthy();
      expect(String(card!.body.text ?? '')).toContain('备用域提取的文章标题'); // 正文来自 fxtwitter 兜底
      expect(saves.length).toBe(1); // Wayback save 指向 fixupx 展示链接
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('tweet 为空(FxEmbed 404) → 落 archiveUrl 通用链, 不抛错且发 TG', async () => {
    mode = 'tweet-empty';
    const kv = memKv();
    await archiveTweet(mkEnv(kv), '944783507', 'fe2o3', '999', ctx); // 不应 reject
    // 通用 URL 存档链走的也是 TG API(markdown 转换三级链失败 → 提示或归档)至少有一次 send
    expect(calls.some((c) => c.url.includes('api.telegram.org'))).toBe(true);
  });

  it('发卡失败(TG 网络错) → 仍有一条 ⚠️ 提示送达(发送层吞错, 靠返回值降级)', async () => {
    mode = 'fail-send';
    const kv = memKv();
    await archiveTweet(mkEnv(kv), '944783507', 'fe2o3', '123', ctx);
    await Promise.allSettled(pending);
    const msgs = sendMessages();
    expect(msgs.some((c) => String(c.body?.text).includes('⚠️ 已取到帖子但发送失败'))).toBe(true);
  });
});