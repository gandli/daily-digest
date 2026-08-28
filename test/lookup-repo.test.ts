// lookup 深覆盖: fetchRepo(私有, 经 lookupRepo 触发) / lookupRepo / fanoutRepoRefs / backfillDescriptions / archiveUrl / markProcessed。
// 风格: mock global fetch 捕获 GitHub/Telegram 调用; vi.mock notify+render+translate+deepwiki+archive+urlmd 短路外呼。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---- 可控制的模块 mock (hoisted) ----
const sendRepo = vi.fn(); // sendPerRepoMessages
const sendText = vi.fn(); // sendTelegram
const mockDw = vi.fn(); // fetchDeepwikiOverview
const mockUrlToMd = vi.fn(); // urlToMarkdown
const mockExtractOg = vi.fn(); // extractOgImage
const mockTranslateDrop = vi.fn(); // 可切换 translateBatch 是否产出中文

vi.mock('../src/notify', () => ({
  sendPerRepoMessages: (...a: unknown[]) => sendRepo(...a),
  sendTelegram: (...a: unknown[]) => sendText(...a),
}));
vi.mock('../src/render', () => ({
  renderMessage: () => [{ html: 'render-card' }],
  renderMarkdown: () => '# md',
  esc: (s: unknown) => String(s),
}));
vi.mock('../src/deepwiki', () => ({
  fetchDeepwikiOverview: (...a: unknown[]) => mockDw(...a),
}));
vi.mock('../src/translate', () => ({
  isChinese: (s: unknown) => /[\u4e00-\u9fff]/.test(String(s ?? '')),
  resolveDescriptions: async () => {}, // 不放风, 使 lookupRepo 走 GitHub desc 翻译兜底
  translateBatch: async (_e: unknown, items: unknown[]) =>
    (items as { desc?: string }[]).map((i) =>
      // mockTranslateDrop() 返回 false 时仍产出中文(覆盖成功路径); true 时不出(覆盖失败/cache-mark 分支)
      mockTranslateDrop() ? { ...i } : { ...i, descZh: i.desc ? '这是翻译后的中文描述' : undefined },
    ),
  translateTextZh: async () => '这是翻译后的中文描述内容',
  summarizeZh: async () => null,
  generateTagsZh: async () => ['ai'],
  generateTitleZh: async () => '测试标题',
}));
vi.mock('../src/archive', () => ({
  archiveToGitHub: async () => {},
  archiveOgImage: async () => null,
}));
vi.mock('../src/urlmd', () => ({
  urlToMarkdown: (...a: unknown[]) => mockUrlToMd(...a),
  extractOgImage: (...a: unknown[]) => mockExtractOg(...a),
}));

import { lookupRepo, fanoutRepoRefs, backfillDescriptions, archiveUrl, markProcessed } from '../src/lookup';

