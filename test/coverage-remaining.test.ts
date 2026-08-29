// 补齐剩余覆盖缺口: catch 分支 / 边缘条件 / 低层异常路径
import { describe, it, expect, vi } from 'vitest';
import { encodeBase64 } from '../src/archive';
import { extractDeepwikiOverview } from '../src/deepwiki';
import { isChinese, resolveDescriptions, translateTextZh, summarizeZh } from '../src/translate';
import { extractOgImage } from '../src/urlmd';
import { vecSearch } from '../src/vec';
import { extractDesc } from '../src/zread';
import { fetchHackerNewsProducts } from '../src/sources/hn';
import { fetchTrending } from '../src/sources/trending';
import { sendTelegram, sendPhotoOrText } from '../src/notify';
import { libToEntry, archToEntry, matchEntries } from '../src/search-index';
import { renderTelegraphNodes } from '../src/render';
import { fetchProductHuntGraphql } from '../src/ph';

// ---------- archive.ts ----------
describe('archive: encodeBase64 / decodeBase64', () => {
  it('encodeBase64 → btoa 等价(小缓冲)', () => {
    expect(encodeBase64(new TextEncoder().encode('hello world'))).toBe(btoa('hello world'));
    expect(encodeBase64(new Uint8Array([0, 1, 2, 255]))).toBe(btoa(String.fromCharCode(0, 1, 2, 255)));
  });
  it('encodeBase64 大缓冲(>0x8000) 分块仍等价', () => {
    const big = new Uint8Array(70000);
    for (let i = 0; i < big.length; i++) big[i] = i % 251;
    const ref = new Uint8Array(big.length);
    for (let i = 0; i < big.length; i++) ref[i] = big[i];
    expect(encodeBase64(big)).toBe(btoa(String.fromCharCode(...ref)));
  });
});

// ---------- deepwiki.ts ----------
describe('deepwiki: extractDeepwikiOverview 边缘', () => {
  it('无 Overview 标记 → null', () => {
    expect(extractDeepwikiOverview('<html>no overview here</html>')).toBeNull();
  });
  it('Overview 后无正文 → null', () => {
    const payload = 'Overview:Repo\n<details><summary>Files</summary></details>\n\n## Other\n\n';
    expect(extractDeepwikiOverview(payload)).toBeNull();
  });
  it('正文太短(<40) → null', () => {
    const payload = 'Overview:Repo\n<details><summary>Files</summary></details>\n\n## Purpose\n\nShort text.';
    // 短文本跳过
    expect(extractDeepwikiOverview(payload)).toBeNull();
  });
  it('模板开场白 "This page provides a comprehensive introduction to X, 描述" → 剥到逗号后', () => {
    const payload = 'Overview:Repo\n<details><summary>Files</summary></details>\n\n## Purpose and Scope\n\nThis page provides a comprehensive introduction to Fancy Project, a new tool for building web apps with Rust. It uses a Yew-based architecture.\n\n## Other';
    const out = extractDeepwikiOverview(payload, 800);
    expect(out).toBeTruthy();
    expect(out).not.toContain('This page provides');
    expect(out).toContain('a new tool for building');
  });
  it('模板开场白无逗号 → 取整段', () => {
    const payload = 'Overview:Repo\n<details><summary>Files</summary></details>\n\n## Purpose\n\nThis document provides an overview of SimpleTool a basic utility library written in Rust.\n\n## Other';
    const out = extractDeepwikiOverview(payload, 800);
    expect(out).toBeTruthy();
    expect(out).toContain('SimpleTool');
  });
});

