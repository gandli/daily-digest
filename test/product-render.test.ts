// renderProductMessage 回归锁: zeli 卡片(by 作者 + 相对时间) + 转义 + 缺字段降级。
import { describe, it, expect } from 'vitest';
import { renderProductMessage } from '../src/render';

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
});
