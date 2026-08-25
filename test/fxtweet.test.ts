// fxtweet: 链接提取 + HTML 渲染转义测试(纯函数; fetchTweet 走线上探针已验证)
import { describe, it, expect } from 'vitest';
import { extractTweet, renderTweetHtml } from '../src/fxtweet';

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
  it('极短数字路径不误伤(纯 /123 非帖子形态由 status 字面量排除)', () => {
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
});
