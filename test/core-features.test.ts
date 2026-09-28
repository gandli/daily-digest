import { describe, it, expect, vi, beforeEach } from 'vitest';
import worker, { runDigest } from '../src/index';
import { archiveToGitHub, archiveDatedToGitHub } from '../src/archive';
import { fetchTrending } from '../src/sources/trending';

vi.mock('../src/sources/trending', () => ({ fetchTrending: vi.fn() }));

function createMockKv(initial: Array<[string, string]> = [], opts: { failPutKeys?: string[] } = {}) {
  const store = new Map<string, string>(initial);
  return {
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => {
      if (opts.failPutKeys?.includes(k)) throw new Error(`KV put error on ${k}`);
      store.set(k, v);
    },
    delete: async (k: string) => { store.delete(k); },
    list: async ({ prefix }: { prefix: string }) => ({
      keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })),
    }),
    store,
  };
}

const mockCtx = {
  waitUntil: (p: Promise<unknown>) => p,
} as unknown as ExecutionContext;

describe('核心功能扩展测试: Web 路由与数据流边界', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('HTTP GET 端点边缘状态', () => {
    it('/rss: 当 KV 无缓存且 GitHub 归档不可达时，回退标准空 RSS 结构', async () => {
      const kv = createMockKv();
      const env: any = {
        CACHE: kv,
        GH_TOKEN: '', // 无 token，导致从 GitHub 构建失败
      };

      const res = await worker.fetch(new Request('https://worker.dev/rss', { method: 'GET' }), env, mockCtx);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('application/rss+xml');
      const text = await res.text();
      expect(text).toContain('<description>No digest yet</description>');
      expect(text).toContain('daily-digest');
    });

    it('/archive/:date: 当日无任何数据返回 404', async () => {
      const kv = createMockKv();
      const env: any = {
        CACHE: kv,
        GH_TOKEN: '',
        GH_ARCHIVE_REPO: 'gandli/daily-digest',
      };

      // fetchArchiveMd 返回 null
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 404 })));

      const res = await worker.fetch(new Request('https://worker.dev/archive/2026-01-01', { method: 'GET' }), env, mockCtx);
      expect(res.status).toBe(404);
      const text = await res.text();
      expect(text).toContain('无 2026-01-01 digest');
    });

    it('/random: 当搜索索引 search:index 为空时返回 503', async () => {
      const kv = createMockKv();
      const env: any = { CACHE: kv };

      const res = await worker.fetch(new Request('https://worker.dev/random', { method: 'GET' }), env, mockCtx);
      expect(res.status).toBe(503);
      expect(await res.text()).toContain('no index');
    });
  });

  describe('runDigest 异常与降级分支', () => {
    it('runDigest: 当 RSS 写入 KV 失败时仅记录日志，主流程不中断', async () => {
      const kv = createMockKv([], { failPutKeys: ['rss:feed'] });
      const env: any = {
        BOT_TOKEN: 'token',
        CHAT_ID: 'chat123',
        CACHE: kv,
        GH_TOKEN: 'gh_token',
        GH_ARCHIVE_REPO: 'gandli/daily-digest',
      };

      vi.mocked(fetchTrending).mockResolvedValue([
        { title: 'org/repo', url: 'https://github.com/org/repo', desc: 'desc' } as any,
      ]);

      vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL) => {
        const u = String(input);
        if (u.includes('api.telegram.org')) {
          return Promise.resolve(new Response(JSON.stringify({ ok: true, result: {} }), { status: 200 }));
        }
        return Promise.resolve(new Response('{}', { status: 200 }));
      }));

      const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const count = await runDigest(env, false);
      expect(count).toBeGreaterThan(0);
      expect(errSpy).toHaveBeenCalledWith('rss feed put failed', expect.stringContaining('KV put error on rss:feed'));
    });
  });

  describe('安全防护: 路径遍历防御', () => {
    it('archiveToGitHub / archiveDatedToGitHub 检测到 ".." 或 "/" 开头路径立即阻断', async () => {
      const env: any = { CACHE: createMockKv() };
      await expect(archiveToGitHub(env, '../evil', 'content')).rejects.toThrow('bad archive name');
      await expect(archiveToGitHub(env, '/absolute/path', 'content')).rejects.toThrow('bad archive name');
      await expect(archiveDatedToGitHub(env, '2026/../../../root', 'content')).rejects.toThrow('bad archive name');
    });
  });
});
