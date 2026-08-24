// deepwiki.com 网页版 wiki Overview 提取(英文)。免 key(RSC payload)。
// 作为 zread 之后的第二级兜底: 拿英文 overview, 再交给翻�译层转中文。
const DW_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126';

/** 从 deepwiki.com /:owner/:repo 页面的 RSC payload 提取 Overview 正文(英文, 纯文本) */
export function extractDeepwikiOverview(payload: string, maxLen = 400): string | null {
  // Overview 标题后紧跟 <details><summary>Relevant source files</summary>... </details> 文件列表
  const marker = /Overview:\s*([^\n]+)\s*\n<details>[\s\S]*?<\/details>/;
  const m = payload.match(marker);
  if (!m) return null;
  // m[1] = 标题行(其实也含描述), 但正文在 </details> 后。重新定位:
  const after = payload.slice(payload.indexOf(m[0]) + m[0].length);
  // 正文是 </details> 后的第一段英文文本
  const bodyMatch = after.match(/^\s*([A-Z][\s\S]*?)\n(?:\n|#{1,3} )/);
  if (!bodyMatch) return null;
  let clean = bodyMatch[1]
    .replace(/`[^`]*`/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*>`|!]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean || clean.length < 40) return null;
  return clean.length > maxLen ? clean.slice(0, maxLen - 1) + '…' : clean;
}

/** 从 deepwiki.com /:owner/:repo 抓取 Overview 英文原文 */
export async function fetchDeepwikiOverview(repo: string, maxLen = 400): Promise<string | null> {
  try {
    const res = await fetch(`https://deepwiki.com/${repo}`, {
      headers: { 'User-Agent': DW_UA },
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    const chunkRe = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
    let payload = '';
    for (const mm of html.matchAll(chunkRe)) {
      payload += JSON.parse(mm[1] as string) as string;
    }
    if (!payload) return null;
    return extractDeepwikiOverview(payload, maxLen);
  } catch {
    return null; // 失败不抛——增强层
  }
}

/** 批量: repo → Overview 英文(深描述兜底) */
export async function fetchDeepwikiBatch(repos: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await Promise.all(
    repos.map(async (r) => {
      const d = await fetchDeepwikiOverview(r);
      if (d) out.set(r, d);
    }),
  );
  return out;
}
