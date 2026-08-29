import type { Env } from './types';
import { d1PutArchiveFiles } from './d1';

/**
 * 二进制 → base64。分块 String.fromCharCode 规避 spread 栈上限
 * (实测 Node ~125K 元素即 RangeError; workerd 更小)。bit-exact 等价已验证。
 */
export function encodeBase64(buf: Uint8Array): string {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < buf.length; i += CH) s += String.fromCharCode(...buf.subarray(i, i + CH));
  return btoa(s);
}

/** base64 → 原文(缓冲值落 Git blob 前还原)。bit-exact 对应 encodeBase64。 */
function decodeBase64Text(b64: string): string {
  const bin = atob(b64);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(buf);
}

const GH_HEADERS = (token: string, json = false): Record<string, string> => ({
  Authorization: `token ${token}`,
  Accept: 'application/vnd.github+json',
  'User-Agent': 'daily-digest',
  ...(json ? { 'content-type': 'application/json' } : {}),
});

// ---------------------------------------------------------------------------
// 存档缓冲: 待写文件先进 KV(pend:arc:*), 由 flushArchivedPending 用 Git Data API
// 打成单个 commit 刷上 archive 分支——替代旧"每文件一次 Contents API PUT"的碎片提交。
// ---------------------------------------------------------------------------

/** 单条待写项(KV 值): content 恒为 base64(KV 存二进制安全), encoding 描述刷写时 blob 的编码。 */
type PendItem = { path: string; content: string; encoding: 'utf-8' | 'base64'; message: string };
const PEND_PREFIX = 'pend:arc:';
// Worker 免费层单请求 50 子请求上限: ref+commits+tree+refs 固定 4 个, blob 每文件 1 个 → 单次至多 40 文件, 余下次再刷。
const FLUSH_BLOB_CAP = 40;

// 单 isolate 内自增序号: 同毫秒多次缓冲时保证键序 = 写入序(去重按键序取后写)
let pendSeq = 0;

/**
 * 缓冲一条待写文件。返回 true = 已入 KV; false = KV 不可用(已回落即时 PUT)。
 * KV 写后读回校验(同请求内 read-your-write 成立): 兼容 Actions 脚本的 no-op CACHE stub / KV 故障——
 * 校验不过回落即时 Contents PUT, 保证存档不因缓冲层静默丢失。全程不抛。
 * content: 'utf-8' 传原文, 'base64' 传已编码串(OG 图 PNG)。
 */
async function pendArchive(env: Env, path: string, content: string, message: string, encoding: 'utf-8' | 'base64'): Promise<boolean> {
  const b64 = encoding === 'utf-8' ? encodeBase64(new TextEncoder().encode(content)) : content;
  try {
    const key = `${PEND_PREFIX}${Date.now().toString(36)}-${(pendSeq++).toString(36).padStart(4, '0')}${Math.random().toString(36).slice(2, 6)}`;
    await env.CACHE.put(key, JSON.stringify({ path, content: b64, encoding, message } satisfies PendItem));
    if ((await env.CACHE.get(key)) !== null) return true; // 读回命中 → 真实 KV, 缓冲成功
    console.error('pend put readback miss, fallback to direct put', path);
  } catch (e) {
    console.error('pend put failed, fallback to direct put', path, String(e).slice(0, 80));
  }
  return putToArchiveBranchDirect(env, path, b64, message); // Contents API content 字段本就收 base64
}