// ---------- translate.ts ----------
describe('translate: isChinese 边缘', () => {
  it('null/undefined → false', () => { expect(isChinese(null)).toBe(false); expect(isChinese(undefined)).toBe(false); });
  it('3 字中文 → false(过短)', () => { expect(isChinese('你好世')).toBe(false); });
  it('4 字中文 → true', () => { expect(isChinese('你好世界')).toBe(true); });
  it('中文占比不足 30%(含大量英文) → false', () => { expect(isChinese('你好abcdefghijklmnopqrstuvwxyz')).toBe(false); });
});
describe('translate: resolveDescriptions 空列表', () => {
  it('items 空 → 不抛', async () => {
    await expect(resolveDescriptions({} as any, [])).resolves.toBeUndefined();
  });
});
describe('translate: translateTextZh 空/已中文输入', () => {
  it('空文本 → null', async () => { expect(await translateTextZh({} as any, '')).toBeNull(); });
  it('已中文 → 原文', async () => { expect(await translateTextZh({} as any, '你好世界')).toBe('你好世界'); });
});
describe('translate: summarizeZh 无 AI 绑定', () => {
  it('env.AI 不存在 → null', async () => {
    expect(await summarizeZh({} as any, 'text')).toBeNull();
  });
});

// ---------- urlmd.ts ----------
describe('urlmd: extractOgImage 边缘', () => {
  it('无 meta → null', () => { expect(extractOgImage('<html></html>')).toBeNull(); });
  it('twitter:image 匹配', () => {
    expect(extractOgImage('<meta name="twitter:image" content="https://x.com/img.png">')).toBe('https://x.com/img.png');
  });
  it('相对路径 → null', () => {
    expect(extractOgImage('<meta property="og:image" content="/img.png">')).toBeNull();
  });
  it('协议相对 → https: 补全', () => {
    expect(extractOgImage('<meta property="og:image" content="//cdn.x.com/img.png">')).toBe('https://cdn.x.com/img.png');
  });
  it('content 前置属性序', () => {
    expect(extractOgImage('<meta content="https://x.com/img.png" property="og:image">')).toBe('https://x.com/img.png');
  });
});

// ---------- vec.ts ----------
describe('vec: vecSearch 未绑定', () => {
  it('无 VEC → []', async () => { expect(await vecSearch({} as any, 'q')).toEqual([]); });
  it('VEC query 抛错 → []', async () => {
    const env = { AI: { run: async () => ({ data: [[0.1]] }) }, VEC: { query: async () => { throw new Error('vec down'); } } } as any;
    expect(await vecSearch(env, 'q')).toEqual([]);
  });
});

// ---------- zread.ts ----------
describe('zread: extractDesc 边缘', () => {
  it('RSC 杂讯/编号行/非中文 → 跳过', () => {
    const payload = 'X'.repeat(30000) + '\n\n```code\n$0\n```\n\n1. numbered list\n\nAn English-only paragraph without enough Chinese characters to pass the guard.\n\n## 概述\n\n这是一个中文描述内容的测试段落, 用于验证选择器是否能正确选中概述段。';
    const out = extractDesc(payload, 280, 'test');
    expect(out).toBeTruthy();
    expect(out).toContain('中文描述');
  });
  it('无概览标记 → 最长含 subject 定义段', () => {
    const payload = 'X'.repeat(30000) + '\n\n## 其他标题\n\n这是一个纯中文的描述段落, 用于验证当没有概览标题时是否选择包含仓库名的定义段。test项目是一个好工具。\n\nSome more text.';
    const out = extractDesc(payload, 280, 'test');
    expect(out).toBeTruthy();
    expect(out).toContain('test');
  });
  it('无定义段 → null', () => {
    const payload = 'X'.repeat(30000) + '\n\nSome random text without definitions.\n\n';
    expect(extractDesc(payload, 280)).toBeNull();
  });
});

// ---------- hn.ts ----------
describe('hn: fetchHackerNewsProducts 边缘', () => {
  it('limit 变体: 0 / 负数 / 超 50 → 各消毒', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ hits: [] }), { status: 200 }));
    await expect(fetchHackerNewsProducts(0)).resolves.toEqual([]);
    await expect(fetchHackerNewsProducts(-5)).resolves.toEqual([]);
    await expect(fetchHackerNewsProducts(100)).resolves.toEqual([]);
  });
  it('响应非 200 → 抛', async () => {
    globalThis.fetch = vi.fn(async () => new Response('err', { status: 503 }));
    await expect(fetchHackerNewsProducts(5)).rejects.toThrow('hn algolia 503');
  });
  it('hits 空数组 → 返回空数组', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ hits: [] }), { status: 200 }));
    expect(await fetchHackerNewsProducts(5)).toEqual([]);
  });
});

