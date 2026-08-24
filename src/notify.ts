const API = 'https://api.telegram.org';

export async function sendTelegram(token: string, chatId: string, html: string): Promise<void> {
  const res = await fetch(`${API}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  if (!res.ok) console.error(`sendMessage ${res.status}: ${await res.text()}`);
}

// Telegram 机器人命令菜单(bot 输入框 "/" 弹菜单)。幂等,setMyCommands repeated 安全。
export async function registerCommands(token: string): Promise<void> {
  const res = await fetch(`${API}/bot${token}/setMyCommands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      commands: [
        { command: 'trending', description: '获取今日 GitHub Trending' },
        { command: 'search', description: '搜索历史存档(如 /search react)' },
        { command: 'archive', description: '查看历史存档链接' },
        { command: 'help', description: '使用说明' },
      ],
    }),
  });
  if (!res.ok) console.error(`setMyCommands ${res.status}: ${await res.text()}`);
}

// OG 图 + 文字合一: 每项目一条 sendPhoto(图=GitHub OG 卡, caption=完整条目)。
// 图下载失败 → 降级纯文字。caption 上限 1024。
export async function sendPerRepoMessages(
  token: string,
  chatId: string,
  messages: { html: string; repo: string }[],
): Promise<void> {
  for (const m of messages) {
    // TG 服务端代抓 OG 图(photo=URL)——省 Worker 子请求(10张图×1 = 10个), 代抓失败自动降级纯文字
    const res = await fetch(`${API}/bot${token}/sendPhoto`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        photo: `https://opengraph.githubassets.com/1/${m.repo}`,
        caption: m.html.slice(0, 1020),
        parse_mode: 'HTML',
      }),
    });
    if (!res.ok) {
      console.error(`sendPhoto ${m.repo} ${res.status}, fallback to text`);
      const fb = await fetch(`${API}/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text: m.html, parse_mode: 'HTML', disable_web_page_preview: true }),
      });
      if (!fb.ok) console.error(`sendMessage fallback also failed ${fb.status}: ${(await fb.text()).slice(0, 120)}`);
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