/** archive 分支通用 PUT(创建或覆盖, Contents API)。contentB64: base64 编码内容。失败只记日志。现仅作 KV 不可用时的兜底。 */
async function putToArchiveBranchDirect(env: Env, path: string, contentB64: string, message: string): Promise<boolean> {
  const repo = (env.GH_ARCHIVE_REPO || 'gandli/daily-digest').replace(/[^A-Za-z0-9_.-]/g, ''); // repo 名消毒(SSRF 守卫)
  // 幂等: 先查 sha,存在则 update(PUT 带 sha 覆盖)
  let sha: string | undefined;
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/contents/${path}?ref=archive`, { headers: GH_HEADERS(env.GH_TOKEN) });
    if (r.ok) sha = ((await r.json()) as { sha?: string }).sha;
  } catch {
    // 无网/限流 → 直接走创建,失败由下方统一处理
  }
  let ok = false;
  try {
    const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
      method: 'PUT',
      headers: GH_HEADERS(env.GH_TOKEN, true),
      body: JSON.stringify({ message, content: contentB64, branch: 'archive', ...(sha ? { sha } : {}) }),
    });
    if (!res.ok) console.error(`archive put ${path} ${res.status}: ${await res.text()}`);
    ok = res.ok;
  } catch (e) {
    console.error(`archive put ${path} network error`, String(e).slice(0, 80));
  }
  return ok;
}

// GitHub 存档 + Telegraph 备份。两者失败都只记日志,不中断管线。
// 存档并入主仓(gandli/daily-digest-archive 已合并, GH_ARCHIVE_REPO 覆写留作备用)。
// 存档文件先进 KV 缓冲(scheduled / webhook 攒够阈值时批量刷写), 不再逐文件即时 PUT。
export async function archiveToGitHub(env: Env, dateStr: string, markdown: string, year?: string): Promise<void> {
  if (dateStr.includes('..') || dateStr.startsWith('/')) throw new Error('bad archive name'); // 路径守卫(SSRF/穿越)
  const path = `archive/${year ?? dateStr.slice(0, 4)}/${dateStr}.md`;
  await pendArchive(env, path, markdown, `digest: ${dateStr}`, 'utf-8');
}

/** X 帖子等带完整时间戳文件名的存档(lookup.ts 同形态)。 */
export async function archiveDatedToGitHub(env: Env, stamp: string, markdown: string, year?: string): Promise<void> {
  if (stamp.includes('..') || stamp.startsWith('/')) throw new Error('bad archive name'); // 路径守卫(SSRF/穿越)
  const path = `archive/${year ?? stamp.slice(0, 4)}/${stamp}.md`;
  await pendArchive(env, path, markdown, `archive: ${stamp}`, 'utf-8');
}

/** OG 图入库 og-images/<owner>__<repo>.png, 返回 markdown 相对路径; 失败返回 null(调用方回退远程 URL 引用)。 */
export async function archiveOgImage(env: Env, repoFull: string): Promise<string | null> {
  try {
    const res = await fetch(`https://opengraph.githubassets.com/1/${repoFull}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    const name = `${repoFull.replace('/', '__')}.png`;
    const repo = (env.GH_ARCHIVE_REPO || 'gandli/daily-digest').replace(/[^A-Za-z0-9_.-]/g, ''); // 消毒(SSRF 守卫)
    // 已有同名图(上次 flush 已入库) → 跳过重传(OG 卡内容随 stars 变化可接受); 同批重复由 flush 按路径去重
    const head = await fetch(`https://api.github.com/repos/${repo}/contents/og-images/${name}?ref=archive`, { headers: GH_HEADERS(env.GH_TOKEN) });
    if (head.ok) {
      const sha = ((await head.json()) as { sha?: string }).sha;
      if (sha) return `../../og-images/${name}`;
    }
    const ok = await pendArchive(env, `og-images/${name}`, encodeBase64(buf), `og-image: ${repoFull}`, 'base64');
    return ok ? `../../og-images/${name}` : null;
  } catch (e) {
    console.error('archiveOgImage failed', String(e).slice(0, 80));
    return null;
  }
}

/**
 * 把 KV 里缓冲的待写文件(pend:arc:*)用 Git Data API 打成一个 commit 刷上 archive 分支。
 * 流程: ref → commit(取 base tree) → 逐文件 blob → tree(base_tree) → commit → 更新 ref(非强制)。
 * 任何一步失败: 保留 pend 键、log 后静默返回 0, 下次再试; ref 非快进冲突重试一次(blob sha 复用)。
 * 成功才删除已刷写的 pend 键。返回成功刷写的文件数(0 = 空缓冲或失败)。绝不向上抛。
 */
