import { describe, it, expect, vi, beforeEach } from 'vitest';
import { libToEntry, archToEntry } from '../src/search-index';

// /search 合并搜索回归锁: search:index 单键索引(star/bm/arch 都并入) 内存过滤
// 旧实现逐键 get 6076 次打爆免费版 50 子请求上限 /search 无响应——本锁验证新索引路径
const sendMock = vi.fn();
vi.mock('../src/notify', () => ({ sendTelegram: (...a: unknown[]) => sendMock(...a), sendTelegramKbd: (...a: unknown[]) => sendMock(...a) }));

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

function makeIndex() {
  const libs = [
    libToEntry({ src: 'star', name: 'vitest', url: 'https://github.com/vitest-dev/vitest', desc: 'A Vite-native test runner', tags: ['ts', 'known'] }),
    libToEntry({ src: 'bookmark', name: '潮流周刊', url: 'https://weekly.tw93.fun/', folder: 'newsletter', tags: ['f:newsletter'] }),
  ];
  const archs = [archToEntry({ repo: 'foo/bar', date: '2026-08-24', desc: 'archived repo' })];
  return JSON.stringify([...libs, ...archs]);
}

const env = { BOT_TOKEN: 't', CACHE: kvStub({ 'search:index': makeIndex() }) as any };

describe('/search 合并搜索(单键索引)', () => {
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

  it('archive 索引仍可命中', async () => {
    const { searchArchive } = await import('../src/index');
    await searchArchive(env, 1, 'foo/bar');
    expect(sendMock.mock.calls[0][2]).toContain('📄');
  });

  it('无命中给统一未找到文案', async () => {
    const { searchArchive } = await import('../src/index');
    await searchArchive(env, 1, 'zzz-not-exist');
    expect(sendMock.mock.calls[0][2]).toContain('没有找到');
  });

  it('索引未初始化 → 明确提示', async () => {
    const { searchArchive } = await import('../src/index');
    await searchArchive({ BOT_TOKEN: 't', CACHE: kvStub({}) as any }, 1, 'ai');
    expect(sendMock.mock.calls[0][2]).toContain('搜索索引未初始化');
  });

  it('量大内存过滤不超 Telegram 4096(回归锁: 旧逐键 get 打爆 50 子请求)', async () => {
    const libs = Array.from({ length: 2000 }, (_, i) =>
      libToEntry({ src: 'star', name: `ai-tool-${i}`, url: `https://github.com/x/ai-${i}`, desc: 'ai powered thing ' + 'x'.repeat(80), tags: ['ai'] }),
    );
    const bigEnv = { BOT_TOKEN: 't', CACHE: kvStub({ 'search:index': JSON.stringify(libs) }) as any };
    const { searchArchive } = await import('../src/index');
    await searchArchive(bigEnv as any, 1, 'ai');
    const text = sendMock.mock.calls[0][2] as string;
    expect(text.length).toBeLessThanOrEqual(4096);
  });

  it('翻页: query 存 KV 凭 token 找回, callback_data 不截断长 query(回归锁: 64B 上限)', async () => {
    // 长 query 用于验证不塞 callback_data
    const libs = Array.from({ length: 40 }, (_, i) =>
      libToEntry({ src: 'star', name: `aiml-${i}`, url: `https://github.com/x/aiml-${i}`, desc: 'x', tags: ['ai'] }),
    );
    // 用带存储的 KV stub(put 落内存, 翻页能 get 回)
    const store = new Map<string, unknown>([['search:index', JSON.stringify(libs)]]);
    const memKv = {
      list: async () => ({ keys: [] }),
      get: async (k: string) => store.get(k) as string | undefined ?? null,
      put: async (k: string, v: unknown) => { store.set(k, v); },
    };
    const { searchArchive } = await import('../src/index');
    const env2 = { BOT_TOKEN: 't', CACHE: memKv as any };
    await searchArchive(env2 as any, 1, 'aiml');
    // 首屏应带翻页按钮, 导航行: [页码指示][下一页...]; 找到下一页按钮取其 callback(token)
    const kbArgs = sendMock.mock.calls[0] as unknown[];
    let data = '';
    for (const a of kbArgs) {
      if (a && typeof a === 'object' && 'inline_keyboard' in a) {
        const all = (a as any).inline_keyboard.flat() as { text: string; callback_data: string }[];
        const next = all.find((b: any) => b.text.includes('下一页'));
        if (next) data = next.callback_data;
      }
    }
    expect(data).toMatch(/^sch:1:/); // 下一页指向 page 1
    const token = data.slice('sch:1:'.length);
    expect(token.length).toBeLessThan(20); // 短 token(64B 内), 长 query 不落 callback
    const q = await (store.get(`search:q:${token}`) as string | undefined);
    expect(q).toBe('aiml'); // KV 里能找 return 原 query
  });
});