import { extractOgImage } from './urlmd';
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
// OG 图 + 文字合一: 每项目一条 sendPhoto。ogUrl 提供时按来源选图:
// GitHub repo → GitHub OG 卡; 非 GitHub(网页) → 抓页面 og:image。图下载失败 → 降级纯文字。caption 上限 1024。
// ponytail: 串行 for(10×12s OG 抓取=120s)→ 超 waitUntil 30s 墙。改 Promise.all 并发,
// 图抓取并行 12s 内完成, 发送批量并发(TG 429 由 catch 重试兜)。
export async function sendPerRepoMessages(
  token: string,
  chatId: string,
  messages: { html: string; repo?: string; ogUrl?: string }[],
  archiveRepo?: string,
): Promise<void> {
  await Promise.all(
    messages.map(async (m) => {
      // 图源 URL 判定: GitHub repo → 官方 OG + 自托管优先后台; 非 GitHub → 抓页面 og:image
      let photoUrl: string | null = null;
      let selfRetry: string | null = null;
      const isGh = /^https?:\/\/(github|www\.github)\.com\//i.test(m.ogUrl ?? '');
      if (m.ogUrl && !isGh) {
        // 网页: fetch 拿 HTML → 提取 og:image。失败 photoUrl=null → 降级纯文字。
        try {
          const r = await fetch(m.ogUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/126' }, signal: AbortSignal.timeout(12000) });
          if (r.ok) {
            const html = await r.text();
            photoUrl = extractOgImage(html.slice(0, 100_000));
          }
        } catch { /* 网页 OG 抓取失败 → 降级 */ }
      } else {
        // GitHub repo(或缺 ogUrl): 自家存档域优先后台 → 官方 GitHub OG
        const repo = m.repo ?? (m.ogUrl ? m.ogUrl.replace(/^https?:\/\/(www\.)?github\.com\//i, '') : '');
        const selfHosted = archiveRepo
          ? `https://raw.githubusercontent.com/${archiveRepo}/archive/og-images/${repo.replace('/', '__')}.png`
          : null;
        photoUrl = selfHosted ?? (repo ? `https://opengraph.githubassets.com/1/${repo}` : null);
        // 自托管图 404(未入库) → 下方 sendPhoto 失败后回退官方 OG
        selfRetry = selfHosted ? `https://opengraph.githubassets.com/1/${repo}` : null;
      }
      if (!photoUrl) {
        // 无图 → 直接纯文字
        await fetch(`${API}/bot${token}/sendMessage`, {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: m.html, parse_mode: 'HTML', link_preview_options: m.ogUrl ? { url: m.ogUrl, prefer_large_media: true } : undefined }),
        });
        return;
      }
      // TG 服务端代抓(photo=URL)——省 Worker 子请求, 代抓失败自动降级
      const res = await fetch(`${API}/bot${token}/sendPhoto`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          photo: photoUrl,
          caption: m.html.slice(0, 1020),
          parse_mode: 'HTML',
        }),
      });
      // 自托管 404(该 repo 未入库) → 回退官方 OG 再试
      if (!res.ok && selfRetry) {
        const retry = await fetch(`${API}/bot${token}/sendPhoto`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, photo: selfRetry, caption: m.html.slice(0, 1020), parse_mode: 'HTML' }),
        });
        if (retry.ok) return;
      }
      if (!res.ok) {
        console.error(`sendPhoto ${photoUrl.slice(0, 60)} ${res.status}, fallback to text`);
        const fb = await fetch(`${API}/bot${token}/sendMessage`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ chat_id: chatId, text: m.html, parse_mode: 'HTML', link_preview_options: m.ogUrl ? { url: m.ogUrl, prefer_large_media: true } : undefined }),
        });
        if (!fb.ok) console.error(`sendMessage fallback also failed ${fb.status}: ${(await fb.text()).slice(0, 120)}`);
      }
    }),
  );
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
