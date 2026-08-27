// deepwiki.com 网页版 wiki Overview 提取(英文)。免 key(RSC payload)。
// 作为 zread 之后的第二级兜底: 拿英文 overview, 再交给翻�译层转中文。
const DW_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126';

/** 从 deepwiki.com /:owner/:repo 页面的 RSC payload 提取 Overview 正文(英文, 纯文本) */
export function extractDeepwikiOverview(payload: string, maxLen = 800): string | null {
  // deepwiki 2026-08 结构: "Overview:[可选标题]<details><summary>Relevant source files</summary>...</details>"
  // repo 间有差异: 有的正文紧跟 </details>, 有的在 "## Purpose and Scope" 等标题后
  const marker = /Overview[:\s]*[^\n<]*\s*(?:\n|<details>)[\s\S]*?<\/details>/m;
  const m = payload.match(marker);
  if (!m) return null;
  const after = payload.slice(payload.indexOf(m[0]) + m[0].length);
  // 正文 = 可选标题(## ...)后 的第一段英文/中文文本
  const bodyMatch = after.match(/^\s*(?:##[^\n]*\n\n)?([A-Z][\s\S]*?)\n(?:(?:\n+)|#{1,3} )/);
  if (!bodyMatch) return null;
  let clean = bodyMatch[1]
    .replace(/`[^`]*`/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[#*>`|!]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (!clean || clean.length < 40) return null;
  // 去掉 deepwiki 模板开场白: "This page/document provides a high-level/comprehensive introduction to X, <真实描述>"
  // 目标: 取描述(X 之后 / 逗号之后的实义内容), 不要"本页面提供了...介绍"这类无信息开头
  let stripped = clean;
  const tpl = /^this\s+(?:page|document|guide|wiki)\s+(?:provides\s+)?(?:a|an)\s+(?:comprehensive\s+|high-level\s+)?(?:introduction|overview|description)\s+(?:of|to)\s+/i;
  const tplm = stripped.match(tpl);
  if (tplm) {
    const rest = stripped.slice(tplm[0].length);
    // 逗号分隔(X, 描述) → 取逗号后; 否则取整段
    const comma = rest.match(/^[^,，]+[,，]\s*(.+)/s);
    stripped = comma ? comma[1] : rest;
  }
  stripped = stripped.trim();
  if (!stripped) return null;
  return stripped.length > maxLen ? stripped.slice(0, maxLen - 1) + '…' : stripped;
}

/** 从 deepwiki.com /:owner/:repo 抓取 Overview 英文原文 */
export async function fetchDeepwikiOverview(repo: string, maxLen = 400): Promise<string | null> {
  try {
    const res = await fetch(`https://deepwiki.com/${repo}`, {
      headers: { 'User-Agent': DW_UA },
      signal: AbortSignal.timeout(45000),
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
