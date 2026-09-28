import { describe, it, expect, vi } from 'vitest';
import { articleRefFixup, renderTweetHtml } from '../src/fxtweet';
import { fetchTrending } from '../src/sources/trending';
import { extractDesc } from '../src/zread';
import { runProductHunt, fetchProductHuntGraphql } from '../src/ph';

describe('核心分支微调与容错验证', () => {
  describe('fxtweet 边界', () => {
    it('articleRefFixup: 缺少 id 或无 article 链接返回 null', () => {
      expect(articleRefFixup({ text: 'just text' } as any, 'user')).toBeNull();
      expect(articleRefFixup({ id: '123', text: 'no article here' } as any, 'user')).toBeNull();
      expect(articleRefFixup({ id: '123', text: 'see https://x.com/i/article/456' } as any, 'user'))
        .toBe('https://fixupx.com/user/status/123');
    });

    it('renderTweetHtml: 当 title 与 text 为空时安全回退空串，不抛出异常', () => {
      const html = renderTweetHtml({ url: 'https://x.com/u/1' } as any, '', '');
      expect(html).toContain('href="https://x.com/u/1"');
    });
  });

  describe('trending HTMLRewriter 解析容错', () => {
    it('当 github.com/trending 请求失败时抛出带有状态码的 Error', async () => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('Forbidden', { status: 403 })));
      await expect(fetchTrending()).rejects.toThrow('trending fetch 403');
    });
  });

  describe('zread extractDesc 概览提取', () => {
    it('支持带有 Markdown 语法的概览标题并识别正文', () => {
      const payload = 'x'.repeat(30005) + '## 概述\n这是一个深度学习框架的前端封装库，用于快速构建模型并在生产环境部署。\n\n## 其它标题\n这里是不相关的正文内容。';
      const desc = extractDesc(payload, 200, 'test/repo');
      expect(desc).toBeTruthy();
      expect(desc).toContain('深度学习框架');
    });
  });

  describe('ph.ts Product Hunt GraphQL 异常处理', () => {
    it('当 GraphQL 响应结构缺少 posts 字段时静默回退空数组', async () => {
      const env: any = { PH_API_TOKEN: 'test_token' };
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 })));
      const items = await fetchProductHuntGraphql(env, 5);
      expect(items).toEqual([]);
    });

    it('当 GraphQL 请求抛出网络异常时安全捕获并返回空数组', async () => {
      const env: any = { PH_API_TOKEN: 'test_token' };
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('network error')));
      const items = await fetchProductHuntGraphql(env, 5);
      expect(items).toEqual([]);
    });

    it('runProductHunt: Atom feed 解析 + 归档失败仅 warn, 发卡与返回条数不受影响', async () => {
      const env: any = {
        BOT_TOKEN: 'tok',
        CHAT_ID: 'chat',
        CACHE: {
          get: vi.fn().mockResolvedValue(null),
          put: vi.fn().mockResolvedValue(undefined),
        },
        GH_TOKEN: 'gh',
        GH_ARCHIVE_REPO: 'test/repo',
      };

      vi.stubGlobal('fetch', vi.fn().mockImplementation((url: RequestInfo | URL) => {
        const u = String(url);
        if (u.includes('api.telegram.org')) return Promise.resolve(new Response('{"ok":true}', { status: 200 }));
        if (u.includes('producthunt.com/feed')) {
          const xml = `<?xml version="1.0"?><feed>
<entry><title>AcmeApp</title><link rel="alternate" type="text/html" href="https://www.producthunt.com/r/abc"/><author><name>Jane</name></author><content type="html">&lt;p&gt;一个用于批量处理的 AI 工具&lt;/p&gt;&lt;a href="https://x"&gt;Discussion&lt;/a&gt; | &lt;a href="https://y"&gt;Link&lt;/a&gt;</content></entry>
<entry><title>NoLinkApp</title><content type="html">&lt;p&gt;missing link entry&lt;/p&gt;</content></entry>
</feed>`;
          return Promise.resolve(new Response(xml, { status: 200 }));
        }
        if (u.includes('/contents/archive/')) return Promise.resolve(new Response('fail', { status: 500 }));
        return Promise.resolve(new Response('{}', { status: 200 }));
      }));

      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const count = await runProductHunt(env, 'chat');
      // 有效条目 1 条(无 link 的 entry 被跳过)
      expect(count).toBe(1);
      // KV 当日缓存写入 + 归档缓冲失败仅告警(不抛出)
      expect(env.CACHE.put).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('archiveToGitHub failed'), expect.stringContaining('ph-'));
    });
  });
});