// ---- 内存 KV stub(+list) ----
function makeEnv(): any {
  const store = new Map<string, string>();
  return {
    GH_TOKEN: 'gh-token', GH_ARCHIVE_REPO: 'gandli/daily-digest',
    BOT_TOKEN: 'bot-token', OPENROUTER_API_KEY: 'ork',
    CF_ACCOUNT_ID: 'acc', CF_API_TOKEN: 'tok',
    CACHE: {
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: unknown) => { store.set(k, String(v)); },
      list: async ({ prefix }: { prefix: string }) => ({
        keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })),
        list_complete: true,
      }),
    },
  };
}
const ghResponse = (body: object, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

beforeEach(() => {
  sendRepo.mockReset(); sendText.mockReset(); mockDw.mockReset();
  mockUrlToMd.mockReset(); mockExtractOg.mockReset(); mockTranslateDrop.mockReset();
  mockDw.mockResolvedValue(null);
  mockUrlToMd.mockResolvedValue('page markdown text content');
  mockExtractOg.mockReturnValue(null);
});
afterEach(() => vi.unstubAllGlobals());

// ---------- fetchRepo / lookupRepo (fetchRepo 私有, 经 lookup 触发) ----------
describe('fetchRepo: GitHub API 解析(私有, 经 lookupRepo)', () => {
  it('200 正常解析 → 发卡+索引(不失败提示)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ghResponse({
      full_name: 'nousresearch/hermes-agent', description: 'A cool agent',
      stargazers_count: 1500, language: 'TypeScript', topics: ['agent', 'ai'],
    })));
    await lookupRepo(makeEnv(), 'chat', 'nousresearch/hermes-agent');
    expect(sendText).not.toHaveBeenCalled();
    expect(sendRepo).toHaveBeenCalledTimes(1);
    const body = sendRepo.mock.calls[0][2] as { html: { html: string } }[];
    expect(body).toHaveLength(1);
    expect(body[0].html.html).toContain('render-card');
  });
  it('404 → 找不到仓库提示(不发卡)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ghResponse({ message: 'Not Found' }, 404)));
    await lookupRepo(makeEnv(), 'chat', 'ghost/repo');
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(String(sendText.mock.calls[0][2])).toContain('找不到仓库');
    expect(sendRepo).not.toHaveBeenCalled();
  });
  it('无 full_name → 找不到仓库提示', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ghResponse({ name: 'no-full-name' })));
    await lookupRepo(makeEnv(), 'chat', 'x/y');
    expect(String(sendText.mock.calls[0][2])).toContain('找不到仓库');
    expect(sendRepo).not.toHaveBeenCalled();
  });
  it('fetch 网络错 → 抛给调用方 → ⚠️网络异常, 不发卡', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    await lookupRepo(makeEnv(), 'chat', 'x/y');
    expect(String(sendText.mock.calls[0][2])).toContain('网络异常');
    expect(sendRepo).not.toHaveBeenCalled();
  });
});

// ---------- markProcessed ----------
describe('markProcessed: 重发质量回填', () => {
  it('写成功(经 env.CACHE 落盘)', async () => {
    const env = makeEnv();
    await markProcessed(env, 'https://example.com/url', true, false, '2026-08-28-1');
    const raw = await env.CACHE.get('reproc:https://example.com/url');
    const saved = JSON.parse(raw!);
    expect(saved.translated).toBe(true);
    expect(saved.descOk).toBe(false);
    expect(saved.md).toBe('2026-08-28-1');
  });
  it('KV 失败静默(不抛给调用方)', async () => {
    const env = { CACHE: { put: async () => { throw new Error('kv down'); } } } as any;
    await expect(markProcessed(env, 'https://a.com', true, true)).resolves.toBeUndefined();
  });
});

// ---------- fanoutRepoRefs ----------
describe('fanoutRepoRefs: 存档内容 repo 联动', () => {
  it('无 ctx → 直接 return, 不触发任何发卡', async () => {
    await fanoutRepoRefs(makeEnv(), 'chat', 'https://github.com/a/b', undefined);
    await fanoutRepoRefs(makeEnv(), 'chat', 'https://github.com/a/b'); // ctx 省略
    expect(sendRepo).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
  });
  it('多个 repo → 并发精简卡; 已 seen 的 repo 被过滤', async () => {
    const today = new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);
    const env = makeEnv();
    await env.CACHE.put(`lookup:${today}:a/b`, '1'); // a/b 今日已查 → fresh 只留 c/d
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      const repo = String(url).split('/repos/')[1];
      return ghResponse({ full_name: repo, description: 'desc', stargazers_count: 900, language: 'Go', topics: ['x'] });
    }));
    await fanoutRepoRefs(env, 'chat', 'https://github.com/a/b and https://github.com/c/d', {} as any);
    expect(sendRepo).toHaveBeenCalledTimes(1); // 只 c/d
    const body = sendRepo.mock.calls[0][2] as { html: string }[];
    expect(String(body[0].html)).toContain('c/d');
  });
  it('fetchRepo 返回 null(私有 repo)/异常 → 单个跳过, 不影响其它', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ghResponse({ message: 'Not Found' }, 404)));
    await fanoutRepoRefs(makeEnv(), 'chat', 'https://github.com/a/private', {} as any);
    expect(sendRepo).not.toHaveBeenCalled(); // 静默跳过
  });
});

