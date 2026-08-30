import { describe, it, expect, beforeEach } from 'vitest';
// archive.ts: 存档缓冲(KV pend:arc:*, 零即时 GitHub 写) + OG 图入库跳过。
// 批量提交(flushArchivedPending)细节见 archive-batch.test.ts。
import { archiveToGitHub, archiveDatedToGitHub, archiveOgImage, encodeBase64 } from '../src/archive';

const calls: { url: string; method: string; body?: any }[] = [];
const origFetch = globalThis.fetch;

function mockFetch(routes: Array<{ match: (u: string) => boolean; method?: string; status: number; json?: unknown; body?: Uint8Array }>) {
  calls.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input);
    const m = init?.method ?? 'GET';
    calls.push({ url: u, method: m, body: JSON.parse(String(init?.body ?? '{}')) });
    const route = routes.find((r) => r.match(u) && (r.method === undefined || r.method === m));
    if (!route) throw new Error(`unexpected: ${m} ${u}`);
    if (route.body) return new Response(route.body, { status: route.status, headers: { 'content-type': 'application/octet-stream' } });
    if (route.json) return new Response(JSON.stringify(route.json), { status: route.status, headers: { 'content-type': 'application/json' } });
    return new Response(route.text ?? '', { status: route.status });
  }) as typeof fetch;
}

function memKv() {
  const store = new Map<string, string>();
  return {
    list: async ({ prefix }: { prefix: string }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v); },
    delete: async (k: string) => { store.delete(k); },
    get store() { return store; },
  } as any;
}

const env = (kv = memKv()) => ({ GH_TOKEN: 'tok', GH_ARCHIVE_REPO: 'gandli/daily-digest', CACHE: kv }) as any;
const pendKeys = (kv: any) => [...kv.store.keys()].filter((k) => k.startsWith('pend:arc:'));
const gh = () => calls.filter((c) => c.url.includes('api.github.com'));

describe('archiveToGitHub/archiveDatedToGitHub 缓冲语义', () => {
  beforeEach(() => { globalThis.fetch = origFetch; calls.length = 0; });

  it('archiveToGitHub → 写 pend 键(路径/message/base64 内容), 零 Contents API 请求', async () => {
    const kv = memKv();
    mockFetch([{ match: (u) => u.includes('api.github.com'), status: 200, json: {} }]); // 放行 → 若直连会被记到
    await archiveToGitHub(env(kv), '2026-08-26', '# markdown');
    expect(gh().length).toBe(0); // 缓冲不外呼
    const item = JSON.parse(kv.store.get(pendKeys(kv)[0])!);
    expect(item.path).toBe('archive/2026/2026-08-26.md');
    expect(item.message).toBe('digest: 2026-08-26');
    expect(item.encoding).toBe('utf-8');
    expect(Buffer.from(item.content, 'base64').toString('utf-8')).toBe('# markdown');
  });

  it('archiveDatedToGitHub → 完整时间戳文件路径 + archive: 前缀 message', async () => {
    const kv = memKv();
    mockFetch([{ match: () => true, status: 200, json: {} }]);
    await archiveDatedToGitHub(env(kv), '2026-08-26-1234567', '# tweet');
    const item = JSON.parse(kv.store.get(pendKeys(kv)[0])!);
    expect(item.path).toBe('archive/2026/2026-08-26-1234567.md');
    expect(item.message).toBe('archive: 2026-08-26-1234567');
    expect(gh().length).toBe(0);
  });

  it('KV 不可用 → 回落即时 PUT; 文件已存在(GET sha) → 带 sha 覆盖(幂等)', async () => {
    const kv = memKv();
    kv.put = async () => { throw new Error('kv down'); };
    mockFetch([
      { match: (u) => u.includes('/contents/archive/2026/2026-08-26.md?ref=archive'), status: 200, json: { sha: 'abc123' } },
      { match: (u) => u.includes('/contents/archive/2026/2026-08-26.md') && !u.includes('ref=archive'), method: 'PUT', status: 201, json: { content: { sha: 'new' } } },
    ]);
    await archiveToGitHub(env(kv), '2026-08-26', '# markdown');
    const put = calls.find((c) => c.method === 'PUT');
    expect(put).toBeTruthy();
    expect(put!.body.sha).toBe('abc123');
    expect(put!.body.message).toBe('digest: 2026-08-26');
    expect(put!.body.branch).toBe('archive');
  });

  it('KV 不可用且文件不存在(GET 404) → 回落 PUT 无 sha 创建', async () => {
    const kv = memKv();
    kv.put = async () => { throw new Error('kv down'); };
    mockFetch([
      { match: (u) => u.includes('?ref=archive'), status: 404, text: 'nope' },
      { match: (u) => u.includes('/contents/') && !u.includes('?ref=archive'), method: 'PUT', status: 201, json: { content: {} } },
    ]);
    await archiveToGitHub(env(kv), '2026-08-27', '# new');
    const put = calls.find((c) => c.method === 'PUT');
    expect(put!.body.sha).toBeUndefined();
    expect(put!.body.message).toBe('digest: 2026-08-27');
  });

  it('KV 不可用且 PUT 失败(500) → 不抛(记日志)', async () => {
    const kv = memKv();
    kv.put = async () => { throw new Error('kv down'); };
    mockFetch([
      { match: () => true, method: 'GET', status: 404, text: '' },
      { match: () => true, method: 'PUT', status: 500, text: 'rate limit' },
    ]);
    await expect(archiveToGitHub(env(kv), '2026-08-28', '# x')).resolves.toBe(false);
  });
});

