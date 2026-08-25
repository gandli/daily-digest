// 存档 OG 相对路径 + 去重 key 规则测试(纯函数部分; KV/上传路径走线上验证)
import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../src/render';

describe('renderMarkdown: og-images 本地相对路径', () => {
  const items = [{ title: 'owner/repo', url: 'https://github.com/owner/repo', desc: 'd', descZh: '中文描述测试' }];
  it('传入 ogPaths → 用相对路径', () => {
    const md = renderMarkdown('2026-08-25', items, undefined, new Map([['owner/repo', '../../og-images/owner__repo.png']]));
    expect(md).toContain('src="../../og-images/owner__repo.png"');
    expect(md).not.toContain('opengraph.githubassets.com');
  });
  it('未传 ogPaths → 回退远程 URL(兼容)', () => {
    const md = renderMarkdown('2026-08-25', items);
    expect(md).toContain('https://opengraph.githubassets.com/1/owner/repo');
  });
});
