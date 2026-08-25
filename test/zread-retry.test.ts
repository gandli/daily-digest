import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchZreadWikiDesc } from '../src/zread';

// Greptile P2 回归锁: 4xx 永久失败单次请求立即 null; 5xx 瞬态重试一次
// 合成 payload 需模拟 zread RSC 结构: __next_f chunk 拼接, 中文定义段落在 30000 偏移窗口内
const filler = 'x'.repeat(30010);
const zhDef = '\\nScrapling 是一个自适应爬虫框架，帮助你快速构建抓取任务，支持多种场景与并发处理能力测试用例内容。';
const html200 = [filler, zhDef]
  .map((c) => `<script>self.__next_f.push([1,${JSON.stringify(c)}])</script>`)
  .join('');

describe('fetchZreadWikiDesc 重试策略', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()));
  afterEach(() => vi.unstubAllGlobals());

  it('404: 1 次请求, 无延迟, 立即 null', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('nf', { status: 404 }));
    const t0 = Date.now();
    expect(await fetchZreadWikiDesc('a/b')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(Date.now() - t0).toBeLessThan(1000);
  });

  it('403: 同样立即 null 不重试', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('fbd', { status: 403 }));
    expect(await fetchZreadWikiDesc('a/b')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('504: 重试一次共 2 次请求后 null', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response('gw', { status: 504 }));
    expect(await fetchZreadWikiDesc('a/b')).toBeNull();
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('200 + RSC payload: 提取中文描述, 单次请求', async () => {
    vi.mocked(fetch).mockResolvedValue(new Response(html200, { status: 200 }));
    const d = await fetchZreadWikiDesc('D4Vinci/Scrapling');
    expect(d).toContain('Scrapling');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
