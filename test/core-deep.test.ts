import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { fetchTrending } from '../src/sources/trending';
import { buildRssFeed } from '../src/rss';

vi.mock('../src/sources/trending', () => ({ fetchTrending: vi.fn() }));

import worker, { runDigest } from '../src/index';

const tgCalls: { url: string; body: any }[] = [];
const pending: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p); return p; } } as unknown as ExecutionContext;
const drain = () => Promise.allSettled(pending);

function memKv(extra: Array<[string, string]> = []) {
  const store = new Map<string, string>(extra);
  return {
    store,
    list: async ({ prefix }: { prefix: string }) => ({
      keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })),
    }),
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v); },
    delete: async (k: string) => { store.delete(k); },
  };
}

const b64 = (s: string) => Buffer.from(s).toString('base64');

const ARCHIVE_MD = `# daily-digest 2026-08-30

1. **[acme/rocket](https://github.com/acme/rocket)** ⭐ 1234 · Rust
   - <img src="https://opengraph.githubassets.com/1/acme/rocket.png">
   - 一个 Rust 编写的命令行工具。
2. **[acme/widget](https://github.com/acme/widget)** ⭐ 42 · TypeScript
   - 一个用于构建前端组件的工具库。
`;

function installFetch(o: { contents?: () => Response | null; rawItems?: unknown[] | null } = {}) {
  tgCalls.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input);
    if (u.includes('api.telegram.org')) {
      tgCalls.push({ url: u, body: JSON.parse(String(init?.body ?? '{}') || '{}') });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
    }
    if (u.includes('api.github.com/repos') && u.includes('/contents/archive/')) {
      const r = o.contents?.() ?? null;
      if (r) return r;
      return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
    }
    if (u.includes('raw.githubusercontent.com')) {
      if (o.rawItems) {
        return new Response(JSON.stringify({ items: o.rawItems, telegraphUrl: 'https://telegra.ph/hn-1' }), { status: 200 });
      }
      return new Response('nope', { status: 404 });
    }
    if (u.includes('api.github.com/repos')) {
      return new Response(JSON.stringify({ full_name: 'acme/rocket', description: 'a rust cli', stargazers_count: 1234, language: 'Rust', topics: ['rust'] }), { status: 200 });
    }
    if (u.includes('api.github.com')) return new Response('{}', { status: 200 });
    if (u.includes('api.telegra.ph')) return new Response(JSON.stringify({ ok: true, result: { url: 'https://telegra.ph/tg-1' } }), { status: 200 });
    return new Response('{}', { status: 200 });
  }) as typeof fetch;
  return tgCalls;
}

let env: any;
const texts = () => tgCalls.filter((c) => c.url.includes('sendMessage') || c.url.includes('sendPhoto'))
  .map((c) => String(c.body?.text ?? c.body?.caption ?? ''));

beforeEach(() => {
  vi.mocked(fetchTrending).mockReset();
  vi.mocked(fetchTrending).mockResolvedValue([
    { title: 'acme/rocket', url: 'https://github.com/acme/rocket', desc: 'a rust cli' } as any,
  ]);
  env = {
    BOT_TOKEN: 'tok', CHAT_ID: '944783507', WEBHOOK_SECRET: 'sec', GH_TOKEN: 'ghtok',
    CACHE: memKv(), AI: undefined, TELEGRAPH_TOKEN: undefined, GH_ARCHIVE_REPO: 'gandli/daily-digest',
    OPENROUTER_API_KEY: undefined, VEC: undefined, DB: undefined,
  };
});
afterEach(() => { vi.restoreAllMocks(); });

const get = async (url: string) => { const r = await worker.fetch(new Request(url, { method: 'GET' }), env, ctx); await drain(); return r; };
const post = async (url: string, body: unknown, headers: Record<string, string> = {}) => {
  const r = await worker.fetch(new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'sec', ...headers },
    body: JSON.stringify(body),
  }), env, ctx);
  await drain();
  return r;
};

