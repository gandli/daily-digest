// 最后一轮覆盖收口: 可达防御分支补测。纯 mock, 零网络。
import { describe, it, expect, vi, afterEach } from 'vitest';
import { extractDeepwikiOverview } from '../src/deepwiki';
import { extractDesc, fetchZreadBatch } from '../src/zread';
import { archiveToGitHub, flushArchivedPending } from '../src/archive';
import { runProductThin } from '../src/index';

const origF = globalThis.fetch;
afterEach(() => { globalThis.fetch = origF; });

// ---------- index.ts L442-447: runProductThin 缓存命中成功路径 ----------
describe('runProductThin: 缓存命中', () => {
  it('hn: 有有效缓存 → 解析 chunks 发卡片, 返回条数, 零 dispatch', async () => {
    const calls: { url: string }[] = [];
    globalThis.fetch = vi.fn(async (u: string, init?: RequestInit) => {
      calls.push({ url: u });
      if (u.includes('api.telegram.org')) return new Response(JSON.stringify({ ok: true }), { status: 200 });
      return new Response('{}', { status: 200 });
    });
    const env = {
      BOT_TOKEN: 't', CHAT_ID: '9', GH_TOKEN: 'g', GH_ARCHIVE_REPO: 'gandli/daily-digest',
      CACHE: {
        get: async (k: string) => (k.startsWith('hn:pending:') ? null : k.startsWith('hn:') ? JSON.stringify({ chunks: ['<b>a</b>', '<b>b</b>'] }) : null),
        put: async () => {},
      },
    } as any;
    const n = await runProductThin(env, '9');
    expect(n).toBe(2);
    const msgs = calls.filter((c) => c.url.includes('/sendMessage'));
    expect(msgs.length).toBe(2);
    expect(calls.some((c) => c.url.includes('/dispatches'))).toBe(false);
  });
});

// ---------- index.ts L441/L470: runProductThin CACHE.get 抛错 catch ----------
describe('runProductThin: KV get 抛错', () => {
  it('KV get 抛错 → 走 miss 链(不崩), dispatch 成功但 CACHE.put 抛错 → 吞掉照发', async () => {
      const calls: { url: string; body?: string }[] = [];
      let putCalled = false;
      globalThis.fetch = (async (u: string, init?: RequestInit) => {
        calls.push({ url: u, body: String(init?.body ?? '') });
        if (u.includes('raw.githubusercontent.com')) return new Response('{"items":[]}', { status: 200 });
        if (u.includes('/dispatches')) return new Response('{}', { status: 200 });
        if (u.includes('api.telegram.org')) return new Response(JSON.stringify({ ok: true }), { status: 200 });
        return new Response('{}', { status: 200 });
      }) as typeof fetch;
      const env = {
        BOT_TOKEN: 't', CHAT_ID: '9', GH_TOKEN: 'g', GH_ARCHIVE_REPO: 'gandli/daily-digest',
        CACHE: { get: async () => { throw new Error('kv down'); }, put: async () => { putCalled = true; throw new Error('kv put down'); } },
      } as any;
      const n = await runProductThin(env, '9');
      expect(n).toBe(0);
      expect(putCalled).toBe(true);
      expect(calls.some((c) => c.url.includes('/dispatches'))).toBe(true);
    });
  it('坏缓存 JSON → 走 miss 链', async () => {
    const calls: { url: string }[] = [];
    globalThis.fetch = vi.fn(async (u: string, init?: RequestInit) => {
      calls.push({ url: u });
      if (u.includes('raw.githubusercontent.com')) return new Response('{"items":[]}', { status: 200 });
      if (u.includes('api.github.com/dispatches')) return new Response('{}', { status: 204 });
      if (u.includes('api.telegram.org')) return new Response(JSON.stringify({ ok: true }), { status: 200 });
      return new Response('{}', { status: 200 });
    });
    const env = {
      BOT_TOKEN: 't', CHAT_ID: '9', GH_TOKEN: 'g', GH_ARCHIVE_REPO: 'gandli/daily-digest',
      CACHE: { get: async (k: string) => (k.startsWith('hn:pending:') ? null : k.startsWith('hn:') ? 'not-json' : null), put: async () => {} },
    } as any;
    const n = await runProductThin(env, '9');
    expect(n).toBe(0);
    expect(calls.some((c) => c.url.includes('/dispatches'))).toBe(true);
  });
});

