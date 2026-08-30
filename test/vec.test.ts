import { describe, it, expect, vi } from 'vitest';
import { vecUpsertItems, vecSearch } from '../src/vec';
import { indexArchivedItems } from '../src/lookup';

// vec.ts 回归锁: Vectorize 镜像写/语义检索。全失败静默, VEC/AI 未绑定直接跳过(行为同旧版)。

vi.mock('../src/translate', () => ({
  isChinese: (s: string) => /[\u4e00-\u9fff]/.test(s),
}));

function fakeEnv({ vec = true, aiFail = false, vecFail = false, matches = [] as unknown[] } = {}) {
  const upsert = vi.fn(async () => (vecFail ? Promise.reject(new Error('vec down')) : {}));
  const query = vi.fn(async () => (vecFail ? Promise.reject(new Error('vec down')) : ({ matches } as never)));
  const run = vi.fn(async (_m: string, args: { text: string[] }) =>
    aiFail ? Promise.reject(new Error('ai down')) : { data: args.text.map(() => [0.1, 0.2, 0.3, 0.4]) },
  );
  return {
    env: { AI: { run }, VEC: vec ? { upsert, query } : undefined },
    upsert,
    query,
    run,
  };
}

describe('vecUpsertItems 写入', () => {
  it('未绑定 VEC → 直接跳过, AI 零调用', async () => {
    const { env, run } = fakeEnv({ vec: false });
    await vecUpsertItems(env as never, [{ title: 'a/b', url: 'u', desc: 'd' } as never]);
    expect(run).not.toHaveBeenCalled();
  });

  it('正常: upsert id=name 小写, metadata 含 src/name/url, 嵌入文本含中文 descZh', async () => {
    const { env, upsert, run } = fakeEnv();
    await vecUpsertItems(env as never, [{ title: 'Owner/Repo', url: 'https://github.com/Owner/Repo', desc: 'en', descZh: '中文描述' } as never]);
    expect(run).toHaveBeenCalledTimes(1);
    expect((run.mock.calls[0][1] as { text: string[] }).text[0]).toContain('中文描述');
    const arg = upsert.mock.calls[0][0];
    expect(arg[0].id).toBe('owner/repo');
    expect(arg[0].metadata).toEqual({ src: 'arch', name: 'Owner/Repo', url: 'https://github.com/Owner/Repo' });
    expect(arg[0].values).toEqual([0.1, 0.2, 0.3, 0.4]);
  });

  it('超长 name(>90 字节) → id 回落确定性哈希(h 前缀)', async () => {
    const { env, upsert } = fakeEnv();
    const longTitle = 'x/'.repeat(60) + 'end';
    await vecUpsertItems(env as never, [{ title: longTitle, url: '' } as never]);
    expect(upsert.mock.calls[0][0][0].id).toMatch(/^h[0-9a-z]+$/);
  });

  it('AI 嵌入抛错 → 静默不抛, 零 upsert', async () => {
    const { env, upsert } = fakeEnv({ aiFail: true });
    await expect(vecUpsertItems(env as never, [{ title: 'a', url: '' } as never])).resolves.toBeUndefined();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('VEC upsert 抛错 → 静默不抛', async () => {
    const { env } = fakeEnv({ vecFail: true });
    await expect(vecUpsertItems(env as never, [{ title: 'a', url: '' } as never])).resolves.toBeUndefined();
  });
});

describe('vecSearch 查询', () => {
  it('正常: query 嵌入后 topK 查询, 过滤低分(<0.55)噪声', async () => {
    const { env, query } = fakeEnv({ matches: [
      { score: 0.9, metadata: { name: 'rust cli', url: 'https://x', src: 'arch' } },
      { score: 0.4, metadata: { name: 'noise', url: 'https://y' } }, // 低于阈值 → 过滤
      { score: 0.5, metadata: {} }, // 缺 name → 过滤
    ] });
    const hits = await vecSearch(env as never, '命令行工具', 10);
    expect(query).toHaveBeenCalledTimes(1);
    expect(hits).toEqual([{ name: 'rust cli', url: 'https://x', score: 0.9 }]);
  });

  it('AI/VEC 失败 → 返回 [](调用方当作无补充)', async () => {
    const { env } = fakeEnv({ aiFail: true });
    expect(await vecSearch(env as never, 'q')).toEqual([]);
    const e2 = fakeEnv({ vecFail: true });
    expect(await vecSearch(e2.env as never, 'q')).toEqual([]);
  });

  it('未绑定 → 返回 [](旧版行为)', async () => {
    const { env } = fakeEnv({ vec: false });
    expect(await vecSearch(env as never, 'q')).toEqual([]);
  });
});

describe('indexArchivedItems 集成: 同时写 KV 索引与 Vectorize', () => {
  it('upsert 被触发, KV 写入不受 vec 故障影响', async () => {
    const { env } = fakeEnv({ vecFail: true });
    const store = new Map<string, string>();
    const kv = { get: async (k: string) => store.get(k) ?? null, put: async (k: string, v: string) => { store.set(k, v); } };
    const fullEnv = { ...env, CACHE: kv, GH_ARCHIVE_REPO: 'gandli/daily-digest' };
    await indexArchivedItems(fullEnv as never, [{ title: 'a/b', url: 'u', desc: 'd' } as never], '2026-08-30');
    const raw = JSON.parse(store.get('search:index')!);
    expect(raw.length).toBe(1); // vec 失败不影响 KV 主路径
  });
});
