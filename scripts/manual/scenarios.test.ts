// 手册场景集: 10 个用户事务(见 docs/guide/OUTLINE.md)。每场景驱动真实 worker.fetch。
// vi.mock 与单测同款 —— 关掉外网, 数据可控; 场景记录即"合成聊天记录", 落盘供 render 截图与 generate 生成正文。
// 日期一律 today() 动态生成(教训: 写死日期的 fixture 过夜即挂)。
import { describe, it, vi, beforeEach } from 'vitest';
import { makeEnv, makeCallLog, runScenario, runScheduled, type Scenario } from './runner';
import { today } from '../../src/lookup';

const D = today();

// —— 外部依赖 stub(与 webhook-routing.test.ts 同款) ——
vi.mock('../../src/sources/trending', () => ({ fetchTrending: vi.fn(async () => [
  { src: 'github', title: 'antirez/kilo', url: 'https://github.com/antirez/kilo', desc: 'A tiny text editor in less than 1K lines of C', descZh: '一个不到 1K 行 C 代码的迷你文本编辑器', stars: 3200, date: D },
  { src: 'github', title: 'sharkdp/bat', url: 'https://github.com/sharkdp/bat', desc: 'A cat(1) clone with syntax highlighting', descZh: '带语法高亮的 cat 命令克隆', stars: 50000, date: D },
]) }));
vi.mock('../../src/translate', async (orig) => {
  const m = await orig<any>();
  return {
    ...m,
    translateBatch: vi.fn(async (items: any[]) => items.map(() => ({ descZh: '一个不到 1K 行 C 代码的迷你文本编辑器, 代码精炼, 适合学习。' }))),
    generateTitleZh: vi.fn(async () => '小而美命令行工具'),
    generateTagsZh: vi.fn(async () => ['开发工具', '命令行']),
    translateTextZh: vi.fn(async (s: string) => `（中文翻译）${String(s).slice(0, 120)}`),
    summarizeZh: vi.fn(async () => '这是一段用于手册演示的中文摘要, 说明该内容的核心要点。'),
  };
});
vi.mock('../../src/deepwiki', () => ({ fetchDeepwikiOverview: vi.fn(async () => '这个仓库实现了经典的文本编辑器, 代码精炼, 适合学习 C 语言。'), fetchDeepwikiBatch: vi.fn(async (titles: string[]) => new Map(titles.map((t) => [t, 'This repository implements a classic minimal text editor.']))) }));
vi.mock('../../src/zread', () => ({ fetchZreadOverview: vi.fn(async () => null), fetchZreadBatch: vi.fn(async (titles: string[]) => new Map(titles.map((t) => [t, '这个仓库实现了经典的文本编辑器, 代码精炼, 适合学习 C 语言。']))) }));
vi.mock('../../src/archive', async (orig) => {
  const m = await orig<any>();
  return { ...m, archiveToGitHub: vi.fn(async () => 'https://github.com/gandli/daily-digest/blob/archive/archive/x.md'), archiveDatedToGitHub: vi.fn(async () => undefined), archiveOgImage: vi.fn(async () => undefined), createTelegraphPage: vi.fn(async () => 'https://telegra.ph/demo-page'), urlToMarkdown: vi.fn(async () => '# Demo\n\n这是示例网页的 markdown 正文, 用于手册演示。'), indexArchivedItems: vi.fn(async () => undefined) };
});
const TWEET_SINGLE = {
  url: 'https://x.com/Smartpigai/status/2093191865193677285', id: '2093191865193677285',
  text: 'Just shipped a new CLI tool for digest curation! #buildinpublic',
  author: { screen_name: 'Smartpigai', name: 'Smart Pigai' }, created_at: '2026-08-28T10:00:00Z',
  likes: 128, reposts: 32, replies: 9,
  media: { all: [{ type: 'photo', url: 'https://opengraph.githubassets.com/1/antirez/kilo' }], photos: [{ type: 'photo', url: 'https://opengraph.githubassets.com/1/antirez/kilo' }], mosaic: null },
  translation: { text: '刚刚发布了一个用于摘要整理的新命令行工具！' },
};
const TWEET_MULTI_ID = '2093191865193677286';
const TWEET_MULTI = {
  ...TWEET_SINGLE, id: TWEET_MULTI_ID, url: `https://x.com/Smartpigai/status/${TWEET_MULTI_ID}`,
  text: 'Screenshots of the new dashboard — four views in one thread.',
  translation: { text: '新仪表盘的截图 —— 一条帖子里的四个视图。' },
  media: {
    all: [{ type: 'photo', url: 'https://opengraph.githubassets.com/1/sharkdp/bat' }, { type: 'photo', url: 'https://opengraph.githubassets.com/1/antirez/kilo' }],
    photos: [{ type: 'photo', url: 'https://opengraph.githubassets.com/1/sharkdp/bat' }, { type: 'photo', url: 'https://opengraph.githubassets.com/1/antirez/kilo' }],
    mosaic: { formats: { jpeg: 'https://opengraph.githubassets.com/1/antirez/kilo' } },
  },
};
vi.mock('../../src/fxtweet', async (orig) => {
  const m = await orig<any>();
  return { ...m, fetchTweet: vi.fn(async (_h: string, id: string) => (id === TWEET_MULTI_ID ? TWEET_MULTI : TWEET_SINGLE)) };
});

