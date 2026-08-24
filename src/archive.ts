import type { Env } from './types';

// GitHub 存档 + Telegraph 备份。两者失败都只记日志,不中断管线。
export async function archiveToGitHub(env: Env, dateStr: string, markdown: string): Promise<void> {
  const repo = env.GH_ARCHIVE_REPO || 'gandli/daily-digest'; // 存档并入主仓(gandli/daily-digest-archive 已合并); 覆写留作备用
  const path = `archive/${dateStr.slice(0, 4)}/${dateStr}.md`;
  const content = btoa(String.fromCharCode(...new TextEncoder().encode(markdown)));
  // 幂等: 先查 sha,存在则 update(PUT 带 sha 覆盖)
  let sha: string | undefined;
  try {
    const r = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
      headers: { Authorization: `Bearer ${env.GH_TOKEN}`, Accept: 'application/vnd.github+json', 'User-Agent': 'daily-digest' },
    });
    if (r.ok) sha = ((await r.json()) as { sha?: string }).sha;
  } catch {
    // 无网/限流 → 直接走创建,失败由下方统一处理
  }
  const res = await fetch(`https://api.github.com/repos/${repo}/contents/${path}`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${env.GH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'daily-digest',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      message: `digest: ${dateStr}`,
      content,
      ...(sha ? { sha } : {}),
    }),
  });
  if (!res.ok) console.error(`archive ${res.status}: ${await res.text()}`);
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
