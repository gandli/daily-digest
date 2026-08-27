// fxtweet: 链接提取 + HTML 渲染转义 + fetchTweet 拉取测试
import { describe, it, expect, afterEach } from 'vitest';
import { extractTweet, renderTweetHtml, fetchTweet, articleToText } from '../src/fxtweet';

describe('extractTweet: X/Twitter 帖子链接', () => {
  it('x.com 标准链接', () => {
    expect(extractTweet('看这个 https://x.com/jack/status/20')).toEqual({ handle: 'jack', id: '20' });
  });
  it('twitter.com + mobile 子域', () => {
    expect(extractTweet('https://mobile.twitter.com/elonmusk/statuses/12345678901')).toEqual({
      handle: 'elonmusk',
      id: '12345678901',
    });
  });
  it('裸域名无协议也命中', () => {
    expect(extractTweet('x.com/a/status/12345')).toEqual({ handle: 'a', id: '12345' });
  });
  it('非 status 路径不命中', () => {
    expect(extractTweet('https://x.com/jack/followers')).toBeNull();
  });
  it('极短数字路径不误伤', () => {
    expect(extractTweet('x.com/jack/123')).toBeNull();
  });
});

describe('renderTweetHtml: 转义与拼装(三段式: 标题/内容/三链)', () => {
  it('HTML 特殊字符转义(标题+正文)', () => {
    const html = renderTweetHtml({ text: '<b>&"test"', url: 'https://x.com/j/s/1' }, '标题<b>', '<b>&"test"');
    expect(html).toContain('&lt;b&gt;&amp;'); // 正文
    expect(html).toContain('标题&lt;b&gt;'); // 标题转义
  });
  it('标题直链 + 内容 + 三链段', () => {
    const html = renderTweetHtml({ text: '正文', url: 'https://x.com/j/s/1' }, 'LLM标题', '正文', '', '\n\n📁 Wayback·Archive');
    expect(html).toContain('<a href="https://x.com/j/s/1">LLM标题</a>');
    expect(html).toContain('正文');
    expect(html).toContain('📁 Wayback·Archive');
  });
  it('无标题 → 回退正文截断(不崩, 无 undefined)', () => {
    const html = renderTweetHtml({ text: 'just text' } as never, '', 'just text');
    expect(html).toContain('just text');
    expect(html).not.toContain('undefined');
  });
  it('已移除媒体/stats/时间行(对齐 product 纯三段式)', () => {
    const html = renderTweetHtml({ text: 'x', likes: 100, retweets: 5, replies: 2, media: { all: [{ type: 'photo', url: 'https://p/1' }] }, created_at: 'Mon Jul 13 01:16:37 +0000 2026' } as never, '', 'x');
    expect(html).not.toContain('📎');
    expect(html).not.toContain('❤️');
    expect(html).not.toContain('🗓');
  });
  it('非中文原文 → 中文替换(不带 🌐 标记)', () => {
    const html = renderTweetHtml({ text: 'english', url: 'https://x.com/e/1' }, '小标题', '中文翻译', '', '\n📁 三链');
    expect(html).toContain('中文翻译');
    expect(html).not.toContain('english'); // 原文被中文替换
    expect(html).not.toContain('🌐');
    expect(html).toContain('📁 三链');
  });
});

describe('fetchTweet: FxEmbed 拉取', () => {
  const origF = globalThis.fetch;
  afterEach(() => { globalThis.fetch = origF; });
  const mock = (body: unknown, status = 200) => {
    globalThis.fetch = (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
  };
  it('200 + text + translation → 返回含 translation', async () => {
    mock({ code: 200, tweet: { text: 'hello', translation: { text: '你好' } } });
    const t = await fetchTweet('j', '1');
    expect(t?.text).toBe('hello');
    expect(t?.translation?.text).toBe('你好');
  });
  it('HTTP 非200 → null', async () => {
    mock({}, 500);
    expect(await fetchTweet('j', '1')).toBeNull();
  });
  it('body code≠200 → null', async () => {
    mock({ code: 404, tweet: null });
    expect(await fetchTweet('j', '1')).toBeNull();
  });
  it('无 text → null(僵尸数据)', async () => {
    mock({ code: 200, tweet: { translation: { text: 'partial' } } });
    expect(await fetchTweet('j', '1')).toBeNull();
  });
  it('网络异常 → null(不抛)', async () => {
    globalThis.fetch = (async () => { throw new Error('net'); }) as typeof fetch;
    expect(await fetchTweet('j', '1')).toBeNull();
  });
});

describe('articleToText: 嵌套文章 blocks → 纯文本', () => {
  it('无文章 → null', () => {
    expect(articleToText({ text: 'x' } as never)).toBeNull();
  });
  it('有文章 → 拼接非空段', () => {
    const t = { article: { content: { blocks: [
      { type: 'unstyled', text: '第一段正文' },
      { type: 'unstyled', text: '' },
      { type: 'header-one', text: '章节标题' },
    ] } } } as never;
    const out = articleToText(t) ?? '';
    expect(out).toContain('第一段正文');
    expect(out).toContain('章节标题');
    expect(out).not.toContain('\n\n\n'); // 空段被滤
  });
});