// 渲染层测试: 双缺条目(descZh 空)不显示描述行; 有描述时显示中文。
import { describe, it, expect } from 'vitest';
import { renderMessage, renderMarkdown, renderTelegraphNodes } from '../src/render';

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
