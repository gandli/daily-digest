// 链接重放台本: 本地复现"发链接没反应"——把一条 Telegram update 原样喂进 Worker fetch handler,
// 打印分派决策 + 全部出站 TG 消息 + 失败原因。**不真发 Telegram**(fetch 拦截), 但读取链/翻译/归档
// 按真实网络走, 所以能复现线上"抓不到内容/链截断/静默丢更新"这类只在真环境暴露的问题。
//
// 用法:
//   npm run replay -- 'https://en.wikipedia.org/wiki/Rust_(programming_language)'
//   npm run replay -- --update '{"edited_message":{"chat":{"id":1},"text":"https://a.com"}}}'
//   npm run replay -- --live 'https://x.com/foo/status/123'        # --live: 真发 TG(读 .dev.vars)
//
// 判读: 输出 `OUTBOUND MESSAGES: 0` 即为"静默丢更新"(入口形态未覆盖 / 白名单 / 限流)。
import { readFileSync, existsSync } from 'node:fs';
import worker from '../src/index';

const args = process.argv.slice(2);
const live = args.includes('--live');
const upIdx = args.indexOf('--update');

let update: unknown;
if (upIdx >= 0) {
  update = JSON.parse(args[upIdx + 1]);
} else {
  const text = args.filter((a) => !a.startsWith('--'))[0] ?? 'https://example.com';
  const chatId = Number(process.env.REPLAY_CHAT_ID ?? 944783507);
  update = { message: { chat: { id: chatId }, message_id: 1, text } };
}

// .dev.vars 里的真实凭证(--live 或需要 GH token 存档时)
const vars: Record<string, string> = {};
if (existsSync('.dev.vars')) {
  for (const line of readFileSync('.dev.vars', 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
    if (m) vars[m[1]] = m[2];
  }
}

const outbound: { url: string; body: any }[] = [];
const netLog: string[] = [];
const realFetch = globalThis.fetch;

const KV = new Map<string, string>();
const env: any = {
  ...vars,
  CHAT_ID: vars.CHAT_ID ?? String((update as any).message?.chat?.id ?? (update as any).edited_message?.chat?.id ?? ''),
  BOT_TOKEN: vars.BOT_TOKEN ?? 'REPLAY_TOKEN',
  WEBHOOK_SECRET: 'replay',
  GH_ARCHIVE_REPO: vars.GH_ARCHIVE_REPO ?? 'gandli/daily-digest',
  CACHE: {
    list: async ({ prefix }: { prefix: string }) => ({ keys: [...KV.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })) }),
    get: async (k: string) => KV.get(k) ?? null,
    put: async (k: string, v: string) => { KV.set(k, v); },
    delete: async (k: string) => { KV.delete(k); },
  },
  AI: undefined, VEC: undefined, DB: undefined,
};

// TG 调用: --live 真发, 否则只记录
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const u = String(input);
  if (u.includes('api.telegram.org')) {
    const body = init?.body ? JSON.parse(String(init.body)) : {};
    outbound.push({ url: u, body });
    if (!live) return new Response(JSON.stringify({ ok: true, result: { message_id: 1 } }), { status: 200 });
  }
  if (!u.includes('api.telegram.org')) netLog.push(`${init?.method ?? 'GET'} ${u.slice(0, 140)}`);
  return realFetch(input as any, init as any);
}) as typeof fetch;

const waiters: Promise<unknown>[] = [];
const ctx = { waitUntil: (p: Promise<unknown>) => { waiters.push(p); } } as any;

const secret = env.WEBHOOK_SECRET;
const res = await worker.fetch(new Request('https://replay/telegram', {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
  body: JSON.stringify(update),
}), env, ctx);

console.log(`\n=== HTTP ${res.status} ${await res.text()} ===`);
// waitUntil 链是异步的: 轮询直到排空(上限 60s, 与线上 Worker wall-clock 同量级)
const t0 = Date.now();
while (Date.now() - t0 < 60_000) {
  const n = waiters.length;
  await Promise.allSettled(waiters.splice(0)).catch(() => {});
  if (n === 0 && outbound.length) break;
  await new Promise((r) => setTimeout(r, 200));
}

console.log(`\n--- 网络外呼 (${netLog.length}) ---`);
netLog.slice(0, 40).forEach((l) => console.log('  ' + l));
console.log(`\n--- KV 写入 (${KV.size}) ---`);
[...KV.keys()].slice(0, 25).forEach((k) => console.log('  ' + k));
console.log(`\n--- 出站 TG 消息 (${outbound.length}) ---`);
if (!outbound.length) {
  console.log('  ⚠️ 零出站 = 用户侧"发了没反应"。逐项排查:');
  console.log('     1) chatId 是否等于 env.CHAT_ID(白名单)? 当前 msg.chat.id =',
    (update as any).message?.chat?.id ?? (update as any).edited_message?.chat?.id ?? (update as any).channel_post?.chat?.id ?? '(非 message 形态)');
  console.log('     2) 更新形态是否被识别? 支持: message / edited_message / channel_post / callback_query');
  console.log('     3) 链接是否在 text/caption/text_link 实体里?');
  console.log('     4) RATE_LIMITER 是否超限(每分钟 20 次)?');
}
outbound.forEach((m, i) => {
  const kind = m.url.split('/').pop();
  console.log(`\n[${i}] ${kind}`);
  const text = String(m.body?.text ?? m.body?.caption ?? '').replace(/<[^>]+>/g, '');
  console.log(text.slice(0, 1200));
  if (m.body?.photo) console.log('   photo:', JSON.stringify(m.body.photo));
  if (m.body?.reply_markup) console.log('   keyboard:', JSON.stringify(m.body.reply_markup).slice(0, 300));
});

if (!live) console.log('\n(重放模式, 未真发 Telegram; 加 --live 且 .dev.vars 有 BOT_TOKEN/CHAT_ID 可直发)');
