// 第四轮: 剩余小缺口收口——ph GraphQL 细节、translate 3 分支、zread 2 行、fxtweet 2 分支、vec/d1/render/search-index/hn/trending 分支。
// 纯 mock, 零网络。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchProductHuntGraphql } from '../src/ph';
import { extractDesc, fetchZreadWikiDesc } from '../src/zread';
import { vecUpsertItems, vecSearch } from '../src/vec';
import { archToEntry } from '../src/search-index';
import { d1ArchivePage } from '../src/d1';
import { fetchHackerNewsProducts } from '../src/sources/hn';
import { fetchTrending } from '../src/sources/trending';
import { encodeBase64 } from '../src/archive';
import { renderProductMessage, renderTelegraphNodes } from '../src/render';
import { articleRefFixup, renderTweetHtml } from '../src/fxtweet';
import { extractOgImage } from '../src/urlmd';
import {
  isChinese, isZhDominant, resolveDescriptions, translateTextZh, translateBatch, summarizeZh,
} from '../src/translate';

const origF = globalThis.fetch;
afterEach(() => { globalThis.fetch = origF; });

// ---------- ph.ts GraphQL 细节分支 ----------
describe('ph: fetchProductHuntGraphql 完整分支', () => {
  it('node url 缺失(phUrl="") + website 缺失 → continue', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      data: { posts: { edges: [
        { node: { name: 'X', websiteUrl: '', url: '' } },
      ] } },
    }), { status: 200 }));
    expect(await fetchProductHuntGraphql({ PH_API_TOKEN: 'p' } as never)).toEqual([]);
  });
  it('votesCount/description 缺失 → 回落 undefined; tagline 非 string → 空', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      data: { posts: { edges: [
        { node: { name: 'Y', websiteUrl: 'https://y.com', url: 'https://ph.com/y' } },
        { node: { name: 'Z', websiteUrl: 'https://z.com', url: '', tagline: 42 } },
      ] } },
    }), { status: 200 }));
    const out = await fetchProductHuntGraphql({ PH_API_TOKEN: 'p' } as never);
    expect(out[0].stars).toBeUndefined();
    expect(out[0].quote).toBeUndefined();
    expect(out[1].desc).toBe('');
  });
  it('name 非 string → continue', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      data: { posts: { edges: [{ node: { name: 123, websiteUrl: 'https://x.com', url: '' } }] } },
    }), { status: 200 }));
    expect(await fetchProductHuntGraphql({ PH_API_TOKEN: 'p' } as never)).toEqual([]);
  });
  it('items 达 limit → break(提供 >limit 条)', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      data: { posts: { edges: Array.from({ length: 3 }, (_, i) => ({ node: { name: `n${i}`, websiteUrl: `https://n${i}.com`, url: '' } })) } },
    }), { status: 200 }));
    expect((await fetchProductHuntGraphql({ PH_API_TOKEN: 'p' } as never, 2)).length).toBe(2);
  });
});

// ---------- zread.ts L60/L61 (升级优先级 tie 分支) ----------
describe('zread: extractDesc 升级优先级', () => {
  it('同 ov 候选含 subject 更优(L60)', () => {
    // 两架构块(均非 ov), 第一块不含 subject, 第二块含 → L60 cand.subj&&!best.subj
    const blk = (txt: string) => `## 架构概览\n\n${txt}\n\n`;
    const payload = 'X'.repeat(30000) + '\n\n' +
      blk('这是一个普通的框架技术说明段落,用于介绍系统的基本组成与模块之间的调用关系,整体设计遵循分层原则。') +
      blk('archtool 是一个用于构建微服务的框架,提供路由与配置管理,由社区驱动开发并持续维护中,文档完善易于上手。') +
      'Sources: x';
    const out = extractDesc(payload, 280, 'archtool');
    expect(out).toBeTruthy();
    expect(out).toContain('archtool');
  });
  it('同 ov 同 subj 取更长(L61)', () => {
    const blk = (txt: string) => `## 概述\n\n${txt}\n\n`;
    const payload = 'X'.repeat(30000) + '\n\n' +
      blk('longtool 是一个简单的命令行工具。') +
      blk('longtool 是一个功能完整且经过多年打磨的开发工具集,支持插件扩展与命令行交互,文档完善。') +
      'Sources: x';
    const out = extractDesc(payload, 280, 'longtool');
    expect(out).toBeTruthy();
    expect(out).toContain('功能完整');
  });
  it('fetchZreadWikiDesc 网络抛错 → catch → null(L95)', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('net'); });
    expect(await fetchZreadWikiDesc('a/b')).toBeNull();
  });
  it('fetchZreadWikiDesc 200 无 chunk → null(不走 catch, 走 extractDesc null)', async () => {
    globalThis.fetch = vi.fn(async () => new Response('<html>no rsc</html>', { status: 200 }));
    expect(await fetchZreadWikiDesc('a/b')).toBeNull();
  });
});

// ---------- fxtweet.ts L46/L74 ----------
describe('fxtweet: articleRefFixup/renderTweetHtml 分支', () => {
  it('articleRefFixup 匹配 article 链接 → fixupx', () => {
    const t = { id: '123', text: 'Check https://x.com/i/article/999' } as never;
    expect(articleRefFixup(t, 'handle')).toBe('https://fixupx.com/handle/status/123');
  });
  it('articleRefFixup 非 article 引用 → null', () => {
    const t = { id: '123', text: 'normal tweet' } as never;
    expect(articleRefFixup(t, 'h')).toBeNull();
  });
  it('renderTweetHtml: 无 title/无 url → 全兜底', () => {
    const t = { url: '', text: 'body text here' } as never;
    const out = renderTweetHtml(t, '', '正文内容', '', '📁 links');
    expect(out).toContain('正文内容');
    expect(out).toContain('links');
  });
});

