// 第五轮: 小文件 branch 缺口收口。全 mock。
import { describe, it, expect, vi } from 'vitest';
import { d1ArchivePage } from '../src/d1';
import { articleRefFixup } from '../src/fxtweet';
import { archToEntry } from '../src/search-index';
import { vecUpsertItems, vecSearch } from '../src/vec';
import { extractOgImage } from '../src/urlmd';
import { fetchHackerNewsProducts } from '../src/sources/hn';
import { renderMessage } from '../src/render';

// d1.ts L67 count?.n ?? 0 (count undefined 左臂)
describe('d1: count?.n undefined → ?? 0 触发', () => {
  it('first 返回 {n: undefined} → ?? 0 fires', async () => {
    const db = { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }), first: async () => ({ n: undefined }) }) }) } as never;
    expect(await d1ArchivePage({ DB: db } as never, 10, 0)).toBeNull();
  });
});

// fxtweet.ts L46 (articleRefFixup, 非 extractTweet)
describe('fxtweet: articleRefFixup 非文章分支', () => {
  it('!tweet.id 为真 → 返回 null', () => {
    expect(articleRefFixup({ text: 'hello' } as never, 'handle')).toBeNull();
  });
  it('tweet.id 有但 text 非文章 → 返回 null', () => {
    expect(articleRefFixup({ id: '123', text: 'just a normal tweet' } as never, 'h')).toBeNull();
  });
  it('id + article 链接 → 返回 fixupx 链接', () => {
    expect(articleRefFixup({ id: '123', text: 'https://x.com/i/article/456' } as never, 'h')).toBe('https://fixupx.com/h/status/123');
  });
});

// hn.ts L12 hits ?? [] / L14 title ?? ''
describe('hn: fetchHackerNewsProducts 字段缺失', () => {
  it('hits 非数组 → 回落 []', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ hits: null }), { status: 200 }));
    expect(await fetchHackerNewsProducts(5)).toEqual([]);
  });
  it('title 缺失 → 回落空串', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ hits: [{ objectID: '1', url: 'https://x.com', points: 10 }] }), { status: 200 }));
    const items = await fetchHackerNewsProducts(5);
    expect(items[0]).toBeDefined();
    expect(items[0].title).toBe('');
  });
});

// urlmd.ts L77 cond-expr / L113 cond-expr
describe('urlmd: extractOgImage 空回落', () => {
  it('body 短 → 返回 null', async () => {
    globalThis.fetch = vi.fn(async () => new Response('<html><head><meta property="og:image" content=""/></head></html>', { status: 200 }));
    expect(await extractOgImage('https://x.com')).toBeNull();
  });
});

// vec.ts L38 ?? / L56 ??
describe('vec: upsert items 字段缺失', () => {
  it('metadata 无 url → 空串', async () => {
    const env = { AI: { run: async () => ({ data: [[0.1]] }) }, VEC: { upsert: vi.fn() } } as never;
    await expect(vecUpsertItems(env, [{ title: 'a' }] as never)).resolves.toBeUndefined();
  });
  it('search matches 无 metadata → 空', async () => {
    const env = { AI: { run: async () => ({ data: [0.1, 0.2] }) }, VEC: { query: vi.fn(async () => ({ matches: [{ id: '1' }] })) } } as never;
    const r = await vecSearch(env, 'q');
    expect(r).toEqual([]);
  });
});

// render.ts L51 cond-expr (tags 缺失)
describe('render: renderMessage tags 缺失', () => {
  it('无 topics → 仅 #trending 标签', () => {
    const msgs = renderMessage('2026-08-30', [{ title: 'test', desc: 'body', stars: 100, url: 'https://github.com/x/y' } as never]);
    expect(msgs[0]).toContain('test');
    expect(msgs[0]).toContain('#trending');
  });
});

// search-index.ts L19 descZh 缺失回落 desc
describe('search-index: archToEntry descZh 缺失', () => {
  it('无 descZh 无 desc → 空串', () => {
    const e = archToEntry({ repo: 'a/b', date: 'd' });
    expect(e[4]).toBeUndefined();
  });
  it('descZh 有 → 用之', () => {
    const e = archToEntry({ repo: 'a/b', date: 'd', descZh: '中文描述内容' });
    expect(e[4]).toBe('中文描述内容');
  });
});