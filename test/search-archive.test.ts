import { describe, it, expect, vi, beforeEach } from 'vitest';
import { libToEntry, archToEntry } from '../src/search-index';

// /search 全链路: searchArchive 入口 + 分页 token 存储 + callback 过期降级
// 沿用 search-lib.test.ts 风格: vi.mock ../src/notify 捕获发送, KV 用内存 stub(带 put)
const sendMock = vi.fn();
const editMock = vi.fn();
const ackMock = vi.fn();
vi.mock('../src/notify', () => ({
  sendTelegram: (...a: unknown[]) => sendMock(...a),
  sendTelegramKbd: (...a: unknown[]) => sendMock(...a),
  sendChatAction: () => Promise.resolve(),
  editMessageKbd: (...a: unknown[]) => editMock(...a),
  answerCallbackQuery: (...a: unknown[]) => ackMock(...a),
  safeEqual: async (a: string, b: string) => a === b,
}));
// 翻译链(env.AI undefined + 网络不可达)必然失败→回退原文; 直接短路避免真实网络抖动
vi.mock('../src/translate', () => ({
  isChinese: () => false,
  translateBatch: async (_e: unknown, items: unknown[]) => items,
  summarizeZh: async () => null,
  summarizeZhDeep: async () => null,
  translateTextZh: async () => null,
  generateTitleZh: async () => null,
  generateTagsZh: async () => null,
}));

// ponytail: 最小 KV stub——list 按 prefix 过滤 + get 读内存 map + put 落盘(翻页 token 需可找回)
function kvStub(data: Record<string, unknown>) {
  const store = new Map(Object.entries(data));
  return {
    list: async ({ prefix }: { prefix: string }) => ({
      keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })),
    }),
    get: async (k: string) => (store.get(k) as string) ?? null,
    put: async (k: string, v: unknown) => { store.set(k, v); },
  };
}

function lastText(): string {
  const call = sendMock.mock.calls.at(-1) ?? editMock.mock.calls.at(-1);
  return (call?.[2] as string) ?? '';
}

function lastKb(): { text: string; callback_data: string }[] | undefined {
  const call = sendMock.mock.calls.at(-1) ?? editMock.mock.calls.at(-1);
  if (!call) return undefined;
  const arg = call[call.length - 1] as { inline_keyboard?: { text: string; callback_data: string }[][] };
  return arg?.inline_keyboard?.flat();
}

function flatTexts(): string[] {
  const kb = lastKb();
  return kb ? kb.map((b) => b.text) : [];
}

function flatCb(): string[] {
  const kb = lastKb();
  return kb ? kb.map((b) => b.callback_data) : [];
}

function makeEnv(entries: unknown[]) {
  return { BOT_TOKEN: 't', CACHE: kvStub({ 'search:index': JSON.stringify(entries) }) as any };
}

