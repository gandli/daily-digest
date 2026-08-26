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

describe('renderTweetHtml: 转义与拼装', () => {
  it('HTML 特殊字符转义', () => {
    const html = renderTweetHtml({ text: '<b>&"test"', author: { screen_name: 'j', name: '<J>' }, url: 'https://x.com/j/s/1' });
    expect(html).toContain('&lt;b&gt;&amp;');
    expect(html).toContain('&lt;J&gt;');
  });
  it('媒体行渲染为 HTML 链接(parse_mode:HTML)', () => {
    const html = renderTweetHtml({ text: 'pic', media: { all: [{ type: 'photo', url: 'https://pbs.twimg.com/x.jpg' }] } });
    expect(html).toContain('<a href="https://pbs.twimg.com/x.jpg">图片</a>');
  });
  it('媒体类型标签中文化(photo→图片 video→视频 gif→GIF)', () => {
    const html = renderTweetHtml({ text: 'x', media: { all: [{ type: 'photo', url: 'https://p/1' }, { type: 'video', url: 'https://v/2.mp4' }, { type: 'gif', url: 'https://g/3' }] } });
    expect(html).toContain('>图片</a>');
    expect(html).toContain('>视频</a>');
    expect(html).toContain('>GIF</a>');
  });
  it('日期格式化为 YYYY-MM-DD HH:mm(北京时间)', () => {
    const html = renderTweetHtml({ text: 'd', created_at: 'Mon Jul 13 01:16:37 +0000 2026' });
    expect(html).toContain('2026-07-13 09:16');
  });
  it('无作者/stats/media → 不崩, 无 undefined', () => {
    const html = renderTweetHtml({ text: 'just text' } as never);
    expect(html).toContain('just text');
    expect(html).not.toContain('undefined');
  });
  it('有 stats → 渲染', () => {
    const html = renderTweetHtml({ text: 'x', likes: 100, retweets: 5, replies: 2 } as never);
    expect(html).toContain('❤️ 100');
    expect(html).toContain('🔁 5');
    expect(html).toContain('💬 2');
  });
  it('日期解析失败 → 原样保留不崩', () => {
    const html = renderTweetHtml({ text: 'd', created_at: 'bad date format' } as never);
    expect(html).toContain('bad date format');
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