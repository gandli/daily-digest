// lookup 功能测试: GitHub 链接提取。
import { describe, it, expect } from 'vitest';
import { extractRepo } from '../src/lookup';

describe('extractRepo: 从消息文本提取 GitHub 仓库', () => {
  it('https://github.com/owner/repo', () => {
    expect(extractRepo('看看这个 https://github.com/nousresearch/hermes-agent 项目')).toBe('nousresearch/hermes-agent');
  });
  it('带子路径 blob/tree → 仍提取 owner/repo', () => {
    expect(extractRepo('https://github.com/openai/codex/blob/main/README.md 好用')).toBe('openai/codex');
  });
  it('www 前缀', () => {
    expect(extractRepo('https://www.github.com/vercel/next.js')).toBe('vercel/next.js');
  });
  it('裸 owner/repo 无协议', () => {
    expect(extractRepo('这个仓库真是好东西 basecamp/omarchy 推荐')).toBe('basecamp/omarchy');
  });
  it('非 github 链接 → null', () => {
    expect(extractRepo('https://gitlab.com/group/repo')).toBeNull();
  });
  it('无链接 → null', () => {
    expect(extractRepo('今晚吃什么')).toBeNull();
  });
  it('含尾标点 → 干净提取', () => {
    expect(extractRepo('https://github.com/mattpocock/skills。')).toBe('mattpocock/skills');
  });
});

// ---------- 兜底翻译逻辑 ----------
import { isChinese } from '../src/translate';
describe('lookup 兜底: GitHub desc 翻译', () => {
  it('中文 desc 直接用(不翻译)', () => {
    expect(isChinese('糟糕，我被基佬包围了！快来看看jilaoskill吧')).toBe(true);
  });
  it('英文 desc 需翻译', () => {
    expect(isChinese('This is an English repository description.')).toBe(false);
  });
});
describe('extractRepo: 文件名形态排除(P2-J)', () => {
  it('src/utils.ts → null(不当仓库)', () => {
    expect(extractRepo('改一下 src/utils.ts 这个文件')).toBeNull();
  });
  it('vite.config.js → null', () => {
    expect(extractRepo('vite.config.js')).toBeNull();
  });
  it('真裸仓库不受影响', () => {
    expect(extractRepo('推荐 basecamp/omarchy')).toBe('basecamp/omarchy');
  });
});