describe('archiveOgImage 入库', () => {
  beforeEach(() => { globalThis.fetch = origFetch; calls.length = 0; });

  it('已有同名图(sha 返回) → 跳过, 零缓冲零 PUT, 返回相对路径', async () => {
    const kv = memKv();
    mockFetch([
      { match: (u) => u.includes('opengraph.githubassets.com'), status: 200, body: new Uint8Array([1, 2, 3]) },
      { match: (u) => u.includes('/contents/og-images/') && u.includes('?ref=archive'), status: 200, json: { sha: 'old' } },
    ]);
    const rel = await archiveOgImage(env(kv), 'owner/Repo');
    expect(rel).toBe('../../og-images/owner__Repo.png');
    // 未再 PUT 也不写缓冲(已有图跳过)
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
    expect(pendKeys(kv).length).toBe(0);
  });

  it('OG 图源失败 → null(调用方回退远程 URL)', async () => {
    mockFetch([{ match: (u) => u.includes('opengraph'), status: 404 }]);
    expect(await archiveOgImage(env(), 'owner/Repo')).toBeNull();
  });

  it('无同名图 → PNG base64 入缓冲(encoding=base64), 返回相对路径', async () => {
    const kv = memKv();
    const png = new Uint8Array([9, 8, 7]);
    mockFetch([
      { match: (u) => u.includes('opengraph.githubassets.com'), status: 200, body: png },
      { match: (u) => u.includes('/contents/og-images/'), status: 404 },
      { match: (u) => u.includes('api.github.com'), status: 200, json: {} },
    ]);
    expect(await archiveOgImage(env(kv), 'owner/Repo')).toBe('../../og-images/owner__Repo.png');
    expect(gh().some((c) => c.method === 'PUT')).toBe(false);
    const item = JSON.parse(kv.store.get(pendKeys(kv)[0])!);
    expect(item.path).toBe('og-images/owner__Repo.png');
    expect(item.encoding).toBe('base64');
    expect(Buffer.from(item.content, 'base64')).toEqual(Buffer.from(png));
  });
});

describe('encodeBase64 分块编码', () => {
  it('大输入不越栈(bit-exact)', () => {
    const big = new Uint8Array(300000); // 超 125K spread 上限
    for (let i = 0; i < big.length; i++) big[i] = i % 256;
    const b = encodeBase64(big);
    // 解码回比对
    const bin = atob(b);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    expect(out).toEqual(big);
  });
});
