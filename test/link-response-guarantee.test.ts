// 「发链接必有响应」不变量回归锁 —— 针对线上"有时发链接没反应"的不稳定症状。
//
// 三条硬约束(全部经 worker.fetch 真实走 webhook, 不直接调内部函数):
//  1. 慢管线不得阻塞 webhook 响应 —— handler 必须秒回 200, 重活全在 ctx.waitUntil。
//     (Telegram 等不到响应会重试/退避, 表现就是"有时没反应")
//  2. 任何链接分支至少产生一次出站回复(sendMessage/sendPhoto/editMessageText), 失败也要有明确文案。
//     静默只允许两种: 白名单外、限流丢弃。
//  3. 出站发送抛错(TG 网络/429)不得让 handler 变 500。
//
// mock: global fetch 按域名路由, 外部抓取带可控延迟; TG API 调用全部记录。
import { describe, it, expect, beforeEach, vi } from 'vitest';
import worker from '../src/index';

type Call = { url: string; body: any };
const calls: Call[] = [];
const pending: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p); return p; } } as unknown as ExecutionContext;

// 外部抓取延迟(ms)。链接管线单级 reader 真实耗时 5-45s, 用 300ms 模拟"慢"。
let externalDelay = 300;
// 外部抓取返回什么: 'empty' = 全链失败(urlToMarkdown 返回空串)
let externalMode: 'ok' | 'empty' | 'throw' = 'ok';
// TG 出站行为
let tgMode: 'ok' | 'throw' | 'fail' = 'ok';
// GitHub Contents API 写档行为
let ghWriteMode: 'ok' | 'fail' = 'ok';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const PAGE = '<html><head><meta property="og:title" content="A Real Article Title Here"></head><body><h1>A Real Article Title Here</h1><p>' + '这是一段足够长的中文正文内容用来通过 html strip 兜底链路提取纯文本超过四十个字符的边界验证。'.repeat(3) + '</p></body></html>';

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes('api.telegram.org')) {
    const body = JSON.parse(String(init?.body ?? '{}'));
    if (tgMode === 'throw') throw new Error('TG network down');
    if (tgMode === 'fail') return new Response(JSON.stringify({ ok: false, description: 'Too Many Requests' }), { status: 429 });
    calls.push({ url, body });
    return new Response(JSON.stringify({ ok: true, result: { message_id: 1, photo: [{ file_id: 'fid' }] } }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (url.includes('api.github.com')) {
    if (/\/contents\//.test(url) && (init?.method === 'PUT' || init?.method === 'POST')) {
      if (ghWriteMode === 'fail') return new Response('{"message":"Bad credentials"}', { status: 401 });
    }
    return new Response(JSON.stringify({ full_name: 'owner/repo', description: 'a rust cli tool', stargazers_count: 12, language: 'Rust', topics: ['rust'] }), { status: 200 });
  }
  if (url.includes('api.telegra.ph')) return new Response(JSON.stringify({ ok: true, result: { url: 'https://telegra.ph/x-1' } }), { status: 200 });
  await sleep(externalDelay); // 模拟 reader/抓取慢
  if (externalMode === 'throw') throw new Error('upstream timeout');
  if (externalMode === 'empty') return new Response('{}', { status: 500 });
  return new Response(PAGE, { status: 200, headers: { 'content-type': 'text/html' } });
}) as typeof fetch;

function memKv(extra: Record<string, string> = {}) {
  const store = new Map<string, string>(Object.entries(extra));
  return {
    list: async ({ prefix }: { prefix?: string } = {}) => ({ keys: [...store.keys()].filter((k) => !prefix || k.startsWith(prefix)).map((name) => ({ name })) }),
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v); },
    delete: async (k: string) => { store.delete(k); },
    store,
  };
}

const CHAT = '944783507';
const URL_ARTICLE = 'https://blog.example.com/posts/rust-async-runtime';
const reprocKey = (u: string) => `reproc:${u.slice(0, 400)}`;

function makeEnv(kv: ReturnType<typeof memKv>) {
  return {
    BOT_TOKEN: 'tok', CHAT_ID: CHAT, WEBHOOK_SECRET: 'sec', GH_TOKEN: 'g',
    CACHE: kv as unknown, AI: { run: async () => ({ translated_text: '中文翻译结果', summary: 'a summary' }), toMarkdown: async () => [{ format: 'markdown', data: PAGE }] },
    GH_ARCHIVE_REPO: 'gandli/daily-digest',
  } as never;
}

