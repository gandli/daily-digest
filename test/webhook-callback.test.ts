import { describe, it, expect, vi, beforeEach } from 'vitest';

// /archive /search 翻页端到端回归锁: 构造真实 callback_query update 打 worker webhook,
// mock global fetch 捕获是否真正发 sendMessage / editMessageText。
// 防: callback_data 超长、白名单串位、答回缺失导致"翻页按钮点了没反应"。

// --- capture TG API calls ---
type Call = { url: string; body: Record<string, unknown> };
const calls: Call[] = [];
const origFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes('api.telegram.org')) {
    calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
    // answerCallbackQuery / sendMessage / editMessageText 都回 ok
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return origFetch(input, init);
}) as typeof fetch;

import worker from '../src/index';

// 生成多页 archive:idx 数据的 KV 内存 stub
function memKv(archCount: number) {
  const store = new Map<string, string>();
  for (let i = 0; i < archCount; i++) {
    const repo = `org${i}/repo${i}`;
    const date = `2026-08-${String((i % 28) + 1).padStart(2, '0')}`;
    store.set(`archive:idx:${repo}`, JSON.stringify({ repo, date, desc: `desc ${i}` }));
  }
  return {
    list: async ({ prefix }: { prefix: string }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }),
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v); },
  };
}

const env = {
  BOT_TOKEN: 'test', CHAT_ID: '944783507', WEBHOOK_SECRET: 'sec', GH_TOKEN: 'g',
  CACHE: memKv(50), // 50 条 -> 5 页
  AI: undefined, TELEGRAPH_TOKEN: undefined, GH_ARCHIVE_REPO: 'gandli/daily-digest',
} as any;

const pending: Promise<unknown>[] = [];
const ctx = {
  waitUntil: (p: Promise<unknown>) => { pending.push(p); return p; },
} as unknown as ExecutionContext;

async function postUpdate(update: unknown) {
  calls.length = 0;
  pending.length = 0;
  const req = new Request('https://x/telegram', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'sec' },
    body: JSON.stringify(update),
  });
  await worker.fetch(req, env, ctx);
  // 等 waitUntil 里后台任务跑完(真实 CF 会挂住事件; 测试端显式 await)
  await Promise.allSettled(pending);
}

describe('/archive 翻页端到端', () => {
  beforeEach(() => calls.length = 0);

  it('command /archive 首屏发消息带 inline keyboard(上一页禁/下一页有)', async () => {
    await postUpdate({ message: { chat: { id: 944783507 }, text: '/archive' } });
    const send = calls.find((c) => c.url.includes('/sendMessage'));
    expect(send).toBeTruthy();
    const kb = (send!.body.reply_markup as any).inline_keyboard;
    // 扁平化所有行按钮(导航行 + 跳转行)
    const texts = kb.flat().map((b: any) => b.text) as string[];
    expect(texts).not.toContain('上一页');
    expect(texts).toContain('下一页 ➡');
    // 页码指示存在(5页)
    expect(texts).toContain('📄 1/5');
  });

  it('点下一页 callback arch:pg:1 -> editMessageText 同消息更新(非新发)', async () => {
    // 先发首屏拿 message_id
    await postUpdate({ message: { chat: { id: 944783507 }, text: '/archive' } });
    const send = calls.find((c) => c.url.includes('/sendMessage'));
    calls.length = 0;
    // 模拟 TG callback: 用 sendMessage 返回的 message_id
    const msgId = 123;
    // 点"下一页"(page 0 -> 1)
    await postUpdate({
      callback_query: { id: 'cq1', data: 'arch:pg:1', message: { chat: { id: 944783507 }, message_id: msgId } },
    });
    const edit = calls.find((c) => c.url.includes('/editMessageText'));
    expect(edit).toBeTruthy();
    expect(edit!.body.message_id).toBe(msgId); // 原地更新
    expect(String(edit!.body.text)).toContain('第 2/5 页');
    // 答回收
    const ack = calls.find((c) => c.url.includes('/answerCallbackQuery'));
    expect(ack!.body.callback_query_id).toBe('cq1');
  });

  it('翻到末页后不再出现下一页按钮', async () => {
    await postUpdate({ message: { chat: { id: 944783507 }, text: '/archive 4' } }); // 第5页(0-index 4)
    const send = calls.find((c) => c.url.includes('/sendMessage'));
    const kb = (send!.body.reply_markup as any).inline_keyboard;
    const texts = kb.flat().map((b: any) => b.text) as string[];
    const joined = texts.join(',');
    expect(joined).toContain('上一页');
    expect(joined).not.toContain('下一页');
  });
});