// —— 外网 canned 数据(fetch 路由表) ——
let productSeeded = false; // 03: round1 未生成(dispatch) → round2 已生成(秒回卡片)
const REPOS_12 = Array.from({ length: 12 }, (_, i) => `demo/repo-${String(i).padStart(2, '0')}`);
const fetcher = makeCallLog([
  { match: (u) => u.endsWith(`/repos/antirez/kilo`), reply: { full_name: 'antirez/kilo', description: 'A tiny text editor in less than 1K lines of C', stargazers_count: 3200, language: 'C', topics: ['c', 'editor'] } },
  { match: (u) => u.includes(`/product/${D}.json`), reply: () => (productSeeded
    ? { telegraphUrl: 'https://telegra.ph/product-page', items: [{ title: 'linear/linear', titleZh: 'Linear — 快得离谱的项目管理工具', url: 'https://linear.app', desc: 'Linear is a purpose-built tool for planning and building products', descZh: '一款以速度著称的产品规划与 issue 跟踪工具。', topics: ['saas', 'planning'], author: 'karpathy', createdAt: new Date(Date.now() - 3 * 3600e3).toISOString(), quote: 'Linear is a better way to build products', photo: 'https://opengraph.githubassets.com/1/antirez/kilo' }] }
    : new Response('not found', { status: 404 })) },
]);

const scenarios: Scenario[] = [];
const env = makeEnv();
const stubGlobalFetch = () => vi.stubGlobal('fetch', fetcher.fetch);

const upd = (text: string) => ({ message: { chat: { id: 944783507 }, text } });
const cb = (data: string) => ({ callback_query: { id: 'cq1', data, from: { id: 944783507 }, message: { chat: { id: 944783507 }, message_id: 100 } } });
const last = () => scenarios[scenarios.length - 1];

