const API = 'https://api.telegram.org';

export async function sendTelegram(token: string, chatId: string, html: string): Promise<void> {
  const res = await fetch(`${API}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  if (!res.ok) console.error(`sendMessage ${res.status}: ${await res.text()}`);
}

// OG 图相册。Telegram 代抓 opengraph.githubassets.com 偶发被限速(WEBPAGE_CURL_FAILED),
// 所以 Worker 自己下载图片, 以 multipart attach:// 上传——可靠。
export async function sendOgAlbum(
  token: string,
  chatId: string,
  items: { title: string; stars?: number; starsToday?: number }[],
): Promise<void> {
  for (let i = 0; i < items.length; i += 10) {
    const slice = items.slice(i, i + 10);
    // 并行下载全部图(约60KB/张)
    const fetched = await Promise.all(
      slice.map(async (it, j) => {
        try {
          const r = await fetch(`https://opengraph.githubassets.com/${i + j + 1}/${it.title}`, {
            headers: { 'User-Agent': 'daily-digest-bot' },
          });
          if (!r.ok) throw new Error(String(r.status));
          return { it, blob: await r.blob() };
        } catch (e) {
          console.error(`og fetch ${it.title}: ${String(e).slice(0, 60)}`);
          return null;
        }
      }),
    );
    const ok = fetched.filter((f): f is NonNullable<typeof f> => f !== null);
    if (!ok.length) continue;

    const form = new FormData();
    form.append('chat_id', chatId);
    form.append(
      'media',
      JSON.stringify(
        ok.map(({ it }, j) => ({
          type: 'photo',
          media: `attach://p${j}`,
          caption: `${i + j + 1}. ${it.title}${it.starsToday ? ` (+${it.starsToday} 今日)` : ''}`,
        })),
      ),
    );
    ok.forEach(({ blob }, j) => form.append(`p${j}`, blob, `og${j}.png`));

    const res = await fetch(`${API}/bot${token}/sendMediaGroup`, { method: 'POST', body: form });
    if (!res.ok) console.error(`sendMediaGroup ${res.status}: ${(await res.text()).slice(0, 120)}`);
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
