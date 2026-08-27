import { describe, it, expect, beforeEach } from 'vitest';

// archiveList / renderArchivePage / buildArchiveKeyboard 端到端回归:
// 打 worker webhook(/archive + arch:pg:N callback), mock KV + TG API, 断言文本与 keyboard。
// 不导出私有函数(不动 src/), 走 webhook 与现有 webhook-callback.test.ts 同形态。

type Call = { url: string; body: Record<string, unknown> };
const calls: Call[] = [];
const origFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes('api.telegram.org')) {
    calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  return origFetch(input, init);
}) as typeof fetch;

import worker from '../src/index';

function memKv(entries: Array<{ repo: string; date: string; desc?: string; descZh?: string; topics?: string[] }>) {
  const store = new Map<string, string>();
  for (const e of entries) store.set(`archive:idx:${e.repo}`, JSON.stringify(e));
  return {
    list: async ({ prefix }: { prefix: string }) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }),
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v); },
  };
}

const pending: Promise<unknown>[] = [];
const ctx = {
  waitUntil: (p: Promise<unknown>) => { pending.push(p); return p; },
} as unknown as ExecutionContext;

const baseEnv = (kv: ReturnType<typeof memKv>) => ({
  BOT_TOKEN: 'test', CHAT_ID: '944783507', WEBHOOK_SECRET: 'sec', GH_TOKEN: 'g',
  CACHE: kv, AI: undefined, TELEGRAPH_TOKEN: undefined, GH_ARCHIVE_REPO: 'gandli/daily-digest',
} as any);

async function cmd(text: string, kv: ReturnType<typeof memKv>) {
  calls.length = 0;
  pending.length = 0;
  const req = new Request('https://x/telegram', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'sec' },
    body: JSON.stringify({ message: { chat: { id: 944783507 }, text } }),
  });
  await worker.fetch(req, baseEnv(kv), ctx);
  await Promise.allSettled(pending);
}

async function cbk(data: string, kv: ReturnType<typeof memKv>, messageId = 123) {
  calls.length = 0;
  pending.length = 0;
  const req = new Request('https://x/telegram', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'sec' },
    body: JSON.stringify({ callback_query: { id: 'cq1', data, message: { chat: { id: 944783507 }, message_id: messageId } } }),
  });
  await worker.fetch(req, baseEnv(kv), ctx);
  await Promise.allSettled(pending);
}

function flatTexts(kb: unknown): string[] {
  const rows = (kb as { inline_keyboard: Array<Array<{ text: string }>> }).inline_keyboard;
  return rows.flat().map((b) => b.text);
}
function sendMessage() { return calls.find((c) => c.url.includes('/sendMessage')); }
function editMessage() { return calls.find((c) => c.url.includes('/editMessageText')); }

function arch(i: number, o: Partial<{ repo: string; date: string; desc: string; descZh: string; topics: string[] }> = {}) {
  return { repo: o.repo ?? `org${i}/repo${i}`, date: o.date ?? `2026-08-${String((i % 28) + 1).padStart(2, '0')}`, desc: o.desc, descZh: o.descZh, topics: o.topics };
}

describe('archiveList 空存档', () => {
  beforeEach(() => { calls.length = 0; });

  it('无条目 → 不 crash, 输出空状态文案, 无 keyboard', async () => {
    await cmd('/archive', memKv([]));
    const send = sendMessage();
    expect(send).toBeTruthy();
    expect(String(send!.body.text)).toContain('暂无存档记录');
    expect(send!.body.reply_markup).toBeUndefined();
    // 无 edit(首屏非翻页)
    expect(editMessage()).toBeFalsy();
  });
});

describe('archiveList 单页', () => {
  beforeEach(() => { calls.length = 0; });

  it('5 条 → maxPage=1, nav 无上一页/下一页', async () => {
    await cmd('/archive', memKv([arch(0), arch(1), arch(2), arch(3), arch(4)]));
    const send = sendMessage();
    const kb = send!.body.reply_markup as { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };
    const texts = flatTexts(kb);
    expect(texts).toContain('📄 1/1');
    expect(texts).not.toContain('上一页');
    expect(texts).not.toContain('下一页 ➡');
    // 单页不显示跳转行(首/中/末)
    expect(texts.filter((t) => t.startsWith('⏭') || t.startsWith('⏮'))).toHaveLength(0);
    expect(String(send!.body.text)).toContain('第 1/1 页');
  });
});

