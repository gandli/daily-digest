// deepwiki RSC payload 解析: extractDeepwikiOverview 关键路径。
// 样例须对准函数真实的模板正则(仅 "This page provides a comprehensive introduction to X, ..." 这类发起形态)。
import { describe, it, expect, afterEach } from 'vitest';
import { extractDeepwikiOverview, fetchDeepwikiOverview, fetchDeepwikiBatch } from '../src/deepwiki';

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

  it('body 后无正文(bodyMatch null) → null', () => {
    // details 后直接是标题, 无首字母大写正文段
    expect(extractDeepwikiOverview(mk('\n### Only Heading Here'))).toBeNull();
  });

  it('模板剥离后全空 → null(line 35)', () => {
    // 只有模板开场白, 逗号后无实义 → stripped 空
    expect(extractDeepwikiOverview(mk('\nThis page provides an introduction to X, ,\n###'))).toBeNull();
  });

  it('maxLen 截断 → 尾部省略号', () => {
    const long = 'A'.repeat(500);
    const out = extractDeepwikiOverview(mk(`\n${long}\n### End`), 100);
    expect(out!.length).toBe(100);
    expect(out!.endsWith('…')).toBe(true);
  });

  it('正文含代码/链接/markdown 语法 → 清洗为纯文本', () => {
    const payload = mk('\nThis tool does `codegen` and [links](http://x) with #heading and *stars* everywhere. It is quite useful for daily work.\n### Next');
    const out = extractDeepwikiOverview(payload);
    expect(out).not.toContain('`');
    expect(out).not.toContain('[');
    expect(out).toContain('links');
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
  it('真实 chunk 流: JSON.parse 拼接 payload → 成功提取(line 51/54)', async () => {
    const inner = 'Overview:<details><summary>R</summary></details>\nThis page provides an introduction to Zed, a fast collaborative code editor built in Rust.\n### More';
    const chunk = JSON.stringify(inner);
    globalThis.fetch = (async () => new Response(`self.__next_f.push([1,${chunk}]);self.__next_f.push([1," tail"])`)) as typeof fetch;
    const out = await fetchDeepwikiOverview('zed/zed');
    expect(out).toContain('collaborative code editor');
  });
  it('chunk JSON 损坏 → catch → null', async () => {
    globalThis.fetch = (async () => new Response('self.__next_f.push([1,"not\\\\\\"valid"]])')) as typeof fetch;
    expect(await fetchDeepwikiOverview('x/y')).toBeNull();
  });
});

describe('fetchDeepwikiBatch', () => {
  const origF = globalThis.fetch;
  afterEach(() => { globalThis.fetch = origF; });
  it('批量: 成功的进 Map, 失败的跳过(line 66)', async () => {
    globalThis.fetch = (async (i: RequestInfo | URL) => {
      const repo = String(i).split('/').slice(-2).join('/');
      if (repo === 'good/repo') {
        const inner = 'Overview:<details><summary>R</summary></details>\nThis page provides an introduction to Good, it works well for everyone.\n### More';
        return new Response(`self.__next_f.push([1,${JSON.stringify(inner)}])`);
      }
      return new Response('', { status: 500 });
    }) as typeof fetch;
    const out = await fetchDeepwikiBatch(['good/repo', 'bad/repo']);
    expect(out.has('good/repo')).toBe(true);
    expect(out.has('bad/repo')).toBe(false);
  });
});