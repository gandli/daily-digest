// 渲染层测试: 双缺条目(descZh 空)不显示描述行; 有描述时显示中文。
import { describe, it, expect } from 'vitest';
import { renderMessage, renderMarkdown, renderTelegraphNodes, renderProductMessage } from '../src/render';

const ZH = '这是一个来自 zread wiki 的中文描述，用于说明该仓库的核心功能模块。';

const mk = (title: string, descZh?: string) => ({
  title, url: `https://github.com/${title}`, stars: 1234, desc: 'English repo desc.',
  descZh, topics: ['test'],
});

describe('渲染: 描述层诚实降级', () => {
  it('有中文描述 → 显示描述行(不含 EN 标注)', () => {
    const [msg] = renderMessage('2026-08-24', [mk('a/aa', ZH)]);
    expect(msg).toContain(ZH);
    expect(msg).not.toContain('(EN)');
  });

  it('双缺(descZh 空) → 不显示描述行, 不泄露 repo 英文一句话', () => {
    const [msg] = renderMessage('2026-08-24', [mk('b/bb')]);
    expect(msg).not.toContain('English repo desc.');   // repo 一句话不出
    expect(msg).not.toContain('(EN)');                  // 无降级标注
    expect(msg).toContain('b/bb');                       // 标题仍在
    expect(msg).toContain('deepwiki');                    // 链接仍在
  });

  it('markdown 存档同规则: 双缺不留 repo 英语, 有则中文', () => {
    const noDesc = renderMarkdown('2026-08-24', [mk('b/bb')]);
    expect(noDesc).not.toContain('English repo desc.');
    const withDesc = renderMarkdown('2026-08-24', [mk('a/aa', ZH)]);
    expect(withDesc).toContain(ZH);
  });

  it('每条带存档三链(Telegraph/Wayback/GitHub md), 非仅末条', () => {
    const msgs = renderMessage('2026-08-24', [mk('a/aa', ZH), mk('b/bb', ZH)], 'https://telegra.ph/x');
    for (const m of msgs) {
      expect(m).toContain('Telegraph');
      expect(m).toContain('Wayback');
      expect(m).toContain('Archive');
      expect(m).toContain('web.archive.org/web/2/');
    }
  });
  it('无 telegraphUrl → 三链含 Wayback + GitHub md, 无 Telegraph 项', () => {
    const [m] = renderMessage('2026-08-24', [mk('a/aa', ZH)]);
    expect(m).toContain('Wayback');
    expect(m).toContain('Archive');
    expect(m).not.toContain('Telegraph');
  });
  it('超长消息 >4000 → 截断到 ≤4000 且以 … 结尾', () => {
    const longZh = '很长的中文描述句子。'.repeat(600); // 10 字 × 600 = 6000 字符
    const [msg] = renderMessage('2026-08-24', [mk('c/cc', longZh)]);
    expect(msg.length).toBeLessThanOrEqual(4000);
    expect(msg.endsWith('…')).toBe(true);
    expect(msg).toContain('c/cc');
  });
  it('序号: 单条卡无 1/1 头; 多条批量每条带 N/M 头', () => {
    const [single] = renderMessage('2026-08-24', [mk('a/aa', ZH)]);
    expect(single).not.toMatch(/<b>\d+\/\d+<\/b>/); // 单条不编号
    const msgs = renderMessage('2026-08-24', [mk('a/aa', ZH), mk('b/bb', ZH), mk('c/cc', ZH)]);
    expect(msgs[0]).toContain('<b>1/3</b> ');
    expect(msgs[1]).toContain('<b>2/3</b> ');
    expect(msgs[2]).toContain('<b>3/3</b> ');
  });
});
describe('renderProductMessage(HN 酷产品)', () => {
  it('显示中文描述(📝) + 领域标签 + 存档三链', () => {
    const [msg] = renderProductMessage('2026-08-26', [{ title: 'Show HN: A cool AI tool', url: 'https://x.dev', descZh: '一个很酷的 AI 工具。', topics: ['ai', 'web'] } as never]);
    expect(msg).toContain('📝 一个很酷的 AI 工具。'); // 中文描述
    expect(msg).toContain('#ai #web'); // 领域标签
    expect(msg).toContain('#product');
    expect(msg).toContain('Wayback');
    expect(msg).toContain('Archive');
  });
  it('有引文(quote) → 显示 💬 引文行', () => {
    const [msg] = renderProductMessage('2026-08-26', [{ title: 'Show HN: A', url: 'https://x.dev', descZh: '这是一段中文摘要。', quote: 'A cool AI tool for builders.' } as never]);
    expect(msg).toContain('💬 "A cool AI tool for builders."');
  });
  it('无中文描述 → 不显示描述行(仍有标题/标签/三链)', () => {
    const [msg] = renderProductMessage('2026-08-26', [{ title: 'Show HN: X', url: 'https://x.dev', descZh: undefined } as never]);
    expect(msg).not.toContain('📝');
    expect(msg).toContain('Show HN: X');
  });
  it('zeli 风格: 显示作者 by + 相对时间', () => {
    const past = new Date(Date.now() - 3600e3).toISOString(); // -1h
    const [msg] = renderProductMessage('2026-08-26', [{ title: 'Show HN: T', url: 'https://x.dev', descZh: '中', author: 'Fe2_O3', createdAt: past } as never]);
    expect(msg).toContain('by Fe2_O3');
    expect(msg).toContain('about 1 hours ago'); // 粗略边界, 断言受控 1h
  });
  it('无 author/createdAt → 不显示 meta 行', () => {
    const [msg] = renderProductMessage('2026-08-26', [{ title: 'Show HN: N', url: 'https://x.dev', descZh: '中' } as never]);
    expect(msg).not.toContain('by ');
    expect(msg).not.toContain('ago');
  });
});
describe('Telegraph 渲染: 中文守卫(P1-A)', () => {
  const base = { title: 'o/r', url: 'https://github.com/o/r', desc: 'English fallback desc' };
  it('双缺 → 只留标题行, 英文不上公开页面', () => {
    const nodes = renderTelegraphNodes([{ ...base }] as never);
    expect(JSON.stringify(nodes)).not.toContain('English fallback desc');
  });
  it('有中文 descZh → 输出中文描述', () => {
    const nodes = renderTelegraphNodes([{ ...base, descZh: '这是一个中文描述。' }] as never);
    expect(JSON.stringify(nodes)).toContain('这是一个中文描述。');
  });
});

describe('存档渲染: OG 图(P3)', () => {
  const it_ = { title: 'o/r', url: 'https://github.com/o/r', desc: 'x' };
  it('markdown 存档含 OG 图引用', () => {
    expect(renderMarkdown('2026-08-24', [it_] as never)).toContain('opengraph.githubassets.com/1/o/r');
  });
  it('Telegraph nodes 含 OG img 节点', () => {
    const nodes = renderTelegraphNodes([it_] as never) as { tag: string }[];
    expect(nodes.some((n) => n.tag === 'figure')).toBe(true);
  });
});