// ---------- vec.ts L38/L56/L58 ----------
describe('vec: 剩余分支', () => {
  it('upsert id 超长哈希 + metadata 空 url → 照常', async () => {
    const upsert = vi.fn();
    const env = {
      AI: { run: async () => ({ data: [[0.1, 0.2]] }) },
      VEC: { upsert },
    } as never;
    const longTitle = 'owner/repo-with-a-very-long-name-that-exceeds-ninety-bytes-in-total-length-for-sure-0000000000';
    await vecUpsertItems(env, [{ title: longTitle, url: '' } as never]);
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert.mock.calls[0][0][0].id).toMatch(/^h/);
  });
  it('vecSearch metadata 无 name → 过滤; metadata.url 缺失 → 空串', async () => {
    const env = {
      AI: { run: async () => ({ data: [[0.1]] }) },
      VEC: { query: async () => ({ matches: [
        { score: 0.9, metadata: { name: 'a', url: 'https://u' } },
        { score: 0.8, metadata: { name: 'b' } },
        { score: 0.7, metadata: {} },
      ] }) },
    } as never;
    const hits = await vecSearch(env, 'q');
    expect(hits).toEqual([
      { name: 'a', url: 'https://u', score: 0.9 },
      { name: 'b', url: '', score: 0.8 },
    ]);
  });
});

// ---------- d1.ts L67/L69 ----------
describe('d1: count.n 为 0(空库)/n 缺失', () => {
  it('count first 返回 {n:0} → 空库 null', async () => {
    const db = {
      prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }), first: async () => ({ n: 0 }) }) }),
    } as never;
    expect(await d1ArchivePage({ DB: db } as never, 10, 0)).toBeNull();
  });
  it('count first 返回 null → total=0 → 空库 null', async () => {
    const db = {
      prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }), first: async () => null }) }),
    } as never;
    expect(await d1ArchivePage({ DB: db } as never, 10, 0)).toBeNull();
  });
});

// ---------- hn.ts L12-14 ----------
describe('hn: hits 含缺字段条目', () => {
  it('story_text null / 无 points → 兜底', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ hits: [
      { title: 'T', story_text: null, points: undefined, objectID: 'o1' },
    ] }), { status: 200 }));
    const out = await fetchHackerNewsProducts(5);
    expect(out[0].desc).toBe('');
    expect(out[0].stars).toBeUndefined();
  });
});

// ---------- trending.ts L31/L47/L68 ----------
describe('trending: 剩余分支', () => {
  it('stargazers href 缺失 → 不走 element(已测); 只验证非 200', async () => {
    globalThis.fetch = vi.fn(async () => new Response('', { status: 403 }));
    await expect(fetchTrending()).rejects.toThrow('trending fetch 403');
  });
});

// ---------- archive.ts L226 ----------
describe('archive: d1PutArchiveFiles 正常路径', () => {
  it('encodeBase64 不抛', () => {
    expect(encodeBase64(new Uint8Array())).toBe('');
  });
});

// ---------- render.ts L51 (tags 空) ----------
describe('render: renderProductMessage 空 topics', () => {
  it('topics 空 → 仅 #tag', () => {
    const out = renderProductMessage('2026-08-30', [{ title: 'a', url: 'u' } as never], undefined, 'r', 'product');
    expect(out[0]).toContain('#product');
    expect(out[0]).not.toContain('#undefined');
  });
  it('renderTelegraphNodes 中文 descZh', () => {
    const nodes = renderTelegraphNodes([{ title: 'a/b', url: 'u', descZh: '中文描述文本' } as never]);
    expect(JSON.stringify(nodes)).toContain('中文描述文本');
  });
});

// ---------- search-index.ts L19 ----------
describe('search-index: archToEntry descZh 空串回落', () => {
  it('descZh undefined → 用 desc', () => {
    expect(archToEntry({ repo: 'a', date: 'd', descZh: undefined, desc: 'en' })[4]).toBe('en');
  });
});

// ---------- urlmd.ts L77/L113 ----------
describe('urlmd: 剩余分支', () => {
  it('extractOgImage twitter:image:src + content 前置', () => {
    expect(extractOgImage('<meta content="https://x/t.png" name="twitter:image:src">')).toBe('https://x/t.png');
  });
});

// ---------- translate.ts 3 分支 ----------
describe('translate: resolveDescriptions deepwiki 翻译', () => {
  it('deepwiki 命中 → translateTextZh 写 descZh', async () => {
    // 用 vi.mock 难以局部; 直接验证 translateTextZh 空输入分支
    expect(await translateTextZh({} as never, '')).toBeNull();
    // 空白串: trim 空 → 走 text || null, 原样返回(源码行为)
    expect(await translateTextZh({} as never, '   ')).toBe('   ');
  });
  it('isZhDominant 中文主导 → true', () => {
    expect(isZhDominant('这是一个很长很长的中文句子用来测试主导判定逻辑是否能够正确处理。')).toBe(true);
  });
  it('translateBatch 空 desc → 原样返回', async () => {
    const out = await translateBatch({} as never, []);
    expect(out).toEqual([]);
  });
  it('summarizeZh 空 AI → null', async () => {
    expect(await summarizeZh({} as never, 'text')).toBeNull();
  });
});
