// 链接处理「必回一条」不变量矩阵 —— 专治线上"发链接没反应"。
//
// 背景: 用户侧"没响应"有两种根因, 本文件把两者都变成可执行断言:
//   A) 入口静默: 更新形态不被识别(edited_message / channel_post / caption / text_link 实体)
//      → chatId 解析为空 → 直接 return 'ok', 用户永远收不到东西(TG 也不重试, 因为是 200)
//   B) 发送失败: 归档链中途抛错 / TG 接口非 2xx → 用户收到空, 只有兜底提示才算通过
//
// 断言口径(与既有 link-response-guarantee.test.ts 一致):
//   支持的形态 → 必须有 ≥1 条出站消息(卡片或显式 ⚠️/❌/⏳ 提示都算)
//   已知静默   → 单列在末尾, 断言"当前确实静默", 修复后本文件自动变红(改 0 → 1 即为修复信号)
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { fetchTrending } from '../src/sources/trending';

vi.mock('../src/sources/trending', () => ({ fetchTrending: vi.fn() }));
vi.mock('../src/fxtweet', async (orig) => {
  const m = await orig<any>();
  return { ...m, fetchTweet: vi.fn().mockResolvedValue(null) }; // X 帖落回通用链, 专注入口断言
});

import worker from '../src/index';

const CHAT = 944783507;
const tgCalls: { url: string; body: any }[] = [];
const pending: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p); return p; } } as unknown as ExecutionContext;

function memKv(extra: Array<[string, string]> = []) {
  const store = new Map<string, string>(extra);
  return {
    store,
    list: async ({ prefix }: { prefix: string }) => ({
      keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })),
    }),
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v); },
    delete: async (k: string) => { store.delete(k); },
  };
}

// fetch 白名单: 让 URL 存档链在 markdown.new 一档成功(其余全失败) → 走到发卡
function installFetch(o: { mdOk?: boolean } = {}) {
  tgCalls.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input);
    if (u.includes('api.telegram.org')) {
      tgCalls.push({ url: u, body: JSON.parse(String(init?.body ?? '{}') || '{}') });
      return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
    }
    if (o.mdOk !== false && u.includes('markdown.new')) {
      const content = '# 示例页面\n\n这是一段足够长的中文正文内容, 用于让读取链的长度阈值校验通过并成功产出 markdown 转换结果, 确保后续归档与发卡流程真实被执行到。';
      return new Response(JSON.stringify({ success: true, content }), { status: 200 });
    }
    if (u.includes('/contents/archive/')) return new Response('{}', { status: 200 });
    if (u.includes('api.telegra.ph')) return new Response(JSON.stringify({ ok: true, result: { url: 'https://telegra.ph/t-1' } }), { status: 200 });
    if (u.includes('api.github.com')) {
      // repo 详情按请求路径回显, 避免固定值让断言测不到真实 repo 名
      const m = u.match(/api\.github\.com\/repos\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/);
      const full = m ? decodeURIComponent(m[1]) : 'a/b';
      return new Response(JSON.stringify({ full_name: full, description: 'a rust cli', stargazers_count: 10, language: 'Rust', topics: [] }), { status: 200 });
    }
    // 其余一律返回 HTML 错误页: 逼真模拟“目标站不可用”, 读取链全档失败
    return new Response('<!doctype html><html><head><title>502 Bad Gateway</title></head><body>502</body></html>', { status: 200 });
  }) as typeof fetch;
}

let env: any;
const outText = () => tgCalls
  .filter((c) => c.url.includes('sendMessage') || c.url.includes('sendPhoto'))
  .map((c) => String(c.body?.text ?? c.body?.caption ?? ''));

async function post(body: unknown, headers: Record<string, string> = {}) {
  const res = await worker.fetch(new Request('https://x/telegram', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': 'sec', ...headers },
    body: JSON.stringify(body),
  }), env, ctx);
  await Promise.allSettled(pending);
  return res;
}

const msg = (text: string, extra: Record<string, unknown> = {}) => ({
  message: { chat: { id: CHAT }, message_id: 1, text, ...extra },
});

beforeEach(() => {
  vi.mocked(fetchTrending).mockResolvedValue([]);
  env = {
    BOT_TOKEN: 'tok', CHAT_ID: String(CHAT), WEBHOOK_SECRET: 'sec', GH_TOKEN: 'ghtok',
    CACHE: memKv(), AI: undefined, TELEGRAPH_TOKEN: undefined, VEC: undefined, DB: undefined,
    GH_ARCHIVE_REPO: 'gandli/daily-digest', OPENROUTER_API_KEY: undefined,
  };
  installFetch();
});

