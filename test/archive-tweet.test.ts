// archiveTweet 回归锁: FxEmbed 成功发卡+Telegraph+存档 / tweet 空落通用链 / 发送失败发⚠️。
// 依赖: mock global fetch(FxEmbed/TG/GitHub/Telegraph) + KV 内存 stub + ctx.waitUntil。
import { describe, it, expect, beforeEach } from 'vitest';
import { archiveTweet } from '../src/index';

type Mode = 'ok' | 'tweet-empty' | 'fail-send' | 'fail-dispatch';
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

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes('api.fxtwitter.com')) {
    return mode === 'tweet-empty'
      ? new Response('{}', { status: 404 })
      : new Response(JSON.stringify(TWEET_OK), { status: 200, headers: { 'content-type': 'application/json' } });
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

  it('tweet 为空(FxEmbed 404) → 落 archiveUrl 通用链, 不抛错且发 TG', async () => {
    mode = 'tweet-empty';
    const kv = memKv();
    await archiveTweet(mkEnv(kv), '944783507', 'fe2o3', '999', ctx); // 不应 reject
    // 通用 URL 存档链走的也是 TG API(markdown 转换三级链失败 → 提示或归档)至少有一次 send
    expect(calls.some((c) => c.url.includes('api.telegram.org'))).toBe(true);
  });

  it('发卡失败(sendPerRepoMessages reject) → sendTelegram ⚠️ 存档失败', async () => {
    mode = 'fail-send';
    const kv = memKv();
    await archiveTweet(mkEnv(kv), '944783507', 'fe2o3', '123', ctx);
    const msgs = sendMessages();
    expect(msgs.some((c) => String(c.body?.text).includes('⚠️ 已取到帖子但存档失败'))).toBe(true);
  });
});