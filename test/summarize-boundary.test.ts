import { describe, it, expect, afterEach, vi } from 'vitest';
// summarizeZh / summarizeZhDeep 边界测试
// 只测边界路径: 空输入、错误传播、非中文输出、超长输入截断、全链回落
// 不改 src/, 不碰已有 test/summarize.test.ts
import { summarizeZh, summarizeZhDeep } from '../src/translate';

// ─── helpers ──────────────────────────────────────────────────────
function mockEnvAi(runFn: (model: string, input: unknown) => Promise<unknown>) {
  return { AI: { run: runFn } as any, OPENROUTER_API_KEY: undefined } as any;
}

function mockFetchReturn(content: string, status = 200) {
  return vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({ choices: [{ message: { content } }] }),
      { status },
    ),
  ) as typeof fetch;
}

function mockFetchFail() {
  return vi.fn().mockRejectedValue(new Error('network')) as typeof fetch;
}

// ─── summarizeZh 边界 ────────────────────────────────────────────
describe('summarizeZh boundary', () => {
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it('空文本 → 不 crash', async () => {
    const calls: [string, unknown][] = [];
    const env = mockEnvAi(async (m, i) => {
      calls.push([m, i]);
      if (m === '@cf/facebook/bart-large-cnn') return { summary: '' };
      return {};
    });
    const r = await summarizeZh(env, '');
    expect(r).toBeNull();
  });

  it('AI.run 全部抛错 → null 不抛', async () => {
    const env = mockEnvAi(async () => { throw new Error('boom'); });
    // summarizeZhDeep 也调 openrouter fetch, mock fetch 失败
    globalThis.fetch = mockFetchFail();
    const r = await summarizeZh(env, 'some text');
    expect(r).toBeNull();
  });

  it('bart 输出空 summary → null', async () => {
    const env = mockEnvAi(async (m) => {
      if (m === '@cf/facebook/bart-large-cnn') return { summary: undefined };
      return {};
    });
    globalThis.fetch = mockFetchFail();
    const r = await summarizeZh(env, 'text');
    expect(r).toBeNull();
  });

  it('m2m100 译文非中文 → null(守卫命中)', async () => {
    const env = mockEnvAi(async (m) => {
      if (m === '@cf/facebook/bart-large-cnn') return { summary: 'English summary' };
      if (m === '@cf/meta/m2m100-1.2b') return { translated_text: 'This is English not Chinese' };
      return {};
    });
    globalThis.fetch = mockFetchFail();
    const r = await summarizeZh(env, 'article');
    expect(r).toBeNull();
  });

  it('超长输入 → bart 侧截断至 2000 字符(input_text)', async () => {
    let capturedInput: string = '';
    const env = mockEnvAi(async (m, i: any) => {
      if (m === '@cf/facebook/bart-large-cnn') {
        capturedInput = i.input_text;
        return { summary: 'summary ok' };
      }
      if (m === '@cf/meta/m2m100-1.2b') return { translated_text: '摘要结果' };
      return {};
    });
    globalThis.fetch = mockFetchFail();
    const longText = 'A'.repeat(10_000);
    await summarizeZh(env, longText);
    expect(capturedInput.length).toBeLessThanOrEqual(2000);
    expect(capturedInput.length).toBe(2000);
  });

  it('summarizeZhDeep 先行成功 → 跳过 bart 路径', async () => {
    const calls: string[] = [];
    const env = {
      OPENROUTER_API_KEY: 'test',
      AI: { run: async (m: string) => { calls.push(m); return {}; } } as any,
    };
    globalThis.fetch = mockFetchReturn('这是一条深度中文摘要，包含足够的中文字符。');
    const r = await summarizeZh(env, 'article');
    expect(r).toContain('深度中文摘要');
    // bart 不应被调用
    expect(calls.some((m) => m.includes('bart'))).toBe(false);
  });
});

// ─── summarizeZhDeep 边界 ────────────────────────────────────────
describe('summarizeZhDeep boundary', () => {
  const origFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it('无 OPENROUTER_API_KEY → null', async () => {
    globalThis.fetch = vi.fn();
    const r = await summarizeZhDeep({} as any, 'text');
    expect(r).toBeNull();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('所有模型都返回非中文 → null', async () => {
    globalThis.fetch = mockFetchReturn('Pure English summary text with no CJK.');
    const r = await summarizeZhDeep({ OPENROUTER_API_KEY: 'k' } as any, 'text');
    expect(r).toBeNull();
  });

  it('摘要过短(<10 字符) → null(守卫)', async () => {
    globalThis.fetch = mockFetchReturn('太短了');
    const r = await summarizeZhDeep({ OPENROUTER_API_KEY: 'k' } as any, 'text');
    expect(r).toBeNull();
  });

  it('fetch 抛错 → null 不抛', async () => {
    globalThis.fetch = mockFetchFail();
    const r = await summarizeZhDeep({ OPENROUTER_API_KEY: 'k' } as any, 'text');
    expect(r).toBeNull();
  });

  it('首模型 403 → 跳到下一模型', async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) return new Response('{}', { status: 403 });
      return new Response(JSON.stringify({
        choices: [{ message: { content: '这是一段足够长的中文摘要内容。' } }],
      }));
    });
    const r = await summarizeZhDeep({ OPENROUTER_API_KEY: 'k' } as any, 'article');
    expect(r?.summaryZh).toContain('中文摘要');
    expect(callCount).toBe(2);
  });

  it('QUOTE 行被正确拆分', async () => {
    globalThis.fetch = mockFetchReturn(
      '这是一条关于该工具的中文摘要内容，符合长度要求。\nQUOTE: This is the original English sentence.',
    );
    const r = await summarizeZhDeep({ OPENROUTER_API_KEY: 'k' } as any, 'article');
    expect(r?.summaryZh).toBe('这是一条关于该工具的中文摘要内容，符合长度要求。');
    expect(r?.quote).toBe('This is the original English sentence.');
  });

  it('超长输入 → 截断至 6000 字符(检查 fetch body)', async () => {
    let capturedBody = '';
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, opts: any) => {
      capturedBody = opts.body;
      return new Response(JSON.stringify({
        choices: [{ message: { content: '足够长的中文摘要结果。' } }],
      }));
    });
    const longArticle = 'B'.repeat(10_000);
    await summarizeZhDeep({ OPENROUTER_API_KEY: 'k' } as any, longArticle);
    const body = JSON.parse(capturedBody);
    const userMsg = body.messages.find((m: any) => m.role === 'user')?.content ?? '';
    expect(userMsg.length).toBeLessThanOrEqual(6000 + 30); // "请用中文总结这篇产品文章：\n\n" prefix + 6000
  });

  it('所有模型 fetch 全抛 → null', async () => {
    globalThis.fetch = mockFetchFail();
    const r = await summarizeZhDeep({ OPENROUTER_API_KEY: 'k' } as any, 'article');
    expect(r).toBeNull();
  });
});
