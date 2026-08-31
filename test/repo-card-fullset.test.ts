// 不变量: 任何 repo 卡(首查/♻️重发/多仓 fanout)三要素齐——
// ① OG 图(sendPhoto photo=opengraph.githubassets 直链) ② wiki 三链 deepwiki·zread·codewiki
// ③ 存档三链 Telegraph·Wayback·Archive。曾有缺口: replyArchived/fanout 手拼卡漏 wiki 链、
// lookupRepo 不写 archive:tg:<stamp> → 重发卡 Telegraph 链缺失、重发卡 OG 图用归档 raw 路径(未 flush 404 掉图)。
// 风格: 真实 worker.fetch 走 webhook, 捕获 TG API 出站调用断言。
import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../src/index';

type Call = { url: string; body: any };
const calls: Call[] = [];
const pending: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p); return p; } } as unknown as ExecutionContext;

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes('api.telegram.org')) {
    calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }
  if (url.includes('api.telegra.ph')) return new Response(JSON.stringify({ ok: true, result: { url: 'https://telegra.ph/repo-page-1' } }), { status: 200 });
  if (url.includes('api.github.com/repos')) {
    // 按 URL 里的 repo 段回对应 full_name(否则 mock 固定 owner/repo, other/thing 也解析成它)
    const m = url.match(/repos\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/);
    const repo = m ? m[1] : 'owner/repo';
    return new Response(JSON.stringify({ full_name: repo, description: 'a rust cli tool', stargazers_count: 12, language: 'Rust', topics: ['rust'] }), { status: 200 });
  }
  if (url.includes('api.github.com')) return new Response('{}', { status: 200 });
  return new Response('<html></html>', { status: 200 });
}) as typeof fetch;

function memKv(extra: Array<[string, string]> = []) {
  const store = new Map<string, string>(extra);
  return {
    list: async ({ prefix }: { prefix: string }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }),
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v); },
    get store() { return store; },
  };
}

let env: any;
beforeEach(() => {
  calls.length = 0;
  pending.length = 0;
  env = {
    BOT_TOKEN: 'test', CHAT_ID: '944783507', WEBHOOK_SECRET: 'sec', GH_TOKEN: 'g',
    CACHE: memKv(), AI: undefined, TELEGRAPH_TOKEN: 'tg', GH_ARCHIVE_REPO: 'gandli/daily-digest', OPENROUTER_API_KEY: undefined,
  };
});

async function post(text: string) {
  await worker.fetch(new Request('https://x/telegram', { method: 'POST', headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'sec' }, body: JSON.stringify({ message: { chat: { id: 944783507 }, text } }) }), env, ctx);
  await Promise.allSettled(pending);
}
const photos = () => calls.filter((c) => c.url.includes('/sendPhoto'));
const msgTexts = () => calls.filter((c) => c.url.includes('/sendMessage') || c.url.includes('/sendPhoto')).map((c) => String(c.body.text ?? c.body.caption ?? ''));

/** 一条 repo 卡文本的三要素断言(repo 参数化, 多仓 fanout 也能用) */
function expectFullCard(t: string, label: string, repo = 'owner/repo') {
  expect(t, label).toContain(`deepwiki.com/${repo}`);
  expect(t, label).toContain(`zread.ai/${repo}`);
  expect(t, label).toContain(`codewiki.google/github.com/${repo}`);
  expect(t, label).toContain('web.archive.org/web/2/');
  expect(t, label).toMatch(/github\.com\/gandli\/daily-digest\/blob\/archive\/.*\.md/);
}

describe('repo 卡三要素不变量(OG图+wiki三链+存档三链)', () => {
  it('首查卡: sendPhoto(opengraph) + wiki 三链 + Telegraph/Wayback/Archive', async () => {
    await post('https://github.com/owner/repo');
    const p = photos().find((c) => String(c.body.photo).includes('opengraph.githubassets.com/1/owner/repo'));
    expect(p, 'OG 图 = opengraph 直链').toBeTruthy();
    const card = String(p!.body.caption);
    expectFullCard(card, '首查卡');
    expect(card).toContain('telegra.ph/repo-page-1'); // Telegraph 链(建页成功即上卡)
  });

  it('lookupRepo 把 Telegraph 页 URL 写 archive:tg:<stamp> → ♻️重发卡三链齐', async () => {
    await post('https://github.com/owner/repo');
    const tgKeys = [...env.CACHE.store.keys()].filter((k: string) => k.startsWith('archive:tg:'));
    expect(tgKeys.length, 'Telegraph URL 已落 KV').toBeGreaterThan(0);
    // 第二条 webhook(同链接重发): seenToday 命中 + archive:idx 在 → replyArchived
    calls.length = 0;
    await post('https://github.com/owner/repo');
    const card2 = msgTexts().find((t) => t.includes('今日已存档'));
    expect(card2, '重发回 ♻️ 卡').toBeTruthy();
    expectFullCard(card2!, '♻️重发卡');
    expect(card2).toContain('telegra.ph/repo-page-1'); // archive:tg 读回 → Telegraph 链在
    const p2 = photos().find((c) => String(c.body.caption ?? '').includes('今日已存档'));
    expect(String(p2!.body.photo), '重发卡 OG 图 = opengraph(非归档 raw 路径)').toContain('opengraph.githubassets.com');
  });

  it('多仓 fanout 精简卡: 每卡 wiki 三链 + Wayback/Archive + OG 图', async () => {
    await post('https://github.com/owner/repo see also https://github.com/other/thing');
    const cards = msgTexts().filter((t) => /🗂/.test(t));
    expect(cards.length, 'fanout 出卡').toBeGreaterThanOrEqual(2);
    for (const c of cards) {
      const repo = c.includes('other/thing') ? 'other/thing' : 'owner/repo';
      expect(c).toContain(`deepwiki.com/${repo}`);
      expect(c).toContain(`zread.ai/${repo}`);
      expect(c).toContain(`codewiki.google/github.com/${repo}`);
      expect(c).toContain('web.archive.org/web/2/');
      expect(c).toMatch(/blob\/archive\/.*\.md/);
    }
    for (const r of ['owner/repo', 'other/thing']) {
      expect(photos().some((p) => String(p.body.photo).includes(`opengraph.githubassets.com/1/${r}`)), `fanout ${r} OG 图`).toBe(true);
    }
  });

  it('当日全 seen → ♻️ 一句话(不重复发卡, 非静默)', async () => {
    await post('https://github.com/owner/repo https://github.com/other/thing');
    calls.length = 0;
    await post('https://github.com/owner/repo https://github.com/other/thing');
    expect(msgTexts().some((t) => t.includes('均已存档')), '二次直发多仓有回执').toBe(true);
  });
});
