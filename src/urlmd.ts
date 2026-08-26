// 任意 URL → markdown: 三级降级链, 全部免费层。
//
// 1) Markdown for Agents — 仅对「已开启该功能的 Cloudflare 托管站点」生效(内容协商
//    Accept: text/markdown)。非 CF 站点返回原始 HTML → 嗅探检测, 失败进下一级。
// 2) AI.toMarkdown({name, blob}) — Workers AI 文档转换。HTML/PDF/图片/Office 全支持,
//    除图片外免费; 静态解析(不执行 JS)。
// 3) Browser Rendering /markdown — 真无头浏览器, 能跑 JS(动态页面兜底)。
//    Workers Free 每天 10 分钟额度; 个人用量足够, 超出即放弃(不付费)。

import type { Env } from './types';

const UA_DESKTOP =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

/**
 * 从 HTML 提取 OG 图, 相对 URL 转绝对, HTML 实体解码。
 * 字段覆盖对齐 open-graph-scraper(og:image/:secure_url/:url + twitter:image/:src),
 * 且同时接受 property= 与 name= 两种属性形态、content 前置/后置两种属性序。
 * ponytail: 正则而非 DOM 解析——只取 meta 头部 100KB, 完整解析器是 Node 依赖, Worker 里 YAGNI。
 */
export function extractOgImage(html: string): string | null {
  const IMG = 'og:image(?::secure_url|:url)?';
  const TW = 'twitter:image(?::src)?';
  const m =
    html.match(new RegExp(String.raw`<meta[^>]+(?:property|name)=["'](?:${IMG})["'][^>]+content=["']([^"']+)["']`, 'i')) ??
    html.match(new RegExp(String.raw`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:${IMG})["']`, 'i')) ??
    html.match(new RegExp(String.raw`<meta[^>]+(?:property|name)=["'](?:${TW})["'][^>]+content=["']([^"']+)["']`, 'i')) ??
    html.match(new RegExp(String.raw`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:${TW})["']`, 'i'));
  if (!m) return null;
  // HTML 实体解码(&amp; 最常见); 仅收绝对/协议相对 URL(sendPhoto 需完整 https), 页面相对路径无 base → 放弃
  const raw = m[1].replace(/&amp;/g, '&').replace(/&#0?39;/g, "'").replace(/&quot;/g, '"');
  if (/^https?:\/\//i.test(raw)) return raw;
  if (raw.startsWith('//')) return `https:${raw}`;
  return null;
}

/** 抓取 URL 原始字节(带 UA; 失败抛给调用方)。 */
async function fetchRaw(url: string): Promise<Blob> {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA_DESKTOP, Accept: 'text/html,application/xhtml+xml,*/*' },
    signal: AbortSignal.timeout(20000),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.blob();
}

/** 方法0(优先, 有 key): Jina Reader r.jina.ai → 干净 markdown(去导航噪声, 通用)。 */
async function viaJina(env: Env, url: string): Promise<string | null> {
  if (!env.JINA_API_KEY) return null;
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: { Authorization: `Bearer ${env.JINA_API_KEY}`, 'User-Agent': UA_DESKTOP },
      signal: AbortSignal.timeout(30000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    // 去掉 Jina 头部(title/url/published/markdown content 前缀) → 纯正文
    const body = text.replace(/Title:.+\n.*\n.*\n(Markdown Content:\s*)/i, '').trim();
    return body.length > 40 ? body : null;
  } catch {
    return null;
  }
}

/** 方法1: Markdown for Agents(仅 CF 托管+已开启站点有效)。 */
async function viaMarkdownForAgents(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { Accept: 'text/markdown', 'User-Agent': UA_DESKTOP },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return null;
    const text = await res.text();
    // 非 CF 转换站点会无视 Accept 返回 HTML —— 嗅探拒绝
    if (text.slice(0, 200).toLowerCase().includes('<!doctype html')) return null;
    if (text.slice(0, 200).toLowerCase().includes('<html')) return null;
    return text.trim() ? text : null;
  } catch {
    return null;
  }
}

/** 方法2: Workers AI toMarkdown(静态文档解析, HTML 免费且覆盖 PDF/图片等)。 */
async function viaToMarkdown(env: Env, url: string): Promise<string | null> {
  try {
    const blob = await fetchRaw(url);
    const results = await env.AI.toMarkdown({ name: 'page.html', blob });
    const r = Array.isArray(results) ? results[0] : results;
    if (r && r.format === 'markdown' && r.data?.trim()) return r.data;
    return null;
  } catch {
    return null;
  }
}

/** 方法3: Browser Rendering REST /markdown(真浏览器, 免费层每天10分钟)。 */
async function viaBrowserRendering(accountId: string, token: string, url: string): Promise<string | null> {
  try {
    const res = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/browser-rendering/markdown`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ url }),
      signal: AbortSignal.timeout(60000),
    });
    if (!res.ok) {
      console.error(`browser-rendering ${res.status}: ${(await res.text()).slice(0, 120)}`);
      return null;
    }
    const j = (await res.json()) as { success?: boolean; result?: string };
    return j.success && j.result?.trim() ? j.result : null;
  } catch {
    return null;
  }
}

/** 方法4(兜底免费): 直接抓 HTML 剥 script/style/tag → 纯文本正文。覆盖普通非 CF 官网(免 Browser Rendering 配置)。 */
// ponytail: 正则剥标签 + 去导航噪声(nav/header/footer/script/style), 粗但免费通用; 能做正文即可喂摘要
async function viaHtmlStrip(url: string): Promise<string | null> {
  try {
    const blob = await fetchRaw(url);
    let html = await blob.text();
    if (!html.toLowerCase().includes('<!doctype html') && !html.toLowerCase().includes('<html')) return null; // 非 HTML
    html = html
      .replace(/<(script|style|noscript|header|nav|footer|aside)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&amp;/g, '&').replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
      .replace(/\s+/g, ' ').trim();
    const out = html.replace(/\b\w{1,2}\b/g, '').replace(/\s{2,}/g, ' ').trim();
    return out.length > 40 ? out : null;
  } catch {
    return null;
  }
}

/**
 * 主入口: 依次尝试三级降级链, 返回第一个非空结果; 全失败抛错给调用方提示用户。
 * ponytail: 不做内容类型预判——PDF/图片在方法1必嗅探失败、方法2天然命中,
 * 预判要 +1 次 HEAD 子请求, 不值。
 */
export async function urlToMarkdown(
  env: Env,
  url: string,
  opts: { accountId?: string; apiToken?: string },
): Promise<string> {
  // 方法0: Jina Reader 优先(有 key, 干净 markdown 通用)
  const m0 = await viaJina(env, url);
  if (m0) return m0;

  const m1 = await viaMarkdownForAgents(url);
  if (m1) return m1;

  const m2 = await viaToMarkdown(env, url);
  if (m2) return m2;

  if (opts.accountId && opts.apiToken) {
    const m3 = await viaBrowserRendering(opts.accountId, opts.apiToken, url);
    if (m3) return m3;
  }

  // 方法4 兜底: 普通 HTML 官网(免 Browser Rendering 配置) —— 剥标签取纯文本正文
  const m4 = await viaHtmlStrip(url);
  if (m4) return m4;

  return ''; // 全失败 → 空串, 调用方安静兜底(标题翻译), 不再 throw
}

/** 从消息文本提取首个 http(s) URL(URL 按规范只含 ASCII, 中文跟随自然截断; 尾部标点剥离)。 */
export function extractUrl(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s<>"')\]\u007f-\uffff]+/i);
  return m ? m[0].replace(/[.,;!?]+$/, '') : null;
}