// ---------- index.ts L457 CACHE.put catch + L471 CACHE.get catch in product path ----------
describe('runProductThin: CACHE.put 抛错 catch', () => {
  it('JSON 成功但 CACHE.put 抛错 → 不崩, 照常发卡片', async () => {
    const calls: { url: string }[] = [];
    globalThis.fetch = vi.fn(async (u: string, init?: RequestInit) => {
      calls.push({ url: u });
      if (u.includes('raw.githubusercontent.com')) return new Response(JSON.stringify({ items: [{ title: 't', url: 'https://x.com', desc: 'd' }], telegraphUrl: '' }), { status: 200 });
      if (u.includes('api.telegram.org')) return new Response(JSON.stringify({ ok: true }), { status: 200 });
      return new Response('{}', { status: 200 });
    });
    const env = {
      BOT_TOKEN: 't', CHAT_ID: '9', GH_TOKEN: 'g', GH_ARCHIVE_REPO: 'gandli/daily-digest',
      CACHE: { get: async () => null, put: async () => { throw new Error('kv put down'); } },
    } as any;
    const n = await runProductThin(env, '9');
    expect(n).toBe(1);
    expect(calls.some((c) => c.url.includes('/sendMessage'))).toBe(true);
  });
});

// ---------- deepwiki.ts L22: clean 过短/空 → null ----------
describe('deepwiki: extractDeepwikiOverview clean 过短', () => {
  it('正文过短(<40) → null', () => {
    const payload = 'Overview:Repo\n<details><summary>Files</summary></details>\n\n## Purpose\n\nA\n\n## Other';
    expect(extractDeepwikiOverview(payload)).toBeNull();
  });
  it('clean 清洗后为空 → null', () => {
    const payload = 'Overview:Repo\n<details><summary>Files</summary></details>\n\n## Purpose\n\n`code`[link](x)***\n\n## Other';
    expect(extractDeepwikiOverview(payload)).toBeNull();
  });
});

// ---------- zread.ts L59 平局取长; L107 if(d) 跳过 null ----------
describe('zread: extractDesc 优先级 + fetchZreadBatch 跳过', () => {
  it('两段同权重 → 取更长', () => {
    const short = '这是一个中文描述内容的测试段落, 用于验证选择器是否能正确选中概述段。';
    const long = '这是一个更长的中文描述段落, 用于测试当两段同为概述段且同权重时的选择器行为。GitHub项目是一个好工具。';
    const payload = 'X'.repeat(30000) + '\n\n## 概述\n\n' + short + '\n\n## 概述\n\n' + long;
    const out = extractDesc(payload, 280, 'test');
    expect(out).toBe(long);
  });
  it('fetchZreadBatch: 命中 1 个 → out.set 执行', async () => {
    const desc = '这是一个中文描述内容的测试段落, 用于验证 zread 批处理能正确提取描述内容并走入 out.set。';
    const prefix = 'X'.repeat(30000);
    const rscPayload = prefix + '## 概述\n\n' + desc + '\n\n## Other';
    const escaped = JSON.stringify(rscPayload);
    const html = 'self.__next_f.push([1,' + escaped + ']);';
    globalThis.fetch = (async (u: RequestInfo | URL) => {
      const url = String(u);
      return url.includes('a/b') ? new Response(html, { status: 200 }) : new Response('<html>no chunk</html>', { status: 200 });
    }) as typeof fetch;
    const m = await fetchZreadBatch(['a/b', 'c/d']);
    expect(m.size).toBe(1);
    expect(m.has('a/b')).toBe(true);
  });
  it('fetchZreadBatch: 全 null → 空 Map, if(d) 不 set', async () => {
    globalThis.fetch = vi.fn(async () => new Response('<html>no chunk</html>', { status: 200 }));
    const m = await fetchZreadBatch(['a/b', 'c/d']);
    expect(m.size).toBe(0);
  });
});

