// 翻译链路单测: isChinese 判定 + translateTextZh 单段 + resolveDescriptions 四级降级。
// 全部 mock env / mock fetch, 不打真实网络。
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isChinese, translateTextZh, resolveDescriptions } from '../src/translate';
import type { SourceItem } from '../src/types';

// mock zread / deepwiki 抓取器(供 resolveDescriptions 四级降级用)
const mockZread = vi.fn();
const mockDw = vi.fn();
vi.mock('../src/zread', () => ({ fetchZreadBatch: (...a: unknown[]) => mockZread(...a) }));
vi.mock('../src/deepwiki', () => ({ fetchDeepwikiBatch: (...a: unknown[]) => mockDw(...a) }));

// ---------- isChinese: CJK≥5 且占比>30% ----------
describe('isChinese: CJK 判定边界', () => {
  // 已知 bug(只报告不修): cjk>=5 门槛把 4 个汉字的纯中文串全部拒掉。
  // 规格期望 你好世界/测试测试 → true(两者都是 4 个 CJK), 与 CJK>=4 的门槛自洽;
  // 当前实现返回 false。it.fails: 修好门槛后此测试自动变红, 提示升级为常规断言。
  it.fails('已知 bug: 纯中文"你好世界"(4 CJK) → 期望 true, 实际 false', () => {
    expect(isChinese('你好世界')).toBe(true);
  });
  it.fails('已知 bug: 纯中文"测试测试"(4 CJK) → 期望 true, 实际 false', () => {
    expect(isChinese('测试测试')).toBe(true);
  });
  it('纯英文 → false', () => {
    expect(isChinese('hello world')).toBe(false);
  });
  it('混合: Hello 你好 world → 依规则判定', () => {
    // CJK=2(<5) → false
    expect(isChinese('Hello 你好 world')).toBe(false);
  });
  it('CJK<5 边界 → false("测试" CJK=2)', () => {
    expect(isChinese('测试')).toBe(false);
  });
  it.fails('已知 bug: 纯中文"测试测试"(4 CJK) → 期望 true, 实际 false', () => {
    expect(isChinese('测试测试')).toBe(true);
  });
  it('URL 稀释: 5个CJK被4个URL稀释占比 → false(已知坑)', () => {
    const s = '项目是好的 → http://github.com/a/b → http://github.com/c/d → http://github.com/e/f → http://github.com/g/h';
    // 5 个汉字(项,目,是,好,的) 虽过 cjk>=5, 但占比被 URL 稀释 <30% → false
    expect(isChinese(s)).toBe(false);
  });
  it('空字符串 → false', () => {
    expect(isChinese('')).toBe(false);
  });
  it('null/undefined → false', () => {
    expect(isChinese(null)).toBe(false);
    expect(isChinese(undefined)).toBe(false);
  });
  it('emoji + 5个中文 → true', () => {
    expect(isChinese('🎉 测试 测试 测试 测试 测试')).toBe(true);
  });
});

// ---------- translateTextZh: 单段翻译, mock env 不触网 ----------
describe('translateTextZh', () => {
  it('OPENROUTER_API_KEY 未设置 → 返回 null(不打网络)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('should not fetch'); }));
    const env = {} as any; // 无 key, 无 AI → 四级链全挂
    const zh = await translateTextZh(env, 'hello world this is a plain english sentence');
    expect(zh).toBeNull();
  });

  it('key 已设置但 AI.run 抛错 → 四级链失败返回 null', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net down'); }));
    const env = {
      OPENROUTER_API_KEY: 'test-key',
      AI: { run: async () => { throw new Error('AI quota'); } },
    } as any;
    const zh = await translateTextZh(env, 'some english text to translate here');
    expect(zh).toBeNull();
  });

  it('isChinese(text) 为 true → 直接返回原文, 不调用翻译', async () => {
    const aiRun = vi.fn();
    const env = { OPENROUTER_API_KEY: 'x', AI: { run: aiRun } } as any;
    const zh = await translateTextZh(env, '这是一句已经足够长的中文内容不需要翻译');
    expect(zh).toBe('这是一句已经足够长的中文内容不需要翻译');
    expect(aiRun).not.toHaveBeenCalled(); // 跳过 WorkersAI/四级链
  });

  it('styleExtra 透传到 system prompt 且 text.slice(0,3000) 截断', async () => {
    const env = { OPENROUTER_API_KEY: 'test-key' } as any;
    let captured: any = null;
    globalThis.fetch = vi.fn(async (_url: string, init?: RequestInit) => {
      captured = JSON.parse(String(init?.body ?? '{}'));
      return new Response(JSON.stringify({
        choices: [{ message: { content: '这是翻译后的中文输出内容足够长' } }],
      }), { status: 200 });
    }) as typeof fetch;

    const STYLE = '改写为项目介绍(仿百科条目, 2-3句, 信息量足)';
    const longText = 'word '.repeat(800); // 4000 字符, 超过 3000 截断
    const zh = await translateTextZh(env, longText, STYLE);
    expect(zh).toContain('翻译后的中文');

    // system prompt 含 styleExtra
    expect(captured.messages[0].role).toBe('system');
    expect(captured.messages[0].content).toContain(STYLE);
    // user content 被截断到 3000
    expect(captured.messages[1].role).toBe('user');
    expect(captured.messages[1].content.length).toBe(3000);
    expect(captured.messages[1].content).toBe(longText.slice(0, 3000));
  });
});

