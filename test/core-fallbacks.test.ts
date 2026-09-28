import { describe, it, expect, vi, beforeEach } from 'vitest';
import { d1ArchivePage, d1UpsertArchiveIdx } from '../src/d1';
import { vecSearch, vecUpsertItems } from '../src/vec';
import { urlToMarkdown } from '../src/urlmd';
import { indexArchivedItems, extractRepoRefs, extractRepo, fanoutRepoRefs } from '../src/lookup';
import { sendPerRepoMessages } from '../src/notify';

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

describe('D1 存档镜像: 故障一律静默回落 KV', () => {
  it('DB 未绑定 → d1ArchivePage 返回 null(回落 KV 旧路径)', async () => {
    expect(await d1ArchivePage({ CACHE: memKv() } as any, 10, 0)).toBeNull();
  });

  it('DB 查询抛错 → 返回 null 且不向上抛(主流程不中断)', async () => {
    const boom = async () => { throw new Error('d1 down'); };
    const env: any = {
      CACHE: memKv(),
      // d1ArchivePage 走两条调用形态: prepare().bind().all() 与 prepare().first()
      DB: { prepare: () => ({ bind: () => ({ all: boom, first: boom }), first: boom }) },
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await d1ArchivePage(env, 10, 0)).toBeNull();
    expect(spy).toHaveBeenCalledWith('d1 archive page failed', expect.stringContaining('d1 down'));
  });

  it('空库(COUNT=0) → 视同不可用返回 null(旧数据仍在 KV)', async () => {
    const env: any = {
      CACHE: memKv(),
      DB: {
        prepare: (sql: string) => ({
          bind: () => ({ all: async () => ({ results: [] }), first: async () => ({ n: 0 }) }),
          first: async () => (sql.includes('COUNT') ? { n: 0 } : null),
        }),
      },
    };
    expect(await d1ArchivePage(env, 10, 0)).toBeNull();
  });

  it('正常返回 → 透传 rows/total, SQL 按 date DESC 排序并带分页参数', async () => {
    const binds: any[] = [];
    const seenSql: string[] = [];
    const rows = [{ repo: 'a/b', date: '2026-08-30', summaryZh: '中文摘要' }];
    const env: any = {
      CACHE: memKv(),
      DB: {
        prepare: (sql: string) => {
          seenSql.push(sql);
          return {
            bind: (...a: any[]) => {
              binds.push(a);
              return { all: async () => ({ results: rows }), first: async () => ({ n: 42 }) };
            },
            first: async () => ({ n: 42 }),
          };
        },
      },
    };
    const r = await d1ArchivePage(env, 10, 20);
    expect(r?.total).toBe(42);
    expect(r?.rows[0].repo).toBe('a/b');
    expect(seenSql.some((s) => s.includes('ORDER BY date DESC'))).toBe(true);
    expect(binds).toContainEqual([10, 20]);
  });

  it('d1UpsertArchiveIdx: 写失败仅记日志, 不抛给调用方', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const env: any = {
      CACHE: memKv(),
      DB: { prepare: () => ({ bind: () => ({}) }), batch: async () => { throw new Error('d1 write fail'); } },
    };
    await expect(d1UpsertArchiveIdx(env, [{ title: 'A/B', url: 'u', desc: 'd' }] as any, '2026-08-30')).resolves.toBeUndefined();
    expect(spy).toHaveBeenCalledWith('d1 upsert archive_idx failed', expect.stringContaining('d1 write fail'));
  });
});

describe('Vectorize 语义索引: 失败全静默', () => {
  it('VEC 未绑定 → vecSearch 返回 [] 且不调用 AI', async () => {
    const ai = { run: vi.fn() };
    expect(await vecSearch({ AI: ai } as any, 'q')).toEqual([]);
    expect(ai.run).not.toHaveBeenCalled();
  });

  it('AI 嵌入抛错 → 返回 [] 且不触发 VEC 查询', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const vec = { query: vi.fn() };
    const r = await vecSearch({ AI: { run: vi.fn().mockRejectedValue(new Error('embed fail')) }, VEC: vec } as any, 'q');
    expect(r).toEqual([]);
    expect(vec.query).not.toHaveBeenCalled();
  });

  it('嵌入返回空向量 → 返回 [], 不查 VEC', async () => {
    const vec = { query: vi.fn() };
    const r = await vecSearch({ AI: { run: vi.fn().mockResolvedValue({ data: [] }) }, VEC: vec } as any, 'q');
    expect(r).toEqual([]);
    expect(vec.query).not.toHaveBeenCalled();
  });

  it('低分(<0.55)结果被过滤, 只留高相关', async () => {
    const env: any = {
      AI: { run: vi.fn().mockResolvedValue({ data: [[0.1]] }) },
      VEC: { query: vi.fn().mockResolvedValue({ matches: [
        { score: 0.91, metadata: { name: 'good/hit', url: 'https://u1' } },
        { score: 0.20, metadata: { name: 'bad/noise' } },
        { score: 0.99 }, // 无 metadata.name → 丢弃
      ] }) },
    };
    const r = await vecSearch(env, 'q');
    expect(r).toEqual([{ name: 'good/hit', url: 'https://u1', score: 0.91 }]);
  });

  it('vecUpsertItems: 向量数量与条目数不符 → 静默跳过(不写脏索引)', async () => {
    const vec = { upsert: vi.fn() };
    await vecUpsertItems({ AI: { run: vi.fn().mockResolvedValue({ data: [[0.1], [0.2]] }) }, VEC: vec } as any,
      [{ title: 'a/b' }] as any);
    expect(vec.upsert).not.toHaveBeenCalled();
  });
});