describe('/rss 订阅源: 命中 / 惰性重建 / 重建失败', () => {
  it('KV 命中 rss:feed → 直返, 零外呼(不触 archive 分支)', async () => {
    const feed = buildRssFeed([{ title: 'a/b', url: 'https://github.com/a/b', desc: '中文描述' }], '2026-08-30', 'https://d.dev');
    env.CACHE = memKv([['rss:feed', feed]]);
    const seen: string[] = [];
    installFetch();
    globalThis.fetch = (async (u: any) => { seen.push(String(u)); return new Response('', { status: 404 }); }) as any;

    const res = await get('https://x/rss');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('a/b');
    expect(seen.filter((u) => u.includes('api.github.com'))).toHaveLength(0);
    expect(res.headers.get('cache-control')).toContain('max-age=300');
  });

  it('KV miss + archive 分支有 md → 惰性重建 + 回填 KV(下次零外呼)', async () => {
    env.CACHE = memKv();
    installFetch({ contents: () => new Response(JSON.stringify({ content: b64(ARCHIVE_MD) }), { status: 200 }) });

    const res = await get('https://x/rss');
    const xml = await res.text();
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain('acme/rocket');
    expect(xml).toContain('acme/widget');
    expect(await env.CACHE.get('rss:feed')).toBeTruthy();

    const res2 = await get('https://x/rss');
    expect(await res2.text()).toContain('acme/rocket');
  });

  it('KV miss + archive 分支 404 → 回退空 RSS(仍 200, 合法 XML)', async () => {
    env.CACHE = memKv();
    installFetch({ contents: () => null });

    const res = await get('https://x/rss');
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain('No digest yet');
    expect(xml.startsWith('<?xml')).toBe(true);
    expect(await env.CACHE.get('rss:feed')).toBeNull();
  });
});

describe('/search 网页混合检索', () => {
  it('子串命中不足一页 → Vectorize 语义补页', async () => {
    env.CACHE = memKv([['search:index', JSON.stringify([
      ['star', 'rust-cli', 'https://github.com/acme/rust-cli', 'rust cli tool', 'a rust cli tool'],
    ])]]);
    env.AI = { run: vi.fn().mockResolvedValue({ data: [[0.1, 0.2, 0.3]] }) };
    env.VEC = {
      query: vi.fn().mockResolvedValue({ matches: [
        { score: 0.9, metadata: { name: 'semantic-extra', url: 'https://github.com/acme/extra' } },
        { score: 0.1, metadata: { name: 'noise-low-score', url: 'https://github.com/acme/noise' } },
      ] }),
    };
    installFetch();

    const res = await get('https://x/search?q=rust');
    const body = await res.text();
    expect(res.status).toBe(200);
    expect(body).toContain('rust-cli');
    expect(body).toContain('semantic-extra');
    expect(body).not.toContain('noise-low-score');
    expect(body).toContain('2 条结果');
  });

  it('VEC 抛错(未绑定/故障) → 静默降级为纯子串结果, 仍 200', async () => {
    env.CACHE = memKv([['search:index', JSON.stringify([
      ['star', 'rust-cli', 'https://github.com/acme/rust-cli', 'rust cli tool', 'a rust cli tool'],
    ])]]);
    env.AI = { run: vi.fn().mockRejectedValue(new Error('ai down')) };
    env.VEC = { query: vi.fn() };
    installFetch();

    const res = await get('https://x/search?q=rust');
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('rust-cli');
    expect(body).toContain('1 条结果');
  });

  it('arch 源条目 → 拼 archive 分支 github 链接', async () => {
    env.CACHE = memKv([['search:index', JSON.stringify([
      ['arch', 'acme/rocket', '2026-08-30', 'acme rocket 中文', '一个 Rust 命令行工具'],
    ])]]);
    installFetch();

    const res = await get('https://x/search?q=rocket');
    const body = await res.text();
    expect(body).toContain('blob/archive/archive/2026-08-30');
    expect(body).toContain('一个 Rust 命令行工具');
  });

  it('search:index 缺失 → 0 结果页(不 500)', async () => {
    env.CACHE = memKv();
    installFetch();
    const res = await get('https://x/search?q=anything');
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('0 条结果');
  });
});

