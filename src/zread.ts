// zread.ai 网页版 wiki 抓取: 从 RSC payload 提取 Overview 定义段(中文), 生成 repo wiki 描述。
// 免 key(robots.txt User-agent:* Allow:/)。Accept-Language: zh-CN 拿中文版。失败不抛——增强层。
const ZREAD_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126';

/** 提取"是什么"定义句: 优先取 "概览/概述/Overview/简介" 标题(含 ## 与 ** 形态)后的概述段 → 含仓库名的最长定义段 → 退回最长 */
export function extractDesc(payload: string, maxLen: number, subject?: string): string | null {
  const tail = payload.slice(30000);
  const end = tail.indexOf('\nSources: ');
  const body = end > 0 ? tail.slice(0, end) : tail.slice(0, 20000);
  const blocks = body.split('\n\n');
  let expectOverview = false;
  let best: { clean: string; len: number; subj: boolean; ov: boolean } | null = null;

  // 识别概览类标题: ## 概述 / **概述** / ## Overview / ## 简介
  const ovHead = /^(?:#{1,3}\s*|\*{1,2}\s*)(概览|概述|Overview|简介)(?:\s*\*{1,2})?\s*$/i;
  // 识别"其他标题"(## xx / **xx**), 遇到则清除 expectOverview
  const otherHead = /^(?:#{1,3}\s*|\*{1,2}[^*]).*/;

  for (let blk of blocks) {
    const lines = blk.trim().split('\n');
    let bodyText = blk.trim();
    // 标题行可能与正文同块: "## 概述\n正文..."。若首行是概览标题, 摘出标题, 剩余作正文; 同时标记后续块待概览
    if (lines.length) {
      const first = lines[0].trim();
      if (ovHead.test(first)) {
        expectOverview = true;
        bodyText = lines.slice(1).join('\n').trim();
        if (!bodyText) continue; // 纯标题行, 等下一块
      } else if (otherHead.test(first) && lines.length >= 1 && blk.trim().length < 80) {
        // 其他标题(独立一行) → 清概览标记
        expectOverview = false;
        continue;
      }
    }

    if (!bodyText || /^[```|[!]/.test(bodyText)) continue;
    if (bodyText.includes('.js') || bodyText.includes('static/') || bodyText.includes('$')) continue; // RSC 杂讯
    if (/^\d+[.)]/.test(bodyText) || /^\d+\s*\|/.test(bodyText)) continue; // 编号目录/表格行

    const clean = bodyText
      .replace(/`[^`]*`/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/[#*>|!]/g, '')
      .replace(/\n/g, ' ')
      .trim();
    const cjk = (clean.match(/[\u4e00-\u9fff]/g) ?? []).length;
    if (cjk < 15 || cjk < clean.length * 0.3) continue; // 必须中文为主
    // 定位动词: 概述段放宽(只需"是…"), 非概述段需强动词——避免概述段被跳过而误选架构概览
    const isDef = /(是一个|是一套|是一款|旨在|专注于|让你|帮助你|解决了|用于构建|用于管理|核心思路|本质上|由 .* 开发)/.test(clean);
    if (!isDef && !(expectOverview && /^[^，。]{2,40}是/.test(clean))) continue;

    const cand = {
      clean, len: clean.length,
      subj: subject ? clean.toLowerCase().includes(subject.toLowerCase()) : false,
      ov: expectOverview,
    };
    // 升级优先级: (1)概览段最高 (2)含 subject 次之 (3)同权重取更长
    if (!best) { best = cand; }
    else if (cand.ov && !best.ov) { best = cand; }
    else if (cand.ov === best.ov && cand.subj && !best.subj) { best = cand; }
    else if (cand.ov === best.ov && cand.subj === best.subj && cand.len > best.len) { best = cand; }
    expectOverview = false;
  }
  if (!best) return null;
  return best.clean.length > maxLen ? best.clean.slice(0, maxLen - 1) + '…' : best.clean;
}

/** 从 zread.ai /:owner/:repo/wiki 页面的 Next.js RSC payload 里提取 Overview 中文描述 */
export async function fetchZreadWikiDesc(repo: string, maxLen = 280): Promise<string | null> {
  // 2026-08 zread 风控波动: 504(Cloudflare 错误页, ~6s)与 200(慢渲染 48-67s 或缓存快回 1s)混杂, 实测命中率 4/5。
  // 策略: 超时放宽到 75s + 非 200 重试一次(间隔 3s)。仍失败落 deepwiki/翻译链。
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`https://zread.ai/${repo}/wiki`, {
        headers: { 'User-Agent': ZREAD_UA, 'Accept-Language': 'zh-CN,zh;q=0.9' },
        signal: AbortSignal.timeout(75000),
      });
      if (!res.ok) {
        if (attempt === 0) await new Promise((r) => setTimeout(r, 3000));
        continue;
      }
      const html = await res.text();
      // 拼接全部 RSC 字符串块
      const chunkRe = /self\.__next_f\.push\(\[1,("(?:[^"\\]|\\.)*")\]\)/g;
      let payload = '';
      for (const m of html.matchAll(chunkRe)) {
        payload += JSON.parse(m[1] as string) as string;
      }
      return extractDesc(payload, maxLen, repo.split('/').pop()?.split(/[-_]/)[0]); // subject = 仓库名首段(hermes-agent→hermes), 优先含它的定义段
    } catch {
      return null; // 网络/解析异常不重试——重试只针对 504 波动
    }
  }
  return null;
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
