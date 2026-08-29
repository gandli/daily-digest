// runDigest 回归锁: 缓存命中重放 / miss 全流程 / 抓取失败⚠️ / 旧格式纯数组回退。
// 依赖: vi.mock trending(fetchTrending 受控) + mock global fetch(TG/GitHub/翻译 no-op) + KV 内存 stub。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchTrending } from '../src/sources/trending';

vi.mock('../src/sources/trending', () => ({ fetchTrending: vi.fn() }));

import { runDigest } from '../src/index';

type Call = { url: string; body: any };
const calls: Call[] = [];

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes('api.telegram.org')) {
    calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }
  // GitHub API(archive PUT / repo detail / dispatch) + 翻译回退链 + Telegraph: 一律空 ok。
  return new Response('{}', { status: 200 });
}) as typeof fetch;

const items = [
  { title: 'owner/repo', url: 'https://github.com/owner/repo', desc: 'a rust cli tool' },
] as any[];

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
  CACHE: kv, AI: undefined, TELEGRAPH_TOKEN: undefined, GH_ARCHIVE_REPO: 'gandli/daily-digest',
});

const sentMessages = () => calls.filter((c) => c.url.includes('/sendMessage'));
const sentPhotos = () => calls.filter((c) => c.url.includes('/sendPhoto'));

describe('runDigest', () => {
  beforeEach(() => {
    calls.length = 0;
    vi.mocked(fetchTrending).mockReset();
    vi.mocked(fetchTrending).mockResolvedValue(items as any);
  });

  it('缓存命中(新格式 {chunks,repos}) → 用 sendPerRepoMessages 重放带 OG 图, 不重抓', async () => {
    const kv = memKv();
    const key = `digest:${new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)}`;
    await kv.put(key, JSON.stringify({ chunks: ['card1', 'card2'], repos: ['a/b', 'c/d'] }));
    const n = await runDigest(mkEnv(kv));
    expect(n).toBe(0);
    expect(vi.mocked(fetchTrending)).not.toHaveBeenCalled(); // 不发重抓
    expect(calls.filter((c) => c.url.includes('/sendPhoto')).length).toBe(2); // 缓存 2 块重放(带 OG 图, 走 sendPhoto)
    expect(calls.filter((c) => c.url.includes('/sendPhoto')).some((m) => String(m.body.photo).includes('opengraph.githubassets.com/1/a/b'))).toBe(true);
  });

  it('缓存 miss → 完整抓取 + 翻译 + 渲染 + 存档 + 发卡, 返回条数', async () => {
    const kv = memKv();
    expect(await kv.get('digest:undefined')).toBeNull();
    const n = await runDigest(mkEnv(kv));
    expect(vi.mocked(fetchTrending)).toHaveBeenCalledTimes(1);
    expect(n).toBe(items.length);
    expect(sentMessages().length + sentPhotos().length).toBe(items.length);
    // 缓存已写入(含 chunks+repos 新格式)
    const raw = await kv.get(`digest:${new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)}`);
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw!).chunks).toHaveLength(1);
    // /search 索引已追加
    expect(await kv.get('search:index')).toBeTruthy();
  });

  it('抓取失败 → sendTelegram ⚠️ + return -1, 不发卡', async () => {
    vi.mocked(fetchTrending).mockRejectedValueOnce(new Error('network down'));
    const n = await runDigest(mkEnv());
    expect(n).toBe(-1);
    const msg = sentMessages()[0]?.body?.text ?? '';
    expect(msg).toContain('⚠️ daily-digest 抓取失败');
  });

  it('旧格式缓存(纯 string[] 数组) → 逐条 sendTelegram', async () => {
    const kv = memKv();
    const key = `digest:${new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10)}`;
    await kv.put(key, JSON.stringify(['chunk-a', 'chunk-b', 'chunk-c']));
    const n = await runDigest(mkEnv(kv));
    expect(n).toBe(0);
    expect(vi.mocked(fetchTrending)).not.toHaveBeenCalled();
    expect(sentMessages().length).toBe(3);
  });
});