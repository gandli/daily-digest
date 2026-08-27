const API = 'https://api.telegram.org';

/** 命令收到即显示"正在输入…"(低成本高回报——处理 2-30s 用户知道在跑)。失败静默。 */
export async function sendChatAction(token: string, chatId: string, action = 'typing'): Promise<void> {
  try {
    await fetch(`${API}/bot${token}/sendChatAction`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action }),
    });
  } catch { /* 状态失败不影响主流程 */ }
}

export async function sendTelegram(token: string, chatId: string, html: string): Promise<void> {
  const res = await fetch(`${API}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: 'HTML', disable_web_page_preview: true }),
  });
  if (!res.ok) console.error(`sendMessage ${res.status}: ${await res.text()}`);
}

/** 图卡合一: photo=直链图 → sendPhoto(caption=html); 失败 → 纯文字 sendMessage。每条消息必带图的总入口。 */
export async function sendPhotoOrText(token: string, chatId: string, photo: string | undefined, html: string): Promise<void> {
  if (photo) {
    const res = await fetch(`${API}/bot${token}/sendPhoto`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, photo, caption: html.slice(0, 1020), parse_mode: 'HTML' }),
    }).catch(() => null);
    if (res?.ok) return;
    console.error(`sendPhoto ${res?.status ?? 'net'}, fallback text`);
  }
  await sendTelegram(token, chatId, html);
}

/** 视频卡: sendVideo(mp4 直链内嵌播放, caption=html); 失败落 sendPhotoOrText(缩略图/纯文字)。 */
export async function sendVideoOrText(token: string, chatId: string, video: string | undefined, thumb: string | undefined, html: string): Promise<void> {
  if (video) {
    const res = await fetch(`${API}/bot${token}/sendVideo`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, video, caption: html.slice(0, 1020), parse_mode: 'HTML', supports_streaming: true }),
    }).catch(() => null);
    if (res?.ok) return;
    console.error(`sendVideo ${res?.status ?? 'net'}, fallback photo`);
  }
  await sendPhotoOrText(token, chatId, thumb, html);
}

// Telegram 机器人命令菜单(bot 输入框 "/" 弹菜单)。幂等,setMyCommands repeated 安全。
export async function registerCommands(token: string): Promise<void> {
  const res = await fetch(`${API}/bot${token}/setMyCommands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      commands: [
        { command: 'trending', description: '今日 GitHub Trending' },
        { command: 'product', description: '今日 HN 酷产品' },
        { command: 'search', description: '搜索历史存档' },
        { command: 'archive', description: '历史存档(分页+三链)' },
        { command: 'help', description: '使用说明' },
      ],
    }),
  });
  if (!res.ok) console.error(`setMyCommands ${res.status}: ${await res.text()}`);
}

// OG 图 + 文字合一: 每项目一条 sendPhoto(图=GitHub OG 卡, caption=完整条目)。
// ponytail: 串行 for(10×12s OG 抓取=120s)→ 超 30s waitUntil 墙。Promise.all 并发 → 爆 50 子请求上限。
// 删 OG 图抓取: 只发文字 + link_preview_options, 子请求降到 10 个, 跑在 50 限内。
export async function sendPerRepoMessages(
  token: string,
  chatId: string,
  messages: { html: string; repo?: string; ogUrl?: string }[],
  archiveRepo?: string,
): Promise<void> {
  for (const m of messages) {
    await fetch(`${API}/bot${token}/sendMessage`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: m.html, parse_mode: 'HTML', link_preview_options: m.ogUrl ? { url: m.ogUrl, prefer_large_media: true } : undefined }),
    }).then(r => r.text()); // 消费 body 防 stalled HTTP response
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

export type InlineKB = { inline_keyboard: Array<Array<{ text: string; callback_data: string }>> };

/** 带 inline keyboard 的 sendMessage。 */
export async function sendTelegramKbd(token: string, chatId: string, html: string, kb: InlineKB): Promise<void> {
  const res = await fetch(`${API}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: html, parse_mode: 'HTML', reply_markup: kb }),
  });
  if (!res.ok) console.error(`sendMessageKbd ${res.status}: ${await res.text()}`);
}

/** callback_query 已应答(转圈消失)。 */
export async function answerCallbackQuery(token: string, callbackQueryId: string): Promise<void> {
  await fetch(`${API}/bot${token}/answerCallbackQuery`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ callback_query_id: callbackQueryId, show_alert: false }),
  }).catch(() => undefined);
}

/** editMessageText inline keyboard 翻页。 */
export async function editMessageKbd(token: string, chatId: string, messageId: number, html: string, kb: InlineKB): Promise<void> {
  const res = await fetch(`${API}/bot${token}/editMessageText`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, message_id: messageId, text: html, parse_mode: 'HTML', reply_markup: kb }),
  });
  if (!res.ok) console.error(`editMessageText ${res.status}: ${await res.text()}`);
}
