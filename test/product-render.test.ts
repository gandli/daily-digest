// renderProductMessage 回归锁: zeli 卡片(by 作者 + 相对时间) + 转义 + 缺字段降级。
import { describe, it, expect } from 'vitest';
import { renderProductMessage, renderMessage, renderMarkdown, yearOf } from '../src/render';

const ZH = '这是一个来自深度摘要的中文描述，用于说明产品核心功能模块。';

const mk = (o: Record<string, unknown> = {}) => ({
  title: 'Show HN: A cool tool', url: 'https://x.dev', descZh: ZH,
  author: 'fe2o3', createdAt: new Date(Date.now() - 3600e3).toISOString(),
  ...o,
});

const past = (ms: number) => new Date(Date.now() - ms).toISOString();

describe('renderProductMessage zeli 卡片', () => {
  it('正常项 → 含 by <author> + about X hours ago', () => {
    const [msg] = renderProductMessage('2026-08-27', [mk() as never]);
    expect(msg).toContain('by fe2o3');
    expect(msg).toContain('about 1 hours ago');
    expect(msg).toMatch(/🚀 <b>\d{4}-\d{2}-\d{2}<\/b>/);
    expect(msg).toContain('#product');
  });

  it('作者缺失 → 不 crash, 不出现 by undefined, 相对时间仍显示', () => {
    const [msg] = renderProductMessage('2026-08-27', [mk({ author: undefined }) as never]);
    expect(msg).not.toContain('by ');
    expect(msg).not.toContain('undefined');
    expect(msg).toContain('about 1 hours ago');
  });

  it('createdAt 缺失 → 不 crash, 无 ago, 作者仍显示', () => {
    const [msg] = renderProductMessage('2026-08-27', [mk({ createdAt: undefined }) as never]);
    expect(msg).not.toContain('ago');
    expect(msg).toContain('by fe2o3');
  });

  it('descZh 为空 → 不 crash, 不显示 📝 行, 不泄露英文 desc', () => {
    const [msg] = renderProductMessage('2026-08-27', [mk({ descZh: undefined, desc: 'English repo desc.' }) as never]);
    expect(msg).not.toContain('📝');
    expect(msg).not.toContain('English repo desc.');
    expect(msg).toContain('Show HN: A cool tool');
  });

  it('descZh 为中文 → 显示 📝 描述行', () => {
    const [msg] = renderProductMessage('2026-08-27', [mk() as never]);
    expect(msg).toContain(`📝 ${ZH}`);
  });

  it('items 空数组 → 返回空数组, 不 crash', () => {
    expect(renderProductMessage('2026-08-27', [])).toEqual([]);
  });

  it('条目含 emoji/special char → 正确转义不 crash', () => {
    const [msg] = renderProductMessage('2026-08-27', [{
      title: 'A <b>cool</b> & useful tool 🚀',
      url: 'https://x.dev/?a=1&b=2',
      descZh: '中文描述含 <script> & 特殊字符。',
      author: 'Fe&Co<3',
      createdAt: past(7200e3),
      quote: 'say "hi" & <bye>',
    } as never]);
    expect(msg).toContain('&lt;b&gt;cool&lt;/b&gt;'); // 标题内标签被转义, 非真 HTML
    expect(msg).not.toContain('<b>cool</b>');
    expect(msg).toContain('Fe&amp;Co&lt;3');
    expect(msg).toContain('&lt;script&gt;');          // descZh 脚本转义
    expect(msg).not.toContain('<script>');
    expect(msg).toContain('&lt;bye&gt;');             // quote 转义
    expect(msg).toContain('🚀');                       // emoji 透传(Telegram 支持)
  });

  it('相对时间: 2h → about 2 hours ago', () => {
    const [msg] = renderProductMessage('2026-08-27', [mk({ createdAt: past(7200e3) }) as never]);
    expect(msg).toContain('about 2 hours ago');
  });

  it('相对时间: 25h → about 1 days ago', () => {
    const [msg] = renderProductMessage('2026-08-27', [mk({ createdAt: past(25 * 3600e3) }) as never]);
    expect(msg).toContain('about 1 days ago');
  });

  it('单条产品 → 仅 🚀 日期头, 无 N/M 序号', () => {
    const [msg] = renderProductMessage('2026-08-27', [mk() as never]);
    expect(msg).toMatch(/🚀 <b>\d{4}-\d{2}-\d{2}<\/b>/);
    expect(msg).not.toMatch(/<b>\d+\/\d+<\/b>/); // 序号只在多条产品时出现
  });
});

