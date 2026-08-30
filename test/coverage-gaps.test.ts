// 覆盖缺口收口: 小单元直测(answerCallbackQuery / articleToText / HN 缺字段兜底 /
// 翻译链低层响应形态 / summarizeZhDeep QUOTE 拆分 / lookup 低层故障分支)。纯 stub, 不触网。
import { describe, it, expect, vi } from 'vitest';
import { answerCallbackQuery } from '../src/notify';
import { articleToText } from '../src/fxtweet';
import { fetchHackerNewsProducts } from '../src/sources/hn';
import { translateTextZh, summarizeZhDeep } from '../src/translate';
import { saveToWayback, shouldReprocess, markProcessed, extractRepoRefs, indexArchivedItems, backfillDescriptions, refreshLookupDescriptions } from '../src/lookup';
import { makeEnv, makeCallLog, runScheduled } from '../scripts/manual/runner';

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
      if (u.includes('transmart.qq.com')) return new Response(JSON.stringify({ auto_translation: ['腾讯翻译的中文'], header: { ret_code: 'succ' } }), { status: 200 });
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

describe('saveToWayback: 静默语义', () => {
  it('无 url → 立即 resolve', async () => {
    await expect(saveToWayback(undefined)).resolves.toBeUndefined();
  });
  it('fetch 抛错 → 静默 resolve 不上抛', async () => {
    globalThis.fetch = (async () => { throw new Error('net down'); }) as typeof fetch;
    await expect(saveToWayback('https://example.com/a')).resolves.toBeUndefined();
  });
});

describe('shouldReprocess / markProcessed: KV 写故障', () => {
  const badKv = { get: async () => null, put: async () => { throw new Error('kv down'); } } as any;
  it('占位 put 抛错 → 仍按 first 返回', async () => {
    await expect(shouldReprocess(badKv, 'https://example.com/x')).resolves.toBe('first');
  });
  it('markProcessed put 抛错 → 静默不上抛', async () => {
    await expect(markProcessed(badKv, 'https://example.com/x', true, true, 'stamp', '标题', '摘要')).resolves.toBeUndefined();
  });
});

describe('extractRepoRefs: 剥 .git / 滤文件路径 / 去重', () => {
  it('混合引用只留干净 owner/repo(去重按原始捕获, 剥 .git 后不合并)', () => {
    const refs = extractRepoRefs('看 https://github.com/a/b.git 与 https://github.com/c/d/blob/main/x.ts');
    expect(refs).toEqual(['a/b', 'c/d']);
  });
  it('无引用 → 空数组', () => {
    expect(extractRepoRefs('no links here')).toEqual([]);
  });
});

describe('indexArchivedItems: 空列表与索引新建', () => {
  const mkKv = () => {
    const store = new Map<string, string>();
    return { store, CACHE: { get: async (k: string) => store.get(k) ?? null, put: async (k: string, v: string) => { store.set(k, v); } } } as any;
  };
  it('items 空 → 不写 search:index', async () => {
    const kv = mkKv();
    await indexArchivedItems(kv, [], '2026-08-29');
    expect(kv.store.has('search:index')).toBe(false);
  });
  it('search:index 缺失 → 新建并追加条目', async () => {
    const kv = mkKv();
    await indexArchivedItems(kv, [{ title: 'a/b', url: 'https://github.com/a/b', desc: 'en desc', descZh: '中文描述内容' } as any], '2026-08-29');
    const entries = JSON.parse(kv.store.get('search:index')!);
    expect(entries).toHaveLength(1);
    expect(entries[0][1]).toBe('a/b');
    expect(entries[0][4]).toBe('中文描述内容');
  });
});

