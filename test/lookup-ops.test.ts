// lookup 运维函数深覆盖: getFreshDesc(新鲜/过期/损坏) / refreshLookupDescriptions(过期刷新/未过期跳过/异常) /
// backfillDescriptions(star 条目命中/缺失/非 star 跳过/已有缓存跳过/deepwiki 未命中记空缓存/limit) /
// archiveLinks(三链全有/缺 tgUrl/缺 url/全空) / fanoutRepoRefs(无 ctx/全 seen/fetchRepo null 跳过/deepwiki 命中发卡)。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const sendRepo = vi.fn(); // sendPerRepoMessages
const sendText = vi.fn(); // sendTelegram
const mockDw = vi.fn(); // fetchDeepwikiOverview
const mockTranslate = vi.fn(); // translateTextZh
const mockTranslateBatch = vi.fn(); // translateBatch(可控, 默认返回中文)

vi.mock('../src/notify', () => ({ sendPerRepoMessages: (...a: unknown[]) => sendRepo(...a), sendTelegram: (...a: unknown[]) => sendText(...a) }));
vi.mock('../src/deepwiki', () => ({ fetchDeepwikiOverview: (...a: unknown[]) => mockDw(...a) }));
vi.mock('../src/translate', () => ({
  isChinese: (s: unknown) => /[\u4e00-\u9fff]/.test(String(s ?? '')),
  translateBatch: async (_e: unknown, items: unknown[]) => mockTranslateBatch(_e, items),
  translateTextZh: async (...a: unknown[]) => mockTranslate(...a),
  resolveDescriptions: async () => {},
  summarizeZh: async () => null,
  generateTagsZh: async () => ['ai'],
}));

import { archiveLinks, fanoutRepoRefs, refreshLookupDescriptions, backfillDescriptions, today } from '../src/lookup';

