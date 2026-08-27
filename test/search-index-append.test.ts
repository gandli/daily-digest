import { describe, it, expect, vi } from 'vitest';
import { indexArchivedItems } from '../src/lookup';

// indexArchivedItems 增量写 search:index(修: X 帖搜不到根因)
// 验证: archive:idx 单键照写 + search:index 追加 X 帖条目(hay 含 descZh 中文)

vi.mock('../src/translate', () => ({
  isChinese: (s: string) => /[\u4e00-\u9fff]/.test(s),
}));

function kvStub(initial: Record<string, unknown>) {
  const store = new Map(Object.entries(initial));
  return {
    get: async (k: string) => (store.has(k) ? store.get(k) : null),
    put: async (k: string, v: unknown) => { store.set(k, v); },
  };
}

describe('indexArchivedItems → search:index 增量', () => {
  it('X 帖条目写入 search:index, hay 含中文 descZh', async () => {
    const kv = kvStub({ 'search:index': JSON.stringify([['star', 'OldRepo', 'u', 'old repo', 'desc']]) });
    const env = { CACHE: kv, GH_ARCHIVE_REPO: 'gandli/daily-digest' } as never;
    await indexArchivedItems(env as never, [
      { title: 'x/@ridvanyagli', url: 'https://x.com/ridvanyagli/status/1', desc: '...', descZh: '越狱 iOS 26 虚拟机' } as never,
    ], '2026-08-28');
    const raw = await kv.get('search:index');
    const entries = JSON.parse(raw as string);
    const xEntry = entries.find((e: string[]) => e[0] === 'x');
    expect(xEntry).toBeTruthy();
    expect(xEntry[1]).toBe('x/@ridvanyagli');
    expect(xEntry[2]).toBe('https://x.com/ridvanyagli/status/1');
    expect(xEntry[3]).toContain('越狱');
    expect(xEntry[4]).toContain('越狱');
  });

  it('search:index 不存在时从空数组建, 不 crash', async () => {
    const kv = kvStub({});
    const env = { CACHE: kv } as never;
    await indexArchivedItems(env as never, [
      { title: 'x/@a', url: 'https://x.com/a/1', desc: 'hi', descZh: undefined } as never,
    ], '2026-08-28');
    const raw = await kv.get('search:index');
    expect(JSON.parse(raw as string).length).toBe(1);
  });

  it('archive:idx 单键照写(不影响 /archive 列表)', async () => {
    const kv = kvStub({});
    const env = { CACHE: kv } as never;
    await indexArchivedItems(env as never, [
      { title: 'x/@a', url: 'https://x.com/a/1' } as never,
    ], '2026-08-28');
    const idx = await kv.get('archive:idx:x/@a');
    expect(JSON.parse(idx as string).date).toBe('2026-08-28');
  });

  it('重复归档幂等: 同 title 不重复追加', async () => {
    const kv = kvStub({ 'search:index': JSON.stringify([]) });
    const env = { CACHE: kv } as never;
    const item = { title: 'x/@dup', url: 'u', descZh: '去重' } as never;
    await indexArchivedItems(env as never, [item], '2026-08-28');
    await indexArchivedItems(env as never, [item], '2026-08-28');
    const raw = JSON.parse((await kv.get('search:index')) as string);
    expect(raw.filter((e: string[]) => e[1] === 'x/@dup').length).toBe(1);
  });
});
