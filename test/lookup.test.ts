// lookup 功能测试: GitHub 链接提取。
import { describe, it, expect } from 'vitest';
import { extractRepo, extractRepoRefs } from '../src/lookup';

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

describe('extractRepoRefs: 存档内容 repo 联动扫描', () => {
  it('提取去重 + 上限 3', () => {
    const refs = extractRepoRefs('see https://github.com/a/b and https://github.com/a/b again, https://github.com/c/d, https://github.com/e/f, https://github.com/g/h');
    expect(refs).toEqual(['a/b', 'c/d', 'e/f']);
  });
  it('滤掉文件路径后缀', () => {
    expect(extractRepoRefs('https://github.com/x/y/blob/main/index.js https://github.com/ok/fine')).toEqual(['x/y', 'ok/fine']);
  });
});

// ---------- 重发语义: shouldReprocess 三态判定 ----------
import { shouldReprocess } from '../src/lookup';

describe('shouldReprocess: 同 URL 重发是否重跑全管线', () => {
  const kv = new Map<string, string>();
  const env = { CACHE: { get: (k: string) => kv.get(k) ?? null, put: async (k: string, v: string) => void kv.set(k, v) } } as never;
  const url = 'https://example.com/a';
  const key = 'reproc:https://example.com/a';
  it('首次提交 → first(正常处理)', async () => {
    expect(await shouldReprocess(env, url)).toBe('first');
    expect(kv.get(key)).toBeTruthy();
  });
  it('上次未翻译(translated=false) → retry', async () => {
    await env.CACHE.put(key, JSON.stringify({ ts: Date.now(), translated: false, descOk: true }));
    expect(await shouldReprocess(env, url)).toBe('retry');
  });
  it('上次无描述(descOk=false) → retry', async () => {
    await env.CACHE.put(key, JSON.stringify({ ts: Date.now(), translated: true, descOk: false }));
    expect(await shouldReprocess(env, url)).toBe('retry');
  });
  it('上次成功(translated+descOk) → done', async () => {
    await env.CACHE.put(key, JSON.stringify({ ts: Date.now(), translated: true, descOk: true }));
    expect(await shouldReprocess(env, url)).toBe('done');
  });
  it('损坏值/缺失字段 → 宽松视同首次(不无限重试)', async () => {
    await env.CACHE.put(key, 'garbage');
    expect(await shouldReprocess(env, url)).toBe('first');
    kv.delete(key);
    expect(await shouldReprocess(env, url)).toBe('first'); // 无记录=首次
  });
});

// ---------- seenToday 去重标记 ----------
import { seenToday, markProcessed } from '../src/lookup';

describe('seenToday: 同日 repo 去重', () => {
  // mock today() 不可直接; seenToday 用内部 today()=北京时间. 用真实日期键检查行为
  const kvm = new Map<string, string>();
  const envm = { CACHE: { get: (k: string) => kvm.get(k) ?? null, put: async (k: string, v: any) => void kvm.set(k, v) } } as never;
  const repo = 'NousResearch/Agent';

  it('首次 → false 并写去重标记', async () => {
    expect(await seenToday(envm, repo)).toBe(false);
    // 标记键含今日日期(repo 小写)
    const skey = [...kvm.keys()].find((k) => k.startsWith('lookup:') && k.endsWith('nousresearch/agent'));
    expect(skey).toBeTruthy();
  });
  it('同日再次 → true(去重)', async () => {
    expect(await seenToday(envm, 'NousResearch/Agent')).toBe(true);
  });
  it('不同 repo → false', async () => {
    expect(await seenToday(envm, 'Other/Repo')).toBe(false);
  });
});

describe('markProcessed: 重发质量回填 + md stamp', () => {
  const kvm = new Map<string, string>();
  const envm = { CACHE: { get: (k: string) => kvm.get(k) ?? null, put: async (k: string, v: any) => void kvm.set(k, v) } } as never;
  const url = 'https://example.com/long-url-'.padEnd(500, 'x');
  const key = `reproc:${url.slice(0, 400)}`;

  it('写 translated/descOk/md, 键截断 400 对齐 shouldReprocess', async () => {
    await markProcessed(envm, url, true, true, '2026-08-26-12345');
    const saved = JSON.parse(kvm.get(key)!);
    expect(saved.translated).toBe(true);
    expect(saved.descOk).toBe(true);
    expect(saved.md).toBe('2026-08-26-12345');
    expect(key.length).toBeLessThanOrEqual(400 + 'reproc:'.length);
  });
  it('long url 截断后重发判定仍对齐', async () => {
    expect(await shouldReprocess(envm, url)).toBe('done'); // md 写入, translated+descOk true
  });
  it('写失败静默(不抛)', async () => {
    const badEnv = { CACHE: { put: async () => { throw new Error('kv down'); } } } as never;
    await expect(markProcessed(badEnv, 'https://e.com', true, true)).resolves.toBeUndefined();
  });
});
