// 不变量: 分派前的 KV 读(seenToday/shouldReprocess)抛错不得 500 也不得静默。
// 回归锁: 裸 CACHE.get 曾在 fetch 主线程 throw → 500 → TG 退避 = "没反应"。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import worker from '../src/index';

type Call = { url: string; body: any };
const calls: Call[] = [];
const pending: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p); return p; } } as unknown as ExecutionContext;
const CHAT = '944783507';
const origFetch = globalThis.fetch;

const throwKv = {
  get: async () => { throw new Error('KV down'); },
  put: async () => { throw new Error('KV down'); },
  delete: async () => { throw new Error('KV down'); },
  list: async () => { throw new Error('KV down'); },
};
const goodKv = {
  get: async () => null as string | null,
  put: async () => {}, delete: async () => {},
  list: async () => ({ keys: [] as { name: string }[] }),
};
function makeEnv(kv: unknown) {
  return {
    BOT_TOKEN: 'tok', CHAT_ID: CHAT, WEBHOOK_SECRET: 'sec', GH_TOKEN: 'g',
    CACHE: kv as unknown, AI: { run: async () => ({ translated_text: '中文翻译结果' }) },
    GH_ARCHIVE_REPO: 'gandli/daily-digest',
  } as never;
}
async function send(text: string, kv: unknown) {
  calls.length = 0; pending.length = 0;
  const t0 = Date.now();
  const res = await worker.fetch(new Request('https://x/telegram', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'sec' },
    body: JSON.stringify({ message: { chat: { id: Number(CHAT) }, text } }),
  }), makeEnv(kv), ctx);
  const ms = Date.now() - t0;
  await Promise.allSettled(pending);
  return { res, ms };
}
const replies = () => calls.filter((c) => /sendMessage|sendPhoto/.test(c.url));
const replyText = () => replies().map((c) => `${c.body.text ?? ''}${c.body.caption ?? ''}`).join('\n');

beforeEach(() => {
  calls.length = 0; pending.length = 0;
  // 每个用例独立的 fetch mock, 不受其它 test 文件的 globalThis.fetch 污染
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('api.telegram.org')) {
      calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    if (url.includes('api.github.com')) return new Response(JSON.stringify({ full_name: 'owner/repo', description: 'a rust cli tool', stargazers_count: 12, language: 'Rust', topics: ['rust'] }), { status: 200 });
    if (url.includes('api.telegra.ph')) return new Response(JSON.stringify({ ok: true, result: { url: 'https://telegra.ph/x-1' } }), { status: 200 });
    // archiveUrl 兜底: 普通网页
    return new Response('<html><body><h1>A Real Title</h1><p>' + '中文'.repeat(60) + '</p></body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
});

describe('KV 抛错不静默: 必有回复 + 秒回 200', () => {
  it('GitHub 仓库链接(KV 全抛) → 仍 200 且有一条出站回复(不静默)', async () => {
    const { res, ms } = await send('https://github.com/owner/repo', throwKv);
    expect(res.status).toBe(200);
    expect(ms).toBeLessThan(150);
    expect(replies().length).toBeGreaterThanOrEqual(1);
  });
  it('任意 URL 链接(KV 全抛) → 仍 200 且有回复(兜底走 archiveUrl)', async () => {
    const { res, ms } = await send('https://blog.example.com/posts/x', throwKv);
    expect(res.status).toBe(200);
    expect(ms).toBeLessThan(150);
    expect(replies().length).toBeGreaterThanOrEqual(1);
    // KV 全抛时 archiveUrl 仍能在后台完成(有兜底), 不断言特定文案, 只要不静默
    expect(replyText().length).toBeGreaterThan(0);
  });
  it('不抛: 正常仓库链接仍走完整卡(无回归)', async () => {
    const t0 = Date.now();
    const res = await worker.fetch(new Request('https://x/telegram', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'sec' },
      body: JSON.stringify({ message: { chat: { id: Number(CHAT) }, text: 'https://github.com/owner/repo' } }),
    }), makeEnv(goodKv), { waitUntil: (p: Promise<unknown>) => { pending.push(p); return p; } } as unknown as ExecutionContext);
    const ms = Date.now() - t0;
    await Promise.allSettled(pending);
    expect(res.status).toBe(200);
    expect(ms).toBeLessThan(150);
    expect(replies().length).toBeGreaterThanOrEqual(1);
  });
});