describe('urlmd 三级读取链降级', () => {
  it('全链失败(各服务非 2xx) → 返回空串, 不抛', async () => {
    const env: any = { AI: undefined, GENEDAI_API_KEY: undefined, BROWSER_RENDERING: undefined };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 500 })));
    const md = await urlToMarkdown(env, 'https://example.com/a', {});
    expect(md).toBe('');
  });

  it('上游返回 HTML 而非 markdown → 嗅探拒绝, 落下一档', async () => {
    const env: any = { AI: undefined, GENEDAI_API_KEY: undefined, BROWSER_RENDERING: undefined };
    const seen: string[] = [];
    vi.stubGlobal('fetch', vi.fn().mockImplementation((u: any) => {
      const url = String(u);
      seen.push(url);
      // markdown.new 成功(内容需过 40 字阈值), 其余档位全失败
      if (url.includes('markdown.new')) {
        return Promise.resolve(new Response(JSON.stringify({ success: true, content: '# 标题\n\n这是一段足够长的中文正文内容用于通过长度阈值校验的转换结果,内容再补长一些确保超过四十个字符的长度下限要求。' }), { status: 200 }));
      }
      return Promise.resolve(new Response('nope', { status: 500 }));
    }));
    const md = await urlToMarkdown(env, 'https://example.com/a', {});
    expect(md).toContain('这是一段足够长的中文正文内容');
  });
});

describe('search 索引增量维护', () => {
  it('已存在同名(大小写不同)条目 → 幂等跳过, 不追加重复', async () => {
    const kv = memKv([['search:index', JSON.stringify([['x', 'Acme/Rocket', 'https://u', 'acme rocket', 'd']])]]);
    const env: any = { CACHE: kv, DB: undefined, VEC: undefined, AI: undefined };
    await indexArchivedItems(env, [{ title: 'acme/rocket', url: 'https://u2', desc: 'new' }] as any, '2026-08-30');
    const entries = JSON.parse(kv.store.get('search:index')!);
    expect(entries.length).toBe(1);
  });

  it('search:index 为损坏 JSON → 静默跳过, 不影响主流程', async () => {
    const kv = memKv([['search:index', '{broken']]);
    await expect(indexArchivedItems({ CACHE: kv, DB: undefined, VEC: undefined, AI: undefined } as any,
      [{ title: 'a/b' }] as any, '2026-08-30')).resolves.toBeUndefined();
  });
});

describe('repo 引用提取(防误抓/防越界)', () => {
  it('去重 + 过滤源码文件链接 + 剥 .git 后缀, 上限 10', () => {
    const refs = extractRepoRefs([
      'https://github.com/a/b',
      'https://github.com/a/b',          // 重复
      'https://github.com/a/b/blob/main/README.md', // 路径
      'https://github.com/c/d.git',     // .git
      'https://github.com/e/f?tab=readme',
    ].join(' '));
    expect(refs).toEqual(['a/b', 'c/d', 'e/f']);
  });

  it('extractRepo: 普通 URL 不误判为 repo', () => {
    expect(extractRepo('看这个 https://example.com/a/b')).toBeNull();
    expect(extractRepo('https://github.com/a/b')).toBe('a/b');
  });
});

describe('发送层: TG 接口异常时显式失败(调用方据此提示用户)', () => {
  beforeEach(() => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('sendMessage 非 2xx → sendPerRepoMessages 返回 false(不静默吞)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('rate limited', { status: 429 })));
    const ok = await sendPerRepoMessages('tok', 'chat', [{ html: '<b>x</b>' }]);
    expect(ok).toBe(false);
  });

  it('fetch 网络异常(throw) → 返回 false', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('conn reset')));
    const ok = await sendPerRepoMessages('tok', 'chat', [{ html: '<b>x</b>' }]);
    expect(ok).toBe(false);
  });

  it('全成功 → 返回 true', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 })));
    expect(await sendPerRepoMessages('tok', 'chat', [{ html: 'a' }, { html: 'b' }])).toBe(true);
  });
});

describe('fanoutRepoRefs: ctx 缺省(cron)时不触发', () => {
  it('未传 ctx → 安全返回, 不产生副作用', async () => {
    const env: any = { CACHE: memKv(), DB: undefined, VEC: undefined, AI: undefined, BOT_TOKEN: 'tok' };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 })));
    await expect(fanoutRepoRefs(env, 'chat', 'https://github.com/a/b')).resolves.toBeUndefined();
  });
});
