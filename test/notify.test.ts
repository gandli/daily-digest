import { describe, it, expect, vi, beforeEach } from 'vitest';
// sendPerRepoMessages: 每 repo 一条 sendPhoto, OG 图失败降级纯文字。
// mock fetch 验证三链路: 自托管 200 / 自托管404→回退官方OG / 全失败→纯文字。

const calls: { url: string; body: Record<string, unknown> }[] = [];
const origFetch = globalThis.fetch;

function mockStatus(map: (url: string, mode: 'photo' | 'msg', body: Record<string, unknown>) => number) {
  calls.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input);
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    const mode = u.includes('/sendPhoto') ? 'photo' : u.includes('/sendMessage') ? 'msg' : 'other';
    calls.push({ url: u, body });
    return new Response('{}', { status: map(u, mode, body) });
  }) as typeof fetch;
}

import { sendPerRepoMessages } from '../src/notify';

const msg = [{ html: '<b>Repo X</b> desc', repo: 'owner/repo' }];

describe('sendPerRepoMessages OG 图链路', () => {
  beforeEach(() => { globalThis.fetch = origFetch; calls.length = 0; });

  it('自托管 200 → 只发一次 sendPhoto, 不回退官方OG/纯文字', async () => {
    mockStatus(() => 200);
    await sendPerRepoMessages('t', '123', msg as any, 'gandli/daily-digest');
    const photos = calls.filter((c) => c.url.includes('/sendPhoto'));
    expect(photos.length).toBe(1);
    expect(String(photos[0].body.photo)).toContain('raw.githubusercontent.com/gandli/daily-digest/archive/og-images/owner__repo.png');
    expect(calls.some((c) => c.url.includes('/sendMessage'))).toBe(false);
  });

  it('自托管 404 → 回退官方 OG sendPhoto', async () => {
    mockStatus((u, mode, body) => {
      if (mode === 'photo') return String(body.photo).includes('raw.githubusercontent') ? 404 : 200;
      return 200;
    });
    await sendPerRepoMessages('t', '123', msg as any, 'gandli/daily-digest');
    const photos = calls.filter((c) => c.url.includes('/sendPhoto'));
    expect(photos.length).toBe(2); // 自托管 404 + 官方
    expect(String(photos[1].body.photo)).toContain('opengraph.githubassets.com');
  });

  it('官方 OG 也失败 → 降级纯文字 sendMessage', async () => {
    mockStatus((u, mode) => (mode === 'msg' ? 200 : 404));
    await sendPerRepoMessages('t', '123', msg as any, 'gandli/daily-digest');
    expect(calls.some((c) => c.url.includes('/sendMessage'))).toBe(true);
    expect(calls.find((c) => c.url.includes('/sendMessage'))!.body.text).toContain('Repo X');
  });

  it('纯文字降级也失败 → 静默(不抛)', async () => {
    mockStatus(() => 500);
    await expect(sendPerRepoMessages('t', '123', msg as any, 'gandli/daily-digest')).resolves.toBeUndefined();
  });

  it('无 archiveRepo → 直接官方 OG(不自托管)', async () => {
    mockStatus(() => 200);
    await sendPerRepoMessages('t', '123', msg as any);
    const photos = calls.filter((c) => c.url.includes('/sendPhoto'));
    expect(String(photos[0].body.photo)).toContain('opengraph.githubassets.com');
  });
});