// zread.ai 网页版 wiki 抓取: 从 RSC payload 提取 Overview 定义段(中文), 生成 repo wiki 描述。
// 免 key(robots.txt User-agent:* Allow:/)。Accept-Language: zh-CN 拿中文版。失败不抛——增强层。
const ZREAD_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126';

/** 提取"是什么"定义句: 含定位动词、中文为主、非目录/表格/RSC杂讯 */
export function extractDesc(payload: string, maxLen: number): string | null {
  const tail = payload.slice(30000);
  const end = tail.indexOf('\nSources: ');
  const body = end > 0 ? tail.slice(0, end) : tail.slice(0, 20000);
  let best = '';
  for (let blk of body.split('\n\n')) {
    blk = blk.trim();
    if (!blk || /^[#```|[!]/.test(blk)) continue;
    if (blk.includes('.js') || blk.includes('static/') || blk.includes('$')) continue; // RSC 杂讯
    if (/^\d+[.)]/.test(blk) || /^\d+\s*\|/.test(blk)) continue; // 编号目录/表格行
    const clean = blk
      .replace(/`[^`]*`/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[#*>|!]/g, '')
      .replace(/\n/g, ' ')
      .trim();
    const cjk = (clean.match(/[\u4e00-\u9fff]/g) ?? []).length;
    if (cjk < 15 || cjk < clean.length * 0.3) continue; // 必须中文为主
    if (!/(是一个|是一套|是一款|旨在|专注于|让你|帮助你|解决了|用于构建|用于管理|核心思路|本质上|由 .* 开发)/.test(clean)) continue;
    if (clean.length > best.length) best = clean;
  }
  if (!best) return null;
  return best.length > maxLen ? best.slice(0, maxLen - 1) + '…' : best;
}

/** 从 zread.ai /:owner/:repo/wiki 页面的 Next.js RSC payload 里提取 Overview 中文描述 */
export async function fetchZreadWikiDesc(repo: string, maxLen = 280): Promise<string | null> {
  try {
    const res = await fetch(`https://zread.ai/${repo}/wiki`, {
      headers: { 'User-Agent': ZREAD_UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
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
    return extractDesc(payload, maxLen);
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
