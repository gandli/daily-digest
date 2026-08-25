import { describe, it, expect, vi, beforeEach } from 'vitest';

// /search 合并搜索回归锁: lib:* (星标/书签) 与 archive:idx:* 都要能被搜到
const sendMock = vi.fn();
vi.mock('../src/notify', () => ({ sendTelegram: (...a: unknown[]) => sendMock(...a) }));

// ponytail: 最小 KV stub——list 按 prefix 过滤 + get 读内存 map
function kvStub(data: Record<string, unknown>) {
  const store = new Map(Object.entries(data));
  return {
    list: async ({ prefix }: { prefix: string }) => ({
      keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })),
    }),
    get: async (k: string) => store.get(k) as string,
    put: async () => {},
  };
}
const env = { BOT_TOKEN: 't', CACHE: kvStub({
  'archive:idx:foo/bar': JSON.stringify({ repo: 'foo/bar', date: '2026-08-24', desc: 'archived repo' }),
  'lib:star:vitest-dev/vitest': JSON.stringify({ src: 'star', name: 'vitest', url: 'https://github.com/vitest-dev/vitest', desc: 'A Vite-native test runner', tags: ['ts', 'known'] }),
  'lib:bm:x': JSON.stringify({ src: 'bookmark', name: '潮流周刊', url: 'https://weekly.tw93.fun/', folder: 'newsletter', tags: ['f:newsletter'] }),
}) as any };

describe('/search 合并搜索', () => {
  beforeEach(() => sendMock.mockClear());

  it('lib 星标命中(名称)', async () => {
    const { searchArchive } = await import('../src/index');
    await searchArchive(env, 1, 'vitest');
    expect(sendMock.mock.calls[0][2]).toContain('⭐');
    expect(sendMock.mock.calls[0][2]).toContain('vitest-dev/vitest'.slice(-6)); // url in anchor
  });

  it('lib 书签命中(tags/folder/中文名)', async () => {
    const { searchArchive } = await import('../src/index');
    await searchArchive(env, 1, 'newsletter');
    expect(sendMock.mock.calls[0][2]).toContain('📑');
  });

  it('archive 索引仍可命中(原行为不回退)', async () => {
    const { searchArchive } = await import('../src/index');
    await searchArchive(env, 1, 'foo/bar');
    expect(sendMock.mock.calls[0][2]).toContain('📄');
  });

  it('无命中给统一未找到文案', async () => {
    const { searchArchive } = await import('../src/index');
    await searchArchive(env, 1, 'zzz-not-exist');
    expect(sendMock.mock.calls[0][2]).toContain('没有找到');
  });

  it('宽泛词(ai)最多返回 20 条且不超 Telegram 4096', async () => {
    const bigEnv = { ...env, CACHE: kvStub(Object.fromEntries(
      Array.from({ length: 60 }, (_, i) => [`lib:star:x/ai-${i}`, JSON.stringify({ src: 'star', name: `ai-tool-${i}`, url: `https://github.com/x/ai-${i}`, desc: 'ai powered thing ' + 'x'.repeat(80), tags: ['ai'] })]),
    )) };
    const { searchArchive } = await import('../src/index');
    await searchArchive(bigEnv as any, 1, 'ai');
    const text = sendMock.mock.calls[0][2] as string;
    expect(text.length).toBeLessThanOrEqual(4096);
  });

  it('KV 分页: 超单页(~1000)的 lib 数据全部可见(Greptile P1 回归锁)', async () => {
    // 1500 条跨两页, 目标 key 在第二页开头——单页 list 永远搜不到它
    const many = Array.from({ length: 1500 }, (_, i) =>
      [`lib:star:x/r${String(i).padStart(4, '0')}`, JSON.stringify({ src: 'star', name: `repo-${i}`, url: `https://github.com/x/${i}`, tags: [] })]);
    many.push(['lib:star:x/needle', JSON.stringify({ src: 'star', name: 'needle-unique-name', url: 'https://github.com/x/needle', tags: [] })]); // 排序在最后
    const pagedKv = (() => {
      const keys = many.map(([k]) => k as string).sort();
      const store = new Map(many);
      return {
        list: async ({ prefix, cursor }: { prefix: string; cursor?: string }) => {
          const all = keys.filter((k) => k.startsWith(prefix));
          const start = cursor ? parseInt(cursor) : 0;
          const page = all.slice(start, start + 1000).map((name) => ({ name }));
          return { keys: page, list_complete: start + 1000 >= all.length, cursor: String(start + 1000) };
        },
        get: async (k: string) => store.get(k) as string,
      };
    })();
    const bigEnv2 = { ...env, CACHE: pagedKv };
    const { searchArchive } = await import('../src/index');
    await searchArchive(bigEnv2 as any, 1, 'needle-unique');
    expect(sendMock.mock.calls[0][2]).toContain('⭐');
    expect(sendMock.mock.calls[0][2]).toContain('needle-unique-name');
  });
});
