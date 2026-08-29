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

/** 图卡合一: photo=直链图 → sendPhoto(caption=html); 失败 → 纯文字 sendMessage。每条消息必带图的总入口。
 * cache 可选(telegram 图床): 首次 sendPhoto 用 URL 上传, TG 返回 file_id 存 KV; 同图复用 file_id 免重复抓取/免存 GitHub。
 * key 用 photo URL 本身(normalize), 稳定复用。ponytail: 不校验 file_id 有效性, TG 失败即回退重传。 */
export async function sendPhotoOrText(token: string, chatId: string, photo: string | undefined, html: string, cache?: { get: (k: string) => Promise<string | null>; put: (k: string, v: string) => Promise<void> }): Promise<void> {
  if (photo) {
    // 图床 key = photo URL(短 hash)。重复图直接复用已存 file_id。
    const key = photo.startsWith('https://') ? `og:${photo}` : undefined;
    let fileId: string | null = null;
    if (cache && key) fileId = await cache.get(key).catch(() => null);
    const payload: Record<string, unknown> = { chat_id: chatId, photo: fileId ?? photo, caption: html.slice(0, 1020), parse_mode: 'HTML' };
    const res = await fetch(`${API}/bot${token}/sendPhoto`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    }).catch(() => null);
    if (res?.ok) {
      // 存图床 file_id 供复用(TG 会先下载 URL 再返回 id; 下次直接传 id 免 TG 再抓外部图)
      if (cache && key && !fileId) {
        try { const j = await res.clone().json() as { result?: { photo?: { file_id?: string }[] } }; if (j.result?.photo?.[0]?.file_id) await cache.put(key, j.result.photo[0].file_id); } catch { /* 图床缓存失败不影响本次 */ }
      }
      return;
    }
    console.error(`sendPhoto ${res?.status ?? 'net'}, fallback text`);
  }
  await sendTelegram(token, chatId, html);
}

/** Telegram 机器人命令菜单(bot 输入框 "/" 弹菜单)。幂等,setMyCommands repeated 安全。 */
export async function registerCommands(token: string): Promise<void> {
  const res = await fetch(`${API}/bot${token}/setMyCommands`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      commands: [
        { command: 'gt', description: '查询今日 GitHub Trending' },
        { command: 'hn', description: '查询今日 Hacker News 酷产品' },
        { command: 'ph', description: '查询今日 Product Hunt 热门产品' },
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
  messages: { html: string; repo?: string; ogUrl?: string; photo?: string }[],
  archiveRepo?: string,
  cache?: { get: (k: string) => Promise<string | null>; put: (k: string, v: string) => Promise<void> },
): Promise<void> {
  for (const m of messages) {
    // 实体图优先(sendPhoto, 经 TG 图床缓存 file_id) → 无 photo 回落 link_preview(ogUrl)
    if (m.photo) {
      await sendPhotoOrText(token, chatId, m.photo, m.html, cache);
      continue;
    }
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
