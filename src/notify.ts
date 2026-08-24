const API = 'https://api.telegram.org';

export async function sendTelegram(token: string, chatId: string, html: string): Promise<void> {
  const res = await fetch(`${API}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  if (!res.ok) console.error(`sendMessage ${res.status}: ${await res.text()}`);
}

// OG 图 + 文字合一: 每项目一条 sendPhoto(图=GitHub OG 卡, caption=完整条目)。
// 图下载失败 → 降级纯文字。caption 上限 1024。
export async function sendPerRepoMessages(
  token: string,
  chatId: string,
  messages: { html: string; repo: string }[],
): Promise<void> {
  for (const m of messages) {
    const blob = await fetchOgImage(m.repo);
    let res: Response;
    if (blob) {
      const form = new FormData();
      form.append('chat_id', chatId);
      form.append('photo', blob, 'og.png');
      form.append('caption', m.html.slice(0, 1020));
      form.append('parse_mode', 'HTML');
      res = await fetch(`${API}/bot${token}/sendPhoto`, { method: 'POST', body: form });
    } else {
      res = await fetch(`${API}/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: m.html, parse_mode: 'HTML', disable_web_page_preview: true }),
      });
    }
    if (!res.ok) console.error(`sendPhoto ${m.repo} ${res.status}: ${(await res.text()).slice(0, 120)}`);
  }
}

async function fetchOgImage(repo: string): Promise<Blob | null> {
  try {
    const r = await fetch(`https://opengraph.githubassets.com/1/${repo}`, {
      headers: { 'User-Agent': 'daily-digest-bot' },
      signal: AbortSignal.timeout(15000),
    });
    return r.ok ? await r.blob() : null;
  } catch {
    return null;
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
