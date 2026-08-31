import { describe, it, expect, vi, beforeEach } from 'vitest';
// sendPerRepoMessages: 每 repo 一条 sendMessage 纯文字 + link_preview。
// 并发化后不再抓 OG 图(sendPhoto 全删)——子请求降到 50 限内, 绕 CF waitUntil 30s 墙。

const calls: { url: string; body: Record<string, unknown> }[] = [];
const origFetch = globalThis.fetch;

function mockStatus(map: (url: string, mode: 'msg' | 'other', body: Record<string, unknown>) => number) {
  calls.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input);
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    const mode = u.includes('/sendMessage') ? 'msg' : 'other';
    calls.push({ url: u, body });
    return new Response('{}', { status: map(u, mode, body) });
  }) as typeof fetch;
}

import { sendPerRepoMessages } from '../src/notify';
import { sendPhotoOrText } from '../src/notify';

const msg = [{ html: '<b>Repo X</b> desc', repo: 'owner/repo', ogUrl: 'https://github.com/owner/repo' }];

describe('sendPerRepoMessages 纯文字链路(OG 图已删)', () => {
  beforeEach(() => { globalThis.fetch = origFetch; calls.length = 0; });

  it('发一条 sendMessage, 带 link_preview', async () => {
    mockStatus(() => 200);
    await sendPerRepoMessages('t', '123', msg as any, 'gandli/daily-digest');
    const msgs = calls.filter((c) => c.url.includes('/sendMessage'));
    expect(msgs.length).toBe(1);
    expect(String(msgs[0].body.text)).toContain('Repo X');
    expect((msgs[0].body.link_preview_options as any)?.url).toContain('github.com/owner/repo');
  });

  it('sendMessage 失败 → 不抛, 返回 false(调用方降级)', async () => {
    mockStatus(() => 500);
    await expect(sendPerRepoMessages('t', '123', msg as any, 'gandli/daily-digest')).resolves.toBe(false);
  });

  it('无 ogUrl → 仍发 sendMessage(无 link_preview)', async () => {
    mockStatus(() => 200);
    await sendPerRepoMessages('t', '123', [{ html: 'text only' }] as any);
    const msgs = calls.filter((c) => c.url.includes('/sendMessage'));
    expect(msgs.length).toBe(1);
    expect(msgs[0].body.link_preview_options).toBeUndefined();
  });
});

describe('sendPhotoOrText Telegram 图床(file_id 复用)', () => {
  beforeEach(() => { globalThis.fetch = origFetch; calls.length = 0; });
  const mem: Map<string, string> = new Map();
  const cache = { get: async (k: string) => mem.get(k) ?? null, put: async (k: string, v: string) => { mem.set(k, v); } };

  it('首次用 URL 发送 → 存 file_id 到缓存', async () => {
    globalThis.fetch = (async (input, init) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? '{}')) });
      return new Response(JSON.stringify({ ok: true, result: { photo: [{ file_id: 'FID123' }] } }), { status: 200 });
    }) as typeof fetch;
    await sendPhotoOrText('t', '1', 'https://opengraph.githubassets.com/1/a/b', 'cap', cache);
    const photos = calls.filter((c) => c.url.includes('/sendPhoto'));
    expect(photos.length).toBe(1);
    expect(photos[0].body.photo).toBe('https://opengraph.githubassets.com/1/a/b'); // 首次 URL
    expect(mem.get('og:https://opengraph.githubassets.com/1/a/b')).toBe('FID123'); // 已存 file_id
  });

  it('同 URL 再次发送 → 复用 file_id(非 URL)', async () => {
    mem.set('og:https://opengraph.githubassets.com/1/a/b', 'FID123');
    globalThis.fetch = (async (input, init) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? '{}')) });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
    await sendPhotoOrText('t', '1', 'https://opengraph.githubassets.com/1/a/b', 'cap', cache);
    const p = calls.filter((c) => c.url.includes('/sendPhoto'));
    expect(p.length).toBe(1);
    expect(p[0].body.photo).toBe('FID123'); // 复用 file_id, 不再用 URL
  });

  it('photo 是 file_id(非 URL) → 不加 cache key', async () => {
    const before = mem.size;
    globalThis.fetch = (async (input, init) => {
      calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? '{}')) });
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    }) as typeof fetch;
    await sendPhotoOrText('t', '1', 'FID_ALREADY', 'cap', cache);
    const p = calls.filter((c) => c.url.includes('/sendPhoto'));
    expect(p[0].body.photo).toBe('FID_ALREADY');
    expect(mem.size).toBe(before); // 非 URL 不写缓存
  });

  it('sendPhoto 失败 → 回退纯文字 sendMessage', async () => {
    globalThis.fetch = (async (input, init) => {
      const u = String(input);
      calls.push({ url: u, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
      if (u.includes('/sendMessage')) return new Response('{}', { status: 200 }); // sendMessage 200
      return new Response('{}', { status: 500 }); // sendPhoto 500
    }) as typeof fetch;
    await sendPhotoOrText('t', '1', 'https://x.com/img.png', 'cap', cache);
    const msgs = calls.filter((c) => c.url.includes('/sendMessage'));
    expect(msgs.length).toBe(1);
    expect(msgs[0].body.text).toBe('cap');
  });
});
