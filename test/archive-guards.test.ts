// archive 守卫与上限回归锁: 路径穿越守卫(bad archive name)、createTelegraphAccount 三分支、
// FLUSH_BLOB_CAP=40 分批(41+ 条只刷前 40, 余键留待下次 flush)。
import { describe, it, expect, beforeEach } from 'vitest';
import { archiveToGitHub, archiveDatedToGitHub, createTelegraphAccount, flushArchivedPending } from '../src/archive';

type Call = { url: string; method: string; body: any };
const calls: Call[] = [];
const origFetch = globalThis.fetch;

type Route = { match: (u: string, m: string) => boolean; status?: number; json?: unknown };
const dyn = <T,>(v: T | (() => T), dflt: T): T => (typeof v === 'function' ? (v as () => T)() : (v ?? dflt));
function mockFetch(routes: Route[]) {
  calls.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input);
    const m = init?.method ?? 'GET';
    calls.push({ url: u, method: m, body: JSON.parse(String(init?.body ?? '{}')) });
    const r = routes.find((r) => r.match(u, m));
    if (!r) throw new Error(`unexpected: ${m} ${u}`);
    return new Response(JSON.stringify(dyn(r.json, {} as unknown)), { status: r.status ?? 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

function memKv() {
  const store = new Map<string, string>();
  return {
    list: async ({ prefix }: { prefix: string }) =>
      ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v); },
    delete: async (k: string) => { store.delete(k); },
    get store() { return store; },
  } as any;
}

const env = (kv = memKv()) => ({ GH_TOKEN: 'tok', GH_ARCHIVE_REPO: 'gandli/daily-digest', CACHE: kv }) as any;
const pendKeys = (kv: any) => [...kv.store.keys()].filter((k) => k.startsWith('pend:arc:'));
const b64 = (s: string) => Buffer.from(s).toString('base64');
const gh = () => calls.filter((c) => c.url.includes('api.github.com'));

/** Git Data API 全 happy-path 路由(与 archive-batch.test.ts 同形态)。 */
function gitRoutes() {
  const s = { blobN: 0 };
  return [
    { match: (u: string, m: string) => u.includes('/git/ref/heads/archive') && m === 'GET', json: { object: { sha: 'basesha' } } },
    { match: (u: string, m: string) => u.includes('/git/commits/') && m === 'GET', json: { tree: { sha: 'treeshabase' } } },
    { match: (u: string, m: string) => u.includes('/git/blobs') && m === 'POST', json: () => ({ sha: `blob${s.blobN++}` }) } as Route,
    { match: (u: string, m: string) => u.includes('/git/trees') && m === 'POST', json: { sha: 'newtree0' } },
    { match: (u: string, m: string) => u.endsWith('/git/commits') && m === 'POST', json: { sha: 'newcommit0' } },
    { match: (u: string, m: string) => u.includes('/git/refs/heads/archive') && m === 'PATCH', json: { ok: true } },
  ];
}

beforeEach(() => { globalThis.fetch = origFetch; calls.length = 0; });

describe('路径穿越守卫(bad archive name)', () => {
  const badNames = ['..', '../evil', '2026/../../etc', 'a..b', '/abs/path'];

  it.each(badNames)('archiveToGitHub 拒绝非法 dateStr %j → 抛 bad archive name, 零请求零缓冲', async (name) => {
    const kv = memKv();
    mockFetch([{ match: () => true, json: {} }]); // 放行 → 若守卫失效会有外呼被记录
    await expect(archiveToGitHub(env(kv), name, '# x')).rejects.toThrow('bad archive name');
    expect(gh().length).toBe(0);
    expect(pendKeys(kv).length).toBe(0);
  });

  it.each(badNames)('archiveDatedToGitHub 拒绝非法 stamp %j → 抛 bad archive name', async (name) => {
    mockFetch([{ match: () => true, json: {} }]);
    await expect(archiveDatedToGitHub(env(), name, '# x')).rejects.toThrow('bad archive name');
    expect(gh().length).toBe(0);
  });

  it('守卫先于缓冲: 非法名不产生 pend 键', async () => {
    const kv = memKv();
    mockFetch([{ match: () => true, json: {} }]);
    await expect(archiveToGitHub(env(kv), '../../escape', '# x')).rejects.toThrow('bad archive name');
    expect(pendKeys(kv).length).toBe(0);
  });
});

describe('createTelegraphAccount', () => {
  it('ok=true 且有 access_token → 返回 token', async () => {
    mockFetch([{ match: (u) => u.includes('api.telegra.ph/createAccount'), json: { ok: true, result: { access_token: 'tg-tok' } } }]);
    expect(await createTelegraphAccount()).toBe('tg-tok');
  });

  it('ok=false → 返回 null 不抛', async () => {
    mockFetch([{ match: (u) => u.includes('api.telegra.ph/createAccount'), json: { ok: false } }]);
    expect(await createTelegraphAccount()).toBeNull();
  });

  it('ok=true 但 result.access_token 缺失 → 返回 null', async () => {
    mockFetch([{ match: (u) => u.includes('api.telegra.ph/createAccount'), json: { ok: true, result: {} } }]);
    expect(await createTelegraphAccount()).toBeNull();
  });

  it('fetch 抛错(网络/超时) → 返回 null 不抛', async () => {
    globalThis.fetch = (async () => { throw new Error('network down'); }) as typeof fetch;
    expect(await createTelegraphAccount()).toBeNull();
  });
});

describe('FLUSH_BLOB_CAP=40 分批上限', () => {
  const seedPend = (kv: any, n: number) => {
    for (let i = 0; i < n; i++) kv.store.set(`pend:arc:c${String(i).padStart(3, '0')}`, JSON.stringify({ path: `archive/2026/f${String(i).padStart(3, '0')}.md`, content: b64('# x'), encoding: 'utf-8', message: 'm' }));
  };

  it('42 条缓冲 → 单次 flush 只刷前 40 条(40 blob 一个 commit), 余 2 键保留', async () => {
    const kv = memKv();
    seedPend(kv, 42);
    mockFetch(gitRoutes());
    expect(await flushArchivedPending(env(kv))).toBe(40);
    expect(gh().filter((c) => c.url.includes('/git/blobs') && c.method === 'POST').length).toBe(40);
    const commit = gh().find((c) => c.url.endsWith('/git/commits') && c.method === 'POST')!;
    expect(commit.body.message).toBe('archive: batch 40 items');
    const tree = gh().find((c) => c.url.includes('/git/trees') && c.method === 'POST')!;
    expect(tree.body.tree.length).toBe(40);
    expect(pendKeys(kv).length).toBe(2);
  });

  it('余键下次 flush 续刷 → 两次共清空缓冲', async () => {
    const kv = memKv();
    seedPend(kv, 42);
    mockFetch(gitRoutes());
    expect(await flushArchivedPending(env(kv))).toBe(40);
    expect(await flushArchivedPending(env(kv))).toBe(2);
    expect(pendKeys(kv).length).toBe(0);
    expect(gh().filter((c) => c.url.includes('/git/blobs') && c.method === 'POST').length).toBe(42);
  });

  it('恰好 40 条 → 一次刷完, 无剩余', async () => {
    const kv = memKv();
    seedPend(kv, 40);
    mockFetch(gitRoutes());
    expect(await flushArchivedPending(env(kv))).toBe(40);
    expect(pendKeys(kv).length).toBe(0);
  });
});
