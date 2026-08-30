// X/Twitter 帖子存档: FxEmbed 公共 API(api.fxtwitter.com, FxTwitter 同源)。
// 免 key, 限 1000 req/min/IP(个人用量无虞)。失败不抛——增强层, 落回通用 URL 存档链。
const API = 'https://api.fxtwitter.com';
const ZH_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126';

/** 从消息文本提取 X 帖子链接(x.com/twitter.com 任意子域, /:user/status/:id)。返回规范化 user/status/id。 */
export function extractTweet(text: string): { handle: string; id: string } | null {
  const m = text.match(/(?:https?:\/\/)?(?:www\.|mobile\.)?(?:x|twitter)\.com\/([A-Za-z0-9_]{1,20})\/status(?:es)?\/(\d{2,25})/i);
  return m ? { handle: m[1], id: m[2] } : null;
}

type FxMedia = { type?: string; url?: string; thumbnail_url?: string; alt_text?: string };
export type FxTweet = {
  url?: string;
  id?: string;
  text?: string;
  author?: { screen_name?: string; name?: string };
  created_at?: string;
  likes?: number; retweets?: number; reposts?: number; replies?: number; // v2 用 reposts, v1 用 retweets
  media?: {
    all?: FxMedia[];
    photos?: FxMedia[];
    mosaic?: { formats?: { jpeg?: string; webp?: string } }; // 多图拼图(FxEmbed 服务端合成)
  } | null;
  translation?: { text?: string } | null;
  article?: {
    id?: string; title?: string; preview_text?: string;
    cover_media?: { media_info?: { original_img_url?: string } };
    content?: { blocks?: { type?: string; text?: string }[] };
  } | null;
};

/** 嵌套文章 blocks → 纯文本正文(提取非空 text 段, 拼接换行)。无文章返回 null。 */
export function articleToText(t: FxTweet): string | null {
  const blocks = t.article?.content?.blocks ?? [];
  if (!blocks.length) return null;
  const lines = blocks.map((b) => b.text ?? '').filter((s) => s.trim().length > 0);
  const txt = lines.join('\n\n').trim();
  return txt.length ? txt : null;
}

/** article 引用帖: 正文只是 x.com/i/article/<id> 裸链(v2 API 对部分 article 帖不内嵌 article 对象,
 *  text 也不含可读文本)。返回 fixupx 公开页链接(服务端渲染全文, 免登录墙), 供 urlToMarkdown 提取
 *  正文并作为展示链接; 非 article 引用帖 → null。 */
export function articleRefFixup(tweet: FxTweet, handle: string): string | null {
  if (!tweet.id || !/x\.com\/i\/article\//.test(tweet.text ?? '')) return null;
  return `https://fixupx.com/${handle}/status/${tweet.id}`;
}

/** 拉取帖子 JSON(v2 API /2/status/{id}?lang=zh-cn)。网络/解析失败返回 null(调用方落回 URL 链)。
 *  v2 相比 v1: 不用从 URL 提取 handle, translation 带 provider, 支持 search/trends 等新端点。 */
export async function fetchTweet(_handle: string, id: string): Promise<FxTweet | null> {
  try {
    // ponytail: handle 参数保留(v1 兼容签名), v2 只需 id —— 调用方无需改签名
    const res = await fetch(`${API}/2/status/${id}?lang=zh-cn`, {
      headers: { 'User-Agent': ZH_UA },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { code?: number; status?: FxTweet | null };
    if (j.code !== 200 || !j.status?.text) return null; // code 字段镜像 HTTP 状态, 200 包体也要查
    return j.status;
  } catch {
    return null;
  }
}

/** 帖子 → Telegram HTML, 对齐 product/trending 三段式: 标题直链 / 中文正文(替换原文) / 存档三链。
 * title: 标题文本; body: 正文(非中文已译中文, 直接替换原文)。 */
import { esc } from './render';
export function renderTweetHtml(t: FxTweet, title: string, body: string, zhLine = '', links = ''): string {
  // product 对齐: LLM 生成标题直链 → 中文正文 → 存档三链。zhLine 仅作可选的原文英文展示(默认无)。
  return [
    `<b><a href="${esc(t.url ?? '')}">${esc(title || t.text?.slice(0, 60) || '')}</a></b>`,
    esc(body).slice(0, 3500),
    zhLine,
    links,
  ].filter((s) => s !== '').join('\n\n');
}
