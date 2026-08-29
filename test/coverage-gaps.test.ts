// 覆盖缺口收口: 小单元直测(answerCallbackQuery / articleToText / HN 缺字段兜底 /
// 翻译链低层响应形态 / summarizeZhDeep QUOTE 拆分)。纯 stub, 不触网。
import { describe, it, expect, vi } from 'vitest';
import { answerCallbackQuery } from '../src/notify';
import { articleToText } from '../src/fxtweet';
import { fetchHackerNewsProducts } from '../src/sources/hn';
import { translateTextZh, summarizeZhDeep } from '../src/translate';

describe('answerCallbackQuery', () => {
  it('POST callback_query_id; 网络错静默不抛', async () => {
    const bodies: any[] = [];
    let shouldThrow = false;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (shouldThrow) throw new Error('net down');
      bodies.push({ url: String(input), body: JSON.parse(String(init?.body ?? '{}')) });
      return new Response('{}', { status: 200 });
    }) as typeof fetch;
    await answerCallbackQuery('t', 'cq42');
    expect(bodies[0].url).toContain('/answerCallbackQuery');
    expect(bodies[0].body.callback_query_id).toBe('cq42');
    shouldThrow = true;
    await expect(answerCallbackQuery('t', 'cq42')).resolves.toBeUndefined();
  });
});

describe('articleToText', () => {
  const mk = (blocks: { text?: string }[]) => ({ article: { content: { blocks } } }) as any;
  it('blocks 文本拼接, 空白段过滤', () => {
    expect(articleToText(mk([{ text: '第一段' }, {}, { text: '  ' }, { text: '第二段' }]))).toBe('第一段\n\n第二段');
  });
  it('全空 blocks → null', () => {
    expect(articleToText(mk([{}, { text: ' ' }]))).toBeNull();
  });
  it('无 article → null', () => {
    expect(articleToText({} as any)).toBeNull();
  });
});

describe('fetchHackerNewsProducts: 缺字段兜底', () => {
  it('无 url → HN item 链接; story_text null → 空 desc; 无 points → 无 stars', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ hits: [
      { title: 'No URL post', objectID: '42', author: 'a', created_at: '2026-08-29T00:00:00Z' },
    ] }), { status: 200 })) as typeof fetch;
    const items = await fetchHackerNewsProducts();
    expect(items[0].url).toBe('https://news.ycombinator.com/item?id=42');
    expect(items[0].desc).toBe('');
    expect(items[0].stars).toBeUndefined();
  });
  it('非 200 → 抛给调用方(Actions 侧失败通知兜底)', async () => {
    globalThis.fetch = (async () => new Response('err', { status: 503 })) as typeof fetch;
    await expect(fetchHackerNewsProducts()).rejects.toThrow('hn algolia 503');
  });
});

describe('translateTextZh: TranSmart/Google/MyMemory 响应形态', () => {
  const skipAiEnv = { AI: { run: async () => { throw new Error('skip ai'); } }, CACHE: {} } as any;
  it('TranSmart auto_translation 数组 → 译文', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes('transmart.qq.com')) return new Response(JSON.stringify({ auto_translation: ['腾讯翻译的中文'] }), { status: 200 });
      throw new Error(`unexpected ${u}`);
    }) as typeof fetch;
    expect(await translateTextZh(skipAiEnv, 'hello world')).toBe('腾讯翻译的中文');
  });
  it('Google 嵌套形态 [[原文,译文]]', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes('transmart.qq.com')) throw new Error('skip');
      if (u.includes('clients5.google.com')) return new Response(JSON.stringify([['hello', '谷歌嵌套译文']]), { status: 200 });
      throw new Error(`unexpected ${u}`);
    }) as typeof fetch;
    expect(await translateTextZh(skipAiEnv, 'hello')).toBe('谷歌嵌套译文');
  });
  it('Google 扁平形态 [译文]', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes('transmart.qq.com')) throw new Error('skip');
      if (u.includes('clients5.google.com')) return new Response(JSON.stringify(['谷歌扁平译文']), { status: 200 });
      throw new Error(`unexpected ${u}`);
    }) as typeof fetch;
    expect(await translateTextZh(skipAiEnv, 'hello')).toBe('谷歌扁平译文');
  });
  it('MyMemory responseData → 译文', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes('transmart.qq.com') || u.includes('clients5.google.com')) throw new Error('skip');
      if (u.includes('api.mymemory.translated.net')) return new Response(JSON.stringify({ responseData: { translatedText: '记忆库译文' } }), { status: 200 });
      throw new Error(`unexpected ${u}`);
    }) as typeof fetch;
    expect(await translateTextZh(skipAiEnv, 'hello memory')).toBe('记忆库译文');
  });
});

describe('summarizeZhDeep: QUOTE 拆分', () => {
  it('内容含 QUOTE → 摘要与引用分离', async () => {
    globalThis.fetch = (async () => new Response(JSON.stringify({ choices: [{ message: { content: '这是一段足够长的深度摘要内容, 描述文章核心观点与论据。\n\nQUOTE: 这是被拆分出来的原文引用句子' } }] }), { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch;
    const out = await summarizeZhDeep({ OPENROUTER_API_KEY: 'sk' } as any, '文章正文');
    expect(out?.summaryZh).toContain('深度摘要内容');
    expect(out?.quote).toContain('原文引用句子');
  });
  it('首模型 500 → 下一模型兜底', async () => {
    let n = 0;
    globalThis.fetch = (async () => {
      n++;
      if (n === 1) return new Response('err', { status: 500 });
      return new Response(JSON.stringify({ choices: [{ message: { content: '第二模型的深度摘要内容, 足够长以通过校验。' } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof fetch;
    const out = await summarizeZhDeep({ OPENROUTER_API_KEY: 'sk' } as any, '文章正文');
    expect(out?.summaryZh).toContain('第二模型');
    expect(n).toBe(2);
  });
});
