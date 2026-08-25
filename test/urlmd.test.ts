// urlmd: extractUrl 提取规则测试(纯函数; 三级转换链走线上验证)
import { describe, it, expect } from 'vitest';
import { extractUrl, extractOgImage } from '../src/urlmd';

describe('extractUrl: 从消息文本提取首个 URL', () => {
  it('普通 https 链接', () => {
    expect(extractUrl('看看这篇 https://blog.example.com/post/123 好文')).toBe('https://blog.example.com/post/123');
  });
  it('http 链接', () => {
    expect(extractUrl('http://example.com')).toBe('http://example.com');
  });
  it('中文标点跟随 → 不带标点', () => {
    expect(extractUrl('https://example.com/a。好的')).toBe('https://example.com/a');
  });
  it('括号包裹 → 不含闭括号', () => {
    expect(extractUrl('(见 https://example.com/x)')).toBe('https://example.com/x');
  });
  it('无 URL → null', () => {
    expect(extractUrl('今晚吃什么')).toBeNull();
  });
  it('GitHub 链接也能提取(路由层 repo 优先, 这里只管提取)', () => {
    expect(extractUrl('https://github.com/owner/repo')).toBe('https://github.com/owner/repo');
  });
});

describe('extractOgImage: og:image 提取', () => {
  it('property 前置形态', () => {
    expect(extractOgImage('<meta property="og:image" content="https://x/a.jpg">')).toBe('https://x/a.jpg');
  });
  it('content 前置形态', () => {
    expect(extractOgImage("<meta content='https://x/b.png' property='og:image'>")).toBe('https://x/b.png');
  });
  it('twitter:image 兜底 + 无图 null', () => {
    expect(extractOgImage('<meta name="twitter:image" content="https://x/c.jpg">')).toBe('https://x/c.jpg');
    expect(extractOgImage('<html><body>no meta</body></html>')).toBeNull();
  });
  it('name= 形态的 og:image(ogs 兼容)', () => {
    expect(extractOgImage('<meta name="og:image" content="https://x/d.jpg">')).toBe('https://x/d.jpg');
  });
  it('og:image:url 变体', () => {
    expect(extractOgImage('<meta property="og:image:url" content="https://x/e.jpg">')).toBe('https://x/e.jpg');
  });
  it('相对路径无 base → 放弃', () => {
    expect(extractOgImage('<meta property="og:image" content="/img/cover.png">')).toBeNull();
  });
  it('HTML 实体解码(&amp;)', () => {
    expect(extractOgImage('<meta property="og:image" content="https://x/p?a=1&amp;b=2">')).toBe('https://x/p?a=1&b=2');
  });
  it('og:image:secure_url 与 twitter:image:src 变体', () => {
    expect(extractOgImage('<meta property="og:image:secure_url" content="https://x/s.png">')).toBe('https://x/s.png');
    expect(extractOgImage('<meta name="twitter:image:src" content="https://x/t.jpg">')).toBe('https://x/t.jpg');
  });
});
