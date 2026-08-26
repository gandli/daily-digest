import { describe, it, expect } from 'vitest';
// archiveLinks 三链优先级回归锁: Telegraph → web.archive → GitHub md。
import { archiveLinks } from '../src/lookup';

describe('archiveLinks 三链优先级', () => {
  const md = 'https://github.com/x/y/blob/archive/archive/2026/2026-08-26.md';

  it('有 Telegraph → Telegraph 在前, 含 web.archive 与 GitHub md', () => {
    const s = archiveLinks('https://example.com/a', 'https://telegra.ph/zz', md);
    expect(s.indexOf('Telegraph')).toBeLessThan(s.indexOf('互联网档案馆'));
    expect(s.indexOf('互联网档案馆')).toBeLessThan(s.indexOf('GitHub md'));
    expect(s).toContain('web.archive.org/web/2/https://example.com/a');
    expect(s).toContain(md);
  });

  it('无 Telegraph → web.archive 在前, GitHub md 兜底', () => {
    const s = archiveLinks('https://example.com/b', undefined, md);
    expect(s.indexOf('互联网档案馆')).toBeLessThan(s.indexOf('GitHub md'));
    expect(s).toContain('web.archive.org/web/2/https://example.com/b');
  });

  it('无源 URL → 仅 GitHub md(Telegraph 可有可无)', () => {
    const s = archiveLinks(undefined, undefined, md);
    expect(s).toContain(md);
    expect(s).not.toContain('web.archive.org');
  });

  it('web.archive URL 保留 :// 与 / 不双编码', () => {
    const s = archiveLinks('https://github.com/anthropics/claude', undefined, md);
    expect(s).toContain('web.archive.org/web/2/https://github.com/anthropics/claude');
    expect(s).not.toContain('%3A');
    expect(s).not.toContain('%2F');
  });
});