// ---------- trending.ts ----------
describe('trending: fetchTrending 边缘', () => {
  it('非 200 → 抛', async () => {
    globalThis.fetch = vi.fn(async () => new Response('err', { status: 500 }));
    await expect(fetchTrending()).rejects.toThrow('trending fetch 500');
  });
});

// ---------- notify.ts ----------
describe('notify: sendTelegram 非 200 → 只记日志不抛', () => {
  it('500 响应不抛', async () => {
    globalThis.fetch = vi.fn(async () => new Response('err', { status: 500 }));
    await expect(sendTelegram('t', 'c', 'hi')).resolves.toBeUndefined();
  });
  it('sendPhotoOrText 图床缓存 key=null(非 https) → 跳过 file_id 读', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 404 }));
    await expect(sendPhotoOrText('t', 'c', 'data:image/png,abc', 'cap')).resolves.toBeUndefined();
  });
});

// ---------- search-index.ts ----------
describe('search-index: libToEntry/archToEntry/matchEntries', () => {
  it('libToEntry: tags/folder/lang 拼入 hay', () => {
    const e = libToEntry({ src: 'star', name: 'a/b', url: 'u', desc: 'd', tags: ['rust', 'ai'], folder: 'my', lang: 'TypeScript' });
    expect(e[3]).toContain('rust');
    expect(e[3]).toContain('my');
    expect(e[3]).toContain('typescript');
  });
  it('archToEntry: descZh 优先', () => {
    const e = archToEntry({ repo: 'a/b', date: '2026-08-30', desc: 'en', descZh: '中文' });
    expect(e[4]).toBe('中文');
  });
  it('matchEntries: 空 query → []', () => {
    expect(matchEntries([['star','a','u','desc']], '')).toEqual([]);
  });
  it('matchEntries: 多词 AND 过滤', () => {
    const entries: any[] = [
      ['star', 'rust-cli', 'url', 'rust cli tool'],
      ['star', 'web-server', 'url', 'web server'],
      ['star', 'rust-web', 'url', 'rust web framework'],
    ];
    const hits = matchEntries(entries, 'rust web');
    expect(hits.map((h) => h[1])).toEqual(['rust-web']); // rust-cli hay 无 'web' → 不匹配
  });
});

// ---------- render.ts ----------
describe('render: renderTelegraphNodes 中文 descZh', () => {
  it('中文 descZh → 带描述行', () => {
    const nodes = renderTelegraphNodes([{ title: 'a/b', url: 'u', descZh: '中文描述' } as any]);
    const str = JSON.stringify(nodes);
    expect(str).toContain('中文描述');
  });
  it('非中文 descZh → 无描述行', () => {
    const nodes = renderTelegraphNodes([{ title: 'a/b', url: 'u', descZh: 'english only' } as any]);
    const str = JSON.stringify(nodes);
    expect(str).not.toContain('english only');
  });
});

// ---------- ph.ts ----------
describe('ph: fetchProductHuntGraphql 边缘', () => {
  it('edges 非数组(数据层缺失) → []', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({ data: { posts: {} } }), { status: 200 }));
    expect(await fetchProductHuntGraphql({ PH_API_TOKEN: 'ph' } as any)).toEqual([]);
  });
  it('node name 非法/无官网无 PH 页 → 跳过', async () => {
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      data: { posts: { edges: [
        { node: { name: 123, websiteUrl: 'https://go.com', url: 'https://ph.com/p' } }, // name 非 string
        { node: { name: 'Valid', websiteUrl: '', url: '' } }, // 无官网无 PH 页
      ] } },
    }), { status: 200 }));
    expect(await fetchProductHuntGraphql({ PH_API_TOKEN: 'ph' } as any)).toEqual([]);
  });
  it('fetch 抛错 → []', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('net'); });
    expect(await fetchProductHuntGraphql({ PH_API_TOKEN: 'ph' } as any)).toEqual([]);
  });
});