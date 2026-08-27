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
  likes?: number; retweets?: number; replies?: number;
  media?: { all?: FxMedia[] } | null;
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

/** 拉取帖子 JSON。网络/解析失败返回 null(调用方落回 URL 链)。 */
export async function fetchTweet(handle: string, id: string): Promise<FxTweet | null> {
  try {
    const res = await fetch(`${API}/${handle}/status/${id}/zh-cn`, {
      headers: { 'User-Agent': ZH_UA },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { code?: number; tweet?: FxTweet | null };
    if (j.code !== 200 || !j.tweet?.text) return null; // code 字段镜像 HTTP 状态, 200 包体也要查
    return j.tweet;
  } catch {
    return null;
  }
}

/** 帖子 → Telegram HTML, 对齐 product/trending 三段式: 作者直链 / 内容(中英) / 互动 / 存档三链。
 * links: 存档三链 HTML(Wayback·Archive·Telegraph 由调用方拼好)。 */
export function renderTweetHtml(t: FxTweet, zhLine = '', links = ''): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const a = t.author ?? {};
  const stats = [
    t.likes !== undefined ? `❤️ ${t.likes}` : '',
    t.retweets !== undefined ? `🔁 ${t.retweets}` : '',
    t.replies !== undefined ? `💬 ${t.replies}` : '',
  ].filter(Boolean).join(' · ');
  const media = (t.media?.all ?? []);
  const zhType = (ty?: string) => (ty === 'photo' ? '图片' : ty === 'video' ? '视频' : ty === 'gif' ? 'GIF' : ty ?? 'media');
  const mediaLine = media.length
    ? `\n\n📎 ${media.map((m) => `<a href="${esc(m.url ?? m.thumbnail_url ?? '')}">${esc(zhType(m.type))}</a>`).join(' · ')}`
    : '';
  const date = t.created_at
    ? // Twitter UTC 时间串 → 北京时间 YYYY-MM-DD HH:mm(纯字符串变换, 无 Date 解析)
      `\n\n🗓 ${t.created_at.replace(
        /^(\w{3}) (\w{3}) (\d{2}) (\d{2}):(\d{2}):\d{2} \+\d{4} (\d{4})$/,
        (_s, _wd, mon, d, hh, mm, yr) => {
          const months: Record<string, string> = { Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12' };
          const h = (Number(hh) + 8) % 24;
          return `${yr}-${months[mon] ?? '??'}-${d} ${String(h).padStart(2, '0')}:${mm}`;
        },
      )}`
    : '';
  // product 对齐: 作者名直链(标题层) → 中文内容优先(🌐翻译) → 互动行 → 标签 → 存档三链
  return [
    `🐦 <b><a href="${esc(t.url ?? '')}">${esc(a.name ?? a.screen_name ?? '')} · @${esc(a.screen_name ?? '')}</a></b>`,
    '',
    esc(t.text ?? '').slice(0, 3500),
    zhLine,
    mediaLine,
    date,
    stats ? `\n\n${stats}` : '',
    links,
  ].filter((s) => s !== '').join('\n');
}
