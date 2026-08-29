import { describe, it, expect, vi, beforeEach } from 'vitest';

// /search 混合检索回归锁: 子串命中不足一页时 Vectorize 语义补页(去重、✨ 标记、上限补齐),
// 命中满页零语义查询, 语义空结果行为同旧版。vec 模块整体 mock(关注 searchArchive 的编排而非 vec 内部)。

const vecSearchMock = vi.fn(async () => [] as { name: string; url: string; score: number }[]);
vi.mock('../src/vec', () => ({
  vecSearch: (...a: unknown[]) => vecSearchMock(...(a as [])),
  vecUpsertItems: async () => {},
}));

const sendMock = vi.fn();
vi.mock('../src/notify', () => ({
  sendTelegram: (...a: unknown[]) => sendMock(...a),
  sendTelegramKbd: (...a: unknown[]) => sendMock(...a),
  sendChatAction: () => Promise.resolve(),
  editMessageKbd: () => Promise.resolve(),
  answerCallbackQuery: () => Promise.resolve(),
  safeEqual: async (a: string, b: string) => a === b,
}));
vi.mock('../src/translate', () => ({
  isChinese: () => false,
  translateBatch: async (_e: unknown, items: unknown[]) => items,
  summarizeZh: async () => null,
  summarizeZhDeep: async () => null,
  translateTextZh: async () => null,
  generateTitleZh: async () => null,
  generateTagsZh: async () => null,
}));

import { libToEntry } from '../src/search-index';

function kvStub(data: Record<string, unknown>) {
  const store = new Map(Object.entries(data));
  return {
    list: async () => ({ keys: [] }),
    get: async (k: string) => (store.get(k) as string) ?? null,
    put: async (k: string, v: unknown) => { store.set(k, v); },
  };
}

function lastText(): string {
  return (sendMock.mock.calls.at(-1)?.[2] as string) ?? '';
}

describe('/search 混合检索(子串 + 语义补页)', () => {
  beforeEach(() => {
    sendMock.mockClear();
    vecSearchMock.mockClear();
    vecSearchMock.mockImplementation(async () => []);
  });

  it('子串命中不足一页 → 语义结果补页, ✨ 标记, 与子串命中按 name 去重', async () => {
    vecSearchMock.mockImplementation(async () => [
      { name: 'rust-lang/rust', url: 'https://github.com/rust-lang/rust', score: 0.9 }, // 与子串命中同名 → 去重
      { name: 'tokio-rs/tokio', url: 'https://github.com/tokio-rs/tokio', score: 0.8 },
      { name: 'serenity-rs/serenity', url: 'https://github.com/serenity-rs/serenity', score: 0.7 },
    ]);
    const env = { BOT_TOKEN: 't', CACHE: kvStub({ 'search:index': JSON.stringify([
      libToEntry({ src: 'star', name: 'rust-lang/rust', url: 'https://github.com/rust-lang/rust', desc: 'language' }),
    ]) }) as never };
    const { searchArchive } = await import('../src/index');
    await searchArchive(env as never, '1', 'rust');
    expect(vecSearchMock).toHaveBeenCalledTimes(1);
    const text = lastText();
    expect(text).toContain('rust-lang/rust');
    expect(text).toContain('✨');
    expect(text).toContain('tokio-rs/tokio');
    expect(text).toContain('serenity-rs/serenity');
    expect(text).not.toContain('没有找到');
  });

  it('子串命中满一页(≥10) → 零语义查询(省 AI/VEC 子请求)', async () => {
    const entries = Array.from({ length: 12 }, (_, i) =>
      libToEntry({ src: 'star', name: `aiml-${i}`, url: `https://github.com/x/aiml-${i}`, desc: 'x', tags: ['ai'] }),
    );
    const env = { BOT_TOKEN: 't', CACHE: kvStub({ 'search:index': JSON.stringify(entries) }) as never };
    const { searchArchive } = await import('../src/index');
    await searchArchive(env as never, '1', 'aiml');
    expect(vecSearchMock).not.toHaveBeenCalled();
  });

  it('语义结果为空 → 行为同旧版(没有找到文案)', async () => {
    const env = { BOT_TOKEN: 't', CACHE: kvStub({ 'search:index': JSON.stringify([
      libToEntry({ src: 'star', name: 'foo', url: 'https://github.com/foo', desc: 'x' }),
    ]) }) as never };
    const { searchArchive } = await import('../src/index');
    await searchArchive(env as never, '1', 'zzz-not-exist');
    expect(vecSearchMock).toHaveBeenCalledTimes(1);
    expect(lastText()).toContain('没有找到');
  });

  it('语义结果超过页余量 → 只补齐到一页(10 条)', async () => {
    vecSearchMock.mockImplementation(async () =>
      Array.from({ length: 20 }, (_, i) => ({ name: `sem-${i}`, url: `https://github.com/x/sem-${i}`, score: 0.9 - i * 0.01 })),
    );
    const env = { BOT_TOKEN: 't', CACHE: kvStub({ 'search:index': JSON.stringify([
      libToEntry({ src: 'star', name: 'rust-lang/rust', url: 'https://github.com/rust-lang/rust', desc: 'language' }),
    ]) }) as never };
    const { searchArchive } = await import('../src/index');
    await searchArchive(env as never, '1', 'rust');
    const text = lastText();
    expect(text).toContain('sem-8'); // 1 子串 + 9 语义 = 10
    expect(text).not.toContain('sem-9');
    expect(text).toContain('10 条命中');
  });
});
