// translate 深覆盖: OpenRouter 三模型回退(generateTitleZh/generateTagsZh/translateTextZh)
// + 四级链 Google 两种响应形态 / MyMemory 额度警告 / TranSmart ret_code 失败。
// 与 chain-order.test.ts(WorkersAI↔TranSmart)互补。
import { describe, it, expect, beforeEach } from 'vitest';
import { generateTitleZh, generateTagsZh, translateTextZh, translateBatch, isChinese } from '../src/translate';

const origFetch = globalThis.fetch;
let aiThrows = false;

const mkEnv = (extra: Record<string, unknown> = {}) => ({
  OPENROUTER_API_KEY: 'sk-or', AI: { run: async () => { if (aiThrows) throw new Error('ai down'); return { translated_text: '这是翻译出来的中文文本' }; } },
  CACHE: {}, ...extra,
}) as never;

// OpenRouter 响应构造器
const orOk = (content: string) => new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
const orErr = (status: number) => new Response('err', { status });

beforeEach(() => {
  globalThis.fetch = origFetch;
  aiThrows = false;
});

describe('generateTitleZh: OpenRouter 多模型回退', () => {
  it('首模型命中 → 直接返回', async () => {
    const seen: string[] = [];
    globalThis.fetch = (async (_i: RequestInfo | URL, init?: RequestInit) => {
      seen.push(String(_i));
      const body = JSON.parse(String(init?.body ?? '{}'));
      return orOk(`这是生成的中文标题` + (body.model.includes('minimax') ? '' : 'X'));
    }) as typeof fetch;
    expect(await generateTitleZh(mkEnv(), 'some english text')).toBe('这是生成的中文标题');
    expect(seen.length).toBe(1);
  });
  it('首模型 429 → 落第二模型', async () => {
    let n = 0;
    globalThis.fetch = (async () => {
      n++;
      return n === 1 ? orErr(429) : orOk('这是第二模型的中文标题');
    }) as typeof fetch;
    expect(await generateTitleZh(mkEnv(), 'some english text')).toBe('这是第二模型的中文标题');
    expect(n).toBe(2);
  });
  it('输出非中文(守卫) → 落下一模型; 全非中文 → null', async () => {
    let n = 0;
    globalThis.fetch = (async () => { n++; return orOk('english only output'); }) as typeof fetch;
    expect(await generateTitleZh(mkEnv(), 'some english text')).toBeNull();
    expect(n).toBe(3); // 三个模型全试
  });
  it('输出过短(≤3字) → 视为失败', async () => {
    globalThis.fetch = (async () => orOk('好')) as typeof fetch;
    expect(await generateTitleZh(mkEnv(), 'text')).toBeNull();
  });
  it('fetch 网络抛错 → 逐模型重试后 null', async () => {
    let n = 0;
    globalThis.fetch = (async () => { n++; throw new Error('net'); }) as typeof fetch;
    expect(await generateTitleZh(mkEnv(), 'text')).toBeNull();
    expect(n).toBe(3);
  });
  it('无 key → null 不打网', async () => {
    let hit = false;
    globalThis.fetch = (async () => { hit = true; return orOk('中文'); }) as typeof fetch;
    expect(await generateTitleZh(mkEnv({ OPENROUTER_API_KEY: undefined }), 'text')).toBeNull();
    expect(hit).toBe(false);
  });
});

describe('generateTagsZh: 标签解析', () => {
  it('正常输出 → 抽取英文标签', async () => {
    globalThis.fetch = (async () => orOk('rust cli tool')) as typeof fetch;
    expect(await generateTagsZh(mkEnv(), 'text')).toEqual(['rust', 'cli', 'tool']);
  });
  it('输出超 4 个 → 截到 4', async () => {
    globalThis.fetch = (async () => orOk('rust cli tool dev web database')) as typeof fetch;
    expect(await generateTagsZh(mkEnv(), 'text')).toHaveLength(4);
  });
  it('纯中文输出(无标签词) → 空数组', async () => {
    globalThis.fetch = (async () => orOk('这是纯中文输出没有标签')) as typeof fetch;
    expect(await generateTagsZh(mkEnv(), 'text')).toEqual([]);
  });
  it('OpenRouter 全挂 → null', async () => {
    globalThis.fetch = (async () => orErr(500)) as typeof fetch;
    expect(await generateTagsZh(mkEnv(), 'text')).toBeNull();
  });
  it('无 key → null', async () => {
    expect(await generateTagsZh(mkEnv({ OPENROUTER_API_KEY: undefined }), 'text')).toBeNull();
  });
});

