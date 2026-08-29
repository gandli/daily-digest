import { describe, it, expect, afterEach } from 'vitest';
// 深层边界: encodeBase64 空/大 buffer bit-exact; GH_TOKEN 缺失静默; 网络错不 crash; OG 无图跳过。
import { encodeBase64, archiveOgImage, archiveToGitHub, archiveDatedToGitHub } from '../src/archive';

const calls: Array<{ url: string; method: string | undefined; body?: any }> = [];
const origFetch = globalThis.fetch;

function mockFetch(fn: (u: string, init?: RequestInit) => Response) {
  calls.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input);
    calls.push({ url: u, method: init?.method, body: JSON.parse(String(init?.body ?? '{}')) });
    return fn(u, init);
  }) as typeof fetch;
}

function base64ToU8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

afterEach(() => {
  globalThis.fetch = origFetch;
  calls.length = 0;
});

describe('encodeBase64 深层边界', () => {
  it('空 Uint8Array → 空串', () => {
    expect(encodeBase64(new Uint8Array(0))).toBe('');
  });

  it('300KB 全字节域 → bit-exact 往返', () => {
    for (const n of [0, 300_000]) {
      const buf = new Uint8Array(n);
      for (let i = 0; i < n; i++) buf[i] = i % 256;
      expect(base64ToU8(encodeBase64(buf))).toEqual(buf);
    }
  });

  it('大 buffer 输出与 Buffer.from.toString(base64) 交叉一致', () => {
    const buf = new Uint8Array(200_000);
    for (let i = 0; i < buf.length; i++) buf[i] = (i * 7 + 13) % 256;
    expect(encodeBase64(buf)).toBe(Buffer.from(buf).toString('base64'));
  });
});

describe('archiveOgImage 边界', () => {
  it('无 og:image(GET 404)→ 跳过, 不 PUT, 返回 null', async () => {
    mockFetch((u) => (u.includes('opengraph') ? new Response('', { status: 404 }) : new Response('{}', { status: 404 })));
    expect(await archiveOgImage({ GH_TOKEN: 'tok' } as never, 'a/b')).toBeNull();
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('HEAD 有 sha → 返回路径且绝不 PUT(已有图跳过)', async () => {
    mockFetch((u) => {
      if (u.includes('opengraph')) return new Response(new Uint8Array([9, 9]), { status: 200 });
      if (u.includes('?ref=archive')) return new Response(JSON.stringify({ sha: 'x' }), { status: 200 });
      return new Response('{}', { status: 404 });
    });
    expect(await archiveOgImage({ GH_TOKEN: 'tok', GH_ARCHIVE_REPO: 'g/d' } as never, 'owner/repo')).toBe('../../og-images/owner__repo.png');
    expect(calls.some((c) => c.method === 'PUT')).toBe(false);
  });

  it('PUT 失败(500)→ null 不抛', async () => {
    mockFetch((u) => {
      if (u.includes('opengraph')) return new Response(new Uint8Array([1]), { status: 200 });
      if (u.includes('?ref=archive')) return new Response('', { status: 404 });
      return new Response('nope', { status: 500 });
    });
    await expect(archiveOgImage({ GH_TOKEN: 'tok' } as never, 'a/b')).resolves.toBeNull();
  });

  it('fetch 网络抛错 → null 不 crash', async () => {
    mockFetch(() => { throw new TypeError('Failed to fetch'); });
    await expect(archiveOgImage({ GH_TOKEN: 'tok' } as never, 'a/b')).resolves.toBeNull();
  });
});

describe('GH_TOKEN 缺失 + 网络错', () => {
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
  const pendKeys = (kv: any) => [...kv.store.keys()].filter((k: string) => k.startsWith('pend:arc:'));

  it('GH_TOKEN 缺失 → 缓冲不依赖 token, 写 pend 键且零外呼(刷写时才需凭证)', async () => {
    const kv = memKv();
    mockFetch(() => { throw new Error('any external call is unexpected'); });
    await expect(archiveToGitHub({ CACHE: kv } as never, '2026-08-28', '# m')).resolves.toBeUndefined();
    expect(pendKeys(kv).length).toBe(1);
    expect(calls.length).toBe(0);
  });

  it('archiveToGitHub 网络全断 → 缓冲照常落 KV, 不 crash 不外呼', async () => {
    globalThis.fetch = (async () => { throw new TypeError('ENOTFOUND'); }) as typeof fetch;
    const kv = memKv();
    await expect(archiveToGitHub({ GH_TOKEN: 't', GH_ARCHIVE_REPO: 'g/d', CACHE: kv } as never, '2026-08-28', '# m')).resolves.toBeUndefined();
    expect(pendKeys(kv).length).toBe(1);
  });

  it('archiveDatedToGitHub 网络抛错 → 不 crash 不中断', async () => {
    globalThis.fetch = (async () => { throw new TypeError('network down'); }) as typeof fetch;
    const kv = memKv();
    await expect(archiveDatedToGitHub({ GH_TOKEN: 't', GH_ARCHIVE_REPO: 'g/d', CACHE: kv } as never, '2026-08-28-120000', '# x')).resolves.toBeUndefined();
    expect(pendKeys(kv).length).toBe(1);
  });

  it('无 CACHE(KV 不可用) → 回落即时 PUT 兜底, GET 抛错仍创建(不 crash)', async () => {
    mockFetch((u) => {
      if (u.includes('?ref=archive')) throw new TypeError('GET blow up');
      return new Response(JSON.stringify({ content: {} }), { status: 201 });
    });
    await expect(archiveDatedToGitHub({ GH_TOKEN: 't' } as never, '2026-08-28-120000', '# x')).resolves.toBeUndefined();
    expect(calls.some((c) => c.method === 'PUT')).toBe(true);
  });
});