describe('archiveList 多页(50 条 → 5 页)', () => {
  const kv50 = memKv(Array.from({ length: 50 }, (_, i) => arch(i)));

  beforeEach(() => { calls.length = 0; });

  it('page 0 → nav 含页码与下一页, 无上一页', async () => {
    await cmd('/archive', kv50);
    const send = sendMessage();
    const texts = flatTexts(send!.body.reply_markup as never);
    expect(texts).toContain('📄 1/5');
    expect(texts).toContain('下一页 ➡');
    expect(texts).not.toContain('上一页');
    // maxPage>4 → 跳转行: page 0 已在首页, 无 ⏮ 首跳; 含中/末 ⏭
    expect(texts.some((t) => t.startsWith('⏭'))).toBe(true);
    expect(texts.some((t) => t.startsWith('⏮'))).toBe(false);
    expect(String(send!.body.text)).toContain('第 1/5 页');
  });

  it('page 2(中页)→ nav 含上一页与下一页, 跳转行含首/中/末', async () => {
    await cmd('/archive 2', kv50);
    const send = sendMessage();
    const texts = flatTexts(send!.body.reply_markup as never);
    expect(texts).toContain('⬅ 上一页');
    expect(texts).toContain('下一页 ➡');
    expect(texts).toContain('📄 3/5');
    // 中页(page=2, maxPage=5): ⏮ 首跳(page>1) + ⏭ 末跳(page<maxPage-2); 中跳 abs(page-mid)<=1 不出
    expect(texts.some((t) => t.startsWith('⏮'))).toBe(true);
    expect(texts.some((t) => t.startsWith('⏭'))).toBe(true);
  });

  it('末页(page 4)→ 无下一页, 无最后一页跳转', async () => {
    await cmd('/archive 4', kv50);
    const send = sendMessage();
    const joined = flatTexts(send!.body.reply_markup as never).join(',');
    expect(joined).toContain('⬅ 上一页');
    expect(joined).not.toContain('下一页');
    // 最后一页跳转(⏭ 5 / arch:pg:4)不应出现
    expect(joined).not.toContain('⏭ 5');
  });

  it('callback_data 均为 arch:pg:<page> 形式', async () => {
    await cmd('/archive', kv50);
    const kb = (sendMessage()!.body.reply_markup as { inline_keyboard: Array<Array<{ callback_data: string }>> }).inline_keyboard;
    const all = kb.flat();
    expect(all.length).toBeGreaterThan(0);
    for (const b of all) expect(b.callback_data).toMatch(/^arch:pg:\d+$/);
    // 点下一页 callback 也走同一格式
    await cbk('arch:pg:1', kv50);
    const edit = editMessage();
    expect(edit).toBeTruthy();
    const ekb = (edit!.body.reply_markup as { inline_keyboard: Array<Array<{ callback_data: string }>> }).inline_keyboard;
    for (const b of ekb.flat()) expect(b.callback_data).toMatch(/^arch:pg:\d+$/);
    expect(String(edit!.body.text)).toContain('第 2/5 页');
  });
});

describe('archiveList 条目渲染', () => {
  beforeEach(() => { calls.length = 0; });

  it('descZh 优先 desc 显示', async () => {
    const kv = memKv([arch(0, { repo: 'a/b', date: '2026-08-01', desc: 'English only', descZh: '中文描述' })]);
    await cmd('/archive', kv);
    expect(String(sendMessage()!.body.text)).toContain('中文描述');
    expect(String(sendMessage()!.body.text)).not.toContain('English only');
  });

  it('desc/descZh 均空 → 不 crash, 无描述行', async () => {
    const kv = memKv([arch(0, { repo: 'a/b', date: '2026-08-01' })]);
    await cmd('/archive', kv);
    const t = String(sendMessage()!.body.text);
    expect(t).toContain('a/b');
    expect(t).toContain('2026-08-01');
    expect(t).not.toContain('📝');
  });

  it('repo 名含特殊字符(&<>) → 转义不 crash', async () => {
    const kv = memKv([arch(0, { repo: 'org/repo&<>', date: '2026-08-01', descZh: '正常' })]);
    await expect(cmd('/archive', kv)).resolves.toBeUndefined();
    const t = String(sendMessage()!.body.text);
    expect(t).toContain('org/repo');
    expect(t).toContain('&amp;');
    expect(t).toContain('&lt;');
    expect(t).toContain('&gt;');
  });
});