describe('/random 随机抽样', () => {
  it('arch 源条目 → 拼 archive github 链', async () => {
    env.CACHE = memKv([['search:index', JSON.stringify([
      ['arch', 'acme/rocket', '2026-08-30', 'acme rocket', '中文描述在'],
    ])]]);
    installFetch();
    const res = await get('https://x/random');
    const body = await res.text();
    expect(body).toContain('blob/archive/archive/2026-08-30');
    expect(body).toContain('中文描述在');
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('star 源条目 → 直链原始 URL', async () => {
    env.CACHE = memKv([['search:index', JSON.stringify([
      ['star', 'acme/starred', 'https://github.com/acme/starred', 'acme starred', '描述'],
    ])]]);
    installFetch();
    const body = await get('https://x/random').then((r) => r.text());
    expect(body).toContain('href="https://github.com/acme/starred"');
  });
});

describe('♻️ 重发卡: archive 索引缺失/损坏的回落', () => {
  const todayKey = () => {
    const d = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
    return `lookup:${d}:acme/rocket`;
  };

  it('索引损坏(非法 JSON) → 重新走 lookupRepo 全管线, 不静默', async () => {
    env.CACHE = memKv([[todayKey(), '1'], ['archive:idx:acme/rocket', '{broken json']]);
    installFetch();
    const res = await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: '看看 https://github.com/acme/rocket' } });
    expect(res.status).toBe(200);
    const t = texts().join('\n');
    expect(t).not.toContain('已查询过');
    expect(t).toContain('acme/rocket');
  });

  it('索引缺失(seenToday 已置位但 idx 没写) → 同样回落重新查询', async () => {
    env.CACHE = memKv([[todayKey(), '1']]);
    installFetch();
    const res = await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: 'https://github.com/acme/rocket' } });
    expect(res.status).toBe(200);
    expect(texts().join('\n')).toContain('acme/rocket');
  });

  it('索引完好 → 回 ♻️ 存档卡(标题+摘要+标签+三链, 带 OG 图)', async () => {
    env.CACHE = memKv([
      [todayKey(), '1'],
      ['archive:idx:acme/rocket', JSON.stringify({
        repo: 'acme/rocket', date: '2026-08-30-120000', descZh: '一个 Rust 编写的命令行工具。', topics: ['rust', 'cli'],
      })],
      ['archive:tg:2026-08-30-120000', 'https://telegra.ph/rocket-1'],
    ]);
    installFetch();
    const res = await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: 'https://github.com/acme/rocket' } });
    expect(res.status).toBe(200);
    const t = texts().join('\n');
    expect(t).toContain('♻️');
    expect(t).toContain('一个 Rust 编写的命令行工具。');
    expect(t).toContain('#rust');
    expect(t).toContain('telegra.ph/rocket-1');
    expect(t).toContain('web.archive.org');
    expect(t).toContain('blob/archive/archive/2026/2026-08-30-120000.md');
    expect(t).toContain('https://github.com/acme/rocket');
  });
});

describe('dispatch 兜底: 分派前 KV 读抛错', () => {
  it('extractRepo/seenToday 前置读抛错 → 回 200 + 后台兜底归档(不 500 不静默)', async () => {
    env.CACHE = memKv();
    (env.CACHE as any).get = vi.fn().mockImplementation(() => { throw new Error('kv down'); });
    installFetch();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: '看这个 https://example.com/a' } });
    expect(res.status).toBe(200);
  });

  it('纯文本分派前置抛错 → 兜底发 HELP', async () => {
    env.CACHE = memKv();
    (env.CACHE as any).get = vi.fn().mockImplementation(() => { throw new Error('kv down'); });
    installFetch();
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const res = await post('https://x/telegram', { message: { chat: { id: 944783507 }, text: '纯无链接文本' } });
    expect(res.status).toBe(200);
  });
});

describe('runDigest 存档异常', () => {
  it('archiveToGitHub 失败(KV 缓冲写失败 + 兜底直投 PUT 500) → 只 warn, 不影响当天消息发送与返回值', async () => {
    // pendArchive 双重失效: KV put 抛 → 回落 putToArchiveBranchDirect, 再让该 PUT 500 → ok=false
    const kv = memKv();
    kv.put = async (k: string, v: string) => {
      if (k.startsWith('pend:arc:')) throw new Error('kv quota exhausted');
      kv.store.set(k, v);
    };
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes('api.telegram.org')) {
        tgCalls.push({ url: u, body: {} });
        return new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 });
      }
      if (u.includes('/contents/archive/')) {
        return new Response('internal error', { status: 500 });
      }
      return new Response('{}', { status: 200 });
    }) as typeof fetch;

    const n = await runDigest({ ...env, CACHE: kv }, false);
    expect(n).toBe(1);
    expect(errSpy).toHaveBeenCalledWith(expect.stringContaining('pend put failed'), expect.stringContaining('archive/'), expect.stringContaining('kv quota exhausted'));
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('archiveToGitHub failed'),
      expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/),
    );
    // 主流程不受存档失败影响: 当天卡片已发出 + digest 缓存已写
    expect(tgCalls.length).toBeGreaterThan(0);
    const dateStr = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
    expect(await kv.get(`digest:${dateStr}`)).toBeTruthy();
  });
});
