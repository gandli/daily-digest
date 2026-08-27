// runProductThin 回归锁: 读 archive 分支 JSON → 渲染卡片 → sendMessage; miss → dispatch + 占位。
import { describe, it, expect, beforeEach } from 'vitest';

type Call = { url: string; body: Record<string, unknown> };
const calls: Call[] = [];
const origFetch = globalThis.fetch;

// jsonMode 控制 raw.githubusercontent.com 返回: 'ok' | 'no-items' | 'bad-json' | 'fail'
let jsonMode: 'ok' | 'no-items' | 'bad-json' | 'fail' = 'ok';
const fakeJson = () => ({
  date: '2026-08-27',
  telegraphUrl: 'https://telegra.ph/product-2026-08-27',
  items: [{
    title: 'Show HN: A cool tool', url: 'https://x.dev', descZh: '这是一个中文描述内容。',
    author: 'fe2o3', createdAt: new Date(Date.now() - 3600e3).toISOString(),
  }],
});

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes('raw.githubusercontent.com')) {
    if (jsonMode === 'fail') throw new Error('network down');
    if (jsonMode === 'bad-json') return new Response('not json {{{', { status: 200 });
    if (jsonMode === 'no-items') return new Response(JSON.stringify({ date: '2026-08-27' }), { status: 200 });
    return new Response(JSON.stringify(fakeJson()), { status: 200 });
  }
  if (url.includes('api.telegram.org')) {
    calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }
  if (url.includes('api.github.com')) {
    calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response('{}', { status: 200 });
  }
  return new Response('{}', { status: 404 });
}) as typeof fetch;

import { runProductThin } from '../src/index';

const env = {
  BOT_TOKEN: 'test', CHAT_ID: '944783507', WEBHOOK_SECRET: 'sec', GH_TOKEN: 'g',
  CACHE: { get: async () => null, put: async () => {}, list: async () => ({ keys: [], list_complete: true }) },
  AI: undefined, TELEGRAPH_TOKEN: undefined, GH_ARCHIVE_REPO: 'gandli/daily-digest',
} as any;

const sendMessages = () => calls.filter((c) => c.url.includes('/sendMessage'));

describe('runProductThin', () => {
  beforeEach(() => { calls.length = 0; jsonMode = 'ok'; });

  it('JSON 有 items → 卡片经 sendMessage 发出, 返回条数', async () => {
    const n = await runProductThin(env, '944783507');
    expect(n).toBe(1);
    const msgs = sendMessages();
    expect(msgs.length).toBe(1);
    expect(String(msgs[0].body.text)).toContain('by fe2o3');
    expect(String(msgs[0].body.text)).toContain('about 1 hours ago');
    expect(String(msgs[0].body.text)).toMatch(/🚀 <b>\d{4}-\d{2}-\d{2}<\/b>/);
    // 不触发 dispatch(命中路径)
    expect(calls.some((c) => c.url.includes('/dispatches'))).toBe(false);
  });

  it('JSON 缺 items → 不 crash, 走 dispatch 兜底 + 占位提示', async () => {
    jsonMode = 'no-items';
    const n = await runProductThin(env, '944783507');
    expect(n).toBe(0);
    // 无卡片发出
    expect(sendMessages().some((c) => String(c.body.text).includes('🚀 <b>'))).toBe(false);
    // dispatch 被触发
    const disp = calls.find((c) => c.url.includes('/dispatches'));
    expect(disp).toBeTruthy();
    expect(disp!.body.event_type).toBe('product-digest');
    // 占位提示发出
    expect(sendMessages().some((c) => String(c.body.text).includes('生成中'))).toBe(true);
  });

  it('JSON 坏格式 → 不 crash, 走 dispatch 兜底', async () => {
    jsonMode = 'bad-json';
    const n = await runProductThin(env, '944783507');
    expect(n).toBe(0);
    expect(calls.find((c) => c.url.includes('/dispatches'))).toBeTruthy();
  });

  it('fetch 失败 → 不 crash, dispatch 尝试 + 占位提示', async () => {
    jsonMode = 'fail';
    const n = await runProductThin(env, '944783507');
    expect(n).toBe(0);
    // dispatch 被尝试(本 mock 里 github 204 ok → 生成中文案)
    expect(calls.find((c) => c.url.includes('/dispatches'))).toBeTruthy();
    expect(sendMessages().length).toBeGreaterThan(0);
  });
});
