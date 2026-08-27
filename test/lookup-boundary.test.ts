import { describe, it, expect } from 'vitest';
// 边界补测: archiveLinks 降级组合 + topicsFromTitle 中文/无匹配 + refreshLookupDescriptions KV 失败静默。
import { archiveLinks, refreshLookupDescriptions } from '../src/lookup';
import { topicsFromTitle } from '../src/index';

describe('archiveLinks 全空/降级组合', () => {
  const md = 'https://github.com/x/y/blob/archive/archive/2026/2026-08-26.md';
  it('tgUrl+mdLink, 无 url → 无 Wayback, 前 Telegraph 后 Archive', () => {
    const s = archiveLinks(undefined, 'https://telegra.ph/zz', md);
    expect(s.indexOf('Telegraph')).toBeLessThan(s.indexOf('Archive'));
    expect(s).not.toContain('web.archive.org');
  });
  it('url+mdLink, 空 tgUrl 字符串(非 undefined) → 不渲染 Telegraph', () => {
    const s = archiveLinks('https://example.com/a', '', md);
    expect(s).not.toContain('Telegraph');
    expect(s).toContain('Wayback');
  });
  it('空 url 字符串 → 无 Wayback', () => {
    const s = archiveLinks('', undefined, md);
    expect(s).not.toContain('web.archive.org');
    expect(s).toContain('Archive');
  });
  it('全空 → 仍渲染 Archive 兜底链(href 空, 不炸)', () => {
    expect(archiveLinks(undefined, undefined, '')).toBe('<a href="">Archive</a>');
  });
  it('mdLink 含 HTML 特殊字符不转义(信任调用方拼 GitHub URL)', () => {
    const s = archiveLinks(undefined, undefined, 'https://github.com/a/b/blob/archive/archive/2026/2026-01-01.md');
    expect(s).toContain('https://github.com/a/b/blob/archive/archive/2026/2026-01-01.md');
  });
});

describe('topicsFromTitle: HN 标题领域标签', () => {
  it('中文标题含 AI 词 → 提取 ai', () => {
    expect(topicsFromTitle('AI 编程助手工具')).toContain('ai');
  });
  it('中文标题含 GitHub/开源词 → open-source', () => {
    expect(topicsFromTitle('GitHub 上最火的开源项目')).toContain('open-source');
  });
  it('中文标题含 手机/App → mobile', () => {
    expect(topicsFromTitle('手机 App 推荐')).toContain('mobile');
  });
  it('无领域词 → []', () => {
    expect(topicsFromTitle('今天天气不错')).toEqual([]);
  });
  it('空串 → []', () => {
    expect(topicsFromTitle('')).toEqual([]);
  });
  it('多词命中去重(同 tag 一次)且 ≤4', () => {
    const t = topicsFromTitle('AI agent for Linux desktop software with web browser API');
    expect(new Set(t).size).toBe(t.length);
    expect(t.length).toBeLessThanOrEqual(4);
    expect(t).toContain('ai');
  });
});

describe('refreshLookupDescriptions: KV 失败静默', () => {
  it('CACHE.list 抛错 → 静默返回(不抛出)', async () => {
    const badEnv = { CACHE: { list: async () => { throw new Error('kv down'); } } } as never;
    await expect(refreshLookupDescriptions(badEnv)).resolves.toBeUndefined();
  });
  it('条目 get 损坏 JSON → 跳过继续不抛', async () => {
    const store = new Map<string, string>([['lookup:desc:a/b', 'not-json']]);
    const env = { CACHE: {
      list: async () => Promise.resolve({ keys: [{ name: 'lookup:desc:a/b' }], list_complete: true }),
      get: async (k: string) => store.get(k) ?? null,
      put: async () => { throw new Error('never'); },
    } } as never;
    await expect(refreshLookupDescriptions(env)).resolves.toBeUndefined();
  });
  it('条目新鲜(<7天) → 跳过不重跑', async () => {
    const fresh = { zh: '中文描述', ts: Date.now() };
    const store = new Map<string, string>([['lookup:desc:a/b', JSON.stringify(fresh)]]);
    let putCalls = 0;
    const env = { CACHE: {
      list: async () => Promise.resolve({ keys: [{ name: 'lookup:desc:a/b' }], list_complete: true }),
      get: async (k: string) => store.get(k) ?? null,
      put: async () => { putCalls++; },
    } } as never;
    await refreshLookupDescriptions(env);
    expect(putCalls).toBe(0);
  });
});
