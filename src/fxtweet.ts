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
};

/** 拉取帖子 JSON。网络/解析失败返回 null(调用方落回 URL 链)。 */
export async function fetchTweet(handle: string, id: string): Promise<FxTweet | null> {
  try {
    const res = await fetch(`${API}/${handle}/status/${id}`, {
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

/** 帖子 → Telegram HTML(esc 由调用方处理前先本地转义)。 */
export function renderTweetHtml(t: FxTweet): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const a = t.author ?? {};
  const stats = [
    t.likes !== undefined ? `❤️ ${t.likes}` : '',
    t.retweets !== undefined ? `🔁 ${t.retweets}` : '',
    t.replies !== undefined ? `💬 ${t.replies}` : '',
  ].filter(Boolean).join(' · ');
  const media = (t.media?.all ?? []);
  const mediaLine = media.length
    ? `\n\n📎 ${media.map((m) => `<a href="${esc(m.url ?? m.thumbnail_url ?? '')}">${esc(m.type ?? 'media')}</a>`).join(' · ')}`
    : '';
  const date = t.created_at ? `\n\n🗓 ${t.created_at.slice(0, 16)}` : '';
  return [
    `<b>🐦 ${esc(a.name ?? a.screen_name ?? '')} <a href="${esc(t.url ?? '')}">@${esc(a.screen_name ?? '')}</a></b>`,
    '',
    esc(t.text ?? '').slice(0, 3500),
    mediaLine,
    date,
    stats ? `\n\n${stats}` : '',
  ].join('\n');
}
