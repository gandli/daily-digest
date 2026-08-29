// 手册场景 runner: 每个场景 = 一串用户消息/按钮点击 → worker.fetch 真实处理 → 收集 bot 实际回复。
// 产出 scenarios.json(steps 带 buttons/photo/note/annotate) 供 render.mts 合成聊天截图、generate.mts 生成正文。
// 复用单测的 mock 手法(内存 KV + fetch 路由表), 但走真实 worker 入口 —— 场景即端到端。
import worker from '../../src/index';

export type Annotate = { target: 'input' | 'button' | 'bubble'; label: string };
export type Step = {
  actor: 'user' | 'bot';
  sys?: boolean; // 系统触发(cron 推送), 渲染为居中提示线而非气泡
  text?: string; // 消息文本(sendMessage.text / sendPhoto.caption)
  photo?: string; // sendPhoto 实体图 URL
  ogUrl?: string; // 链接预览 URL(无实体图时的卡片头图来源)
  buttons?: unknown; // inline_keyboard reply_markup(渲染层画按钮)
  note?: string; // 行为说明(原地编辑/正在输入等)
  edits?: number; // 原地编辑: 本步内容替换 steps[edits] 的显示(渲染层合并, 不新增气泡)
  annotate?: Annotate; // 显式标注(渲染层默认规则之外)
};
export type Scenario = { id: string; title: string; outline: string; steps: Step[] };

export const CHAT = 944783507;

// —— 环境搭建(与单测同款)。CHAT_ID 必须与 CHAT 一致, 否则命中白名单门(src/index.ts)静默不回;
//    WEBHOOK_SECRET 必须与 post() 的验签头一致, 否则 403。 ——
export function makeEnv() {
  const store = new Map<string, string>();
  return {
    CACHE: {
      list: async ({ prefix }: { prefix: string }) => ({
        keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })),
      }),
      get: async (k: string) => store.get(k) ?? null,
      put: async (k: string, v: string) => void store.set(k, v),
      delete: async (k: string) => void store.delete(k),
      get store() {
        return store;
      },
    },
    BOT_TOKEN: 'test-token',
    CHAT_ID: String(CHAT),
    WEBHOOK_SECRET: 'sec',
    GH_TOKEN: 'gh-token',
    OPENROUTER_API_KEY: 'sk-test',
    GH_ARCHIVE_REPO: 'gandli/daily-digest',
    AI: undefined,
  } as any;
}

// fetch 路由: match(url) 命中 → reply(值/函数/Response 原样)。用于给 worker 的外网请求供 canned 数据。
export type Route = { match: (url: string) => boolean; reply: unknown | ((url: string) => unknown) | Response };

const okJson = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } });

// 存档 stamp(毫秒级, 每次运行必变)归一化 → scenarios.json 与截图逐字节稳定, 免产物日常 churn
const normStamp = (s: string = '') => s.replace(/(\d{4}-\d{2}-\d{2})-\d{1,10}\.md/g, '$1-<stamp>.md');

// 收集 bot 的 Telegram API 调用 → 还原成聊天气泡; 其余外网请求按 fixtures 供数据。
export function makeCallLog(fixtures: Route[] = []) {
  const calls: { url: string; body: any }[] = [];
  return {
    calls,
    async fetch(input: RequestInfo | URL, init?: RequestInit) {
      const url = String(input);
      calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
      const hit = fixtures.find((f) => f.match(url));
      if (hit) {
        const r = typeof hit.reply === 'function' ? (hit.reply as (u: string) => unknown)(url) : hit.reply;
        return r instanceof Response ? r : okJson(r);
      }
      if (url.includes('api.telegram.org')) {
        if (url.includes('/sendMessage') || url.includes('/editMessageText') || url.includes('/sendPhoto')) {
          return okJson({ ok: true, result: { message_id: 100 + calls.length, chat: { id: CHAT } } });
        }
        return okJson({ ok: true, result: true });
      }
      return okJson({ ok: true, result: { message_id: 999 } });
    },
  };
}

// 把这一轮 worker 发出的 Telegram 调用还原成 bot 步骤; editMessageText 原地合并进最近一条带按钮的消息(翻页语义)
function harvest(fetcher: ReturnType<typeof makeCallLog>, steps: Step[]): void {
  let typing = false;
  const round: Step[] = [];
  for (const c of fetcher.calls) {
    if (c.body?.chat_id !== String(CHAT)) continue;
    if (c.url.includes('/sendChatAction')) {
      typing = true;
    } else if (c.url.includes('/editMessageText')) {
      // 克隆替换: 保留原步骤(第 1 页快照), 新步骤引用其下标 —— 渲染层原地替换, 保真每一轮
      for (let i = steps.length - 1; i >= 0; i--) {
        if (steps[i].actor === 'bot' && steps[i].buttons) {
          round.push({
            actor: 'bot',
            text: normStamp(c.body.text),
            buttons: c.body.reply_markup,
            note: '原地编辑(翻页)',
            edits: i,
          });
          break;
        }
      }
    } else if (c.url.includes('/sendMessage') || c.url.includes('/sendPhoto')) {
      round.push({
        actor: 'bot',
        text: normStamp(c.body.text ?? c.body.caption),
        photo: c.body.photo,
        ogUrl: c.body.link_preview_options?.url,
        buttons: c.body.reply_markup,
      });
    }
  }
  if (typing && round.length) {
    round[0].note = round[0].note ? `${round[0].note} · 先显示「正在输入…」` : '先显示「正在输入…」';
  }
  steps.push(...round);
  fetcher.calls.length = 0; // 只保留本轮新调用
}

export async function runScenario(
  env: any,
  fetcher: ReturnType<typeof makeCallLog>,
  id: string,
  title: string,
  outline: string,
  script: (post: (update: any, annotate?: Annotate) => Promise<void>) => Promise<void>,
): Promise<Scenario> {
  const steps: Step[] = [];
  const post = async (update: any, annotate?: Annotate) => {
    if (update.message?.text) steps.push({ actor: 'user', text: update.message.text, annotate });
    else if (update.callback_query?.data) steps.push({ actor: 'user', text: `[按钮] ${update.callback_query.data}`, note: '用户点按 inline 按钮', annotate });
    const waitUntil: Promise<unknown>[] = [];
    await worker.fetch(
      new Request('https://bot.example/telegram', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': String(env.WEBHOOK_SECRET) },
        body: JSON.stringify(update),
      }),
      env,
      { waitUntil: (p: Promise<unknown>) => waitUntil.push(p) } as any,
    );
    await Promise.all(waitUntil);
    harvest(fetcher, steps);
  };
  await script(post);
  return { id, title, outline, steps };
}

// 定时推送场景(cron): 无用户操作, 直接驱动 worker.scheduled, 以 sys 伪步开场
export async function runScheduled(
  env: any,
  fetcher: ReturnType<typeof makeCallLog>,
  id: string,
  title: string,
  outline: string,
): Promise<Scenario> {
  const steps: Step[] = [{ actor: 'user', sys: true, text: '⏰ 每天 08:30(北京时间)自动推送', note: '定时任务触发, 无需用户操作' }];
  const waitUntil: Promise<unknown>[] = [];
  await (worker as any).scheduled({ cron: '30 0 * * *' }, env, { waitUntil: (p: Promise<unknown>) => waitUntil.push(p) } as any);
  await Promise.all(waitUntil);
  harvest(fetcher, steps);
  return { id, title, outline, steps };
}
