import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../src/index';

// webhook 入口 Rate Limiting 回归锁: 超限静默丢弃(仍回 200 给 Telegram)、正常放行、
// 限流器故障放行(可用性优先)、未绑定不限流。global fetch mock 捕获 TG API 调用。

type Call = { url: string; body: Record<string, unknown> };
const calls: Call[] = [];
const origFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes('api.telegram.org')) {
    calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
}) as typeof fetch;

function memKv() {
  const store = new Map<string, string>();
  return {
    list: async () => ({ keys: [] }),
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v); },
    delete: async (k: string) => { store.delete(k); },
  };
}

const pending: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p); } } as unknown as ExecutionContext;

function makeEnv(rateLimiter?: { limit: (o: { key: string }) => Promise<{ success: boolean }> }) {
  return {
    BOT_TOKEN: 'test', CHAT_ID: '944783507', WEBHOOK_SECRET: 'sec', GH_TOKEN: 'g',
    CACHE: memKv() as unknown, AI: undefined,
    GH_ARCHIVE_REPO: 'gandli/daily-digest',
    ...(rateLimiter ? { RATE_LIMITER: rateLimiter } : {}),
  } as never;
}

async function postUpdate(env: never, text: string): Promise<Response> {
  calls.length = 0;
  const req = new Request('https://x/telegram', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'sec' },
    body: JSON.stringify({ message: { chat: { id: 944783507 }, text } }),
  });
  const res = await worker.fetch(req, env, ctx);
  await Promise.allSettled(pending);
  return res;
}

beforeEach(() => { calls.length = 0; });

describe('webhook Rate Limiting', () => {
  it('超限(success=false) → 静默丢弃: 回 200 且零 TG API 调用', async () => {
    const rl = { limit: async () => ({ success: false }) };
    const res = await postUpdate(makeEnv(rl), '/search zzz');
    expect(res.status).toBe(200);
    expect(calls.length).toBe(0);
  });

  it('未超限 → 放行, /search 正常发消息', async () => {
    const rl = { limit: async () => ({ success: true }) };
    await postUpdate(makeEnv(rl), '/search zzz');
    expect(calls.some((c) => c.url.includes('sendMessage'))).toBe(true);
  });

  it('限流器抛错 → 放行(可用性优先)', async () => {
    const rl = { limit: async () => { throw new Error('rl down'); } };
    await postUpdate(makeEnv(rl), '/search zzz');
    expect(calls.some((c) => c.url.includes('sendMessage'))).toBe(true);
  });

  it('未绑定 RATE_LIMITER → 不限流(旧版行为)', async () => {
    await postUpdate(makeEnv(), '/search zzz');
    expect(calls.some((c) => c.url.includes('sendMessage'))).toBe(true);
  });
});