// 覆盖缺口: stars/quote/topics 变体 + 超长截断 + renderMessage/renderMarkdown 缺字段降级。
describe('renderProductMessage stars/quote/topics 变体与截断', () => {
  it('stars 缺失 → 无 ⭐ 段', () => {
    const [msg] = renderProductMessage('2026-08-27', [mk({ stars: undefined }) as never]);
    expect(msg).not.toContain('⭐');
  });
  it('stars 有值 → ⭐ k 格式化', () => {
    const [msg] = renderProductMessage('2026-08-27', [mk({ stars: 2300 }) as never]);
    expect(msg).toContain('⭐ 2.3k');
  });
  it('quote 有值 → 💬 引用行(esc 只转 & < >, 引号透传)', () => {
    const [msg] = renderProductMessage('2026-08-27', [mk({ quote: 'a "quoted" <line>' }) as never]);
    expect(msg).toContain('💬 "a "quoted" &lt;line&gt;"');
  });
  it('quote 缺失 → 无 💬 行', () => {
    const [msg] = renderProductMessage('2026-08-27', [mk() as never]);
    expect(msg).not.toContain('💬');
  });
  it('topics 空 → 仅 #product 标签; topics 有 → 追加领域标签', () => {
    const [noTopic] = renderProductMessage('2026-08-27', [mk() as never]);
    expect(noTopic).toContain('#product');
    expect(noTopic).not.toMatch(/#product #/);
    const [withTopic] = renderProductMessage('2026-08-27', [mk({ topics: ['ai', 'dev'] }) as never]);
    expect(withTopic).toContain('#product #ai #dev');
  });
  it('telegraphUrl 有 → Telegraph 链入三链', () => {
    const [msg] = renderProductMessage('2026-08-27', [mk() as never], 'https://telegra.ph/d-1');
    expect(msg).toContain('Telegraph');
  });
  it('msg > 4000 → 截断加省略号', () => {
    const [msg] = renderProductMessage('2026-08-27', [mk({ descZh: '超'.repeat(4500) }) as never]);
    expect(msg.length).toBeLessThanOrEqual(4000);
    expect(msg.endsWith('…')).toBe(true);
  });
  it('relTime < 60min → about X minutes ago', () => {
    const [msg] = renderProductMessage('2026-08-27', [mk({ createdAt: past(30 * 60e3) }) as never]);
    expect(msg).toContain('about 30 minutes ago');
  });
});

describe('renderMessage/renderMarkdown/yearOf 缺字段降级', () => {
  const bare = { title: 'plainname', url: 'https://x.dev/p' } as never; // 无 author/stars/starsToday/createdAt/lang/topics/descZh
  it('renderMessage: 无 stars/author/createdAt → 无 ⭐/👤日期, 标题直链仍在', () => {
    const [msg] = renderMessage('2026-08-27', [bare]);
    expect(msg).not.toContain('⭐');
    expect(msg).not.toContain('👤');
    expect(msg).not.toContain('📅');
    expect(msg).not.toContain('(+');
    expect(msg).toContain('<a href="https://x.dev/p">plainname</a>');
    expect(msg).toContain('#trending');
  });
  it('renderMessage: title 含 / 且无 author → owner 取 title 前段', () => {
    const [msg] = renderMessage('2026-08-27', [{ title: 'acme/tool', url: 'https://github.com/acme/tool' } as never]);
    expect(msg).toContain('👤 acme');
  });
  it('renderMarkdown: 无 starsToday → 无 (+N) 段', () => {
    const md = renderMarkdown('2026-08-27', [{ title: 'a/b', url: 'https://github.com/a/b' } as never]);
    expect(md).not.toContain('(+');
    expect(md).toContain('[a/b](https://github.com/a/b)');
  });
  it('yearOf: 无日期串 → 取前 4 位; 带前缀 stamp → 取最后日期段', () => {
    expect(yearOf('no-date-here')).toBe('no-d');
    expect(yearOf('repo__x-2026-08-27-123')).toBe('2026');
  });
});

describe('renderMessage/renderMarkdown starsToday 高亮', () => {
  it('renderMessage: starsToday 有值 → ⭐ k + (+N 今日)', () => {
    const [msg] = renderMessage('2026-08-27', [{ title: 'a/b', url: 'https://github.com/a/b', stars: 2300, starsToday: 150 } as never]);
    expect(msg).toContain('⭐ 2.3k (+150 今日)');
  });
  it('renderMarkdown: starsToday 有值 → (+N) 段', () => {
    const md = renderMarkdown('2026-08-27', [{ title: 'a/b', url: 'https://github.com/a/b', stars: 2300, starsToday: 150 } as never]);
    expect(md).toContain('⭐ 2.3k (+150)');
  });
});
