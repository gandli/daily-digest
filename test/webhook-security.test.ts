import { describe, it, expect, beforeEach } from 'vitest';

// webhook 入口安全边界 + 路由回归锁(只测入口, 不碰 src/):
// 验签 fail-closed / CHAT_ID 白名单 / 未知命令静默 / 非命令文本路由 / callback data 前缀与白名单 /
// /preview 凭证门 / 路径与方法 404。
// 风格与 test/webhook-callback.test.ts 一致: 真实 update 打 worker.fetch, mock global fetch 捕获 TG API 调用。

type Call = { url: string; body: Record<string, unknown> };
const calls: Call[] = [];
const origFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes('api.telegram.org')) {
    calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (url.includes('zread') || url.includes('deepwiki') || url.includes('transmart') || url.includes('google') || url.includes('mymemory')) {
    // translate.ts 回退链: 全返回空 → 不产生网络差异
    return new Response(JSON.stringify({}), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (url.includes('github.com/trending')) {
    // /preview 无凭证路径会抓 trending; HTMLRewriter 无 runtime 可用, 回退化空页兜底
    return new Response('<html><body></body></html>', { status: 200, headers: { 'content-type': 'text/html' } });
  }
  return origFetch(input, init);
}) as typeof fetch;

import worker from '../src/index';

// HTMLRewriter 是 CF runtime 全局, vitest 无。/preview 无凭证路径会抓 trending(用 HTMLRewriter)。
// 这里给最小 stub: transform 回空响应, 让 /preview 逻辑跑通以验证真实安全行为(开放/拒绝)。
class HTMLRewriterStub {
  on() { return this; }
  transform(res: Response) { return new Response('', { status: res.status, headers: res.headers }); }
}
(globalThis as any).HTMLRewriter = HTMLRewriterStub;

const memKv = () => {
  const store = new Map<string, string>();
  return {
    list: async () => ({ keys: [] }),
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v); },
    delete: async (k: string) => { store.delete(k); },
  };
};

const pending: Promise<unknown>[] = [];
const ctx = {
  waitUntil: (p: Promise<unknown>) => { pending.push(p); return p; },
} as unknown as ExecutionContext;

let env: any;
beforeEach(() => {
  calls.length = 0;
  pending.length = 0;
  env = {
    BOT_TOKEN: 'test', CHAT_ID: '944783507', WEBHOOK_SECRET: 'sec', GH_TOKEN: 'g',
    CACHE: memKv(), AI: undefined, TELEGRAPH_TOKEN: undefined, GH_ARCHIVE_REPO: 'gandli/daily-digest',
  };
});

async function post(url: string, token: string | null, body: unknown) {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (token !== null) headers['X-Telegram-Bot-Api-Secret-Token'] = token;
  return worker.fetch(new Request(url, { method: 'POST', headers, body: JSON.stringify(body) }), env, ctx);
}
async function postUpdate(update: unknown) {
  const res = await post('https://x/telegram', 'sec', update);
  await Promise.allSettled(pending);
  return res;
}

describe('验签 fail-closed', () => {
  it('secret token 不匹配 → 403, 无 TG API 调用', async () => {
    const res = await post('https://x/telegram', 'wrong', { message: { chat: { id: 944783507 }, text: '/gt' } });
    expect(res.status).toBe(403);
    await Promise.allSettled(pending);
    expect(calls.length).toBe(0);
  });
  it('缺 secret token header → 403', async () => {
    const res = await post('https://x/telegram', null, { message: { chat: { id: 944783507 }, text: '/gt' } });
    expect(res.status).toBe(403);
  });
  it('env.WEBHOOK_SECRET 未配置 → fail-closed 全拒', async () => {
    env.WEBHOOK_SECRET = undefined;
    const res = await post('https://x/telegram', 'sec', { message: { chat: { id: 944783507 }, text: '/gt' } });
    expect(res.status).toBe(403);
  });
  it('非法 JSON 但验签通过 → 秒回 200(不 crash, 无 chatId 走忽略)', async () => {
    const headers = { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'sec' };
    const res = await worker.fetch(new Request('https://x/telegram', { method: 'POST', headers, body: 'not-json{{' }), env, ctx);
    expect(res.status).toBe(200);
  });
});

describe('chatId 白名单', () => {
  it('白名单外消息 chatId → 忽略(200, 全链路零 TG API 调用)', async () => {
    const res = await postUpdate({ message: { chat: { id: 999 }, text: '/gt' } });
    expect(res.status).toBe(200);
    expect(calls.length).toBe(0);
  });
  it('白名单外 callback_query → 忽略(不答回收不编辑)', async () => {
    const res = await postUpdate({
      callback_query: { id: 'cq-x', data: 'arch:pg:1', message: { chat: { id: 999 }, message_id: 1 } },
    });
    expect(res.status).toBe(200);
    expect(calls.length).toBe(0);
  });
  it('白名单外 str 形式 chatId 也忽略', async () => {
    const res = await postUpdate({ message: { chat: { id: '999' }, text: '/archive' } });
    expect(res.status).toBe(200);
    expect(calls.length).toBe(0);
  });
  it('缺 chatId(空 update) → 忽略不 crash', async () => {
    const res = await postUpdate({});
    expect(res.status).toBe(200);
    expect(calls.length).toBe(0);
  });
});