async function sendText(text: string, kv: ReturnType<typeof memKv>) {
  calls.length = 0;
  pending.length = 0;
  const t0 = Date.now();
  const res = await worker.fetch(new Request('https://x/telegram', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'sec' },
    body: JSON.stringify({ message: { chat: { id: Number(CHAT) }, text } }),
  }), kv ? makeEnv(kv) : makeEnv(memKv()), ctx);
  return { res, ms: Date.now() - t0 };
}

// 出站"回复"(不含 sendChatAction 的 typing 状态)
const replies = () => calls.filter((c) => /sendMessage|sendPhoto|editMessageText/.test(c.url));
const replyText = () => replies().map((c) => `${c.body.text ?? ''}${c.body.caption ?? ''}`).join('\n');

beforeEach(() => {
  calls.length = 0; pending.length = 0;
  externalDelay = 300; externalMode = 'ok'; tgMode = 'ok'; ghWriteMode = 'ok';
});

describe('不变量1: webhook 秒回, 慢管线全在 waitUntil', () => {
  // 单级 reader 300ms、全链 7 级 → 若有任何一级被 handler await, 响应时间会远超阈值。
  // 阈值 150ms: 远大于正常 KV/内存操作, 远小于任一次外部抓取。
  const cases: Array<[string, string, Record<string, string>]> = [
    ['首次链接', URL_ARTICLE, {}],
    ['重发 done(有 md → 回缓存卡)', URL_ARTICLE, { [reprocKey(URL_ARTICLE)]: JSON.stringify({ translated: true, descOk: true, md: '2026-08-31-1', t: '标题', s: '摘要' }) }],
    ['X 帖链接', 'https://x.com/fe2o3/status/1234567890', {}],
    ['GitHub 仓库链接', 'https://github.com/owner/repo', {}],
    ['/search 命令', '/search rust', {}],
  ];
  for (const [name, text, extra] of cases) {
    it(`${name} → handler <150ms 返回 200`, async () => {
      const { res, ms } = await sendText(text, memKv(extra));
      expect(res.status).toBe(200);
      expect(ms, `handler 阻塞了 ${ms}ms —— 有慢调用没放进 ctx.waitUntil`).toBeLessThan(150);
      await Promise.allSettled(pending);
    });
  }

  it('重发 done 但记录缺 md → 兜底重挂也须秒回(回归锁: 此分支曾 inline await 全链)', async () => {
    const { res, ms } = await sendText(URL_ARTICLE, memKv({ [reprocKey(URL_ARTICLE)]: JSON.stringify({ translated: true, descOk: true }) }));
    expect(res.status).toBe(200);
    expect(ms, 'done-无md 分支 inline await archiveUrl → 全链 reader 阻塞 webhook').toBeLessThan(150);
    await Promise.allSettled(pending);
  });

  it('重发 retry(上次未译) → 秒回且提示文案先出', async () => {
    const { ms } = await sendText(URL_ARTICLE, memKv({ [reprocKey(URL_ARTICLE)]: JSON.stringify({ translated: false, descOk: true }) }));
    expect(ms).toBeLessThan(150);
    await Promise.allSettled(pending);
    expect(replyText()).toContain('🔁');
  });
});