describe('手册场景', () => {
  beforeEach(() => stubGlobalFetch());

  it('收集全部场景', async () => {
    // 1 快速开始
    scenarios.push(await runScenario(env, fetcher, '01-start', '快速开始: /start 与帮助', '新用户首次接触, 了解命令与支持的链接类型。', async (post) => {
      await post(upd('/start'), { target: 'input', label: '发送 /start 启动 Bot' });
    }));
    // 2 /trending: round1 无缓存 → 占位 + 完整管线出卡; round2 再发 → 缓存秒回
    scenarios.push(await runScenario(env, fetcher, '02-trending', '/trending 今日 GitHub Trending', '拉当天 Trending; 首次跑完整管线(抓取→翻译→存档→发卡), 当天再次发送秒回缓存。', async (post) => {
      await post(upd('/trending'), { target: 'input', label: '发送 /trending' });
      await post(upd('/trending'));
    }));
    // 3 /product: round1 未生成 → dispatch 占位; round2 已生成 → 产品卡
    scenarios.push(await runScenario(env, fetcher, '03-product', '/product 今日 HN 酷产品', '读 Actions 生成的当日产品卡; 未生成时自动触发 GitHub Actions, 生成完成后推送。', async (post) => {
      await post(upd('/product'), { target: 'input', label: '发送 /product' });
      productSeeded = true;
      await post(upd('/product'));
    }));
    last().steps[last().steps.length - 1].annotate = { target: 'bubble', label: '产品卡: 标题直链/作者/中文摘要/三链' };
    // 4 /archive: 12 条存档 → 第 1 页 + 按钮翻到第 2 页(原地编辑)
    for (const repo of REPOS_12) {
      await env.CACHE.put(`archive:idx:${repo}`, JSON.stringify({ repo, date: `${D}T083000`, descZh: `${repo} 的中文摘要示例。`, topics: ['demo'] }));
    }
    await env.CACHE.put(`archive:tg:${D}T083000`, 'https://telegra.ph/bat-page');
    scenarios.push(await runScenario(env, fetcher, '04-archive', '/archive 历史存档与翻页', '浏览最近存档, 点 ◀️▶️ 按钮原地翻页, 无需重新发送命令。', async (post) => {
      await post(upd('/archive'), { target: 'input', label: '发送 /archive' });
      await post(cb('arch:pg:1'), { target: 'button', label: '点击「下一页 ➡」原地翻页' });
    }));
    // 5 /search: 缺关键词 → 用法; 有关键词 → 命中卡片
    await env.CACHE.put('search:index', JSON.stringify([
      ['star', 'sharkdp/bat', 'https://github.com/sharkdp/bat', 'bat cli rust syntax highlighting cat', '带语法高亮的 cat 命令克隆'],
      ['star', 'antirez/kilo', 'https://github.com/antirez/kilo', 'kilo c editor tiny text editor', '一个不到 1K 行 C 代码的迷你文本编辑器'],
      ['star', 'linear/linear', 'https://linear.app', 'linear saas planning issue tracking', '一款以速度著称的产品规划与 issue 跟踪工具。'],
    ]));
    scenarios.push(await runScenario(env, fetcher, '05-search', '/search 关键词搜索', '按关键词搜历史存档; 不带关键词回用法提示, 命中回结果卡片(带翻页)。', async (post) => {
      await post(upd('/search'), { target: 'input', label: '只发 /search 不带关键词' });
      await post(upd('/search bat'), { target: 'input', label: '带上关键词: /search bat' });
    }));
    last().steps[last().steps.length - 1].annotate = { target: 'bubble', label: '命中结果: 标题直链 + 中文描述 + 翻页按钮' };
    // 6 GitHub 链接 → 单仓查询卡
    scenarios.push(await runScenario(env, fetcher, '06-github-link', '粘贴 GitHub 仓库链接', '单仓查询: 抓元数据 + deepwiki 中文简介 + 存档, 回一张卡。当天重复发送回已存档信息。', async (post) => {
      await post(upd('https://github.com/antirez/kilo'), { target: 'input', label: '直接粘贴仓库链接' });
    }));
    last().steps[last().steps.length - 1].annotate = { target: 'bubble', label: '单仓卡: 标题/⭐/语言/中文简介/wiki 三链/存档三链' };
    // 7 X/Twitter 链接 → 帖子存档卡(单图/多图 mosaic)
    scenarios.push(await runScenario(env, fetcher, '07-x-link', '粘贴 X(Twitter) 帖子链接', 'FxEmbed 拉帖 + 中文翻译 + Telegraph 页 + 存档; 多图帖自动拼 mosaic 单图发送。', async (post) => {
      await post(upd('https://x.com/Smartpigai/status/2093191865193677285'), { target: 'input', label: '粘贴单图帖子链接' });
      await post(upd(`https://x.com/Smartpigai/status/${TWEET_MULTI_ID}`));
    }));
    last().steps[last().steps.length - 1].annotate = { target: 'bubble', label: '多图帖: mosaic 拼图单张发送' };
    // 8 任意网页 → markdown 存档卡
    scenarios.push(await runScenario(env, fetcher, '08-webpage', '粘贴任意网页链接', '转 markdown 存档 + Telegraph 页, 回标题 + 中文摘要 + 三链。', async (post) => {
      await post(upd('https://example.com/blog/demo-post'), { target: 'input', label: '粘贴普通网页链接' });
    }));
    last().steps[last().steps.length - 1].annotate = { target: 'bubble', label: '网页卡: 标题/中文摘要/#archive 标签/三链' };
    // 9 重复链接 → 秒回(不重跑)
    await env.CACHE.put('reproc:https://example.com/blog/demo-post', JSON.stringify({ ts: Date.now(), translated: true, descOk: true, md: `${D}T090000`, t: '示例博文: 演示页', s: '这是一篇用于演示重发语义的示例文章摘要。' }));
    await env.CACHE.put(`archive:tg:${D}T090000`, 'https://telegra.ph/demo-page-08-28');
    scenarios.push(await runScenario(env, fetcher, '09-repost', '重复发送同一链接', '已处理过的链接重发: 秒回标题 + 摘要 + 三链, 不重跑管线。', async (post) => {
      await post(upd('https://example.com/blog/demo-post'), { target: 'input', label: '再次发送同一链接' });
    }));
    last().steps[last().steps.length - 1].annotate = { target: 'bubble', label: '♻️ 秒回: 复用上次结果' };
    // 10 每日自动推送(cron): 无用户操作, scheduled 直接触发完整管线并推送
    scenarios.push(await runScheduled(env, fetcher, '10-cron', '每日自动推送(08:30)', '每天早上 08:30(北京时间)自动抓取 GitHub Trending 并推送到对话, 无需任何操作。'));
    last().steps[last().steps.length - 1].annotate = { target: 'bubble', label: '推送卡片自动送达, 无需操作' };

    // 校验: 每场景至少一问一答
    for (const s of scenarios) {
      if (!s.steps.some((x) => x.actor === 'bot')) throw new Error(`场景 ${s.id} 无 bot 回复`);
    }
    // 落盘供 render 截图与 generate 生成正文
    const { writeFileSync, mkdirSync } = await import('node:fs');
    mkdirSync('docs/guide/assets', { recursive: true });
    writeFileSync('docs/guide/scenarios.json', JSON.stringify(scenarios, null, 2));
    console.log(`scenarios: ${scenarios.length}, steps: ${scenarios.reduce((a, s) => a + s.steps.length, 0)}`);
  }, 60000);
});