export async function flushArchivedPending(env: Env): Promise<number> {
  try {
    // 1. 列出待写键(翻页遍历); 空缓冲零请求直返
    const keys: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await env.CACHE.list({ prefix: PEND_PREFIX, cursor });
      keys.push(...page.keys.map((k) => k.name));
      cursor = page.list_complete ? undefined : (page as { cursor?: string }).cursor;
    } while (cursor);
    if (!keys.length) return 0;
    keys.sort(); // 键含 base36 时间戳+序号 → 排序即写入顺序; 同路径多次缓冲时后写覆盖先写
    const items = new Map<string, { keys: string[]; item: PendItem }>(); // path → 最新条目(含被覆盖的旧键, 刷写成功一并删)
    for (const key of keys) {
      try {
        const item = JSON.parse((await env.CACHE.get(key)) ?? '') as PendItem;
        if (!item?.path || typeof item.content !== 'string') continue; // 损坏条目跳过(保留, 不进本批)
        const prev = items.get(item.path);
        if (prev) prev.keys.push(key), (prev.item = item);
        else items.set(item.path, { keys: [key], item });
      } catch {
        console.error('flush: corrupt pend entry skipped', key);
      }
    }
    // 免费层子请求预算: 固定 4 + 每 blob 1 → 单批至多 40 文件, 超出留给下次 flush
    const batch = [...items.values()].slice(0, FLUSH_BLOB_CAP);
    if (!batch.length) return 0;
    const repo = (env.GH_ARCHIVE_REPO || 'gandli/daily-digest').replace(/[^A-Za-z0-9_.-]/g, ''); // 消毒(SSRF 守卫)
    const api = `https://api.github.com/repos/${repo}/git`;

    // 2. base: ref → commit → tree
    const base = await baseOf(api, env.GH_TOKEN);
    if (!base) return 0;
    // 3. 逐文件建 blob(同一 commit 内)
    const blobShas: { path: string; sha: string }[] = [];
    for (const { item } of batch) {
      try {
        const r = await fetch(`${api}/blobs`, {
          method: 'POST',
          headers: GH_HEADERS(env.GH_TOKEN, true),
          body: JSON.stringify({ content: item.encoding === 'utf-8' ? decodeBase64Text(item.content) : item.content, encoding: item.encoding }),
        });
        if (!r.ok) {
          console.error(`flush blob ${item.path} ${r.status}`);
          return 0; // 半途失败: 全批保留, 下次整体重试(blob 幂等, 重建无害)
        }
        blobShas.push({ path: item.path, sha: ((await r.json()) as { sha?: string }).sha ?? '' });
      } catch (e) {
        console.error(`flush blob ${item.path} error`, String(e).slice(0, 80));
        return 0;
      }
    }
    // 4. tree → commit → 更新 ref; 非快进冲突(409/422)重试一次(blob sha 可复用)
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const treeRes = await fetch(`${api}/trees`, {
          method: 'POST',
          headers: GH_HEADERS(env.GH_TOKEN, true),
          body: JSON.stringify({
            base_tree: base.treeSha,
            tree: blobShas.filter((b) => b.sha).map((b) => ({ path: b.path, mode: '100644', type: 'blob', sha: b.sha })),
          }),
        });
        if (!treeRes.ok) {
          console.error(`flush tree ${treeRes.status}`);
          return 0;
        }
        const treeSha = ((await treeRes.json()) as { sha?: string }).sha ?? '';
        const commitRes = await fetch(`${api}/commits`, {
          method: 'POST',
          headers: GH_HEADERS(env.GH_TOKEN, true),
          body: JSON.stringify({ message: `archive: batch ${batch.length} items`, tree: treeSha, parents: [base.sha] }),
        });
        if (!commitRes.ok) {
          console.error(`flush commit ${commitRes.status}`);
          return 0;
        }
        const commitSha = ((await commitRes.json()) as { sha?: string }).sha ?? '';
        const refRes = await fetch(`${api}/refs/heads/archive`, {
          method: 'PATCH',
          headers: GH_HEADERS(env.GH_TOKEN, true),
          body: JSON.stringify({ sha: commitSha, force: false }),
        });
        if (refRes.ok) {
          // D1 内容冗余(utf-8 markdown, 图片不存): 失败静默, 不影响 GitHub 正本与删键
          await d1PutArchiveFiles(
            env,
            batch
              .filter(({ item }) => item.encoding === 'utf-8')
              .map(({ item }) => ({ path: item.path, content: decodeBase64Text(item.content), message: item.message })),
          );
          await Promise.all(batch.flatMap(({ keys }) => keys.map((key) => env.CACHE.delete(key).catch(() => { /* 删除失败: 下次 flush 重放同内容(blob sha 相同, 幂等) */ }))));
          return batch.length;
        }
        // 非快进(期间 ref 又前进) → 重取 base 重建 tree 再试一次; 已是最后一次尝试则放弃(保留缓冲)
        console.error(`flush ref update ${refRes.status}, retrying with fresh base`);
        if (attempt === 1) return 0;
        const fresh = await baseOf(api, env.GH_TOKEN);
        if (!fresh) return 0;
        base.sha = fresh.sha;
        base.treeSha = fresh.treeSha;
      } catch (e) {
        console.error('flush commit/ref error', String(e).slice(0, 80));
        return 0;
      }
    }
    return 0; // 两次尝试都撞冲突 → 保留 pend 键下次再试
  } catch (e) {
    console.error('flushArchivedPending failed', String(e).slice(0, 120));
    return 0;
  }
}

