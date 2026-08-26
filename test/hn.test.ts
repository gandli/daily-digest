import { describe, it, expect } from 'vitest';
// fetchHackerNewsProducts: Algolia search_by_date (tags=story,show_hn) 抓当日 Show HN 新品。
import { fetchHackerNewsProducts } from '../src/sources/hn';
import { afterEach } from 'vitest';

const origF = globalThis.fetch;
describe('fetchHackerNewsProducts', () => {
  afterEach(() => { globalThis.fetch = origF; });
  const mockHits = (hits: unknown) => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ hits }))) as typeof fetch;
  };
  it('返回当日 Show HN 新品(标题/链接/描述/points)', async () => {
    mockHits([
      { title: 'Show HN: Hostflip', url: 'https://github.com/x/hostflip', story_text: '<p>a hosts switcher</p>', points: 4 },
      { title: 'Show HN: no url', story_text: '', points: 1 },
    ]);
    const items = await fetchHackerNewsProducts(2);
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('Show HN: Hostflip');
    expect(items[0].url).toBe('https://github.com/x/hostflip');
    expect(items[0].desc).toContain('a hosts switcher'); // HTML 剥
    expect(items[0].desc).not.toContain('<');
    expect(items[0].stars).toBe(4);
    // 无 url → HN 链接兜底
    expect(items[1].url).toContain('news.ycombinator.com/item?id=');
  });
  it('API 失败 → throw', async () => {
    globalThis.fetch = (async () => new Response('', { status: 500 })) as typeof fetch;
    await expect(fetchHackerNewsProducts(10)).rejects.toBeTruthy();
  });
  it('空 hits → 空数组', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ hits: [] }))) as typeof fetch;
    expect(await fetchHackerNewsProducts(10)).toEqual([]);
  });
});