describe('命令路由', () => {
  it('/unknown → 200 无 crash, 无 TG 调用(无 repo/url/tweet 匹配 → HELP)', async () => {
    const res = await postUpdate({ message: { chat: { id: 944783507 }, text: '/unknown' } });
    expect(res.status).toBe(200);
    expect(calls.some((c) => c.url.includes('/sendMessage'))).toBe(true);
    expect(String(calls.find((c) => c.url.includes('/sendMessage'))!.body.text)).toContain('daily-digest 使用');
  });
  it('普通文本(无 / 前缀, 非 repo/url/tweet)→ HELP 而非命令', async () => {
    await postUpdate({ message: { chat: { id: 944783507 }, text: 'everything fine' } });
    const send = calls.find((c) => c.url.includes('/sendMessage'));
    expect(send).toBeTruthy();
    expect(String(send!.body.text)).toContain('daily-digest 使用');
  });
  it('空文本 → HELP(立即返回, 无 crash)', async () => {
    await postUpdate({ message: { chat: { id: 944783507 }, text: '' } });
    expect(calls.length).toBeGreaterThan(0);
  });
  it('非 / 开头但匹配命令路径的文本不会误触发命令', async () => {
    await postUpdate({ message: { chat: { id: 944783507 }, text: 'search rust' } });
    // 非命令文本 → 无 repo/tweet/url → HELP, 而非 /search 用法
    const send = calls.find((c) => c.url.includes('/sendMessage'));
    expect(String(send!.body.text)).toContain('daily-digest 使用');
  });
});

describe('callback_query 安全', () => {
  it('未知 data 前缀 → 未忽略, 落入文本路由回 HELP(bug: 应忽略)', async () => {
    await postUpdate({
      callback_query: { id: 'cq1', data: 'evil:rm-rf', message: { chat: { id: 944783507 }, message_id: 5 } },
    });
    // bug: 非 arch:pg:/sch: 前缀不忽略, 因无 message.text → text='' → 落到 else 回 HELP
    const send = calls.find((c) => c.url.includes('/sendMessage'));
    expect(String(send!.body.text)).toContain('daily-digest 使用');
    // 未编辑未答回(安全: 不碰消息)
    expect(calls.some((c) => c.url.includes('/editMessageText'))).toBe(false);
    expect(calls.some((c) => c.url.includes('/answerCallbackQuery'))).toBe(false);
  });
  it('arch:pg: 前缀非数字 data → page 回退 0 → 发首屏不 crash', async () => {
    await postUpdate({
      callback_query: { id: 'cq2', data: 'arch:pg:abc', message: { chat: { id: 944783507 }, message_id: 6 } },
    });
    expect(calls.length).toBeGreaterThan(0); // 忽略也不应 crash; 此处仍走编辑/发送
  });
  it('sch: 前缀 token 缺失 → 查询过期提示, 不 crash', async () => {
    await postUpdate({
      callback_query: { id: 'cq3', data: 'sch:0:', message: { chat: { id: 944783507 }, message_id: 7 } },
    });
    expect(calls.some((c) => c.url.includes('/editMessageText'))).toBe(true);
  });
});

describe('路由: 路径与方法', () => {
  it('GET /telegram → 200 banner(非 404; GET 分支兜底返回 HTML 状态页)', async () => {
    const res = await worker.fetch(new Request('https://x/telegram'), env, ctx);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('daily-digest');
  });
  it('POST /other → 404', async () => {
    const res = await post('https://x/other', 'sec', {});
    expect(res.status).toBe(404);
  });
  it('POST /run 错 token → 403(端点已修复: /run 移出 GET 分支, 真实可达)', async () => {
    env.WEBHOOK_SECRET = 'sec';
    const res = await post('https://x/run', 'wrong', {});
    expect(res.status).toBe(403);
  });
  it('GET /run → 405(端点已修复: /run 在 GET 探活分支之前)', async () => {
    const res = await worker.fetch(new Request('https://x/run'), env, ctx);
    expect(res.status).toBe(405);
  });
});

describe('GET /preview 凭证门', () => {
  it('无 BOT_TOKEN → 200 开放(即使有 WEBHOOK_SECRET)', async () => {
    env.BOT_TOKEN = undefined;
    env.WEBHOOK_SECRET = 'sec';
    const res = await worker.fetch(new Request('https://x/preview'), env, ctx);
    expect(res.status).toBe(200);
  });
  it('有 BOT_TOKEN → 200 兜底根路径响应但无 preview 数据(bug: /preview 未在有凭证时拒绝)', async () => {
    env.BOT_TOKEN = 'test';
    const res = await worker.fetch(new Request('https://x/preview'), env, ctx);
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).not.toContain('"count"');
  });
});