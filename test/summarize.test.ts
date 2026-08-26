import { describe, it, expect } from 'vitest';
// summarizeZh 自检: 验证 CF Summarization(bart-large-cnn) 摘要 → m2m100 译中 调用链。
// mock env.AI.run 返回英文摘要 + 中文翻译, 断言最终输出为中文摘要。
import { summarizeZh, translateTextZh } from '../src/translate';

function mockEnv() {
  const calls: [string, unknown][] = [];
  return {
    env: {
      AI: {
        run: async (model: string, input: unknown) => {
          calls.push([model, input]);
          if (model === '@cf/facebook/bart-large-cnn') return { summary: 'This is a summary of the long article.' };
          if (model === '@cf/meta/m2m100-1.2b') return { translated_text: '这是长文章的摘要。' };
          return {};
        },
      } as any,
    },
    calls,
  };
}

describe('summarizeZh (CF Summarization)', () => {
  it('长文 → bart-large-cnn 摘要 → m2m100 译中, 返回中文摘要', async () => {
    const { env, calls } = mockEnv();
    const zh = await summarizeZh(env as any, 'long article text '.repeat(50));
    expect(zh).toBe('这是长文章的摘要。');
    const models = calls.map(([m]) => m);
    expect(models).toContain('@cf/facebook/bart-large-cnn');
    expect(models).toContain('@cf/meta/m2m100-1.2b');
  });

  it('摘要模型失败 → null(调用方回退原文截断)', async () => {
    const env = { AI: { run: async () => { throw new Error('quota'); } } as any };
    const zh = await summarizeZh(env as any, 'text');
    expect(zh).toBeNull();
  });

  it('translateTextZh 直译存活(短帖回退路径)', async () => {
    const env = { AI: { run: async (m: string) => ({ translated_text: '这是一段中文翻译内容，用于测试。', }) } as any } as any;
    const zh = await translateTextZh(env, 'hello world this is a test sentence for translation');
    expect(zh).toContain('中文');
  });
});