// ---------- archive.ts L56 pendArchive 回落; L226 delete catch ----------
describe('archive: pendArchive 回落 + flush delete catch', () => {
  it('KV put 成功但读回 null → 回落 direct PUT', async () => {
    let putCount = 0;
    globalThis.fetch = vi.fn(async (u: string, init?: RequestInit) => {
      if (u.includes('?ref=archive')) return new Response(JSON.stringify({ sha: 'abc' }), { status: 200 });
      if (u.includes('/contents/')) { putCount++; return new Response(JSON.stringify({ content: { sha: 'new' } }), { status: 201 }); }
      return new Response('{}', { status: 200 });
    });
    const env = { GH_TOKEN: 'g', GH_ARCHIVE_REPO: 'gandli/daily-digest', CACHE: { put: async () => {}, get: async () => null } } as any;
    await archiveToGitHub(env, '2026-09-01', '# readback miss');
    expect(putCount).toBeGreaterThan(0);
  });
  it('KV put 抛错 → 回落 direct PUT', async () => {
    let putCount = 0;
    globalThis.fetch = vi.fn(async (u: string, init?: RequestInit) => {
      if (u.includes('?ref=archive')) return new Response(JSON.stringify({ sha: 'abc' }), { status: 200 });
      if (u.includes('/contents/')) { putCount++; return new Response(JSON.stringify({ content: { sha: 'new' } }), { status: 201 }); }
      return new Response('{}', { status: 200 });
    });
    const env = { GH_TOKEN: 'g', GH_ARCHIVE_REPO: 'gandli/daily-digest', CACHE: { put: async () => { throw new Error('kv down'); }, get: async () => null } } as any;
    await archiveToGitHub(env, '2026-09-01', '# kv throw');
    expect(putCount).toBeGreaterThan(0);
  });
  it('direct PUT 网络错误 → 不抛', async () => {
    globalThis.fetch = vi.fn(async (u: string) => {
      if (u.includes('?ref=archive')) return new Response(JSON.stringify({ sha: 'abc' }), { status: 200 });
      if (u.includes('/contents/')) throw new Error('network down');
      return new Response('{}', { status: 200 });
    });
    const env = { GH_TOKEN: 'g', GH_ARCHIVE_REPO: 'gandli/daily-digest', CACHE: { put: async () => { throw new Error('kv down'); }, get: async () => null } } as any;
    await expect(archiveToGitHub(env, '2026-09-01', '# net err')).resolves.toBe(false);
  });
  it('flush 成功但 delete 抛错 → 吞掉, 返回 batch 数', async () => {
    const store = new Map<string, string>();
    const seq: string[] = [];
    globalThis.fetch = vi.fn(async (u: string, init?: RequestInit) => {
      const url = u as string;
      if (url.includes('/git/ref/heads/archive') && !init?.method) return new Response(JSON.stringify({ object: { sha: 'basesha' } }), { status: 200 });
      if (url.endsWith('git/commits/basesha')) return new Response(JSON.stringify({ sha: 'basesha', tree: { sha: 'treeshabase' } }), { status: 200 });
      if (url.includes('/git/blobs') && init?.method === 'POST') { seq.push('blob'); return new Response(JSON.stringify({ sha: `blob${seq.length - 1}` }), { status: 201 }); }
      if (url.includes('/git/trees') && init?.method === 'POST') return new Response(JSON.stringify({ sha: 'newtree0' }), { status: 201 });
      if (url.endsWith('git/commits') && init?.method === 'POST') return new Response(JSON.stringify({ sha: 'newcommit0' }), { status: 201 });
      if (url.includes('/git/refs/heads/archive') && init?.method === 'PATCH') return new Response('{}', { status: 200 });
      if (url.includes('api.github.com') && !init?.method) return new Response('{}', { status: 200 });
      return new Response('{}', { status: 404 });
    });
    const env = {
      GH_TOKEN: 'g', GH_ARCHIVE_REPO: 'gandli/daily-digest',
      CACHE: {
        list: async ({ prefix }: { prefix: string }) => ({
          keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })),
          list_complete: true,
        }),
        get: async (k: string) => store.get(k) ?? null,
        put: async (k: string, v: string) => { store.set(k, v); },
        delete: async () => { throw new Error('delete down'); },
      },
    } as any;
    await archiveToGitHub(env, '2026-09-01', '# a');
    await archiveToGitHub(env, '2026-09-02', '# b');
    const n = await flushArchivedPending(env);
    expect(n).toBe(2);
  });
});

// ---------- lookup.ts L535-536: archiveUrl catch ----------
import { archiveUrl } from '../src/lookup';
describe('archiveUrl: 内层 throw 触发 catch', () => {
  it('sendPhoto 抛错 → 不崩, 回落纯文字 + 存档失败警告', async () => {
    const msgs: string[] = [];
    globalThis.fetch = vi.fn(async (u: string, init?: RequestInit) => {
      if (u.includes('sendPhoto')) throw new Error('photo api down');
      if (u.includes('api.telegram.org')) {
        msgs.push(String(init?.body ?? ''));
        return new Response(JSON.stringify({ ok: true }), { status: 200 });
      }
      if (u.includes('api.github.com')) return new Response(JSON.stringify({ sha: 'abc' }), { status: 200 });
      return new Response('<html><meta property="og:title" content="t"><meta property="og:image" content="https://x.com/i.png"></html>', { status: 200 });
    });
    const env = {
      BOT_TOKEN: 't', CHAT_ID: '9', GH_TOKEN: 'g', GH_ARCHIVE_REPO: 'gandli/daily-digest',
      AI: undefined, TELEGRAPH_TOKEN: undefined, OPENROUTER_API_KEY: 'o', CF_ACCOUNT_ID: undefined, CF_API_TOKEN: undefined,
      CACHE: { get: async () => null, put: async () => {}, delete: async () => {}, list: async () => ({ keys: [], list_complete: true }) },
    } as any;
    await archiveUrl(env, '9', 'https://example.com/page');
    expect(msgs.length).toBeGreaterThan(0);
  });
});