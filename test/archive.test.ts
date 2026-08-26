import { describe, it, expect, beforeEach } from 'vitest';
// archive.ts: GitHub archive 分支 PUT(创建/覆盖 sha 幂等) + OG 图入库跳过。
import { archiveToGitHub, archiveDatedToGitHub, archiveOgImage, encodeBase64 } from '../src/archive';

const calls: { url: string; method: string; body?: any; headers: Record<string, string> }[] = [];
const origFetch = globalThis.fetch;

function mockFetch(routes: Array<{ match: (u: string) => boolean; method?: string; status: number; json?: unknown; text?: string; body?: Uint8Array }>) {
  calls.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input);
    const m = init?.method ?? 'GET';
    calls.push({ url: u, method: m, body: JSON.parse(String(init?.body ?? '{}')), headers: (init?.headers ?? {}) as Record<string, string> });
    const route = routes.find((r) => r.match(u) && (r.method === undefined || r.method === m));
    if (!route) throw new Error(`unexpected: ${m} ${u}`);
    if (route.body) return new Response(route.body, { status: route.status, headers: { 'content-type': 'application/octet-stream' } });
    if (route.json) return new Response(JSON.stringify(route.json), { status: route.status, headers: { 'content-type': 'application/json' } });
    return new Response(route.text ?? '', { status: route.status });
  }) as typeof fetch;
}

const env = { GH_TOKEN: 'tok', GH_ARCHIVE_REPO: 'gandli/daily-digest' } as never;

describe('archiveToGitHub archive 分支 PUT', () => {
  beforeEach(() => { globalThis.fetch = origFetch; calls.length = 0; });

  it('文件已存在(sha 返回)→ PUT 带 sha 覆盖(幂等更新)', async () => {
    mockFetch([
      { match: (u) => u.includes('/contents/archive/2026/2026-08-26.md?ref=archive'), status: 200, json: { sha: 'abc123' } },
      { match: (u) => u.includes('/contents/archive/2026/2026-08-26.md') && !u.includes('ref=archive'), method: 'PUT', status: 201, json: { content: { sha: 'new' } } },
    ]);
    await archiveToGitHub(env, '2026-08-26', '# markdown');
    const put = calls.find((c) => c.method === 'PUT');
    expect(put).toBeTruthy();
    expect(put!.body.sha).toBe('abc123');
    expect(put!.body.message).toBe('digest: 2026-08-26');
    expect(put!.body.branch).toBe('archive');
  });

  it('文件不存在(GET 404)→ PUT 无 sha 创建', async () => {
    mockFetch([
      { match: (u) => u.includes('?ref=archive'), status: 404, text: 'nope' },
      { match: (u) => u.includes('/contents/') && !u.includes('?ref=archive'), method: 'PUT', status: 201, json: { content: {} } },
    ]);
    await archiveToGitHub(env, '2026-08-27', '# new');
    const put = calls.find((c) => c.method === 'PUT');
    expect(put!.body.sha).toBeUndefined();
    expect(put!.body.message).toBe('digest: 2026-08-27');
  });

  it('PUT 失败 → 不抛(记日志)', async () => {
    mockFetch([
      { match: () => true, method: 'GET', status: 404, text: '' },
      { match: () => true, method: 'PUT', status: 500, text: 'rate limit' },
    ]);
    await expect(archiveToGitHub(env, '2026-08-28', '# x')).resolves.toBeUndefined();
  });

  it('archiveDatedToGitHub → PUT 带完整时间戳文件路径', async () => {
    mockFetch([
      { match: () => true, method: 'GET', status: 404 },
      { match: () => true, method: 'PUT', status: 201, json: { content: {} } },
    ]);
    await archiveDatedToGitHub(env, '2026-08-26-1234567', '# tweet');
    const put = calls.find((c) => c.method === 'PUT');
    expect(put!.body.message).toBe('archive: 2026-08-26-1234567');
  });
});

describe('archiveOgImage 入库', () => {
  beforeEach(() => { globalThis.fetch = origFetch; calls.length = 0; });

  it('已有同名图(sha 返回)→ 跳过重传, 返回相对路径', async () => {
    mockFetch([
      { match: (u) => u.includes('opengraph.githubassets.com'), status: 200, body: new Uint8Array([1, 2, 3]) },
      { match: (u) => u.includes('/contents/og-images/') && u.includes('?ref=archive'), status: 200, json: { sha: 'old' } },
    ]);
    const rel = await archiveOgImage(env, 'owner/Repo');
    expect(rel).toBe('../../og-images/owner__Repo.png');
    // 未再 PUT(已有图跳过)
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('OG 图源失败 → null(调用方回退远程 URL)', async () => {
    mockFetch([{ match: (u) => u.includes('opengraph'), status: 404 }]);
    expect(await archiveOgImage(env, 'owner/Repo')).toBeNull();
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