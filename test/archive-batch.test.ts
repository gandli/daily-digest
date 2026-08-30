// archive 批量提交回归锁: 三个存档函数只写 KV 缓冲(pend:arc:*, 零 GitHub 请求);
// flushArchivedPending 用 Git Data API 把 N 个文件打成单个 commit(ref→blobs→tree→commits→refs),
// 成功才删 pend 键; 任一步失败保留缓冲; ref 非快进冲突重取 base 重试一次(blob sha 复用)。
import { describe, it, expect, beforeEach } from 'vitest';
import worker from '../src/index';
import { archiveToGitHub, archiveDatedToGitHub, archiveOgImage, flushArchivedPending } from '../src/archive';

type Call = { url: string; method: string; body: any };
const calls: Call[] = [];
const origFetch = globalThis.fetch;

type Route = { match: (u: string, m: string) => boolean; status?: number | (() => number); json?: unknown | (() => unknown); body?: Uint8Array };
const dyn = <T>(v: T | (() => T), dflt: T): T => (typeof v === 'function' ? (v as () => T)() : (v ?? dflt));

/** 记录全部调用的路由式 fetch stub; 未命中路由抛错(暴露意外外呼)。 */
function mockFetch(routes: Route[]) {
  calls.length = 0;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const u = String(input);
    const m = init?.method ?? 'GET';
    calls.push({ url: u, method: m, body: JSON.parse(String(init?.body ?? '{}')) });
    const r = routes.find((r) => r.match(u, m));
    if (!r) throw new Error(`unexpected: ${m} ${u}`);
    if (r.body) return new Response(r.body, { status: dyn(r.status, 200), headers: { 'content-type': 'application/octet-stream' } });
    return new Response(JSON.stringify(dyn(r.json, {} as unknown)), { status: dyn(r.status, 200), headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
}

function memKv() {
  const store = new Map<string, string>();
  return {
    list: async ({ prefix }: { prefix: string }) =>
      ({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
    get: async (k: string) => store.get(k) ?? null,
    put: async (k: string, v: string) => { store.set(k, v); },
    delete: async (k: string) => { store.delete(k); },
    get store() { return store; },
  } as any;
}

const env = (kv = memKv()) => ({ GH_TOKEN: 'tok', GH_ARCHIVE_REPO: 'gandli/daily-digest', CACHE: kv }) as any;
const pendKeys = (kv: any) => [...kv.store.keys()].filter((k) => k.startsWith('pend:arc:'));
const b64 = (s: string) => Buffer.from(s).toString('base64');
const gh = () => calls.filter((c) => c.url.includes('api.github.com'));

/** Git Data API 全 happy-path 路由; refConflicts = PATCH 返回 409 的次数(其后 200)。 */
function gitRoutes(refConflicts = 0) {
  const s = { refReads: 0, blobN: 0, treeN: 0, commitN: 0, patchN: 0 };
  const routes: Route[] = [
    { match: (u, m) => u.includes('/git/ref/heads/archive') && m === 'GET', json: () => ({ object: { sha: s.refReads++ === 0 ? 'basesha' : 'basesha2' } }) },
    { match: (u, m) => u.includes('/git/commits/') && m === 'GET', json: { tree: { sha: 'treeshabase' } } },
    { match: (u, m) => u.includes('/git/blobs') && m === 'POST', json: () => ({ sha: `blob${s.blobN++}` }) },
    { match: (u, m) => u.includes('/git/trees') && m === 'POST', json: () => ({ sha: `newtree${s.treeN++}` }) },
    { match: (u, m) => u.endsWith('/git/commits') && m === 'POST', json: () => ({ sha: `newcommit${s.commitN++}` }) },
    { match: (u, m) => u.includes('/git/refs/heads/archive') && m === 'PATCH', status: () => (s.patchN++ < refConflicts ? 409 : 200), json: { ok: true } },
  ];
  return { routes, s };
}

beforeEach(() => { globalThis.fetch = origFetch; calls.length = 0; });

describe('存档缓冲: 只写 KV, 零 GitHub 请求', () => {
  it('archiveToGitHub → 写 pend 键(path/content base64/encoding/message), 不发任何 Contents API 请求', async () => {
    const kv = memKv();
    // 放行所有 GitHub 请求 → 若缓冲层错误地直连, 会被记录到
    mockFetch([{ match: (u) => u.includes('api.github.com'), json: {} }]);
    await archiveToGitHub(env(kv), '2026-08-28', '# markdown 正文');
    expect(gh().length).toBe(0); // 无 ref/contents/任何 GitHub 外呼
    const keys = pendKeys(kv);
    expect(keys.length).toBe(1);
    const item = JSON.parse(kv.store.get(keys[0])!);
    expect(item.path).toBe('archive/2026/2026-08-28.md');
    expect(item.content).toBe(b64('# markdown 正文'));
    expect(item.encoding).toBe('utf-8');
    expect(item.message).toBe('digest: 2026-08-28');
  });

  it('archiveDatedToGitHub → 完整时间戳路径 + archive: 前缀 message', async () => {
    const kv = memKv();
    mockFetch([{ match: (u) => u.includes('api.github.com'), json: {} }]);
    await archiveDatedToGitHub(env(kv), '2026-08-28-1234567', '# tweet');
    const item = JSON.parse(kv.store.get(pendKeys(kv)[0])!);
    expect(item.path).toBe('archive/2026/2026-08-28-1234567.md');
    expect(item.message).toBe('archive: 2026-08-28-1234567');
  });

  it('archiveOgImage → PNG 以 base64 编码缓冲(encoding=base64), 返回相对路径, 零 PUT', async () => {
    const kv = memKv();
    const png = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
    mockFetch([
      { match: (u) => u.includes('opengraph.githubassets.com'), body: png },
      { match: (u) => u.includes('/contents/og-images/'), status: 404 }, // 已入库检查: 无
      { match: (u) => u.includes('api.github.com'), json: {} },
    ]);
    const rel = await archiveOgImage(env(kv), 'owner/Repo');
    expect(rel).toBe('../../og-images/owner__Repo.png');
    expect(gh().filter((c) => c.method === 'PUT').length).toBe(0); // 不再即时 PUT
    const item = JSON.parse(kv.store.get(pendKeys(kv)[0])!);
    expect(item.path).toBe('og-images/owner__Repo.png');
    expect(item.encoding).toBe('base64');
    expect(Buffer.from(item.content, 'base64')).toEqual(Buffer.from(png)); // 二进制无损
  });

  it('KV put 抛错 → 回落即时 Contents PUT(不静默丢档), 不抛', async () => {
    const kv = memKv();
    kv.put = async () => { throw new Error('kv down'); };
    mockFetch([
      { match: (u) => u.includes('?ref=archive'), status: 404 },
      { match: (u) => u.includes('/contents/'), json: { content: {} } },
    ]);
    await expect(archiveToGitHub(env(kv), '2026-08-28', '# x')).resolves.toBe(true);
    expect(gh().some((c) => c.method === 'PUT' && c.url.includes('/contents/'))).toBe(true);
    expect(pendKeys(kv).length).toBe(0);
  });
});

describe('flushArchivedPending: 空缓冲 / 单 commit / 删键', () => {
  it('空缓冲 → 返回 0 且零请求', async () => {
    mockFetch([{ match: () => true, json: {} }]);
    expect(await flushArchivedPending(env())).toBe(0);
    expect(gh().length).toBe(0);
  });

  it('N 个文件 → ref→base commit→blobs→tree→commit→ref PATCH 一次打成单 commit, 成功后删 pend 键', async () => {
    const kv = memKv();
    await archiveToGitHub(env(kv), '2026-08-28', '# digest');
    await archiveDatedToGitHub(env(kv), '2026-08-28-111', '# tweet a');
    await archiveDatedToGitHub(env(kv), '2026-08-28-222', '# tweet b');
    const { routes } = gitRoutes();
    mockFetch(routes);
    expect(await flushArchivedPending(env(kv))).toBe(3);
    // 调用序列: ref → base commit → 3 blobs → tree → commit → ref PATCH(全程无 /contents/)
    const seq = gh().map((c) => `${c.method} ${c.url.split('/git/')[1] ?? c.url}`);
    expect(seq).toEqual([
      'GET ref/heads/archive',
      'GET commits/basesha',
      'POST blobs', 'POST blobs', 'POST blobs',
      'POST trees',
      'POST commits',
      'PATCH refs/heads/archive',
    ]);
    expect(gh().some((c) => c.url.includes('/contents/'))).toBe(false);
    // tree: base_tree + 3 条目(blob sha 与 POST 顺序一致)
    const tree = gh().find((c) => c.url.includes('/git/trees') && c.method === 'POST')!;
    expect(tree.body.base_tree).toBe('treeshabase');
    expect(tree.body.tree.map((t: any) => t.path).sort()).toEqual([
      'archive/2026/2026-08-28-111.md', 'archive/2026/2026-08-28-222.md', 'archive/2026/2026-08-28.md',
    ]);
    expect(tree.body.tree.every((t: any) => t.type === 'blob' && t.sha === `blob${tree.body.tree.indexOf(t)}` && t.mode === '100644')).toBe(true);
    // commit: message + tree + parent
    const commit = gh().find((c) => c.url.endsWith('/git/commits') && c.method === 'POST')!;
    expect(commit.body.message).toBe('archive: batch 3 items');
    expect(commit.body.tree).toBe('newtree0');
    expect(commit.body.parents).toEqual(['basesha']);
    // ref 更新: 非强制
    const patch = gh().find((c) => c.method === 'PATCH')!;
    expect(patch.body).toEqual({ sha: 'newcommit0', force: false });
    // 成功后缓冲清空
    expect(pendKeys(kv).length).toBe(0);
  });

  it('同路径多次缓冲 → 去重只建一个 blob, 取最后写入的内容', async () => {
    const kv = memKv();
    await archiveToGitHub(env(kv), '2026-08-28', '# 旧版');
    await archiveToGitHub(env(kv), '2026-08-28', '# 新版');
    const { routes } = gitRoutes();
    mockFetch(routes);
    expect(await flushArchivedPending(env(kv))).toBe(1);
    const blobs = gh().filter((c) => c.url.includes('/git/blobs') && c.method === 'POST');
    expect(blobs.length).toBe(1);
    expect(blobs[0].body.content).toBe('# 新版'); // 后写覆盖先写(utf-8 blob 内容为原文)
    expect(pendKeys(kv).length).toBe(0);
  });

  it('损坏的 pend 条目 → 跳过不进批(键保留), 其余正常刷', async () => {
    const kv = memKv();
    await archiveToGitHub(env(kv), '2026-08-28', '# ok');
    kv.store.set('pend:arc:corrupt', 'not json {{{');
    const { routes } = gitRoutes();
    mockFetch(routes);
    expect(await flushArchivedPending(env(kv))).toBe(1);
    expect(kv.store.get('pend:arc:corrupt')).toBe('not json {{{'); // 损坏键保留
    expect(pendKeys(kv).length).toBe(1);
  });
});

describe('flushArchivedPending: 失败保留缓冲', () => {
  it('blob 建失败(500) → 返回 0, pend 键全保留, 后续 tree/refs 零请求', async () => {
    const kv = memKv();
    await archiveToGitHub(env(kv), '2026-08-28', '# a');
    await archiveToGitHub(env(kv), '2026-08-29', '# b');
    mockFetch([
      { match: (u, m) => u.includes('/git/ref/heads/archive') && m === 'GET', json: { object: { sha: 'basesha' } } },
      { match: (u, m) => u.includes('/git/commits/') && m === 'GET', json: { tree: { sha: 'treeshabase' } } },
      { match: (u, m) => u.includes('/git/blobs') && m === 'POST', status: 500 },
    ]);
    expect(await flushArchivedPending(env(kv))).toBe(0);
    expect(pendKeys(kv).length).toBe(2);
    expect(gh().some((c) => c.url.includes('/git/trees') || c.url.includes('/git/refs'))).toBe(false);
  });

  it('ref 更新两次都冲突(409) → 重试一次后放弃, pend 键保留', async () => {
    const kv = memKv();
    await archiveToGitHub(env(kv), '2026-08-28', '# a');
    const { routes } = gitRoutes(2); // 两次 PATCH 都 409
    mockFetch(routes);
    expect(await flushArchivedPending(env(kv))).toBe(0);
    expect(pendKeys(kv).length).toBe(1);
    // 重试时重新取了 base(第二次 ref 读)且未强推(force 恒 false)
    expect(gh().filter((c) => c.url.includes('/git/ref/heads/archive') && c.method === 'GET').length).toBe(2);
    expect(gh().every((c) => c.method !== 'PATCH' || c.body.force === false)).toBe(true);
  });

  it('ref 读取失败(分支不存在 404) → 返回 0 且零 blob 请求, pend 键保留', async () => {
    const kv = memKv();
    await archiveToGitHub(env(kv), '2026-08-28', '# a');
    mockFetch([{ match: (u) => u.includes('/git/ref/heads/archive'), status: 404 }]);
    expect(await flushArchivedPending(env(kv))).toBe(0);
    expect(pendKeys(kv).length).toBe(1);
    expect(gh().filter((c) => c.url.includes('/git/blobs')).length).toBe(0);
  });
});

describe('flushArchivedPending: ref 冲突重试成功(blob sha 复用)', () => {
  it('首次 PATCH 409 → 重取 base 重建 tree 再提交 → 第二次成功删键', async () => {
    const kv = memKv();
    await archiveToGitHub(env(kv), '2026-08-28', '# a');
    await archiveToGitHub(env(kv), '2026-08-29', '# b');
    const { routes } = gitRoutes(1); // 第一次 409, 第二次 200
    mockFetch(routes);
    expect(await flushArchivedPending(env(kv))).toBe(2);
    // blob 只建一次(重试复用 sha), tree/commit 各两次(重建), PATCH 两次
    expect(gh().filter((c) => c.url.includes('/git/blobs') && c.method === 'POST').length).toBe(2);
    expect(gh().filter((c) => c.url.includes('/git/trees') && c.method === 'POST').length).toBe(2);
    expect(gh().filter((c) => c.url.endsWith('/git/commits') && c.method === 'POST').length).toBe(2);
    const tree2 = gh().filter((c) => c.url.includes('/git/trees') && c.method === 'POST')[1];
    expect(tree2.body.base_tree).toBe('treeshabase');
    const commit2 = gh().filter((c) => c.url.endsWith('/git/commits') && c.method === 'POST')[1];
    expect(commit2.body.parents).toEqual(['basesha2']); // 第二次 ref 读返回的新 base
    expect(pendKeys(kv).length).toBe(0);
  });
});

describe('flushArchivedPending: 失败/边界分支补全', () => {
  it('条目 JSON 合法但缺 path / content 非串 → 全部跳过: 返回 0 零请求, 键保留', async () => {
    const kv = memKv();
    kv.store.set('pend:arc:a1', JSON.stringify({ path: '', content: b64('# x'), encoding: 'utf-8', message: 'm' })); // path 缺失
    kv.store.set('pend:arc:a2', JSON.stringify({ path: 'a.md', content: 123, encoding: 'utf-8', message: 'm' })); // content 非串
    mockFetch([{ match: () => true, json: {} }]);
    expect(await flushArchivedPending(env(kv))).toBe(0);
    expect(gh().length).toBe(0);
    expect(pendKeys(kv).length).toBe(2);
  });

  it('blob 外呼网络错误(无路由抛错) → catch 返回 0, pend 键保留, 零 tree 请求', async () => {
    const kv = memKv();
    await archiveToGitHub(env(kv), '2026-08-28', '# a');
    mockFetch([
      { match: (u, m) => u.includes('/git/ref/heads/archive') && m === 'GET', json: { object: { sha: 'basesha' } } },
      { match: (u, m) => u.includes('/git/commits/') && m === 'GET', json: { tree: { sha: 'treeshabase' } } },
      // 故意不给 blobs 路由 → stub 抛 unexpected → flush 内部 catch
    ]);
    expect(await flushArchivedPending(env(kv))).toBe(0);
    expect(pendKeys(kv).length).toBe(1);
    expect(gh().some((c) => c.url.includes('/git/trees') || c.url.includes('/git/refs'))).toBe(false);
  });

  it('tree 400 → 返回 0, pend 键保留, 零 commit/PATCH 请求', async () => {
    const kv = memKv();
    await archiveToGitHub(env(kv), '2026-08-28', '# a');
    mockFetch([
      { match: (u, m) => u.includes('/git/ref/heads/archive') && m === 'GET', json: { object: { sha: 'basesha' } } },
      { match: (u, m) => u.includes('/git/commits/') && m === 'GET', json: { tree: { sha: 'treeshabase' } } },
      { match: (u, m) => u.includes('/git/blobs') && m === 'POST', json: { sha: 'blob0' } },
      { match: (u, m) => u.includes('/git/trees') && m === 'POST', status: 400 },
    ]);
    expect(await flushArchivedPending(env(kv))).toBe(0);
    expect(pendKeys(kv).length).toBe(1);
    expect(gh().some((c) => c.method === 'PATCH' || (c.url.endsWith('/git/commits') && c.method === 'POST'))).toBe(false);
  });

  it('commit 422 → 返回 0, pend 键保留, 零 PATCH 请求', async () => {
    const kv = memKv();
    await archiveToGitHub(env(kv), '2026-08-28', '# a');
    mockFetch([
      { match: (u, m) => u.includes('/git/ref/heads/archive') && m === 'GET', json: { object: { sha: 'basesha' } } },
      { match: (u, m) => u.includes('/git/commits/') && m === 'GET', json: { tree: { sha: 'treeshabase' } } },
      { match: (u, m) => u.includes('/git/blobs') && m === 'POST', json: { sha: 'blob0' } },
      { match: (u, m) => u.includes('/git/trees') && m === 'POST', json: { sha: 'newtree0' } },
      { match: (u, m) => u.endsWith('/git/commits') && m === 'POST', status: 422 },
    ]);
    expect(await flushArchivedPending(env(kv))).toBe(0);
    expect(pendKeys(kv).length).toBe(1);
    expect(gh().filter((c) => c.method === 'PATCH').length).toBe(0);
  });

  it('commit/ref 外呼网络错误(无 tree 路由抛错) → catch 返回 0, pend 键保留', async () => {
    const kv = memKv();
    await archiveToGitHub(env(kv), '2026-08-28', '# a');
    mockFetch([
      { match: (u, m) => u.includes('/git/ref/heads/archive') && m === 'GET', json: { object: { sha: 'basesha' } } },
      { match: (u, m) => u.includes('/git/commits/') && m === 'GET', json: { tree: { sha: 'treeshabase' } } },
      { match: (u, m) => u.includes('/git/blobs') && m === 'POST', json: { sha: 'blob0' } },
      // 故意不给 trees 路由 → stub 抛 unexpected → 提交阶段 catch
    ]);
    expect(await flushArchivedPending(env(kv))).toBe(0);
    expect(pendKeys(kv).length).toBe(1);
  });

  it('PATCH 失败(500)后重取 base 也失败(404) → 放弃返回 0, pend 键保留', async () => {
    const kv = memKv();
    await archiveToGitHub(env(kv), '2026-08-28', '# a');
    let refN = 0;
    mockFetch([
      { match: (u, m) => u.includes('/git/ref/heads/archive') && m === 'GET', status: () => (++refN === 1 ? 200 : 404), json: { object: { sha: 'basesha' } } },
      { match: (u, m) => u.includes('/git/commits/') && m === 'GET', json: { tree: { sha: 'treeshabase' } } },
      { match: (u, m) => u.includes('/git/blobs') && m === 'POST', json: { sha: 'blob0' } },
      { match: (u, m) => u.includes('/git/trees') && m === 'POST', json: { sha: 'newtree0' } },
      { match: (u, m) => u.endsWith('/git/commits') && m === 'POST', json: { sha: 'newcommit0' } },
      { match: (u, m) => u.includes('/git/refs/heads/archive') && m === 'PATCH', status: 500 },
    ]);
    expect(await flushArchivedPending(env(kv))).toBe(0);
    expect(pendKeys(kv).length).toBe(1);
    // 确实重试过: 第二次 ref 读失败, PATCH 只发生一次
    expect(gh().filter((c) => c.url.includes('/git/ref/heads/archive') && c.method === 'GET').length).toBe(2);
    expect(gh().filter((c) => c.method === 'PATCH').length).toBe(1);
  });

  it('CACHE.list 抛错 → 顶层 catch 返回 0, 零外呼', async () => {
    const kv = memKv();
    kv.list = async () => { throw new Error('kv list boom'); };
    mockFetch([{ match: () => true, json: {} }]);
    expect(await flushArchivedPending(env(kv))).toBe(0);
    expect(gh().length).toBe(0);
  });

  it('base 读取各失败形态 → 返回 0 零 blob, pend 键保留', async () => {
    // ref 200 但 object.sha 缺失
    let kv = memKv();
    await archiveToGitHub(env(kv), '2026-08-28', '# a');
    mockFetch([{ match: (u) => u.includes('/git/ref/heads/archive'), json: {} }]);
    expect(await flushArchivedPending(env(kv))).toBe(0);
    expect(pendKeys(kv).length).toBe(1);
    expect(gh().filter((c) => c.url.includes('/git/blobs')).length).toBe(0);

    // base commit 读取 500
    kv = memKv();
    await archiveToGitHub(env(kv), '2026-08-28', '# a');
    mockFetch([
      { match: (u, m) => u.includes('/git/ref/heads/archive') && m === 'GET', json: { object: { sha: 'basesha' } } },
      { match: (u, m) => u.includes('/git/commits/') && m === 'GET', status: 500 },
    ]);
    expect(await flushArchivedPending(env(kv))).toBe(0);
    expect(pendKeys(kv).length).toBe(1);
    expect(gh().filter((c) => c.url.includes('/git/blobs')).length).toBe(0);

    // base commit 200 但 tree.sha 缺失
    kv = memKv();
    await archiveToGitHub(env(kv), '2026-08-28', '# a');
    mockFetch([
      { match: (u, m) => u.includes('/git/ref/heads/archive') && m === 'GET', json: { object: { sha: 'basesha' } } },
      { match: (u, m) => u.includes('/git/commits/') && m === 'GET', json: {} },
    ]);
    expect(await flushArchivedPending(env(kv))).toBe(0);
    expect(pendKeys(kv).length).toBe(1);
    expect(gh().filter((c) => c.url.includes('/git/blobs')).length).toBe(0);

    // ref 外呼网络错误(无路由抛错) → baseOf catch
    kv = memKv();
    await archiveToGitHub(env(kv), '2026-08-28', '# a');
    mockFetch([]);
    expect(await flushArchivedPending(env(kv))).toBe(0);
    expect(pendKeys(kv).length).toBe(1);
  });

  it('list 到键但 get 返回 null(KV 最终一致) → 该键跳过, 其余正常刷', async () => {
    const kv = memKv();
    await archiveToGitHub(env(kv), '2026-08-28', '# a');
    await archiveToGitHub(env(kv), '2026-08-29', '# b');
    const names = pendKeys(kv);
    const gone = names[0];
    kv.get = async (k: string) => (k === gone ? null : kv.store.get(k) ?? null);
    const { routes } = gitRoutes();
    mockFetch(routes);
    expect(await flushArchivedPending(env(kv))).toBe(1);
    // 消失键(get 返回 null)不进批、不删; 存活键已刷掉
    expect(pendKeys(kv)).toEqual([gone]);
  });

  it('list 翻页(list_complete=false + cursor) → 两页键都入批, 一个 commit 刷完删键', async () => {
    const kv = memKv();
    await archiveToGitHub(env(kv), '2026-08-28', '# a');
    await archiveToGitHub(env(kv), '2026-08-29', '# b');
    const names = pendKeys(kv);
    const pages = [
      { keys: [{ name: names[0] }], list_complete: false, cursor: 'c1' },
      { keys: [{ name: names[1] }], list_complete: true },
    ];
    let listN = 0;
    kv.list = async () => pages[listN++];
    const { routes } = gitRoutes();
    mockFetch(routes);
    expect(await flushArchivedPending(env(kv))).toBe(2);
    expect(listN).toBe(2);
    expect(pendKeys(kv).length).toBe(0);
  });

  it('base64 条目(OG 图)flush → blob 直传 base64 原串(encoding=base64)', async () => {
    const kv = memKv();
    const png = new Uint8Array([137, 80, 78, 71, 9, 9]);
    mockFetch([
      { match: (u) => u.includes('opengraph.githubassets.com'), body: png },
      { match: (u) => u.includes('/contents/og-images/'), status: 404 },
      { match: (u) => u.includes('api.github.com'), json: {} },
    ]);
    expect(await archiveOgImage(env(kv), 'o/r')).toBe('../../og-images/o__r.png');
    const stored = JSON.parse(kv.store.get(pendKeys(kv)[0])!);
    mockFetch(gitRoutes().routes);
    expect(await flushArchivedPending(env(kv))).toBe(1);
    const blob = gh().find((c) => c.url.includes('/git/blobs') && c.method === 'POST')!;
    expect(blob.body.encoding).toBe('base64');
    expect(blob.body.content).toBe(stored.content); // 直传不解码
    expect(Buffer.from(blob.body.content, 'base64')).toEqual(Buffer.from(png));
    expect(pendKeys(kv).length).toBe(0);
  });
});

describe('webhook 机会性刷写(命令分派后 ≥20 条阈值)', () => {
  const postWebhook = async (kv: any): Promise<Promise<unknown>[]> => {
    const pending: Promise<unknown>[] = [];
    const ctx = { waitUntil: (p: Promise<unknown>) => { pending.push(p); } } as any;
    const envW = { BOT_TOKEN: 't', CHAT_ID: '944783507', WEBHOOK_SECRET: 'sec', GH_TOKEN: 'g', CACHE: kv, AI: undefined } as any;
    await worker.fetch(
      new Request('https://x/telegram', {
        method: 'POST',
        headers: { 'X-Telegram-Bot-Api-Secret-Token': 'sec', 'content-type': 'application/json' },
        body: JSON.stringify({ message: { chat: { id: 944783507 }, text: 'random text' } }),
      }),
      envW, ctx,
    );
    await Promise.allSettled(pending); // waitUntil 里的 flush 跑完再断言
    return pending;
  };
  const seedPend = (kv: any, n: number) => {
    for (let i = 0; i < n; i++) kv.store.set(`pend:arc:s${String(i).padStart(2, '0')}`, JSON.stringify({ path: `archive/2026/f${i}.md`, content: b64('# x'), encoding: 'utf-8', message: 'm' }));
  };
  const tgRoutes = (): Route[] => [{ match: (u) => u.includes('api.telegram.org'), json: { ok: true } }];

  it('缓冲 <20 条 → 命令分派后不触发 flush(零 GitHub 请求, 键保留)', async () => {
    const kv = memKv();
    seedPend(kv, 19);
    mockFetch([...tgRoutes(), { match: () => true, json: {} }]);
    await postWebhook(kv);
    expect(gh().length).toBe(0);
    expect(pendKeys(kv).length).toBe(19);
  });

  it('缓冲 ≥20 条 → 命令分派完成后 waitUntil flush: 单 commit + 删键, 不阻塞回复', async () => {
    const kv = memKv();
    seedPend(kv, 20);
    const { routes } = gitRoutes();
    mockFetch([...tgRoutes(), ...routes]);
    await postWebhook(kv);
    // 20 文件一个 commit + 缓冲清空
    expect(gh().filter((c) => c.url.endsWith('/git/commits') && c.method === 'POST').length).toBe(1);
    expect(gh().find((c) => c.method === 'PATCH')!.body.force).toBe(false);
    expect(pendKeys(kv).length).toBe(0);
  });
});