describe('/search searchArchive 全链路', () => {
  beforeEach(() => {
    sendMock.mockClear();
    editMock.mockClear();
    ackMock.mockClear();
  });

  it('正常命中: 多条目匹配 query, 只返回含 query 的', async () => {
    const env = makeEnv([
      libToEntry({ src: 'star', name: 'rust-lang/rust', url: 'https://github.com/rust-lang/rust', desc: 'language', tags: ['systems'] }),
      libToEntry({ src: 'star', name: 'vuejs/core', url: 'https://github.com/vuejs/core', desc: 'ui framework', tags: ['frontend'] }),
      libToEntry({ src: 'bookmark', name: 'rust 工具', url: 'https://x', desc: 'rust article', folder: 'r' }),
    ]);
    const { searchArchive } = await import('../src/index');
    await searchArchive(env as any, '1', 'rust');
    const text = lastText();
    expect(text).toContain('rust-lang/rust');
    expect(text).toContain('rust 工具');
    expect(text).not.toContain('vuejs/core');
  });

  it('大小写不敏感: GITHUB 匹配 github', async () => {
    const env = makeEnv([
      libToEntry({ src: 'star', name: 'github-copilot', url: 'https://github.com/copilot', desc: 'ai pair', tags: ['github'] }),
    ]);
    const { searchArchive } = await import('../src/index');
    await searchArchive(env as any, '1', 'GITHUB');
    expect(lastText()).toContain('github-copilot');
  });

  it('无结果: 空输出不抛错 + 给统一未找到文案', async () => {
    const env = makeEnv([
      libToEntry({ src: 'star', name: 'foo', url: 'https://github.com/foo', desc: 'nothing here' }),
    ]);
    const { searchArchive } = await import('../src/index');
    await expect(searchArchive(env as any, '1', 'zzz-not-exist')).resolves.toBeUndefined();
    expect(lastText()).toContain('没有找到');
    // 实现: 无命中时仍带单页码指示按钮(可点回同样结果), 非空键盘
    expect(flatTexts()).toContain('📄 1/1');
  });

  it('分页: page>0 翻页正确, maxPage 边界(末页/超界)', async () => {
    // 25 条命中 -> maxPage=3; 每页 10 条
    const entries = Array.from({ length: 25 }, (_, i) =>
      libToEntry({ src: 'star', name: `aiml-${String(i).padStart(2, '0')}`, url: `https://github.com/x/aiml-${i}`, desc: 'x', tags: ['ai'] }),
    );
    const env = makeEnv(entries);
    const { searchArchive } = await import('../src/index');

    // page 0: 0..9, 无上一页, 有下一页
    await searchArchive(env as any, '1', 'aiml');
    const t0 = lastText();
    expect(t0).toContain('aiml-09');
    expect(t0).not.toContain('aiml-10');
    expect(flatTexts()).not.toContain('上一页');
    expect(flatTexts()).toContain('下一页 ➡');
    expect(flatTexts()).toContain('📄 1/3');

    // page 1: 10..19
    await searchArchive(env as any, '1', 'aiml', 1);
    const t1 = lastText();
    expect(t1).toContain('aiml-10');
    expect(t1).toContain('aiml-19');
    expect(t1).not.toContain('aiml-09');
    expect(flatTexts()).toContain('⬅ 上一页');
    expect(flatTexts()).toContain('📄 2/3');

    // page 2 (末页): 20..24, 无下一页
    await searchArchive(env as any, '1', 'aiml', 2);
    const t2 = lastText();
    expect(t2).toContain('aiml-24');
    expect(t2).not.toContain('aiml-20'.replace('aiml-20', 'aiml-19'));
    expect(flatTexts()).toContain('⬅ 上一页');
    expect(flatTexts()).not.toContain('下一页');
    expect(flatTexts()).toContain('📄 3/3');

    // page 3 超界 -> 钳到 page 2, 内容与 page 2 一致
    await searchArchive(env as any, '1', 'aiml', 3);
    expect(lastText()).toContain('aiml-24');
    expect(flatTexts()).toContain('📄 3/3');
  });

  it('arch 条目 url 槽存 date → github archive 链接拼接正确', async () => {
    const env = makeEnv([
      archToEntry({ repo: 'foo/bar', date: '2026-08-24', desc: 'archived repo' }),
    ]);
    const { searchArchive } = await import('../src/index');
    await searchArchive(env as any, '1', 'foo/bar');
    expect(lastText()).toContain(
      'https://github.com/gandli/daily-digest/blob/archive/archive/2026/2026-08-24.md',
    );
  });

  it('search:q:token 存储: callback 可凭 token 找回 query, 短 token 不落 callback_data', async () => {
    const entries = Array.from({ length: 15 }, (_, i) =>
      libToEntry({ src: 'star', name: `aiml-${i}`, url: `https://github.com/x/aiml-${i}`, desc: 'x', tags: ['ai'] }),
    );
    // 用带存储的 KV stub, 便于读回 token
    const store = new Map<string, unknown>([['search:index', JSON.stringify(entries)]]);
    const memKv = {
      list: async () => ({ keys: [] }),
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: unknown) => { store.set(k, v); },
    };
    const env = { BOT_TOKEN: 't', CACHE: memKv as any };
    const { searchArchive } = await import('../src/index');
    await searchArchive(env as any, '1', 'aiml');

    const cbs = flatCb();
    expect(cbs.some((c) => /^sch:0:/.test(c))).toBe(true); // 首页 callback
    const next = cbs.find((c) => /^sch:1:/.test(c));
    expect(next).toBeTruthy();
    const token = next!.slice('sch:1:'.length);
    expect(token.length).toBeLessThan(20);
    const stored = store.get(`search:q:${token}`);
    expect(stored).toBe('aiml');
  });
});

