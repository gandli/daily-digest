// deepwiki RSC payload 解析: extractDeepwikiOverview 关键路径。
// 样例须对准函数真实的模板正则(仅 "This page provides a comprehensive introduction to X, ..." 这类发起形态)。
import { describe, it, expect, afterEach } from 'vitest';
import { extractDeepwikiOverview, fetchDeepwikiOverview } from '../src/deepwiki';

// 真实 deepwiki 页解析后 payload: Overview:<details>...</details> 后接真实换行 + 正文
const mk = (after: string) => 'self.__next_f.push([1,"Overview:<details><summary>R</summary></details>' + after + '"])';

describe('extractDeepwikiOverview', () => {
  it('标准: 模板开场白剥离, 取逗号后实义', () => {
    const payload = mk('\nThis page provides an introduction to The Framework, a lightweight library for building CLI tools.\n### Deep dive');
    const out = extractDeepwikiOverview(payload);
    expect(out).toContain('lightweight library for building CLI tools');
    expect(out).not.toMatch(/introduction to/);
  });

  it('comprehensive 形态同样剥离', () => {
    const payload = mk('\nThis page provides a comprehensive introduction to Foo, Bar does X and Y.\n### D');
    const out = extractDeepwikiOverview(payload);
    expect(out).toContain('Bar does X and Y');
    expect(out).not.toMatch(/comprehensive introduction/);
  });

  it('无 Overview marker → null', () => {
    expect(extractDeepwikiOverview('just some text')).toBeNull();
  });

  it('body 太短 → null', () => {
    expect(extractDeepwikiOverview(mk('\nShort.\n###'))).toBeNull();
  });
});

describe('fetchDeepwikiOverview: 网络路径', () => {
  const origF = globalThis.fetch;
  afterEach(() => { globalThis.fetch = origF; });
  it('HTTP 非200 → null', async () => {
    globalThis.fetch = (async () => new Response('', { status: 404 })) as typeof fetch;
    expect(await fetchDeepwikiOverview('x/y')).toBeNull();
  });
  it('无 chunk(payload 空) → null', async () => {
    globalThis.fetch = (async () => new Response('no chunks here')) as typeof fetch;
    expect(await fetchDeepwikiOverview('x/y')).toBeNull();
  });
  it('网络异常 → null(不抛)', async () => {
    globalThis.fetch = (async () => { throw new Error('net'); }) as typeof fetch;
    expect(await fetchDeepwikiOverview('x/y')).toBeNull();
  });
});