describe('translateTextZh: OpenRouter 优先落四级链', () => {
  it('OpenRouter 命中 → 直接返回, 不走四级链', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).includes('openrouter.ai')) return orOk('这是OpenRouter的中文译文');
      throw new Error('should not reach fallback chain');
    }) as typeof fetch;
    expect(await translateTextZh(mkEnv(), 'english text here')).toBe('这是OpenRouter的中文译文');
  });
  it('OpenRouter 全挂 → 落四级链(Workers AI)', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      if (String(input).includes('openrouter.ai')) return orErr(503);
      throw new Error('unexpected fallback fetch');
    }) as typeof fetch;
    // AI.run 出中文 → 四级链第一级命中
    expect(await translateTextZh(mkEnv(), 'english text here')).toBe('这是翻译出来的中文文本');
  });
  it('中文输入 → 原样返回不翻译', async () => {
    expect(await translateTextZh(mkEnv(), '这是已经是中文的输入文本')).toBe('这是已经是中文的输入文本');
  });
  it('styleExtra 追加到 system prompt', async () => {
    let sys = '';
    globalThis.fetch = (async (_i: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}'));
      sys = body.messages[0].content;
      return orOk('这是带风格的中文译文');
    }) as typeof fetch;
    await translateTextZh(mkEnv(), 'english text', '改写为项目介绍句式');
    expect(sys).toContain('改写为项目介绍句式');
  });
  it('空文本 → 原样返回(不做翻译调用)', async () => {
    let hit = false;
    globalThis.fetch = (async () => { hit = true; return orOk('x'); }) as typeof fetch;
    expect(await translateTextZh(mkEnv(), '   ')).toBe('   ');
    expect(hit).toBe(false);
  });
});

