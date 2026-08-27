// urlmd 三级链边界: extractUrl/extractOgImage 空值边缘 + urlToMarkdown 全失败回落链(只测 test/, 不动 src/)。
import { describe, it, expect, beforeEach } from 'vitest';
import { extractUrl, extractOgImage, urlToMarkdown } from '../src/urlmd';

const origFetch = globalThis.fetch;
const calls: string[] = [];

type Route = { match: (u: string) => boolean; method?: string; status: number; text?: string; json?: unknown };

function mockFetch(routes: Route[]) {
  calls.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input);
    const m = init?.method ?? 'GET';
    calls.push(`${m} ${u}`);
    const route = routes.find((r) => r.match(u) && (r.method === undefined || r.method === m));
    if (!route) throw new Error(`unexpected: ${m} ${u}`);
    if (route.json !== undefined)
      return new Response(JSON.stringify(route.json), { status: route.status, headers: { 'content-type': 'application/json' } });
    return new Response(route.text ?? '', { status: route.status, headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
}

// 长中文正文, html strip 后仍 > 40 字 → 兜底链终点能命中
const PAGE =
  '<html><head><title>示例</title></head><body><header>导航</header><p>这是一段很长的中文正文内容用来验证 html strip 兜底链路最终正确剥出纯文本超过四十个字符的边界</p><footer>版权</footer></body></html>';

const AI_FAIL = { toMarkdown: async () => ({ format: 'html' }) }; // 非 markdown → 链继续走
const mkEnv = (ai: unknown, extra: Record<string, unknown> = {}) =>
  ({ JINA_API_KEY: undefined, GENEDAI_API_KEY: undefined, AI: ai, CACHE: {}, ...extra }) as never;

beforeEach(() => {
  globalThis.fetch = origFetch;
});

describe('extractUrl: 空值/多URL/X-Twitter 边界', () => {
  it('空文本 → null', () => expect(extractUrl('')).toBeNull());
  it('纯空白 → null', () => expect(extractUrl('   ')).toBeNull());
  it('无 http(s) 前缀(裸域名) → null', () => {
    expect(extractUrl('访问 example.com 看看')).toBeNull();
  });
  it('含多个 URL → 取第一个', () => {
    expect(extractUrl('https://first.example.com/a 和 https://second.example.com/b')).toBe('https://first.example.com/a');
  });
  it('X / Twitter 链接可提取', () => {
    expect(extractUrl('https://x.com/elonmusk')).toBe('https://x.com/elonmusk');
    expect(extractUrl('分享自 https://twitter.com/nasa')).toBe('https://twitter.com/nasa');
  });
});

describe('extractOgImage: 无图/协议相对/空 content 边界', () => {
  it('有其它 meta 但无 og:image → null', () => {
    expect(extractOgImage('<meta property="og:title" content="标题"><meta name="description" content="描述">')).toBeNull();
  });
  it('协议相对 // 前缀 → 补 https', () => {
    expect(extractOgImage('<meta property="og:image" content="//cdn.example.com/img.jpg">')).toBe('https://cdn.example.com/img.jpg');
  });
  it('og:image 空 content → null', () => {
    expect(extractOgImage('<meta property="og:image" content="">')).toBeNull();
  });
});

describe('urlToMarkdown: 三级链失败回落边界', () => {
  it('无 key + markdown.new 失败 + 页面是 HTML → 一路落到 html strip 兜底', async () => {
    mockFetch([
      { match: (u) => u.includes('markdown.new'), status: 500 },
      { match: () => true, text: PAGE },
    ]);
    const out = await urlToMarkdown(mkEnv(AI_FAIL), 'https://x.example/p', {});
    expect(calls[0]).toContain('markdown.new'); // 链先走 markdown.new
    expect(out).toContain('中文正文'); // 终点 html strip 产出
  });

  it('有 key 时顺序: Jina → Genedai 依次失败后继续走完链', async () => {
    mockFetch([
      { match: (u) => u.includes('r.jina.ai'), status: 500 },
      { match: (u) => u.includes('md.genedai.me'), status: 500 },
      { match: (u) => u.includes('markdown.new'), status: 500 },
      { match: () => true, text: PAGE },
    ]);
    const out = await urlToMarkdown(mkEnv(AI_FAIL, { JINA_API_KEY: 'j', GENEDAI_API_KEY: 'g' }), 'https://x.example/p', {});
    expect(calls[0]).toContain('r.jina.ai');
    expect(calls[1]).toContain('md.genedai.me');
    expect(out).toContain('中文正文');
  });

  it('env.AI 抛错 → 不 crash, 落 html strip 兜底', async () => {
    const badAI = { toMarkdown: async () => { throw new Error('AI quota'); } };
    mockFetch([
      { match: (u) => u.includes('markdown.new'), status: 500 },
      { match: () => true, text: PAGE },
    ]);
    const out = await urlToMarkdown(mkEnv(badAI), 'https://x.example/p', {});
    expect(out).toContain('中文正文');
  });

  it('全链每级都失败 → 返回空串, 不抛错', async () => {
    mockFetch([]); // 无路由 → 每次 fetch 都 throw
    await expect(urlToMarkdown(mkEnv(AI_FAIL), 'https://x.example/p', {})).resolves.toBe('');
  });
});
