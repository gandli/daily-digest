// urlmd: extractUrl 提取规则测试(纯函数; 三级转换链走线上验证)
import { describe, it, expect } from 'vitest';
import { extractUrl } from '../src/urlmd';

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