// ---------- backfillDescriptions ----------
describe('backfillDescriptions: 星标仓中文描述回填', () => {
  it('无 search:index → 直接 return', async () => {
    await backfillDescriptions(makeEnv());
    expect(mockDw).not.toHaveBeenCalled();
  });
  it('star 仓非中文 desc + deepwiki 命中 → 写 lookup:desc 缓存', async () => {
    mockDw.mockResolvedValue('An English overview paragraph long enough to translate');
    const env = makeEnv();
    await env.CACHE.put('search:index', JSON.stringify([
      ['star', 'a/b', 'https://github.com/a/b', 'hay', 'English description'],
    ]));
    await backfillDescriptions(env, 1);
    const raw = await env.CACHE.get('lookup:desc:a/b');
    expect(JSON.parse(raw!).zh).toContain('中文描述');
  });
  it('非 star / 已中文 desc / 已有缓存 → 全部跳过', async () => {
    mockDw.mockResolvedValue('overview');
    const env = makeEnv();
    await env.CACHE.put('search:index', JSON.stringify([
      ['bookmark', 'c/d', 'https://c', 'hay', 'English bookmark'],   // 非 star
      ['star', 'e/f', 'https://e', 'hay', '这是已是中文的文字内容'],  // 已中文
      ['star', 'g/h', 'https://g', 'hay', 'English'],               // 已有缓存
    ]));
    await env.CACHE.put('lookup:desc:g/h', JSON.stringify({ zh: '有缓存', ts: Date.now() }));
    await backfillDescriptions(env);
    expect(mockDw).not.toHaveBeenCalled(); // 三条全跳过 → deepwiki 0 命
  });
  it('deepwiki 未命中 → 写空缓存做标记(防重复遍历)', async () => {
    mockDw.mockResolvedValue(''); // 空 → 不中文
    const env = makeEnv();
    await env.CACHE.put('search:index', JSON.stringify([
      ['star', 'noref/repo', 'https://n', 'hay', 'English desc'],
    ]));
    await backfillDescriptions(env, 1);
    const raw = await env.CACHE.get('lookup:desc:noref/repo');
    expect(JSON.parse(raw!).zh).toBe('');
  });
});

// ---------- archiveUrl ----------
describe('archiveUrl: 任意 URL 存档', () => {
  it('urlToMarkdown 抛错 → ❌无法转换(不静默)', async () => {
    mockUrlToMd.mockRejectedValue(new Error('chain fail'));
    await archiveUrl(makeEnv(), 'chat', 'https://example.com/page');
    expect(String(sendText.mock.calls[0][2])).toContain('无法转换');
  });
  it('urlToMarkdown 返回空 → ❌无法提取', async () => {
    mockUrlToMd.mockResolvedValue('');
    await archiveUrl(makeEnv(), 'chat', 'https://example.com/page');
    expect(String(sendText.mock.calls[0][2])).toContain('无法提取');
  });
  it('有 og:image → sendPhoto 成功即返回(不走纯文字)', async () => {
    mockExtractOg.mockReturnValue('https://og.example/img.png');
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.startsWith('https://api.telegram.org')) return new Response('ok', { status: 200 });
      return new Response('<html><meta property="og:image" content="https://og.example/img.png"></html>', { status: 200 });
    }));
    const ctx = { waitUntil: vi.fn((p: Promise<void>) => Promise.resolve(p)) };
    await archiveUrl(makeEnv(), 'chat', 'https://example.com/page', ctx as any);
    expect(sendText).not.toHaveBeenCalled(); // photo 路径直接 return
    expect(ctx.waitUntil).toHaveBeenCalled(); // markProcessed 已入队列
  });
  it('无 og + 兜底图 sendPhoto 失败 → 回退纯文字确认', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      const u = String(url);
      if (u.startsWith('https://api.telegram.org')) return new Response('nope', { status: 500 });
      if (u.includes('apple-touch-icon') || u.includes('favicon')) return new Response('', { status: 404 });
      return new Response('<html><body>no og</body></html>', { status: 200 });
    }));
    await archiveUrl(makeEnv(), 'chat', 'https://example.com/page', {} as any);
    expect(sendText).toHaveBeenCalledTimes(1); // 纯文字确认发出
    expect(String(sendText.mock.calls[0][2])).toContain('#archive');
  });
});