// ---------- resolveDescriptions: 四级降级 mock 环境 ----------
describe('resolveDescriptions', () => {
  const ZH_TL = '这是翻译后的中文描述内容足够长';
  const fakeEnv = { AI: { run: vi.fn(async () => ({ translated_text: ZH_TL })) } } as any;
  const mkItem = (title: string, desc: string, descZh?: string | null) =>
    ({ title, url: `https://github.com/${title}`, stars: 1000, desc, descZh }) as SourceItem;

  beforeEach(() => {
    mockZread.mockReset();
    mockDw.mockReset();
    fakeEnv.AI.run.mockClear();
  });

  it('全部已有 descZh → 不调用翻译(AI.run 不动), zread/dw 也不必再补', async () => {
    mockZread.mockResolvedValue(new Map());
    mockDw.mockResolvedValue(new Map());
    const items = [mkItem('a/b', 'desc', '已有的中文描述内容足够长')];
    await resolveDescriptions(fakeEnv, items);
    expect(items[0].descZh).toBe('已有的中文描述内容足够长');
    expect(fakeEnv.AI.run).not.toHaveBeenCalled();
  });

  it('zread 命中但 deepwiki 缺 → descZh 由 zread 补(中文 wiki 直用)', async () => {
    const zhWiki = 'Codex CLI 是 OpenAI 的开源编码 Agent，可在本地运行。';
    mockZread.mockResolvedValue(new Map([['openai/codex', zhWiki]]));
    mockDw.mockResolvedValue(new Map());
    const items = [mkItem('openai/codex', 'A CLI tool from OpenAI.')];
    await resolveDescriptions(fakeEnv, items);
    expect(items[0].descZh).toBe(zhWiki);
    expect(isChinese(items[0].descZh!)).toBe(true);
  });

  it('deepwiki 命中但 zread 缺 → descZh 由 deepwiki 英文经翻译补', async () => {
    mockZread.mockResolvedValue(new Map());
    mockDw.mockImplementation(async (repos: string[]) =>
      new Map(repos.map((r) => [r, `${r} is a harness-native operator system for agentic work.`])),
    );
    const items = [mkItem('affaan-m/ECC', 'short desc')];
    await resolveDescriptions(fakeEnv, items);
    expect(items[0].descZh).toBe(ZH_TL); // WorkersAI 假翻译
    expect(isChinese(items[0].descZh!)).toBe(true);
    expect(fakeEnv.AI.run).toHaveBeenCalled(); // 翻译层确实跑了
  });

  it('两者都缺 → descZh 留 undefined(不硬凑 repo 一句话)', async () => {
    mockZread.mockResolvedValue(new Map());
    mockDw.mockResolvedValue(new Map());
    const items = [mkItem('some/repo', 'Original English repository description.')];
    await resolveDescriptions(fakeEnv, items);
    expect(items[0].descZh).toBeUndefined();
    expect(fakeEnv.AI.run).not.toHaveBeenCalled();
  });

  it('descZh=null 与 undefined 处理一致(均视为缺失, 均不被硬凑)', async () => {
    // 下游消费者(render.ts / lookup.ts / search-index.ts)全部用真值判断或 isChinese 守卫,
    // null 与 undefined 在渲染/搜索/归档行为上等价。这里断言语义一致性, 不断言归一化。
    mockZread.mockResolvedValue(new Map());
    mockDw.mockResolvedValue(new Map());
    const itemsNull = [mkItem('a/b', 'desc', null)];
    const itemsUndef = [mkItem('c/d', 'desc', undefined)];
    await resolveDescriptions(fakeEnv, itemsNull);
    await resolveDescriptions(fakeEnv, itemsUndef);
    // 两者都未命中 → 均被跳过、均未触发翻译、均未硬凑 repo 一句话
    expect(fakeEnv.AI.run).not.toHaveBeenCalled();
    expect(isChinese(itemsNull[0].descZh ?? '')).toBe(false);
    expect(isChinese(itemsUndef[0].descZh ?? '')).toBe(false);
    // 断言语义等价: 两者在下游 `!!it.descZh` 与 `it.descZh ?? ''` 下行为相同
    expect(!!itemsNull[0].descZh).toBe(false);
    expect(!!itemsUndef[0].descZh).toBe(false);
  });
});