// ===========================================================================
// A) 支持的形态: 必须有响应
// ===========================================================================
describe('✅ 必回一条: 已支持的链接形态', () => {
  it('纯 GitHub 仓库链接 → 归档卡', async () => {
    const res = await post(msg('https://github.com/acme/rocket'));
    expect(res.status).toBe(200);
    expect(outText().join('\n')).toContain('acme/rocket');
  });

  it('任意网页链接 → Web Archive 卡', async () => {
    await post(msg('看看这个 https://example.com/post'));
    expect(outText().join('\n')).toContain('example.com');
  });

  it('中文句子里夹带链接(前后有中文)→ 正常处理', async () => {
    await post(msg('这个工具不错, 试试 https://example.com/tool, 挺好用的'));
    expect(outText().join('\n')).toContain('example.com');
  });

  it('URL 尾部带句号/逗号 → 提取时正确剥离标点', async () => {
    await post(msg('推荐 https://example.com/a, 收藏。'));
    expect(outText().join('\n')).toContain('https://example.com/a');
  });

  it('URL 含括号(维基百科风格)→ 完整识别', async () => {
    await post(msg('https://en.wikipedia.org/wiki/Rust_(programming_language)'));
    expect(outText().join('\n')).toContain('Rust_(programming_language)');
  });

  it('X 帖子链接 → 落通用链仍有提示(不静默)', async () => {
    await post(msg('https://x.com/fe2o3/status/1234567890123456789'));
    expect(outText().length).toBeGreaterThan(0);
  });

  it('读取链全失败 → 显式 ❌ 提示(用户知道失败原因, 不是"没反应")', async () => {
    installFetch({ mdOk: false });
    await post(msg('https://dead.example.com/x'));
    expect(outText().join('\n')).toContain('❌');
  });

  it('非链接文本 → HELP(兜底提示)', async () => {
    await post(msg('今天天气不错'));
    expect(outText().join('\n')).toContain('daily-digest 使用');
  });
});

// ===========================================================================
// B) 以前的静默形态(已修复): 必须有响应
// ===========================================================================
describe('✅ 曾经的静默形态(现已打通)', () => {
  it('edited_message(编辑消息补发链接)→ 正确响应', async () => {
    const res = await post({ edited_message: { chat: { id: CHAT }, message_id: 1, text: 'https://example.com/edited' } });
    expect(res.status).toBe(200);
    expect(outText().join('\n')).toContain('example.com/edited');
  });

  it('channel_post(频道里发链接)→ 正确响应', async () => {
    const res = await post({ channel_post: { chat: { id: CHAT }, message_id: 1, text: 'https://example.com/ch' } });
    expect(res.status).toBe(200);
    expect(outText().join('\n')).toContain('example.com/ch');
  });

  it('photo.caption 里的链接 → 提取 caption 归档(非回 HELP)', async () => {
    await post({ message: { chat: { id: CHAT }, message_id: 1, photo: [{ file_id: 'f' }], caption: 'https://example.com/cap' } });
    expect(outText().join('\n')).toContain('example.com/cap');
  });

  it('text_link 实体(自定义文字超链接)→ 从 entities 提取 URL 归档', async () => {
    await post({ message: {
      chat: { id: CHAT }, message_id: 1, text: '点这里',
      entities: [{ type: 'text_link', offset: 0, length: 3, url: 'https://example.com/hidden' }],
    } });
    expect(outText().join('\n')).toContain('example.com/hidden');
  });
});

// ===========================================================================
// C) 运维侧静默(非代码 bug, 但同样表现为"没反应")—— 锁住现象便于自查
// ===========================================================================
describe('⚠️ 运维侧静默: 排查用', () => {
  it('webhook secret 不匹配 → 403(TG 会退避重试后放弃, 用户侧表现为没反应)', async () => {
    const res = await post(msg('https://example.com/a'), { 'X-Telegram-Bot-Api-Secret-Token': 'wrong' });
    expect(res.status).toBe(403);
  });

  it('CHAT_ID 不匹配(换群/换会话)→ 200 且零响应(白名单静默, 属设计但常被误当故障)', async () => {
    const res = await post({ message: { chat: { id: 111 }, message_id: 1, text: 'https://example.com/a' } });
    expect(res.status).toBe(200);
    expect(outText().length).toBe(0);
  });

  it('超限(第 21 次)→ 200 且零响应(静默丢弃, 必须回 200 否则 TG 无限重试)', async () => {
    let n = 0;
    env.RATE_LIMITER = {
      limit: async () => {
        n += 1;
        return { success: n <= 20 };
      },
    };
    // 复用同一 env 连打 21 次
    for (let i = 0; i < 20; i++) {
      const res = await worker.fetch(new Request('https://x/telegram', {
        method: 'POST', headers: { 'X-Telegram-Bot-Api-Secret-Token': 'sec' },
        body: JSON.stringify(msg('https://example.com/a')),
      }), env, ctx);
      await Promise.allSettled(pending);
      expect(res.status).toBe(200);
    }
    tgCalls.length = 0;
    const res = await post(msg('https://example.com/a'));
    expect(res.status).toBe(200);
    expect(outText().length).toBe(0);
  });
});
