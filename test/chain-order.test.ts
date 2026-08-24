// 兜底链顺序测试(集成级): mock zread/deepwiki 抓取器 + WorkersAI,
// 验证 resolveDescriptions 严格按 ①zread中文 → ②deepwiki英文→翻译 → ③repo desc翻译 依次兜底。
import { describe, it, expect, vi, beforeEach } from 'vitest';

// 抓取器 mock: 每个测试用例改写 mockZread/mockDw 控制命中
const mockZread = vi.fn();
const mockDw = vi.fn();
vi.mock('../src/zread', () => ({
  fetchZreadBatch: (...a: unknown[]) => mockZread(...a),
}));
vi.mock('../src/deepwiki', () => ({
  fetchDeepwikiBatch: (...a: unknown[]) => mockDw(...a),
}));

import { resolveDescriptions, isChinese } from '../src/translate';

// fake Env: WorkersAI 永远返回中文译文(不触网)
const ZH_TL = '这是翻译后的中文描述内容足够长';
const fakeEnv = {
  AI: { run: vi.fn(async () => ({ translated_text: ZH_TL })) },
} as any;

const item = (title: string, desc: string) =>
  ({ title, url: `https://github.com/${title}`, stars: 1000, desc, descZh: undefined }) as any;

beforeEach(() => {
  mockZread.mockReset();
  mockDw.mockReset();
  fakeEnv.AI.run.mockClear();
});

describe('兜底链顺序: zread → deepwiki → repo desc 翻译', () => {
  it('① zread 中文命中: 直接用, 不调 deepwiki, 不触发翻译', async () => {
    const zhWiki = 'Codex CLI 是 OpenAI 的开源编码 Agent，可在本地运行。';
    mockZread.mockResolvedValue(new Map([['openai/codex', zhWiki]]));
    mockDw.mockResolvedValue(new Map());

    const items = [item('openai/codex', 'A CLI tool from OpenAI.')];
    await resolveDescriptions(fakeEnv, items);

    expect(isChinese(items[0].descZh)).toBe(true);
    expect(items[0].descZh).toBe(zhWiki); // 就是 zread 原文
    expect(mockDw).not.toHaveBeenCalled(); // 不落二级
    expect(fakeEnv.AI.run).not.toHaveBeenCalled(); // 不触发翻译
  });

  it('② zread 缺失 → deepwiki 英文命中 → 翻译成中文; deepwiki 只收到缺失条目', async () => {
    mockZread.mockResolvedValue(new Map()); // zread 全空
    mockDw.mockImplementation(async (repos: string[]) =>
      new Map(repos.map((r) => [r, `${r} is a harness-native operator system for agentic work.`])),
    );

    const items = [item('affaan-m/ECC', 'short desc'), item('apache/maka', 'another desc')];
    await resolveDescriptions(fakeEnv, items);

    // 二级被调用且只含缺失条目(zread 全缺 → 两个都在, 且受5条上限约束)
    expect(mockDw).toHaveBeenCalled();
    const asked = mockDw.mock.calls[0][0] as string[];
    expect(asked.sort()).toEqual(['affaan-m/ECC', 'apache/maka']);

    // 终态: 翻译层产出中文
    for (const it of items) expect(isChinese(it.descZh)).toBe(true);
    expect(fakeEnv.AI.run).toHaveBeenCalled(); // 翻译确实跑了
  });

  it('③ zread+deepwiki 双缺 → repo 原 desc 走翻译成中文', async () => {
    mockZread.mockResolvedValue(new Map());
    mockDw.mockResolvedValue(new Map()); // deepwiki 也空

    const items = [item('some/repo', 'Original English repository description.')];
    await resolveDescriptions(fakeEnv, items);

    expect(mockDw).toHaveBeenCalled(); // 试过二级
    expect(isChinese(items[0].descZh)).toBe(true); // 三级兜底产出中文
    expect(items[0].descZh).toBe(ZH_TL);
  });

  it('顺序敏感: zread 部分命中时, 只有缺失的进 deepwiki', async () => {
    mockZread.mockResolvedValue(new Map([['a/aa', '这个仓库是一个用于构建工作流的开发工具。']]));
    mockDw.mockResolvedValue(new Map());

    const items = [item('a/aa', 'hit desc'), item('b/bb', 'missed desc')];
    await resolveDescriptions(fakeEnv, items);

    expect(mockDw.mock.calls[0][0]).toEqual(['b/bb']); // 仅缺失者进二级
    expect(items[0].descZh).toContain('工作流'); // 命中者用 zread
    expect(isChinese(items[1].descZh)).toBe(true); // 缺失者走翻译
  });

  it('全链路失败 → 诚实降级(descZh 空), 不冒充中文', async () => {
    mockZread.mockRejectedValue(new Error('network down'));
    mockDw.mockRejectedValue(new Error('network down'));
    const envFail = { AI: { run: vi.fn(async () => { throw new Error('AI down'); }) } } as any;
    // WorkersAI 失败 → TranSmart 会真实触网。mock global fetch 拒绝, 让四级全挂。
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('net down'); }));

    const items = [item('x/y', 'Plain English description here.')];
    await resolveDescriptions(envFail as any, items);

    expect(items[0].descZh).toBeUndefined(); // 守卫拒绝, 不假中文
    vi.unstubAllGlobals();
  });

  it('zread 返回非中文(被污染) → 视为未命中, 落入下一级', async () => {
    mockZread.mockResolvedValue(new Map([['bad/repo', 'This wiki content is in English, not Chinese at all.']]));
    mockDw.mockResolvedValue(new Map());

    const items = [item('bad/repo', 'English desc.')];
    await resolveDescriptions(fakeEnv, items);

    expect(items[0].descZh).not.toContain('not Chinese'); // 英文 wiki 未被采纳
    expect(items[0].descZh).toBe(ZH_TL); // 走了翻译
  });
});