// --- webhook 端到端: callback 分发 + token 过期降级(复用 webhook-callback.test.ts 模式) ---
describe('/search callback 端到端(token 过期/缺失)', () => {
  beforeEach(() => {
    sendMock.mockClear();
    editMock.mockClear();
    ackMock.mockClear();
  });

  function memKv() {
    // 15 条命中 → 2 页, 保证有"下一页"按钮
    const entries = Array.from({ length: 15 }, (_, i) =>
      libToEntry({ src: 'star', name: `x${i}`, url: `https://github.com/x/x${i}`, desc: 'd', tags: ['x'] }),
    );
    const store = new Map<string, string>([
      ['search:index', JSON.stringify(entries)],
    ]);
    return {
      list: async () => ({ keys: [] }),
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: string) => { store.set(k, v); },
    };
  }

  const env = {
    BOT_TOKEN: 'test', CHAT_ID: '944783507', WEBHOOK_SECRET: 'sec', GH_TOKEN: 'g',
    CACHE: memKv() as any, AI: undefined, TELEGRAPH_TOKEN: undefined, GH_ARCHIVE_REPO: 'gandli/daily-digest',
  } as any;
  const pending: Promise<unknown>[] = [];
  const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p); return p; } } as unknown as ExecutionContext;

  async function postUpdate(update: unknown) {
    sendMock.mockClear();
    editMock.mockClear();
    ackMock.mockClear();
    const req = new Request('https://x/telegram', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'sec' },
      body: JSON.stringify(update),
    });
    const worker = (await import('../src/index')).default;
    await worker.fetch(req, env, ctx);
    await Promise.allSettled(pending);
  }

  it('search:q:token 缺失(KV 过期/未写入) → 编辑消息给过期提示, 不抛错', async () => {
    await expect(
      postUpdate({ callback_query: { id: 'cq-exp', data: 'sch:1:expired-token-xyz', message: { chat: { id: 944783507 }, message_id: 42 } } }),
    ).resolves.toBeUndefined();
    const edit = editMock.mock.calls[0];
    expect(edit).toBeTruthy();
    expect(edit[2]).toBe(42); // message_id
    expect(String(edit[3])).toContain('查询过期');
    const ack = ackMock.mock.calls[0];
    expect(ack[1]).toBe('cq-exp');
  });

  it('token 命中 → 正常重算分页并原地编辑(非新发)', async () => {
    // 先发首屏拿 token(search:q 写入), 再点下一页
    await postUpdate({ message: { chat: { id: 944783507 }, text: '/search x' } });
    const send = sendMock.mock.calls.at(-1);
    expect(send).toBeTruthy();
    const kb = (send![send!.length - 1] as { inline_keyboard: { text: string; callback_data: string }[][] }).inline_keyboard;
    const all = kb.flat() as { text: string; callback_data: string }[];
    const next = all.find((b) => b.text.includes('下一页'));
    expect(next).toBeTruthy();
    await postUpdate({ callback_query: { id: 'cq1', data: next!.callback_data, message: { chat: { id: 944783507 }, message_id: 7 } } });
    const edit = editMock.mock.calls[0];
    expect(edit).toBeTruthy();
    expect(edit[2]).toBe(7); // 原地编辑, 非新发
    expect(String(edit[3])).toContain('2/');
  });
});