describe('不变量2: 每条链接路径都有出站回复(失败不静默)', () => {
  const scenarios: Array<{ name: string; text: string; extra?: Record<string, string>; setup?: () => void; expect?: (t: string) => void }> = [
    { name: '正常文章链接', text: URL_ARTICLE, expect: (t) => expect(t.length).toBeGreaterThan(0) },
    { name: 'reader 全链失败', text: URL_ARTICLE, setup: () => { externalMode = 'empty'; }, expect: (t) => expect(t).toContain('❌') },
    { name: '上游全部抛错', text: URL_ARTICLE, setup: () => { externalMode = 'throw'; }, expect: (t) => expect(t.length).toBeGreaterThan(0) },
    // 写档缓冲失败(KV put 抛 → 回落即时 PUT → 也失败)。archiveToGitHub 内层吞错不抛,
    // 用户仍收到卡片 —— 但卡里的 GitHub 链接会 404。此处锁"不静默", 404 问题另案。
    { name: 'GitHub 写档失败', text: URL_ARTICLE, setup: () => { ghWriteMode = 'fail'; }, expect: (t) => expect(t.length).toBeGreaterThan(0) },
    { name: 'X 帖链接', text: 'https://x.com/fe2o3/status/1234567890', expect: (t) => expect(t.length).toBeGreaterThan(0) },
    { name: '仓库链接', text: 'https://github.com/owner/repo', expect: (t) => expect(t.length).toBeGreaterThan(0) },
    { name: '链接带中文尾标点', text: `${URL_ARTICLE}。很好`, expect: (t) => expect(t.length).toBeGreaterThan(0) },
    { name: '裸域名(非链接) → HELP', text: 'example.com', expect: (t) => expect(t).toContain('daily-digest') },
  ];
  for (const s of scenarios) {
    it(s.name, async () => {
      s.setup?.();
      externalDelay = 0; // 只验"有没有回复", 不验耗时
      const { res } = await sendText(s.text, memKv(s.extra ?? {}));
      await Promise.allSettled(pending);
      expect(res.status).toBe(200);
      expect(replies().length, '零出站回复 = 用户侧"没反应"').toBeGreaterThan(0);
      s.expect?.(replyText());
    });
  }

  it('仅两种情形允许静默: 白名单外 / 限流丢弃', async () => {
    // 白名单外
    calls.length = 0;
    const r1 = await worker.fetch(new Request('https://x/telegram', {
      method: 'POST', headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'sec' },
      body: JSON.stringify({ message: { chat: { id: 111 }, text: URL_ARTICLE } }),
    }), makeEnv(memKv()), ctx);
    expect(r1.status).toBe(200);
    expect(replies().length).toBe(0);

    // 限流
    calls.length = 0;
    const env = Object.assign(makeEnv(memKv()) as object, { RATE_LIMITER: { limit: async () => ({ success: false }) } }) as never;
    const r2 = await worker.fetch(new Request('https://x/telegram', {
      method: 'POST', headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'sec' },
      body: JSON.stringify({ message: { chat: { id: Number(CHAT) }, text: URL_ARTICLE } }),
    }), env, ctx);
    expect(r2.status).toBe(200); // 必须 200, 否则 TG 无限重试
    expect(replies().length).toBe(0);
  });
});

describe('不变量3: 出站发送故障不得让 handler 500', () => {
  it('TG API 网络抛错 → 仍 200, 后台不产生未捕获拒绝', async () => {
    externalDelay = 0; tgMode = 'throw';
    const { res } = await sendText(URL_ARTICLE, memKv());
    expect(res.status).toBe(200);
    // 后台 promise 抛错 = Worker 记 error 且该次更新彻底丢失(线上"没反应"的另一来源)
    const settled = await Promise.allSettled(pending);
    const rejected = settled.filter((s) => s.status === 'rejected');
    expect(rejected.length, `waitUntil 里有 ${rejected.length} 个未捕获异常`).toBe(0);
  });

  it('TG 返回 429 → 仍 200 且不 crash', async () => {
    externalDelay = 0; tgMode = 'fail';
    const { res } = await sendText(URL_ARTICLE, memKv());
    expect(res.status).toBe(200);
    await Promise.allSettled(pending);
  });

  it('KV 读写抛错 → 链接仍得到回复', async () => {
    externalDelay = 0;
    const kv = memKv();
    kv.get = vi.fn(async (k: string) => { if (k.startsWith('search:') || k.startsWith('reproc:')) throw new Error('KV 429'); return null; });
    kv.put = vi.fn(async () => { throw new Error('KV 429'); });
    const { res } = await sendText(URL_ARTICLE, kv);
    await Promise.allSettled(pending);
    expect(res.status).toBe(200);
    expect(replies().length).toBeGreaterThan(0);
  });
});

describe('稳定性: 同一链接连发不互相吞掉', () => {
  it('连发 3 条不同链接 → 各自都有回复(无跨请求状态串扰)', async () => {
    externalDelay = 0;
    const urls = ['https://a.example.com/x', 'https://b.example.com/y', 'https://c.example.com/z'];
    const kv = memKv();
    for (const u of urls) {
      const { res } = await sendText(u, kv);
      await Promise.allSettled(pending);
      expect(res.status).toBe(200);
      expect(replies().length, `${u} 无回复`).toBeGreaterThan(0);
    }
  });

  it('同一链接连发 2 次 → 第 2 次走重发语义且仍有回复', async () => {
    externalDelay = 0;
    const kv = memKv();
    await sendText(URL_ARTICLE, kv); await Promise.allSettled(pending);
    const first = replies().length;
    calls.length = 0;
    await sendText(URL_ARTICLE, kv); await Promise.allSettled(pending);
    expect(first).toBeGreaterThan(0);
    expect(replies().length, '第二次静默').toBeGreaterThan(0);
    expect(replyText()).toContain('♻️');
  });
});
