import type { Env } from './types';

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

// GitHub 存档 + Telegraph 备份。两者失败都只记日志,不中断管线。
export async function archiveToGitHub(env: Env, dateStr: string, markdown: string): Promise<void> {
  const repo = env.GH_ARCHIVE_REPO || 'gandli/daily-digest'; // 存档并入主仓(gandli/daily-digest-archive 已合并); 覆写留作备用
  const path = `archive/${dateStr.slice(0, 4)}/${dateStr}.md`;
  await putToArchiveBranch(env, path, markdown, `digest: ${dateStr}`);
}

/** X 帖子等带完整时间戳文件名的存档(lookup.ts 同形态)。 */
export async function archiveDatedToGitHub(env: Env, stamp: string, markdown: string): Promise<void> {
  const path = `archive/${stamp.slice(0, 4)}/${stamp}.md`;
  await putToArchiveBranch(env, path, markdown, `archive: ${stamp}`);
}

/** archive 分支通用 PUT(创建或覆盖)。失败只记日志。 */
async function putToArchiveBranch(env: Env, path: string, content: string, message: string): Promise<boolean> {
  const repo = env.GH_ARCHIVE_REPO || 'gandli/daily-digest';
  const encoded = encodeBase64(new TextEncoder().encode(content));
  // 幂等: 先查 sha,存在则 update(PUT 带 sha 覆盖)
  let sha: string | undefined;
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/contents/${path}?ref=archive`, {
      headers: { Authorization: `token ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'daily-digest' },
    });
    if (r.ok) sha = ((await r.json()) as { sha?: string }).sha;
  } catch {
    // 无网/限流 → 直接走创建,失败由下方统一处理
  }
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `token ${env.GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'daily-digest',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      message,
      content: encoded,
      branch: 'archive', // 存档独立分支, 不污染 main 代码历史(contents API 按分支精确跟踪)
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) console.error(`archive put ${path} ${res.status}: ${await res.text()}`);
  return res.ok;
}

/**
 * OG 图入库 archive 分支 og-images/<owner>__<repo>.png。
 * 返回 markdown 相对路径; 失败返回 null(调用方回退远程 URL 引用)。
 * ponytail: 原图直接存(~100KB PNG), 不做压缩/缩放——Worker 无 sharp, YAGNI。
 */
export async function archiveOgImage(env: Env, repoFull: string): Promise<string | null> {
  try {
    const res = await fetch(`https://opengraph.githubassets.com/1/${repoFull}`, {
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const buf = new Uint8Array(await res.arrayBuffer());
    const name = `${repoFull.replace('/', '__')}.png`;
    const repo = env.GH_ARCHIVE_REPO || 'gandli/daily-digest';
    let sha: string | undefined;
    const head = await fetch(`https://api.github.com/repos/${repo}/contents/og-images/${name}?ref=archive`, {
      headers: { Authorization: `token ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'daily-digest' },
    });
    if (head.ok) {
      sha = ((await head.json()) as { sha?: string }).sha; // 已有同名图 → 跳过重传(OG 卡内容随 stars 变化可接受)
      if (sha) return `../../og-images/${name}`;
    }
    const put = await fetch(`https://api.github.com/repos/${repo}/contents/og-images/${name}`, {
      method: 'PUT',
      headers: {
        Authorization: `token ${env.GH_TOKEN}`,
        Accept: 'application/vnd.github+json',
        'User-Agent': 'daily-digest',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        message: `og-image: ${repoFull}`,
        content: encodeBase64(buf),
        branch: 'archive',
      }),
    });
    if (!put.ok) console.error(`og upload ${put.status}`);
    return put.ok ? `../../og-images/${name}` : null;
  } catch (e) {
    console.error('archiveOgImage failed', String(e).slice(0, 80));
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
        title: `Daily Digest · ${dateStr}`,
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
