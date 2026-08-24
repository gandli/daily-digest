// zread.ai 网页版 wiki 抓取: 从 RSC payload 提取 Overview 正文, 生成 repo wiki 描述。
// 免 key(robots.txt User-agent:* Allow:/)。失败不抛——增强层。
const ZREAD_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126';

/** 从 zread.ai /:owner/:repo/wiki 页面的 Next.js RSC payload 里提取 Overview 首段 */
export async function fetchZreadWikiDesc(repo: string, maxLen = 280): Promise<string | null> {
  try {
    const res = await fetch(`https://zread.ai/${repo}/wiki`, {
      headers: { 'User-Agent': ZREAD_UA },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const html = await res.text();
    // 拼接全部 RSC 字符串块
    const chunkRe = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
    let payload = '';
    for (const m of html.matchAll(chunkRe)) {
      payload += JSON.parse(m[1] as string) as string;
    }
    // Overview 正文: 跳过页面头部文案区(约40K字符的 i18n/营销串), 找第一个 markdown 标题
    const tail = payload.slice(40000);
    const h = tail.match(/## [^\n]{3,80}\n/);
    if (!h || h.index === undefined) return null;
    const body = tail.slice(h.index + h[0].length);
    // 首段; 跳过代码块开头的段(目录树对描述无价值)
    let para = body.split('\n\n')[0].trim();
    if (para.startsWith('```')) {
      para = body.split('\n\n').filter((s) => !s.startsWith('```'))[0] ?? '';
    }
    para = para.replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
    return para.length > maxLen ? para.slice(0, maxLen - 1) + '…' : para || null;
  } catch {
    return null;
  }
}

/** 批量并行抓取 */
export async function fetchZreadBatch(repos: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await Promise.all(
    repos.map(async (r) => {
      const d = await fetchZreadWikiDesc(r);
      if (d) out.set(r, d);
    }),
  );
  return out;
}