describe('translateBatch 四级链深分支', () => {
  it('WorkersAI+TranSmart 全挂 → Google 数组形态["译文"] 命中', async () => {
    aiThrows = true;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = String(input);
      if (u.includes('transmart.qq.com')) return new Response(JSON.stringify({ header: { ret_code: 'fail' } }), { status: 200 });
      if (u.includes('clients5.google.com')) return new Response(JSON.stringify(['这是谷歌翻译的中文内容']), { status: 200 });
      throw new Error(`unexpected ${u}`);
    }) as typeof fetch;
    const [out] = await translateBatch(mkEnv(), [{ title: 'a', url: '', desc: 'english desc here' } as any]);
    expect(out.descZh).toBe('这是谷歌翻译的中文内容');
  });
  it('Google 嵌套形态[["原文","译文"]] → 取 [0][1]', async () => {
    aiThrows = true;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes('transmart.qq.com')) return new Response(JSON.stringify({ header: { ret_code: 'fail' } }), { status: 200 });
      if (u.includes('clients5.google.com')) return new Response(JSON.stringify([['english desc here', '这是嵌套形态的中文内容']]), { status: 200 });
      throw new Error(`unexpected ${u}`);
    }) as typeof fetch;
    const [out] = await translateBatch(mkEnv(), [{ title: 'a', url: '', desc: 'english desc here' } as any]);
    expect(out.descZh).toBe('这是嵌套形态的中文内容');
  });
  it('Google 坏形态 → 抛 → 落 MyMemory', async () => {
    aiThrows = true;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes('transmart.qq.com')) return new Response(JSON.stringify({ header: { ret_code: 'fail' } }), { status: 200 });
      if (u.includes('clients5.google.com')) return new Response(JSON.stringify({ unexpected: 'shape' }), { status: 200 });
      if (u.includes('mymemory.translated.net')) return new Response(JSON.stringify({ responseData: { translatedText: '这是MyMemory的中文内容' }, responseStatus: 200 }), { status: 200 });
      throw new Error(`unexpected ${u}`);
    }) as typeof fetch;
    const [out] = await translateBatch(mkEnv(), [{ title: 'a', url: '', desc: 'english desc here' } as any]);
    expect(out.descZh).toBe('这是MyMemory的中文内容');
  });
  it('MyMemory 额度警告(WARNING 文案) → 抛 → 全链失败保原文', async () => {
    aiThrows = true;
    const errors: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes('transmart.qq.com')) return new Response(JSON.stringify({ header: { ret_code: 'fail' } }), { status: 200 });
      if (u.includes('clients5.google.com')) return orErr(429);
      if (u.includes('mymemory.translated.net')) return new Response(JSON.stringify({ responseData: { translatedText: 'MYMEMORY WARNING: YOU USED ALL AVAILABLE FREE QUERIES' } }), { status: 200 });
      throw new Error(`unexpected ${u}`);
    }) as typeof fetch;
    const [out] = await translateBatch(mkEnv(), [{ title: 'a', url: '', desc: 'english desc here' } as any], errors);
    expect(out.descZh).toBeUndefined(); // 英文原文兜底
    expect(errors.length).toBe(4); // workersAI/tranSmart/google/myMemory 全记
  });
  it('TranSmart ret_code 非 succ → 抛', async () => {
    aiThrows = true;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes('transmart.qq.com')) return new Response(JSON.stringify({ header: { ret_code: 'error' } }), { status: 200 });
      throw new Error(`unexpected ${u}`);
    }) as typeof fetch;
    const errors: string[] = [];
    await translateBatch(mkEnv(), [{ title: 'a', url: '', desc: 'english desc here' } as any], errors);
    expect(errors.some((e) => e.startsWith('tranSmart:') || e.startsWith('google:') || e.startsWith('myMemory:'))).toBe(true);
  });
  it('WorkersAI 半数失败(<ceil(1/2)) → 抛落 TranSmart', async () => {
    // 单条: 空译文 1/1 < ceil(1/2)=1 → 抛
    globalThis.fetch = (async () => { throw new Error('no external'); }) as typeof fetch;
    const envBad = { OPENROUTER_API_KEY: undefined, AI: { run: async () => ({ translated_text: '' }) }, CACHE: {} } as never;
    const errors: string[] = [];
    const [out] = await translateBatch(envBad, [{ title: 'a', url: '', desc: 'english desc here' } as any], errors);
    expect(out.descZh).toBeUndefined();
    expect(errors[0]).toContain('workersAI');
  });
  it('补翻: WorkersAI 输出英文 + TranSmart 补成功 → 回填中文', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes('transmart.qq.com')) return new Response(JSON.stringify({ header: { ret_code: 'succ' }, auto_translation: ['这是补翻的中文内容'] }), { status: 200 });
      throw new Error(`unexpected ${u}`);
    }) as typeof fetch;
    const envEn = { OPENROUTER_API_KEY: undefined, AI: { run: async () => ({ translated_text: 'still english output' }) }, CACHE: {} } as never;
    const [out] = await translateBatch(envEn, [{ title: 'a', url: '', desc: 'english desc here' } as any]);
    expect(out.descZh).toBe('这是补翻的中文内容');
  });
  it('补翻后仍非中文 → 不回填', async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const u = String(input);
      if (u.includes('transmart.qq.com')) return new Response(JSON.stringify({ header: { ret_code: 'succ' }, auto_translation: ['still english'] }), { status: 200 });
      throw new Error(`unexpected ${u}`);
    }) as typeof fetch;
    const envEn = { OPENROUTER_API_KEY: undefined, AI: { run: async () => ({ translated_text: 'still english output' }) }, CACHE: {} } as never;
    const [out] = await translateBatch(envEn, [{ title: 'a', url: '', desc: 'english desc here' } as any]);
    expect(out.descZh).toBeUndefined();
  });
  it('空 descs → 直接返回原数组(不打网)', async () => {
    let hit = false;
    globalThis.fetch = (async () => { hit = true; return orOk('x'); }) as typeof fetch;
    const items = [{ title: 'a', url: '' } as any];
    expect(await translateBatch(mkEnv(), items)).toBe(items);
    expect(hit).toBe(false);
  });
  it('isChinese 导出与阈值行为一致', () => {
    expect(isChinese('这是一段中文内容')).toBe(true);
    expect(isChinese('short')).toBe(false);
  });
});