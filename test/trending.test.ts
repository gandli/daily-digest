import { describe, it, expect, afterEach } from 'vitest';
import { fetchTrending } from '../src/sources/trending';

// vitest 无 CF runtime(无 HTMLRewriter)。这里是内存实现的最小 HTMLRewriter:
// tokenize HTML → 按选择器命中回调, handler 签名/取数路径与 workerd 语义一致
// (element/getAttribute + text 单块)。足够覆盖 trending.ts 的解析逻辑。

type Handlers = { selector: string; element?: (el: any) => void; text?: (t: any) => void };

function parseAttrs(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w-]+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(s))) out[m[1]] = m[2];
  return out;
}

// selector part: [tag][.class...][[attr=val|href$=...]]
function matchesEl(part: string, tag: string, attrs: Record<string, string>): boolean {
  let p = part;
  const t = p.match(/^([\w-]+)/);
  if (t) { if (t[1] !== tag) return false; p = p.slice(t[0].length); }
  const cls = (attrs.class ?? '').split(/\s+/).filter(Boolean);
  for (const c of p.matchAll(/\.([\w-]+)/g)) { if (!cls.includes(c[1])) return false; }
  for (const a of p.matchAll(/\[([\w-]+)(\$)?="([^"]*)"\]/g)) {
    const v = attrs[a[1]] ?? '';
    if (a[2]) { if (!v.endsWith(a[3])) return false; }
    else if (v !== a[3]) return false;
  }
  return true;
}

class HTMLRewriterStub {
  handlers: Handlers[] = [];
  on(selector: string, h: any) { this.handlers.push({ selector, ...h }); return this; }
  transform(res: Response) {
    const handlers = this.handlers;
    return {
      async arrayBuffer() {
        const html = await res.text();
        const specs = handlers.map((h: any) => ({ ...h, parts: h.selector.split(/\s+/) }));
        run(html, specs);
        return new ArrayBuffer(0);
      },
    };
  }
}

function run(html: string, specs: any[]) {
  const stack: { tag: string; attrs: Record<string, string> }[] = [];
  const collectors: { close: string; onText: (t: any) => void }[] = [];
  const re = /<(\/?)([\w-]+)((?:\s[^<>]*?)?)(\/?)>/g;
  let last = 0;
  let m;
  while ((m = re.exec(html))) {
    const text = html.slice(last, m.index);
    if (text) for (const c of collectors) c.onText({ text });
    last = re.lastIndex;
    const [, close, tag, rest] = m;
    if (close) {
      for (let i = collectors.length - 1; i >= 0; i--)
        if (collectors[i].close === tag) collectors.splice(i, 1);
      for (let i = stack.length - 1; i >= 0; i--) if (stack[i].tag === tag) { stack.length = i; break; }
      continue;
    }
    const attrs = parseAttrs(rest);
    stack.push({ tag, attrs });
    // 元素段必须命中栈顶(不跳过); 祖先段向上跳过中间节点逐一命中(后代匹配)
    const chain = stack.map((s) => ([s.tag, s.attrs] as const)).reverse(); // 内→外
    for (const spec of specs) {
      const parts = [...spec.parts].reverse(); // 元素段在前
      if (parts.length > chain.length) continue;
      if (!matchesEl(parts[0], chain[0][0], chain[0][1])) continue;
      let i = 0;
      let ok = true;
      for (let k = 1; k < parts.length; k++) {
        let found = false;
        for (let j = i + 1; j < chain.length; j++) {
          if (matchesEl(parts[k], chain[j][0], chain[j][1])) { found = true; i = j; break; }
        }
        if (!found) { ok = false; break; }
      }
      if (!ok) continue;
      if (spec.element) spec.element({ getAttribute: (n: string) => attrs[n] ?? null });
      if (spec.text) collectors.push({ close: tag, onText: spec.text });
    }
  }
}

(globalThis as any).HTMLRewriter = HTMLRewriterStub;

const origF = globalThis.fetch;
const mockPage = (html: string) => {
  globalThis.fetch = (async () =>
    new Response(html, { status: 200, headers: { 'content-type': 'text/html' } })) as typeof fetch;
};
const stubRow = (o: { owner?: string; name?: string; desc?: string; lang?: string; stars?: string; today?: string }) => {
  const { owner = 'owner', name = 'repo', desc = 'A repo description.', lang = 'TypeScript', stars = '12,345', today = '1,234 stars today' } = o;
  return `\n<article class="Box-row">\n  <h2 class="h3 lh-condensed"><a href="/${owner}/${name}">${owner}/${name}</a></h2>\n  <p class="col-9 color-fg-muted my-1 pr-4">${desc}</p>\n  <div class="f6 color-fg-muted mt-2">\n    <span itemprop="programmingLanguage">${lang}</span>\n    <a class="Link--muted d-inline-block mr-3" href="/${owner}/${name}/stargazers">${stars}</a>\n    <span class="d-inline-block float-sm-right"><a class="Link--muted" href="/${owner}/${name}/forks">1,023</a></span>\n    <span class="d-inline-block float-sm-right"><svg/>${today}</span>\n  </div>\n</article>`;
};