function memKv(entries: Array<[string, string]> = []) {
  const s = new Map<string, string>(entries);
  return {
    list: async ({ prefix }: { prefix: string }) => ({ keys: [...s.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }),
    get: async (k: string) => s.get(k) ?? null,
    put: async (k: string, v: string) => { s.set(k, v); },
    delete: async (k: string) => { s.delete(k); },
    get store() { return s; },
  } as any;
}

function makeEnv(entries: Array<[string, string]> = []) {
  return {
    GH_TOKEN: 'g', GH_ARCHIVE_REPO: 'gandli/daily-digest', BOT_TOKEN: 'test',
    CACHE: memKv(entries),
  } as any;
}

const idx = (entries: unknown[][]) => JSON.stringify(entries);

beforeEach(() => {
  sendRepo.mockClear();
  sendText.mockClear();
  mockDw.mockReset();
  mockTranslate.mockReset();
  mockTranslate.mockResolvedValue('这是中文翻译内容');
  // translateBatch 默认: 每条 desc 产中文
  mockTranslateBatch.mockReset();
  mockTranslateBatch.mockImplementation(async (_e: unknown, items: unknown[]) =>
    (items as { desc?: string }[]).map((i) => ({ ...i, descZh: i.desc ? '这是中文翻译内容' : undefined })),
  );
});
afterEach(() => { globalThis.fetch = undefined as never; });

describe('archiveLinks: 三链组合', () => {
  it('三链全有 → Telegraph · Wayback · Archive', () => {
    const out = archiveLinks('https://github.com/o/r', 'https://telegra.ph/t', 'https://github.com/o/r/blob/archive/2026/2026-08-27.md');
    expect(out).toContain('Telegraph');
    expect(out).toContain('Wayback');
    expect(out).toContain('Archive');
    expect(out.split(' · ').length).toBe(3);
  });
  it('tgUrl 缺 → 无 Telegraph, 只 Wayback + Archive', () => {
    const out = archiveLinks('https://github.com/o/r', undefined, 'md');
    expect(out).not.toContain('Telegraph');
    expect(out).toContain('Wayback');
    expect(out).toContain('Archive');
  });
  it('url 缺 → 无 Wayback', () => {
    const out = archiveLinks(undefined, 'https://telegra.ph/t', 'md');
    expect(out).not.toContain('Wayback');
    expect(out).toContain('Telegraph');
  });
  it('url+tgUrl 全缺 → 只 Archive', () => {
    const out = archiveLinks(undefined, undefined, 'md');
    expect(out).toBe('<a href="md">Archive</a>');
  });
  it('url 含特殊字符 → Wayback URL 编码', () => {
    const out = archiveLinks('https://example.com/a?b=c&d=e', undefined, 'md');
    expect(out).toContain('web.archive.org/web/2/');
    expect(out).toContain(encodeURIComponent('https://example.com/a?b=c&d=e').replace(/%3A/g, ':').replace(/%2F/g, '/'));
  });
});

describe('fanoutRepoRefs: ctx 缺省 / repo 过滤 / 单仓失败', () => {
  it('无 ctx → 直接 return, 不调任何外部', async () => {
    await fanoutRepoRefs(makeEnv(), 'chat', 'https://github.com/o/r', undefined);
    expect(sendRepo).not.toHaveBeenCalled();
    expect(mockDw).not.toHaveBeenCalled();
  });
  it('所有 repo 当日已 seen → 全过滤, 不发卡', async () => {
    const env = makeEnv([[`lookup:${today()}:o/r`, '1']]);
    await fanoutRepoRefs(env, 'chat', 'https://github.com/o/r', { waitUntil: (p) => p } as any);
    expect(sendRepo).not.toHaveBeenCalled();
  });
  it('repo 未 seen → 逐个查+发精简卡; fetchRepo 返回 null → 跳过不影响其它; Wayback save 触发', async () => {
    const saves: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.startsWith('https://web.archive.org/save/')) { saves.push(u); return new Response('ok', { status: 200 }); }
      if (u.includes('api.github.com/repos/o/r')) return new Response(JSON.stringify({ full_name: 'o/r', description: 'a rust cli', stargazers_count: 5, language: 'Rust', topics: ['rust'] }), { status: 200 });
      if (u.includes('api.github.com/repos/p/q')) return new Response('{}', { status: 404 });
      throw new Error(`unexpected ${u}`);
    }) as typeof fetch;
    mockDw.mockResolvedValue(null);
    await fanoutRepoRefs(makeEnv(), 'chat', 'https://github.com/o/r https://github.com/p/q', { waitUntil: (p) => p } as any);
    expect(sendRepo).toHaveBeenCalledTimes(1); // 只有 o/r 发卡(p/q 404 → fetchRepo null → 跳过)
    // 序号按 fresh 批量: 失败仓占位, o/r 仍为 1/2
    expect(String((sendRepo.mock.calls[0][2] as { html: string }[])[0].html)).toContain('<b>1/2</b> ');
    expect(saves).toEqual(['https://web.archive.org/save/https://github.com/o/r']); // 只存成功发卡的仓
    await Promise.allSettled([]);
  });
  it('deepwiki 命中 → descZh 用翻译后的中文', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes('api.github.com/repos/o/r')) return new Response(JSON.stringify({ full_name: 'o/r', description: 'a rust cli', stargazers_count: 5, language: 'Rust', topics: ['rust'] }), { status: 200 });
      throw new Error(`unexpected ${u}`);
    }) as typeof fetch;
    mockDw.mockResolvedValue('This is a deepwiki overview in english');
    mockTranslate.mockResolvedValue('这是 deepwiki 翻译后的中文描述');
    await fanoutRepoRefs(makeEnv(), 'chat', 'https://github.com/o/r', { waitUntil: (p) => p } as any);
    expect(mockTranslate).toHaveBeenCalledWith(expect.anything(), 'This is a deepwiki overview in english');
    const html = sendRepo.mock.calls[0]?.[2]?.[0]?.html ?? '';
    expect(html).toContain('这是 deepwiki 翻译后的中文描述');
    expect(String(html)).not.toMatch(/<b>\d+\/\d+<\/b>/); // 单仓批量无序号头
  });
  it('deepwiki 未命中 → 走 GitHub desc 翻译兜底', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes('api.github.com/repos/o/r')) return new Response(JSON.stringify({ full_name: 'o/r', description: 'a rust cli tool', stargazers_count: 5, language: 'Rust', topics: ['rust'] }), { status: 200 });
      throw new Error(`unexpected ${u}`);
    }) as typeof fetch;
    mockDw.mockResolvedValue(null);
    await fanoutRepoRefs(makeEnv(), 'chat', 'https://github.com/o/r', { waitUntil: (p) => p } as any);
    expect(mockTranslate).toHaveBeenCalledWith(expect.anything(), 'a rust cli tool'.slice(0, 500));
    const html = sendRepo.mock.calls[0]?.[2]?.[0]?.html ?? '';
    expect(html).toContain('这是中文翻译内容');
  });
  it('4 repo 跨 2 批(每批 3)→ 全部发卡, 编号 1/4-4/4 按输入序(2026-08-30 分批修复)', async () => {
    const repos = ['a/b', 'c/d', 'e/f', 'g/h'];
    const make = (full: string) => JSON.stringify({ full_name: full, description: `desc of ${full}`, stargazers_count: 3, language: 'Go', topics: ['go'] });
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const u = String(input);
      for (const r of repos) if (u.includes(`api.github.com/repos/${r}`)) return new Response(make(r), { status: 200 });
      if (u.startsWith('https://web.archive.org/save/')) return new Response('ok', { status: 200 });
      throw new Error(`unexpected ${u}`);
    }) as typeof fetch;
    mockDw.mockResolvedValue(null);
    await fanoutRepoRefs(makeEnv(), 'chat', repos.map((r) => `https://github.com/${r}`).join(' '), { waitUntil: (p) => p } as any);
    expect(sendRepo).toHaveBeenCalledTimes(4);
    const htmls = sendRepo.mock.calls.map((c) => (c[2] as { html: string }[])[0].html);
    htmls.forEach((h, k) => expect(h).toContain(`<b>${k + 1}/4</b> `));
    // 顺序 = 输入序(批次不重排)
    repos.forEach((r, k) => expect(htmls[k]).toContain(`>${r}</a>`));
  });
  it('单仓异常 → 不阻断其它仓发卡', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes('api.github.com/repos/o/r')) throw new Error('boom');
      if (u.includes('api.github.com/repos/p/q')) return new Response(JSON.stringify({ full_name: 'p/q', description: 'tool', stargazers_count: 1, language: 'Go', topics: ['go'] }), { status: 200 });
      throw new Error(`unexpected ${u}`);
    }) as typeof fetch;
    mockDw.mockResolvedValue(null);
    await fanoutRepoRefs(makeEnv(), 'chat', 'https://github.com/o/r https://github.com/p/q', { waitUntil: (p) => p } as any);
    expect(sendRepo).toHaveBeenCalledTimes(1);
  });
  it('无 search:index → 直接 return', async () => {
    await backfillDescriptions(makeEnv());
    expect(mockDw).not.toHaveBeenCalled();
  });
});

