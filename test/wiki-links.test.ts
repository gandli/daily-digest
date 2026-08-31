// 不变量: 任何含 GitHub repo 的回复卡都必须带 deepwiki · zread · codewiki 三链。
// 曾有缺口: ♻️重发卡(replyArchived)与多仓 fanout 批量卡手拼 HTML 漏链, 只有首查 renderMessage 有。
import { describe, expect, it } from 'vitest';
import { renderMessage, wikiLinks } from '../src/render';
import type { SourceItem } from '../src/types';

const item = (title: string): SourceItem => ({ title, url: `https://github.com/${title}`, desc: 'd' });

describe('wiki 三链不变量', () => {
  it('wikiLinks 三链齐', () => {
    const s = wikiLinks('gandli/daily-digest');
    expect(s).toContain('https://deepwiki.com/gandli/daily-digest');
    expect(s).toContain('https://zread.ai/gandli/daily-digest');
    expect(s).toContain('https://codewiki.google/github.com/gandli/daily-digest');
  });

  it('renderMessage(单仓/批量卡) 每条含三链', () => {
    for (const msg of renderMessage('2026-08-31', [item('a/b'), item('c/d')])) {
      expect(msg).toContain('deepwiki.com');
      expect(msg).toContain('zread.ai');
      expect(msg).toContain('codewiki.google');
    }
  });

  it('renderMessage repo 名含特殊字符时 URL 转义不破坏', () => {
    const msg = renderMessage('2026-08-31', [item('o/r&x')])[0];
    expect(msg).toContain('deepwiki.com/o/r&amp;x');
  });
});
