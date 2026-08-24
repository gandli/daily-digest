import type { Env, SourceItem } from './types';
import { resolveDescriptions, translateBatch } from './translate';
import { fetchDeepwikiOverview } from './deepwiki';
import { renderMessage, renderMarkdown } from './render';
import { sendPerRepoMessages, sendTelegram } from './notify';
import { archiveToGitHub } from './archive';

// 北京时间日期串(与 index.ts 一致; 独立内联避免循环依赖)
const today = (): string => new Date(Date.now() + 8 * 3600_000).toISOString().slice(0, 10);

/** 从文本提取 GitHub 仓库链接或裸 owner/repo。优先 github.com 域; 兜底裸 owner/repo。 */
export function extractRepo(text: string): string | null {
  const full = text.match(/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/i);
  if (full) return full[1].replace(/[。.,,;；]$/, '');
  // 裸 owner/repo(无域名、斜杠二段、非路径分隔)——宽松匹配常见仓库形态
  const bare = text.match(/(?:^|\s)([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)(?:\s|$)/);
  return bare ? bare[1].replace(/[。.,,;；]$/, '') : null;
}

/** 从 GitHub API 抓单 repo 详情 → SourceItem */
async function fetchRepo(repo: string, ghToken: string): Promise<SourceItem | null> {
  const res = await fetch(`https://api.github.com/repos/${repo}`, {
    headers: {
      Authorization: `Bearer ${ghToken}`,
      Accept: 'application/vnd.github+json',
      'User-Agent': 'daily-digest',
    },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) return null;
  const j = (await res.json()) as {
    full_name: string; description: string | null; stargazers_count?: number;
    language?: string | null; topics?: string[];
  };
  if (!j.full_name) return null;
  return {
    title: j.full_name,
    url: `https://github.com/${j.full_name}`,
    desc: j.description ?? j.full_name,
    stars: j.stargazers_count ?? undefined,
    lang: j.language ?? undefined,
    topics: (j.topics ?? []).slice(0, 4),
  };
}

/** 仓库查找: 描述 -> OG图 -> 回复 -> 存档。静默失败不抛。 */
export async function lookupRepo(env: Env, chatId: string, repo: string): Promise<void> {
  const item = await fetchRepo(repo, env.GH_TOKEN);
  if (!item) {
    await sendTelegram(env.BOT_TOKEN, chatId, `❌ 找不到仓库 ${repo}，请检查拼写或是否为公开仓库。`);
    return;
  }
  // 单 repo(无子请求预算压力): 优先 deepwiki 概述(已验证恒定纯净), 其次 zread, 再降级管线。
  // ponytail: deepwiki 对部分 repo 返回"架构"类描述——这里固定优先 deepwiki, 因 zread 偶发选中架构段
  try {
    const dw = await fetchDeepwikiOverview(repo);
    if (dw) {
      item.desc = dw;
      const done = await translateBatch(env, [item]);
      item.descZh = done[0]?.descZh;
    }
  } catch {
    /* deepwiki 失败落 zread */
  }
  if (!item.descZh) {
    try {
      await resolveDescriptions(env, [item]);
    } catch {
      /* 描述失败不阻塞发送 */
    }
  }
  // 一条消息: OG 图做照片, 条目做 caption
  const chunks = renderMessage(today(), [item]);
  await sendPerRepoMessages(env.BOT_TOKEN, chatId, chunks.map((html) => ({ html, repo: item.title })));
  // 存档(复用 trending 同款日期路径; lookup 额外加时间戳避免同日覆盖)
  try {
    await archiveToGitHub(env, `${today()}-${Date.now() % 86400000}`, renderMarkdown(today(), [item]));
  } catch {
    /* 存档失败静默 */
  }
}