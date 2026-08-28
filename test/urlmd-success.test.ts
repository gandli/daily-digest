// urlmd 成功路径补全: 每级降级链的命中分支 + fetchRaw 失败 + htmlstrip 非 HTML 拒绝。
// 与 urlmd-chain.test.ts(失败链)互补: 这里测"哪一级成功就停在哪一级"。
import { describe, it, expect, beforeEach } from 'vitest';
import { urlToMarkdown } from '../src/urlmd';

const origFetch = globalThis.fetch;
const calls: string[] = [];

type Route = { match: (u: string, m: string, h: Record<string, string>) => boolean; status: number; text?: string; json?: unknown };

function mockFetch(routes: Route[]) {
  calls.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input);
    const m = init?.method ?? 'GET';
    const h = (init?.headers ?? {}) as Record<string, string>;
    calls.push(`${m} ${u}`);
    const route = routes.find((r) => r.match(u, m, h));
    if (!route) throw new Error(`unexpected: ${m} ${u}`);
    if (route.json !== undefined)
      return new Response(JSON.stringify(route.json), { status: route.status, headers: { 'content-type': 'application/json' } });
    return new Response(route.text ?? '', { status: route.status, headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
}

const LONG = '这是一段足够长的中文正文内容用来验证链路命中后正确返回超过四十个字符的边界条件再加一些字确保稳过门槛';
const AI_FAIL = { toMarkdown: async () => ({ format: 'html' }) };
const mkEnv = (extra: Record<string, unknown> = {}) =>
  ({ JINA_API_KEY: undefined, GENEDAI_API_KEY: undefined, AI: AI_FAIL, CACHE: {}, ...extra }) as never;

beforeEach(() => { globalThis.fetch = origFetch; });

describe('urlToMarkdown 成功路径(命中即停)', () => {
  it('Jina 命中 → 直接返回, 不触后续链', async () => {
    mockFetch([
      { match: (u) => u.includes('r.jina.ai'), status: 200, text: `Title: T\nSource: S\nPublished: P\nMarkdown Content:\n${LONG}` },
    ]);
    const md = await urlToMarkdown(mkEnv({ JINA_API_KEY: '***' }), 'https://example.com', {});
    expect(md).toContain('这是一段足够长的中文正文');
    expect(calls.length).toBe(1); // 只打 Jina
  });
  it('Jina 返回过短(<40字) → null, 继续链', async () => {
    mockFetch([
      { match: (u) => u.includes('r.jina.ai'), status: 200, text: 'Markdown Content:\nshort' },
      { match: (u) => u.includes('markdown.new'), status: 200, json: { success: true, content: LONG } },
    ]);
    const md = await urlToMarkdown(mkEnv({ JINA_API_KEY: '***' }), 'https://example.com', {});
    expect(md).toContain('这是一段足够长的中文正文');
    expect(calls.some((c) => c.includes('markdown.new'))).toBe(true);
  });
  it('Jina 非 200 → null, 继续链', async () => {
    mockFetch([
      { match: (u) => u.includes('r.jina.ai'), status: 429, text: '' },
      { match: (u) => u.includes('markdown.new'), status: 200, json: { success: true, content: LONG } },
    ]);
    const md = await urlToMarkdown(mkEnv({ JINA_API_KEY: '***' }), 'https://example.com', {});
    expect(md).toContain('这是一段足够长的中文正文');
  });

  it('Genedai 命中(Jina 无 key) → 返回', async () => {
    mockFetch([
      { match: (u) => u.includes('md.genedai.me'), status: 200, text: `${LONG}##` },
    ]);
    const md = await urlToMarkdown(mkEnv({ GENEDAI_API_KEY: '***' }), 'https://example.com', {});
    expect(md).toContain('这是一段足够长的中文正文');
    expect(calls.length).toBe(1);
  });
  it('Genedai 非 200 → null 继续', async () => {
    mockFetch([
      { match: (u) => u.includes('md.genedai.me'), status: 500, text: '' },
      { match: (u) => u.includes('markdown.new'), status: 200, json: { success: true, content: LONG } },
    ]);
    const md = await urlToMarkdown(mkEnv({ GENEDAI_API_KEY: '***' }), 'https://example.com', {});
    expect(md).toContain('这是一段足够长的中文正文');
  });

  it('markdown.new 命中(免 key) → 返回', async () => {
    mockFetch([
      { match: (u) => u.includes('markdown.new'), status: 200, json: { success: true, content: LONG } },
    ]);
    const md = await urlToMarkdown(mkEnv(), 'https://example.com', {});
    expect(md).toContain('这是一段足够长的中文正文');
    expect(calls.length).toBe(1);
  });
  it('markdown.new success=false/content 空 → null 继续', async () => {
    mockFetch([
      { match: (u) => u.includes('markdown.new'), status: 200, json: { success: false } },
      { match: () => true, status: 200, text: `<html><body><p>${LONG}</p></body></html>` },
    ]);
    const md = await urlToMarkdown(mkEnv(), 'https://example.com', {});
    expect(md).toContain('这是一段足够长的中文正文');
  });

  it('Markdown for Agents 命中(非 HTML 响应) → 返回', async () => {
    mockFetch([
      { match: (u) => u.includes('markdown.new'), status: 500, text: '' },
      { match: (u) => u === 'https://example.com', status: 200, text: `# Title\n\n${LONG}` },
    ]);
    const md = await urlToMarkdown(mkEnv(), 'https://example.com', {});
    expect(md).toContain('# Title');
  });
  it('Markdown for Agents 返回 doctype HTML → 嗅探拒绝, 继续链', async () => {
    mockFetch([
      { match: (u) => u.includes('markdown.new'), status: 500, text: '' },
      { match: (u) => u === 'https://example.com', status: 200, text: `<!DOCTYPE html><html><body><p>${LONG}</p></body></html>` },
    ]);
    const md = await urlToMarkdown(mkEnv(), 'https://example.com', {});
    // doctype 拒绝 → toMarkdown(AI_FAIL) → htmlstrip 兜底命中
    expect(md).toContain('这是一段足够长的中文正文');
    expect(calls.length).toBeGreaterThanOrEqual(3);
  });

  it('Workers AI toMarkdown 数组形态 → 取 [0]', async () => {
    const aiArr = { toMarkdown: async () => [{ format: 'markdown', data: LONG }] };
    mockFetch([
      { match: (u) => u.includes('markdown.new'), status: 500, text: '' },
      { match: () => true, status: 200, text: '<!DOCTYPE html><html></html>' },
    ]);
    const md = await urlToMarkdown({ ...mkEnv(), AI: aiArr } as never, 'https://example.com', {});
    expect(md).toContain('这是一段足够长的中文正文');
  });

  it('Browser Rendering 命中(opts 有凭证) → 返回', async () => {
    mockFetch([
      { match: (u) => u.includes('markdown.new'), status: 500, text: '' },
      { match: (u) => u === 'https://example.com', status: 404, text: '' }, // agents + fetchRaw 失败
      { match: (u) => u.includes('browser-rendering'), status: 200, json: { success: true, result: LONG } },
    ]);
    const md = await urlToMarkdown(mkEnv(), 'https://example.com', { accountId: 'acc', apiToken: 'tok' });
    expect(md).toContain('这是一段足够长的中文正文');
    expect(calls.some((c) => c.includes('browser-rendering'))).toBe(true);
  });
  it('Browser Rendering 非 200 → null, 落 htmlstrip', async () => {
    mockFetch([
      { match: (u) => u.includes('markdown.new'), status: 500, text: '' },
      { match: (u) => u === 'https://example.com', status: 200, text: `<html><body><p>${LONG}</p></body></html>` },
      { match: (u) => u.includes('browser-rendering'), status: 500, text: 'quota' },
    ]);
    const md = await urlToMarkdown(mkEnv(), 'https://example.com', { accountId: 'acc', apiToken: 'tok' });
    expect(md).toContain('这是一段足够长的中文正文');
  });
  it('Browser Rendering success=false → null', async () => {
    mockFetch([
      { match: (u) => u.includes('markdown.new'), status: 500, text: '' },
      { match: (u) => u === 'https://example.com', status: 200, text: `<html><body><p>${LONG}</p></body></html>` },
      { match: (u) => u.includes('browser-rendering'), status: 200, json: { success: false } },
    ]);
    const md = await urlToMarkdown(mkEnv(), 'https://example.com', { accountId: 'acc', apiToken: 'tok' });
    expect(md).toContain('这是一段足够长的中文正文'); // htmlstrip 兜底
  });

  it('htmlstrip: 页面 404(fetchRaw 抛) → 全链空串', async () => {
    mockFetch([
      { match: (u) => u.includes('markdown.new'), status: 500, text: '' },
      { match: () => true, status: 404, text: '' },
    ]);
    const md = await urlToMarkdown(mkEnv(), 'https://example.com', {});
    expect(md).toBe('');
  });
  it('htmlstrip: 200 但非 HTML(纯 JSON) → 嗅探拒绝 → 空串', async () => {
    mockFetch([
      { match: (u) => u.includes('markdown.new'), status: 500, text: '' },
      // agents 步(Accept: text/markdown) 404 挡掉; fetchRaw(Accept: text/html...) 拿到 JSON → htmlstrip 拒绝
      { match: (u, _m, h) => u === 'https://example.com' && String(h.Accept ?? '').includes('text/markdown'), status: 404, text: '' },
      { match: (u) => u === 'https://example.com', status: 200, text: '{"json": true}' },
    ]);
    const md = await urlToMarkdown(mkEnv(), 'https://example.com', {});
    expect(md).toBe('');
  });
  it('htmlstrip: HTML 但正文过短(<40字) → null → 空串', async () => {
    mockFetch([
      { match: (u) => u.includes('markdown.new'), status: 500, text: '' },
      { match: () => true, status: 200, text: '<html><body><p>hi</p></body></html>' },
    ]);
    const md = await urlToMarkdown(mkEnv(), 'https://example.com', {});
    expect(md).toBe('');
  });
  it('fetchRaw 非 200 → toMarkdown 抛 → 链继续', async () => {
    mockFetch([
      { match: (u) => u.includes('markdown.new'), status: 500, text: '' },
      { match: () => true, status: 503, text: '' },
    ]);
    const md = await urlToMarkdown(mkEnv(), 'https://example.com', {});
    expect(md).toBe('');
  });
});