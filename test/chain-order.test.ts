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

  it('③ zread+deepwiki 双缺 → 不出描述(descZh 空), 不硬凑 repo 一句话', async () => {
    mockZread.mockResolvedValue(new Map());
    mockDw.mockResolvedValue(new Map()); // deepwiki 也空

    const items = [item('some/repo', 'Original English repository description.')];
    await resolveDescriptions(fakeEnv, items);

    expect(mockDw).toHaveBeenCalled(); // 试过二级
    expect(items[0].descZh).toBeUndefined(); // 双缺 → 诚实降级, 不出描述
    expect(fakeEnv.AI.run).not.toHaveBeenCalled(); // 不翻译 repo 一句话
  });

  it('顺序敏感: zread 部分命中时, 只有缺失的进 deepwiki; 双缺不留描述', async () => {
    mockZread.mockResolvedValue(new Map([['a/aa', '这个仓库是一个用于构建工作流的开发工具。']]));
    mockDw.mockResolvedValue(new Map()); // deepwiki 也空(只验证被调用与否)

    const items = [item('a/aa', 'hit desc'), item('b/bb', 'missed desc')];
    await resolveDescriptions(fakeEnv, items);

    expect(mockDw.mock.calls[0][0]).toEqual(['b/bb']); // 仅缺失者进二级
    expect(items[0].descZh).toContain('工作流'); // 命中者用 zread
    expect(items[1].descZh).toBeUndefined(); // b/bb: zread+deepwiki 双缺 → 不出描述
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

  it('zread 返回非中文(被污染) + deepwiki 缺 → 双缺不出描述', async () => {
    mockZread.mockResolvedValue(new Map([['bad/repo', 'This wiki content is in English, not Chinese at all.']]));
    mockDw.mockResolvedValue(new Map());

    const items = [item('bad/repo', 'English desc.')];
    await resolveDescriptions(fakeEnv, items);

    expect(items[0].descZh).toBeUndefined(); // 英文 wiki 被拒 + deepwiki 缺 → 不出描述
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

  it('混合空/非空 desc → pos 映射对齐, 空项透传不错位(回归锁 P2-A)', async () => {
    const items = [item('a/b', 'First English description.'), item('c/d', ''), item('e/f', 'Third English description.')] as any[];
    (items[1] as { desc: string }).desc = ''; // 显式空串
    const done = await translateBatch(mkEnv('ok'), items);
    expect(done[0].descZh).toContain('中文翻译');
    expect(done[1].descZh).toBeUndefined(); // 空 desc 原样透传, 不吃别人的翻译
    expect(done[2].descZh).toContain('中文翻译'); // 第三项拿到自己的翻译, 不错位到第二项
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

// ---------- 契约: 描述必须来自 zread 或 deepwiki ----------
describe('契约: 每条成功产出的描述必须源自 zread 或 deepwiki', () => {
  it('混合命中: zread 条用中文、deepwiki 条译中文、双缺条留空——逐条分派正确', async () => {
    mockZread.mockResolvedValue(new Map([
      ['z/one', '这是 zread 提供的中文 wiki 描述。'],
    ]));
    mockDw.mockImplementation(async (repos: string[]) =>
      new Map(repos.map((r) => [r, `${r} is a deepwiki overview paragraph with enough length to translate.`])),
    );

    const items = [
      item('z/one', 'repo desc A'),
      item('d/two', 'repo desc B'),
      item('x/three', 'repo desc C'), // deepwiki 只补前5条(这里3条都在5内)→命中
    ];
    await resolveDescriptions(fakeEnv, items);

    // 1 = zread 中文直用(不翻译)
    expect(items[0].descZh).toContain('zread');
    // 2,3 = deepwiki 英文经翻译层(WorkersAI 假翻译)
    expect(items[1].descZh).toBe(ZH_TL);
    expect(items[2].descZh).toBe(ZH_TL);
    // 全部非空时 100% 中文
    for (const it of items) {
      expect(isChinese(it.descZh ?? '')).toBe(true);
    }
  });

  it('deepwiki 只补前5条: 第6+条 zread/deepwiki 双缺 → 留空', async () => {
    mockZread.mockResolvedValue(new Map());
    mockDw.mockImplementation(async (repos: string[]) =>
      new Map(repos.map((r) => [r, `${r} dw overview english text.`])),
    );
    const items = Array.from({ length: 7 }, (_, i) => item(`r/${i}`, `desc ${i}`));
    await resolveDescriptions(fakeEnv, items);

    // deepwiki slice(0,5) → 前5条命中翻译, 后2条双缺留空
    for (let i = 0; i < 5; i++) expect(isChinese(items[i].descZh ?? '')).toBe(true);
    expect(items[5].descZh).toBeUndefined();
    expect(items[6].descZh).toBeUndefined();
  });
});