describe('lookup 低层补测: saveToWayback / backfill / refresh / index 去重', () => {
  it('saveToWayback 200 → 消费响应体后 resolve', async () => {
    let textRead = false;
    globalThis.fetch = (async () => ({ text: async () => { textRead = true; return 'saved'; } })) as unknown as typeof fetch;
    await expect(saveToWayback('https://example.com/b')).resolves.toBe('saved');
    expect(textRead).toBe(true);
  });
  it('响应体 text() 拒绝 → 内层 catch 兜底空串', async () => {
    globalThis.fetch = (async () => ({ text: () => Promise.reject(new Error('body down')) })) as unknown as typeof fetch;
    await expect(saveToWayback('https://example.com/c')).resolves.toBe('');
  });

  it('backfill: repoKey get 抛错视为未缓存 / put 抛错静默 / 中文 desc 跳过', async () => {
    globalThis.fetch = (async () => new Response('{}', { status: 200 })) as typeof fetch;
    const entries = [
      ['star', 'aa/bb', '', 'hay', '已有中文描述内容'], // desc 中文 → 跳过
      ['star', 'cc/dd', '', 'hay', ''], // repoKey get 抛错 → 视为未缓存 → deepwiki miss → put 抛错静默
    ];
    const store = new Map<string, string>([['search:index', JSON.stringify(entries)]]);
    const kv = {
      get: async (k: string) => { if (k === 'lookup:desc:cc/dd') throw new Error('get down'); return store.get(k) ?? null; },
      put: async (k: string, v: string) => { if (k.startsWith('lookup:desc:')) throw new Error('put down'); store.set(k, v); },
    } as any;
    await backfillDescriptions({ CACHE: kv } as any, 5);
    expect(store.has('lookup:desc:cc/dd')).toBe(false); // put 失败被 .catch 吞掉
  });

  it('refresh: 未过期条目 → 跳过保持旧值', async () => {
    globalThis.fetch = (async () => new Response('{}', { status: 200 })) as typeof fetch;
    const fresh = JSON.stringify({ zh: '新中文描述内容', ts: Date.now() });
    const store = new Map<string, string>([['lookup:desc:aa/bb', fresh]]);
    const kv = {
      list: async ({ prefix }: any) => ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: string) => { store.set(k, v); },
    } as any;
    await refreshLookupDescriptions({ CACHE: kv } as any);
    expect(store.get('lookup:desc:aa/bb')).toBe(fresh);
  });

  it('indexArchivedItems: 重复条目幂等跳过', async () => {
    const store = new Map<string, string>();
    const kv = { CACHE: { get: async (k: string) => store.get(k) ?? null, put: async (k: string, v: string) => { store.set(k, v); } } } as any;
    const item = [{ title: 'a/b', url: 'https://github.com/a/b', descZh: '中文描述内容' }] as any;
    await indexArchivedItems(kv, item, '2026-08-29');
    await indexArchivedItems(kv, item, '2026-08-29');
    const entries = JSON.parse(store.get('search:index')!);
    expect(entries).toHaveLength(1);
  });
});

describe('runner.makeEnv: CACHE mock 完整性', () => {
  it('store 访问器 + delete 可用', async () => {
    const env = makeEnv();
    await env.CACHE.put('k1', 'v1');
    expect(env.CACHE.store.get('k1')).toBe('v1');       // get store() 访问器
    await env.CACHE.delete('k1');                        // delete 路径
    expect(await env.CACHE.get('k1')).toBeNull();
    expect((await env.CACHE.list({ prefix: 'k' })).keys).toEqual([]);
  });
});

describe('runner.runScheduled: cron 场景驱动 scheduled', () => {
  it('scheduled 走 waitUntil 收集 + harvest 出 sys 开场步', async () => {
    const env = makeEnv();
    const fetcher = makeCallLog();
    const sc = await runScheduled(env, fetcher, '10', '每日自动推送', 'cron');
    expect(sc.id).toBe('10');
    expect(sc.steps[0]).toMatchObject({ actor: 'user', sys: true }); // sys 伪步开场
    expect(sc.steps[0].text).toContain('08:30');
  });
});
