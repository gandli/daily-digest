import { describe, it, expect, vi, beforeEach } from 'vitest';
// fetchHackerNewsProducts: HN API 抓取 → 过滤 Show HN/GitHub 开源项目 → 取前 N。
import { fetchHackerNewsProducts } from '../src/sources/hn';

const origFetch = globalThis.fetch;
// mock HN API: topstories 返回 ids, item/<id> 返回 story 或非 story
function mockHN() {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const u = String(input);
    if (u.includes('/topstories.json')) {
      return new Response(JSON.stringify([1, 2, 3, 4, 5, 6]));
    }
    const id = Number(u.split('/item/')[1].split('.json')[0]);
    const stories: Record<number, unknown> = {
      1: { id: 1, type: 'story', title: 'Show HN: my new app', url: 'https://example.com/app', text: '<p>Show HN demo</p>', score: 120, by: 'alice' },
      2: { id: 2, type: 'story', title: 'An open source tool', url: 'https://github.com/alice/tool', text: 'repo desc', score: 80, by: 'bob' },
      3: { id: 3, type: 'job', title: 'job post', url: 'https://news.ycombinator.com/item?id=3' }, // 非 story 跳过
      4: { id: 4, type: 'story', title: 'A random HN article', url: 'https://news.ycombinator.com', text: 'no product no github' }, // 非新品/开源跳过
      5: { id: 5, type: 'story', title: 'Show HN: another', url: 'https://x.com/site', text: '', score: 50 }, // Show HN 无 GitHub
      6: { id: 6, type: 'story', title: 'github.com 项目', url: 'https://github.com/owner/repo', text: '<p>简介</p>' },
    };
    return new Response(JSON.stringify(stories[id] ?? null));
  }) as typeof fetch;
}

describe('fetchHackerNewsProducts', () => {
  beforeEach(() => { globalThis.fetch = origFetch; });

  it('过滤 Only Show HN + GitHub 开源项目, 跳过非新品/非 story, 去 HTML 标签', async () => {
    mockHN();
    // limit 大, 确保全扫
    const items = await fetchHackerNewsProducts(10);
    // 应命中: 1(Show HN), 2(github), 5(Show HN 无github), 6(github 中文) = 4 条
    expect(items.length).toBe(4);
    // 标题保留原文
    expect(items.some((i) => i.title === 'Show HN: my new app')).toBe(true);
    expect(items.some((i) => i.title === 'An open source tool')).toBe(true);
    // HTML 标签剥离
    const app = items.find((i) => i.title === 'Show HN: my new app')!;
    expect(app.desc).not.toContain('<');
    expect(app.desc).toContain('Show HN demo');
    // score 存 stars 槽
    expect(app.stars).toBe(120);
    // job 和普通文章被过滤
    expect(items.some((i) => i.title === 'job post')).toBe(false);
    expect(items.some((i) => i.title === 'A random HN article')).toBe(false);
  });

  it('limit 截断', async () => {
    mockHN();
    const items = await fetchHackerNewsProducts(2);
    expect(items.length).toBeLessThanOrEqual(2);
  });

  it('HN API 失败 → throw', async () => {
    globalThis.fetch = (async () => new Response('{}', { status: 500 })) as typeof fetch;
    await expect(fetchHackerNewsProducts(10)).rejects.toBeTruthy();
  });

  it('空 topstories → 返回空数组', async () => {
    globalThis.fetch = (async () => new Response('[]')) as typeof fetch;
    expect(await fetchHackerNewsProducts(10)).toEqual([]);
  });
});