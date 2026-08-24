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
    // zread.ai 2026-08 起变慢且风控。优先但尽力而为: 15s 超时兜底最坏情况(串行10个×15s=150s<curl预算), 失败即落 deepwiki/翻译
    const res = await fetch(`https://zread.ai/${repo}/wiki`, {
      headers: { 'User-Agent': ZREAD_UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
      signal: AbortSignal.timeout(15000),
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

/** 批量抓取——串行限速, 逐个小间隔。 */
// ponytail: 并发 10 会触发 zread 风控(实测 0/10 全时)。逐个串行+间隔, 降低压力; 代价=慢(10个×可控), 上限可调
export async function fetchZreadBatch(repos: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const r of repos) {
    // ponytail: 用 setTimeout 走 Web Worker 兼容; 上次限流重灾区在并发, 串行间隔 800ms 防风控
    await new Promise((res) => setTimeout(res, 800));
    const d = await fetchZreadWikiDesc(r);
    if (d) out.set(r, d);
  }
  return out;
}
