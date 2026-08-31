// 不变量: X 帖无 OPENROUTER_API_KEY / LLM 全挂时也必须出兜底标题, 不裸显整段英文。
// generateTitleZh 本身保持 null 语义(文章卡有真标题, 不能被截)。
import { describe, it, expect } from 'vitest';
import { generateTweetTitle } from '../src/translate';

const mkNoKey = () => ({ OPENROUTER_API_KEY: undefined } as never);

describe('generateTweetTitle 无 key 兜底(heuristicTitle)', () => {
  it('中文原文 → 首句截20', async () => {
    expect(await generateTweetTitle(mkNoKey(), '这是超长中文帖子首句应该被截到二十个字符以内。后面还有第二句。')).toBe('这是超长中文帖子首句应该被截到二十个字符');
  });
  it('英文原文 → 按词不超20, 去 URL/@', async () => {
    expect(await generateTweetTitle(mkNoKey(), 'Hey @alice check https://x.com/foo this is a long English post!')).toBe('Hey check this is a');
  });
  it('LLM 命中 → 用 LLM 标题, 不走兜底', async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ choices: [{ message: { content: '中文标题命中' } }] }), { status: 200 })) as typeof fetch;
    expect(await generateTweetTitle({ OPENROUTER_API_KEY: 'sk' } as never, 'english text')).toBe('中文标题命中');
  });
  it('仅 @ 与 URL → null(交调用方回退 X Post · @handle)', async () => {
    expect(await generateTweetTitle(mkNoKey(), '@alice https://x.com/a')).toBeNull();
  });
});
