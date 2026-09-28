// 两个线上 bug 的单元回归锁(均由 link-response-matrix.test.ts 端到端发现):
//   ① extractUrl 把尾部 ')' 当句末标点剥掉 → 维基/MDN 风格链接截断 → 抓不到内容 → 用户看着"没反应"
//   ② viaMarkdownForAgents 收了 <40 字的垃圾响应 → 归档出空内容卡, 而不是显式 ❌ 提示
import { describe, it, expect, vi } from 'vitest';
import { extractUrl, urlToMarkdown } from '../src/urlmd';

describe('extractUrl: 括号是路径合法字符, 不是标点', () => {
  it('维基百科风格链接 → 完整保留成对括号', () => {
    expect(extractUrl('https://en.wikipedia.org/wiki/Rust_(programming_language)'))
      .toBe('https://en.wikipedia.org/wiki/Rust_(programming_language)');
  });

  it('中文句子后缀一个 ' + "'" + ')' + ' + 句号 → 只剥句末标点, 不动路径内括号', () => {
    expect(extractUrl('看这个 https://en.wikipedia.org/wiki/Rust_(programming_language)。'))
      .toBe('https://en.wikipedia.org/wiki/Rust_(programming_language)');
  });

  it('句子里的裸右括号(不成对)→ 剥掉当句末标点', () => {
    expect(extractUrl('参考 https://example.com/a) 这个')).toBe('https://example.com/a');
  });

  it('嵌套/多个括号 → 仍配平保留', () => {
    expect(extractUrl('https://x.dev/a_(b_(c))')).toBe('https://x.dev/a_(b_(c))');
  });

  it('尾部 . , ; ! ? 仍照旧剥除(旧行为不回归)', () => {
    expect(extractUrl('推荐 https://example.com/a, 收藏。')).toBe('https://example.com/a');
    expect(extractUrl('https://example.com/a?b=1')).toBe('https://example.com/a?b=1');
  });
});

describe('urlToMarkdown: 垃圾/短响应不收下(否则产出空内容卡)', () => {
  it('Markdown-for-Agents 档返回短 JSON 壳 → 继续降级, 全链失败回空串', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 200 })));
    expect(await urlToMarkdown({} as any, 'https://dead.example.com/x', {})).toBe('');
  });

  it('Markdown-for-Agents 档返回 HTML(无视 Accept) → 嗅探拒绝, 降级', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response('<!doctype html><html><body>hello</body></html>', { status: 200 })));
    expect(await urlToMarkdown({} as any, 'https://dead.example.com/x', {})).toBe('');
  });

  it('真正够长的 markdown 才被采纳', async () => {
    const body = '# 标题\n\n这是一段足够长的中文正文内容, 用于让读取链的长度阈值校验通过并成功产出 markdown 转换结果, 确保后续归档与发卡流程真实被执行到。';
    vi.stubGlobal('fetch', vi.fn().mockImplementation((u: any) => {
      const url = String(u);
      // 让前面的方法(Jina/markdown.new 等)全抛, 逼走 viaMarkdownForAgents
      if (url.includes('markdown.new') || url.includes('jina') || url.includes('genedai')) {
        return Promise.resolve(new Response('nope', { status: 500 }));
      }
      return Promise.resolve(new Response(body, { status: 200 }));
    }));
    expect(await urlToMarkdown({} as any, 'https://ok.example.com/x', {})).toContain('长度阈值校验');
  });
});
