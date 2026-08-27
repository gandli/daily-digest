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

  it('sendMessage 失败 → 静默(不抛)', async () => {
    mockStatus(() => 500);
    await expect(sendPerRepoMessages('t', '123', msg as any, 'gandli/daily-digest')).resolves.toBeUndefined();
  });

  it('无 ogUrl → 仍发 sendMessage(无 link_preview)', async () => {
    mockStatus(() => 200);
    await sendPerRepoMessages('t', '123', [{ html: 'text only' }] as any);
    const msgs = calls.filter((c) => c.url.includes('/sendMessage'));
    expect(msgs.length).toBe(1);
    expect(msgs[0].body.link_preview_options).toBeUndefined();
  });
});
