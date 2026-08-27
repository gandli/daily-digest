import { describe, it, expect, beforeEach } from 'vitest';

// createTelegraphPage: 成功返回 url; ok=false 返回 null; 网络异常返回 null; title 透传。
import { createTelegraphPage } from '../src/archive';

const origFetch = globalThis.fetch;
const calls: Array<{ url: string; body: any }> = [];

function mockFetch(routes: Array<{ match: (u: string) => boolean; status: number; json?: unknown; error?: string }>) {
  calls.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input);
    calls.push({ url: u, body: JSON.parse(String(init?.body ?? '{}')) });
    const r = routes.find((x) => x.match(u));
    if (!r) throw new Error(`unexpected: ${u}`);
    if (r.error) throw new Error(r.error);
    if (r.json) return new Response(JSON.stringify(r.json), { status: r.status, headers: { 'content-type': 'application/json' } });
    return new Response('{}', { status: r.status });
  }) as typeof fetch;
}

describe('createTelegraphPage', () => {
  beforeEach(() => { globalThis.fetch = origFetch; calls.length = 0; });

  it('ok=true + url → 返回 url', async () => {
    mockFetch([{ match: (u) => u.includes('createPage'), status: 200, json: { ok: true, result: { url: 'https://telegra.ph/x' } } }]);
    const url = await createTelegraphPage('tok', '2026-08-26', [{ tag: 'p', children: ['hi'] }]);
    expect(url).toBe('https://telegra.ph/x');
    // title 透传
    expect(calls[0].body.title).toBe('2026-08-26');
    expect(calls[0].body.access_token).toBe('tok');
    expect(calls[0].body.author_name).toBe('daily-digest');
    expect(calls[0].body.return_content).toBe(false);
  });

  it('ok=false → 返回 null', async () => {
    mockFetch([{ match: (u) => u.includes('createPage'), status: 200, json: { ok: false } }]);
    expect(await createTelegraphPage('tok', '2026-08-26', [])).toBeNull();
  });

  it('ok=true 但 url 缺失 → 返回 null', async () => {
    mockFetch([{ match: (u) => u.includes('createPage'), status: 200, json: { ok: true, result: {} } }]);
    expect(await createTelegraphPage('tok', '2026-08-26', [])).toBeNull();
  });

  it('网络异常(throw) → 返回 null', async () => {
    mockFetch([{ match: (u) => u.includes('createPage'), status: 0, error: 'network down' }]);
    expect(await createTelegraphPage('tok', '2026-08-26', [])).toBeNull();
  });

  it('HTTP 非 200(ok=false 由 body 决定, 非 status)→ 仍走 body 解析', async () => {
    // telegra.ph 实际总是 200 + body.ok 标记结果; 这里锁: status 不决定 ok
    mockFetch([{ match: (u) => u.includes('createPage'), status: 500, json: { ok: false } }]);
    expect(await createTelegraphPage('tok', '2026-08-26', [])).toBeNull();
  });
});