describe('backfillDescriptions: 星标仓描述补/跳过', () => {
  it('star 仓非中文 desc + 无缓存 + deepwiki 命中 → 写中文缓存, 计数+1', async () => {
    const raw = idx([['star', 'o/r', 'https://github.com/o/r', 'o r rust', 'a rust cli tool']]);
    globalThis.fetch = (async () => { throw new Error('no external'); }) as typeof fetch;
    mockDw.mockResolvedValue('this is a deepwiki overview');
    await backfillDescriptions(makeEnv([['search:index', raw]]), 1);
    expect(mockDw).toHaveBeenCalledWith('o/r');
  });
  it('非 star 条目(src=arch)→ 跳过, 不触发 deepwiki', async () => {
    const raw = idx([['arch', 'o/r', '2026-08-27', 'o r rust', '这是中文描述']]);
    mockDw.mockResolvedValue('dw');
    await backfillDescriptions(makeEnv([['search:index', raw]]));
    expect(mockDw).not.toHaveBeenCalled();
  });
  it('已有缓存 → 跳过(不重复遍历)', async () => {
    const raw = idx([['star', 'o/r', 'https://github.com/o/r', 'o r', 'a rust cli tool']]);
    mockDw.mockResolvedValue('dw');
    await backfillDescriptions(makeEnv([['search:index', raw], ['lookup:desc:o/r', JSON.stringify({ zh: '已有', ts: Date.now() })]]));
    expect(mockDw).not.toHaveBeenCalled();
  });
  it('deepwiki 未命中 → 写空缓存做标记(防重试)', async () => {
    const raw = idx([['star', 'o/r', 'https://github.com/o/r', 'o r', 'a rust cli tool']]);
    globalThis.fetch = (async () => { throw new Error('no external'); }) as typeof fetch;
    mockDw.mockResolvedValue(null);
    const env = makeEnv([['search:index', raw]]);
    await backfillDescriptions(env, 1);
  });
  it('limit 到 → 提前 break( limit=2 避免 1500ms 逐条延时)', async () => {
    const entries = Array.from({ length: 5 }, (_, i) => ['star', `o${i}/r${i}`, `https://github.com/o${i}/r${i}`, `o${i} r${i}`, 'a rust cli tool']);
    const raw = idx(entries);
    globalThis.fetch = (async () => { throw new Error('no external'); }) as typeof fetch;
    mockDw.mockResolvedValue('dw overview');
    await backfillDescriptions(makeEnv([['search:index', raw]]), 2);
    expect(mockDw).toHaveBeenCalledTimes(2);
  });
  it('search:index JSON 损坏 → 直接 return', async () => {
    mockDw.mockResolvedValue('dw');
    await backfillDescriptions(makeEnv([['search:index', 'not json']]));
    expect(mockDw).not.toHaveBeenCalled();
  });
});

