import { describe, it, expect } from 'vitest';
import { extractTweet } from '../src/fxtweet';

// fxZh 优先级判定逻辑与 index.ts archiveTweet 内联实现保持同构(纯函数镜像, 防回归)
const pickTextZh = (tweetText: string | undefined, fxZh: string | undefined | null): string | null => {
  if (!tweetText) return null;
  const isChinese = (s: string) => /[\u4e00-\u9fff]/.test(s);
  return fxZh && isChinese(fxZh) && fxZh !== tweetText ? fxZh : tweetText; // 四级链调用点此处仅返回非空语义
};

describe('FxEmbed /zh-cn 翻译优先级', () => {
  const en = 'PoC released for CVE-2026-26119 in Windows Admin Center';
  it('fxZh 中文译文 → 直接采用', () => {
    expect(pickTextZh(en, 'Windows Admin Center 中 CVE-2026-26119 漏洞的 PoC 已发布')).toContain('PoC 已发布');
  });
  it('fxZh 空(grok 偶发) → 落四级链(返回原值由链路处理)', () => {
    expect(pickTextZh(en, undefined)).toBe(en);
    expect(pickTextZh(en, '')).toBe(en);
  });
  it('中文原帖 → 不翻译(fxZh===原文 或 原文本就中文)', () => {
    const zh = '中文帖子内容';
    expect(pickTextZh(zh, zh)).toBe(zh);
  });
  it('URL 后缀规范化: extractTweet 不受 /zh-cn 影响', () => {
    expect(extractTweet('https://x.com/user/status/123456789/zh-cn')).toEqual({ handle: 'user', id: '123456789' });
  });
});