// ---------- 翻译服务优先级: Cloudflare AI → 免费公开翻译服务 ----------
import { translateBatch } from '../src/translate';

describe('翻译服务优先级', () => {
  const mkEnv = (aiBehavior: 'ok' | 'throw' | 'english') => ({
    AI: {
      run: vi.fn(async (_m: string, p: { text: string }) => {
        if (aiBehavior === 'throw') throw new Error('AI quota');
        if (aiBehavior === 'english') return { translated_text: p.text }; // 原样返回=英文垃圾
        return { translated_text: `这是${p.text.slice(0, 4)}的中文翻译版本内容` };
      }),
    },
  } as any);

  it('WorkersAI 可用 → 只用 AI, 不触任何外部翻译(零 fetch)', async () => {
    const f = vi.fn();
    vi.stubGlobal('fetch', f);
    const items = [item('a/b', 'Some English description.')];
    const done = await translateBatch(mkEnv('ok'), items);
    expect(done[0].descZh).toContain('中文翻译');
    expect(f).not.toHaveBeenCalled(); // 没碰 TranSmart/Google/MyMemory
    vi.unstubAllGlobals();
  });

  it('WorkersAI 挂 → 落 TranSmart(fetch 首个外呼是 transmart.qq.com)', async () => {
    const calls: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL) => {
      calls.push(String(url));
      return new Response(JSON.stringify({
        header: { ret_code: 'succ' },
        auto_translation: ['这是免费公开服务译出的中文描述文本'],
      }), { status: 200 });
    }));
    const items = [item('a/b', 'Some English description.')];
    const done = await translateBatch(mkEnv('throw'), items);
    expect(isChinese(done[0].descZh)).toBe(true);
    expect(calls.some((u) => u.includes('transmart.qq.com'))).toBe(true); // 二级接手
    vi.unstubAllGlobals();
  });

  it('WorkersAI 输出英文垃圾 → TranSmart 补翻该槽位', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string | URL, init?: RequestInit) => {
      const req = JSON.parse(String(init?.body ?? '{}'));
      const list: string[] = req?.source?.text_list ?? ['x'];
      return new Response(JSON.stringify({
        header: { ret_code: 'succ' },
        auto_translation: list.map((t: string, i: number) => `补翻成功的中文内容第${i + 1}条:${t.slice(0, 6)}`),
      }), { status: 200 });
    }));
    const items = [item('a/b', 'English one.'), item('c/d', 'English two.')];
    const done = await translateBatch(mkEnv('english'), items);
    expect(isChinese(done[0].descZh!)).toBe(true); // 垃圾被替换
    expect(isChinese(done[1].descZh!)).toBe(true);
    vi.unstubAllGlobals();
  });
});
