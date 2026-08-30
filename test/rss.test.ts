// RSS feed 生成测试
import { describe, it, expect } from 'vitest';
import { buildRssFeed } from '../src/rss';

const items = [
  {
    title: 'a/aa',
    url: 'https://github.com/a/aa',
    desc: 'English desc',
    descZh: '中文描述 & 特殊 <字符>',
    author: 'author1',
  },
  {
    title: 'b/bb',
    url: 'https://github.com/b/bb',
    desc: 'English only',
    descZh: undefined,
  },
];

describe('RSS feed 生成', () => {
  it('生成合法 RSS 2.0 结构: channel + item 数正确', () => {
    const xml = buildRssFeed(items, '2026-08-30', 'https://example.com');
    expect(xml).toContain('<rss version="2.0"');
    expect(xml).toContain('<channel>');
    expect(xml).toContain('<item>');
    expect(xml).toContain('<title><![CDATA[1. a/aa]]></title>');
    expect(xml).toContain('<title><![CDATA[2. b/bb]]></title>');
    expect(xml).toContain('<link>https://example.com</link>');
    expect(xml).toContain('<guid isPermaLink="false">2026-08-30-0</guid>');
    expect(xml).toContain('<language>zh-CN</language>');
    expect(xml).toContain('<ttl>1440</ttl>');
  });

  it('desc 优先 descZh, 缺失回落原文 desc', () => {
    const xml = buildRssFeed(items, '2026-08-30', 'https://example.com');
    expect(xml).toContain('中文描述');
    expect(xml).toContain('English only');
  });

  it('XML 特殊字符转义 (desc/url)', () => {
    const xml = buildRssFeed(items, '2026-08-30', 'https://example.com');
    // 特殊字符在 CDATA 内也需转义 & < >
    expect(xml).toContain('中文描述 &amp; 特殊 &lt;字符&gt;');
  });

  it('pubDate 正确 (UTC)', () => {
    const xml = buildRssFeed(items, '2026-08-30', 'https://example.com');
    expect(xml).toContain('<pubDate>Sun, 30 Aug 2026 00:00:00 GMT</pubDate>');
  });
});
