const API = 'https://api.telegram.org';

export async function sendTelegram(token: string, chatId: string, html: string): Promise<void> {
  const res = await fetch(`${API}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  if (!res.ok) console.error(`sendMessage ${res.status}: ${await res.text()}`);
}

// OG 图相册(每 repo 一图, caption 带标题+星数)。sendMediaGroup 上限 10 张/组。
// Telegram 服务器代抓图, 偶发 WEBPAGE_CURL_FAILED → 失败项剔除后整组重试一次。
export async function sendOgAlbum(
  token: string,
  chatId: string,
  items: { title: string; stars?: number; starsToday?: number }[],
): Promise<void> {
  for (let i = 0; i < items.length; i += 10) {
    let group = items.slice(i, i + 10).map((it, j) => {
      const today = it.starsToday ? ` (+${it.starsToday} 今日)` : '';
      return {
        type: 'photo' as const,
        media: `https://opengraph.githubassets.com/${i + j + 1}/${it.title}`,
        caption: `${i + j + 1}. ${it.title}${today}`,
      };
    });
    for (let attempt = 0; attempt < 2 && group.length; attempt++) {
      const res = await fetch(`${API}/bot${token}/sendMediaGroup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, media: group }),
      });
      if (res.ok) break;
      const err = (await res.text()).slice(0, 200);
      console.error(`sendMediaGroup ${res.status}: ${err}`);
      // WEBPAGE_CURL_FAILED = 某张图 Telegram 抓取失败; message #N → 剔除第 N 张重试
      const m = err.match(/message #(\d+)/);
      if (!m || !res.ok) break;
      group.splice(Number(m[1]) - 1, 1);
    }
  }
}

// timing-safe 比较 webhook secret
export async function safeEqual(a: string, b: string): Promise<boolean> {
  if (a.length !== b.length) return false;
  const ab = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  let diff = 0;
  for (let i = 0; i < ab.length; i++) diff |= ab[i] ^ bb[i];
  return diff === 0;
}