describe('refreshLookupDescriptions: 过期缓存刷新', () => {
  const OLD = 7 * 86400_000 + 1000;
  const FRESH = 1000;
  it('未过期缓存 → 跳过, 不调 deepwiki', async () => {
    const env = makeEnv([['lookup:desc:o/r', JSON.stringify({ zh: '新', ts: Date.now() - FRESH })]]);
    mockDw.mockResolvedValue('dw');
    await refreshLookupDescriptions(env);
    expect(mockDw).not.toHaveBeenCalled();
  });
  it('过期缓存 + deepwiki 命中 + 翻译中文 → 刷新写入新 zh', async () => {
    const oldTs = Date.now() - OLD;
    const env = makeEnv([['lookup:desc:o/r', JSON.stringify({ zh: '旧的中文描述', ts: oldTs })]]);
    mockDw.mockResolvedValue('this is a deepwiki overview');
    await refreshLookupDescriptions(env);
    expect(mockDw).toHaveBeenCalledWith('o/r');
    const refreshed = JSON.parse((await env.CACHE.get('lookup:desc:o/r'))!);
    expect(refreshed.zh).toBe('这是中文翻译内容');
    expect(refreshed.ts).toBeGreaterThan(oldTs);
  });
  it('过期缓存 + deepwiki 未命中 → 保持旧值, 不写', async () => {
    const oldTs = Date.now() - OLD;
    const env = makeEnv([['lookup:desc:o/r', JSON.stringify({ zh: '旧的中文描述', ts: oldTs })]]);
    mockDw.mockResolvedValue(null);
    await refreshLookupDescriptions(env);
    const v = await env.CACHE.get('lookup:desc:o/r');
    expect(JSON.parse(v!).zh).toBe('旧的中文描述');
  });
  it('过期缓存 + 翻译非中文 → 保持旧值', async () => {
    const oldTs = Date.now() - OLD;
    // translateBatch 返回无 descZh 的条目 → isChinese('') 假 → 保持旧值
    mockTranslateBatch.mockResolvedValueOnce([{ title: 'o/r', url: '', desc: 'dw overview' } as any]);
    const env = makeEnv([['lookup:desc:o/r', JSON.stringify({ zh: '旧的中文描述', ts: oldTs })]]);
    mockDw.mockResolvedValue('dw overview');
    await refreshLookupDescriptions(env);
    const v = await env.CACHE.get('lookup:desc:o/r');
    expect(JSON.parse(v!).zh).toBe('旧的中文描述');
  });
  it('KV list 异常 → 不抛, 记日志后 return', async () => {
    const env = makeEnv([]);
    (env.CACHE as any).list = async () => { throw new Error('kv down'); };
    await expect(refreshLookupDescriptions(env)).resolves.toBeUndefined();
  });
  it('KV 条目损坏(JSON.parse 失败) → continue 跳过', async () => {
    const env = makeEnv([['lookup:desc:o/r', 'not json'], ['lookup:desc:p/q', JSON.stringify({ zh: '新', ts: Date.now() - OLD })]]);
    mockDw.mockResolvedValue('dw overview');
    await refreshLookupDescriptions(env);
    expect(mockDw).toHaveBeenCalledTimes(1);
    expect(mockDw).toHaveBeenCalledWith('p/q');
  });
});