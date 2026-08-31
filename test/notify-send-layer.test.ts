import { describe, it, expect, vi, beforeEach } from 'vitest';
// 发送层边界测试: 回落链、幂等、常量时间比较、失败静默。
// 风格沿用 test/notify.test.ts: mock global fetch 捕获 TG API 调用。

const calls: { url: string; body: Record<string, unknown> }[] = [];
const origFetch = globalThis.fetch;

function mockRespond(map: (url: string) => Response | Promise<Response>) {
  calls.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input);
    calls.push({ url: u, body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
    return map(u);
  }) as typeof fetch;
}
function mockNet() {
  calls.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), body: JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown> });
    throw new TypeError('network down');
  }) as typeof fetch;
}

import {
  sendPerRepoMessages, sendPhotoOrText, registerCommands, safeEqual,
  sendTelegramKbd, editMessageKbd, answerCallbackQuery,
} from '../src/notify';

beforeEach(() => { globalThis.fetch = origFetch; calls.length = 0; });

describe('sendPerRepoMessages 多 chunk', () => {
  it('多 chunk 全部发出(串行), 各带 link_preview', async () => {
    mockRespond(() => new Response('{}', { status: 200 }));
    await sendPerRepoMessages('t', '123', [
      { html: 'A', ogUrl: 'https://github.com/a' },
      { html: 'B', ogUrl: 'https://github.com/b' },
      { html: 'C' },
    ] as any);
    const msgs = calls.filter((c) => c.url.includes('/sendMessage'));
    expect(msgs.length).toBe(3);
    expect(msgs.map((m) => m.body.text)).toEqual(['A', 'B', 'C']);
    expect((msgs[0].body.link_preview_options as any)?.url).toBe('https://github.com/a');
    expect((msgs[2].body.link_preview_options)).toBeUndefined();
  });

  it('空 chunks 不 crash, 不发请求', async () => {
    mockRespond(() => new Response('{}', { status: 200 }));
    await expect(sendPerRepoMessages('t', '123', [] as any)).resolves.toBe(true);
    expect(calls.length).toBe(0);
  });

  it('单个 chunk 失败(500)不阻断后续 chunk', async () => {
    mockRespond((u) => new Response('{}', { status: u.includes('B') ? 500 : 200 }));
    await sendPerRepoMessages('t', '123', [
      { html: 'A' }, { html: 'B' }, { html: 'C' },
    ] as any);
    const msgs = calls.filter((c) => c.url.includes('/sendMessage'));
    expect(msgs.length).toBe(3); // 失败 chunk 也被请求过, 循环继续
    expect(msgs.map((m) => m.body.text)).toEqual(['A', 'B', 'C']);
  });
});

describe('sendPhotoOrText 回落链', () => {
  it('sendPhoto 200 → 不回落 sendMessage', async () => {
    mockRespond((u) => u.includes('/sendMessage') ? new Response('{}', { status: 200 }) : new Response('{}', { status: 200 }));
    await sendPhotoOrText('t', '1', 'https://x.com/img.png', 'cap');
    const msgs = calls.filter((c) => c.url.includes('/sendMessage'));
    expect(msgs.length).toBe(0);
  });

  it('sendPhoto 404 → 回落 sendMessage', async () => {
    mockRespond((u) => u.includes('/sendMessage') ? new Response('{}', { status: 200 }) : new Response('{}', { status: 404 }));
    await sendPhotoOrText('t', '1', 'https://x.com/img.png', 'cap');
    const msgs = calls.filter((c) => c.url.includes('/sendMessage'));
    expect(msgs.length).toBe(1);
    expect(msgs[0].body.text).toBe('cap');
  });

  it('sendPhoto 网络错 → 回落 sendMessage, 网络错被吞(修复后不抛)', async () => {
    mockNet();
    await expect(sendPhotoOrText('t', '1', 'https://x.com/img.png', 'cap')).resolves.toBe(false); // 回落也网络错 → false, 不抛
    const msgs = calls.filter((c) => c.url.includes('/sendMessage'));
    expect(msgs.length).toBe(1); // 回落确实尝试了(内部 sendTelegram 吞错不抛)
  });

  it('photoUrl 空 → 直接 sendMessage, 不发 sendPhoto', async () => {
    mockRespond(() => new Response('{}', { status: 200 }));
    await sendPhotoOrText('t', '1', undefined, 'plain');
    const photos = calls.filter((c) => c.url.includes('/sendPhoto'));
    const msgs = calls.filter((c) => c.url.includes('/sendMessage'));
    expect(photos.length).toBe(0);
    expect(msgs.length).toBe(1);
    expect(msgs[0].body.text).toBe('plain');
  });
});

describe('registerCommands', () => {
  it('幂等: 调两次都 200', async () => {
    mockRespond(() => new Response('{}', { status: 200 }));
    await registerCommands('t');
    await registerCommands('t');
    const set = calls.filter((c) => c.url.includes('/setMyCommands'));
    expect(set.length).toBe(2);
    expect((set[0].body.commands as any[]).length).toBe(6);
  });
});

describe('safeEqual', () => {
  it('相等 → true', async () => { expect(await safeEqual('abc', 'abc')).toBe(true); });
  it('不等 → false', async () => { expect(await safeEqual('abc', 'abd')).toBe(false); });
  it('不同长度 → false', async () => { expect(await safeEqual('abc', 'abcd')).toBe(false); });
  it('空串相等 → true, 空 vs 非空 → false', async () => {
    expect(await safeEqual('', '')).toBe(true);
    expect(await safeEqual('', 'a')).toBe(false);
  });
  it('多字节(非 ASCII)不等 → false', async () => { expect(await safeEqual('你好', '你好啊')).toBe(false); });
});

describe('sendTelegramKbd / editMessageKbd / answerCallbackQuery', () => {
  const kb = { inline_keyboard: [[{ text: 't', callback_data: 'c' }]] };

  it('ok 响应 → 正常 resolve', async () => {
    mockRespond(() => new Response('{}', { status: 200 }));
    await expect(sendTelegramKbd('t', '1', 'hi', kb)).resolves.toBeUndefined();
    await expect(editMessageKbd('t', '1', 7, 'hi', kb)).resolves.toBeUndefined();
    await expect(answerCallbackQuery('t', 'q1')).resolves.toBeUndefined();
  });

  it('HTTP 500 → 静默不抛', async () => {
    mockRespond(() => new Response('{}', { status: 500 }));
    await expect(sendTelegramKbd('t', '1', 'hi', kb)).resolves.toBeUndefined();
    await expect(editMessageKbd('t', '1', 7, 'hi', kb)).resolves.toBeUndefined();
    await expect(answerCallbackQuery('t', 'q1')).resolves.toBeUndefined();
  });
});