afterEach(() => { globalThis.fetch = origF; });

describe('fetchTrending', () => {
  it('解析典型 GitHub trending 行: 标题/链接/语言/星数/今日/描述', async () => {
    mockPage(`<html><body>${stubRow({})}</body></html>`);
    const items = await fetchTrending();
    expect(items).toHaveLength(1);
    const it = items[0];
    expect(it.title).toBe('owner/repo');
    expect(it.url).toBe('https://github.com/owner/repo');
    expect(it.desc).toBe('A repo description.');
    expect(it.lang).toBe('TypeScript');
    expect(it.stars).toBe(12345);
    expect(it.starsToday).toBe(1234);
  });

  it('多条目全部返回, 描述多余空白压缩', async () => {
    mockPage(`<html><body>${stubRow({ name: 'a', desc: 'line1\n\n    line2' })}${stubRow({ owner: 'b', name: 'two' })}</body></html>`);
    const items = await fetchTrending();
    expect(items).toHaveLength(2);
    expect(items[0].title).toBe('owner/a');
    expect(items[0].desc).toBe('line1 line2');
    expect(items[1].title).toBe('b/two');
  });

  it('缺描述/缺星数的条目正确略过, 不崩溃', async () => {
    // 无 desc → 不 push
    mockPage(`<html><body>${stubRow({ desc: '' })}${stubRow({ name: 'ok' })}</body></html>`);
    let items = await fetchTrending();
    expect(items).toEqual([expect.objectContaining({ title: 'owner/ok' })]);

    // 无星数(stars 为 "★" 不可数)→ 保留条目, stars 未定义
    mockPage(`<html><body>${stubRow({ stars: '★' })}</body></html>`);
    items = await fetchTrending();
    expect(items).toHaveLength(1);
    expect(items[0].stars).toBeUndefined();
  });

  it('超过 10 条只返回前 10', async () => {
    mockPage(`<html><body>${Array.from({ length: 12 }, (_, i) => stubRow({ name: `r${i}` })).join('')}</body></html>`);
    const items = await fetchTrending();
    expect(items).toHaveLength(10);
    expect(items[0].title).toBe('owner/r0');
    expect(items[9].title).toBe('owner/r9');
  });

  it('handler 边界: article 外的 h2 a/desc 命中(!cur) → 忽略', async () => {
    // 页头/页脚散落的同类选择器, cur=null 时 element/text 回调必须不崩
    mockPage(`<html><body>
      <h2><a href="/stray/lonely">stray/lonely</a></h2>
      <p class="col-9">stray description outside article</p>
      ${stubRow({ name: 'ok' })}
    </body></html>`);
    const items = await fetchTrending();
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe('owner/ok');
  });

  it('h2 内非 repo 链接(/blob/xxx、/topics/x) → 不设 title, 条目丢弃', async () => {
    mockPage(`<html><body>${stubRow({})}</body></html>`.replace('/owner/repo', '/owner/repo/blob/main/README.md'));
    const items = await fetchTrending();
    expect(items).toHaveLength(0);
  });

  it('lang 空/重复文本 → 首个非空生效, 后续忽略', async () => {
    // itemprop span 内两块文本: 空白块 + 实义块 → 只取实义
    mockPage(`<html><body><article class="Box-row">
      <h2><a href="/o/l">o/l</a></h2>
      <span itemprop="programmingLanguage">  </span><span itemprop="programmingLanguage">Go</span><span itemprop="programmingLanguage">Rust</span>
      <p class="col-9">d</p>
    </article></body></html>`);
    const items = await fetchTrending();
    expect(items[0].lang).toBe('Go');
  });

  it('stargazers 重复命中(多链接) → 首次数值生效(stars !== undefined 短路)', async () => {
    mockPage(`<html><body><article class="Box-row">
      <h2><a href="/o/s">o/s</a></h2>
      <a href="/o/s/stargazers">1,000</a><a href="/o/s/stargazers">2,000</a>
      <p class="col-9">d</p>
    </article></body></html>`);
    const items = await fetchTrending();
    expect(items[0].stars).toBe(1000);
  });

  it('stars today 变体(无逗号)→ 解析成功', async () => {
    mockPage(`<html><body>${stubRow({ today: '999 stars today' })}</body></html>`);
    const items = await fetchTrending();
    expect(items[0].starsToday).toBe(999);
  });

  it('非 200 → 抛 trending fetch <status>', async () => {
    globalThis.fetch = (async () => new Response('', { status: 500 })) as typeof fetch;
    await expect(fetchTrending()).rejects.toThrow('trending fetch 500');
  });

  it('网络错误(fetch reject)→ 抛错', async () => {
    globalThis.fetch = (async () => { throw new Error('boom'); }) as typeof fetch;
    await expect(fetchTrending()).rejects.toThrow('boom');
  });
});