/** 取 archive 分支 base(sha + tree sha); 失败/分支不存在返回 null(保留缓冲下次再试)。 */
async function baseOf(api: string, token: string): Promise<{ sha: string; treeSha: string } | null> {
  try {
    const refRes = await fetch(`${api}/ref/heads/archive`, { headers: GH_HEADERS(token) });
    if (!refRes.ok) {
      console.error(`flush ref read ${refRes.status}`);
      return null;
    }
    const sha = ((await refRes.json()) as { object?: { sha?: string } }).object?.sha ?? '';
    if (!sha) return null;
    const commitRes = await fetch(`${api}/commits/${sha}`, { headers: GH_HEADERS(token) });
    if (!commitRes.ok) {
      console.error(`flush base commit read ${commitRes.status}`);
      return null;
    }
    const treeSha = ((await commitRes.json()) as { tree?: { sha?: string } }).tree?.sha ?? '';
    if (!treeSha) return null;
    return { sha, treeSha };
  } catch (e) {
    console.error('flush base read error', String(e).slice(0, 80));
    return null;
  }
}

// Telegraph 匿名账号: createAccount 每次建唯一 token(Accounts 免费, 无密)。返回 null 则跳过 Telegraph。
export async function createTelegraphAccount(): Promise<string | null> {
  try {
    const res = await fetch('https://api.telegra.ph/createAccount?short_name=daily_digest&author_name=daily-digest', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    });
    const j = (await res.json()) as { ok?: boolean; result?: { access_token?: string } };
    return j.ok && j.result?.access_token ? j.result.access_token : null;
  } catch (e) {
    console.error('telegraph account failed', String(e).slice(0, 80));
    return null;
  }
}

export async function createTelegraphPage(
  token: string,
  dateStr: string,
  nodes: unknown[],
): Promise<string | null> {
  try {
    const res = await fetch('https://api.telegra.ph/createPage', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        access_token: token,
        title: dateStr,
        author_name: 'daily-digest',
        content: nodes,
        return_content: false,
      }),
    });
    const j = (await res.json()) as { ok?: boolean; result?: { url?: string } };
    return j.ok && j.result?.url ? j.result.url : null;
  } catch (e) {
    console.error('telegraph failed', e);
    return null;
  }
}
