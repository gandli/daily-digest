import type { Env, SourceItem } from './types';

// 翻译回退链: Workers AI 批量 → MyMemory → 英文原文。任何失败不抛出。
export async function translateBatch(
  env: Env,
  items: SourceItem[],
  errors: string[] = [],
): Promise<SourceItem[]> {
  const descs = items.map((i) => i.desc).filter(Boolean);
  if (!descs.length) return items;

  let zh: string[] | null = null;
  try {
    zh = await viaWorkersAI(env, descs);
  } catch (e) {
    errors.push(`workersAI: ${String(e).slice(0, 120)}`);
    try {
      zh = await via9Router(env, descs);
    } catch (e1) {
      errors.push(`9router: ${String(e1).slice(0, 120)}`);
      try {
        zh = await viaMyMemory(descs);
      } catch (e2) {
        errors.push(`myMemory: ${String(e2).slice(0, 120)}`);
        zh = null;
      }
    }
  }
  if (!zh) return items; // 英文原文兜底

  // ponytail: 按 desc 数组对位回填; 存在空描述条目时会错位——v1 数据源保证 desc 非空
  return items.map((it, i) => ({ ...it, descZh: zh[i] || it.desc }));
}

// m2m100-1.2b: 专职翻译模型。llama 系列已于 2026-05 弃用。
// ponytail: 类型定义只接受单条 text, 官方 API 实际支持批量; 先逐条并行, 量小无压力
async function viaWorkersAI(env: Env, descs: string[]): Promise<string[]> {
  const results = await Promise.all(
    descs.map(async (d) => {
      const out = (await env.AI.run('@cf/meta/m2m100-1.2b', {
        text: d,
        source_lang: 'en',
        target_lang: 'zh',
      })) as { translated_text?: string };
      return out.translated_text ?? '';
    }),
  );
  if (results.filter(Boolean).length < Math.ceil(descs.length / 2)) throw new Error('AI translate incomplete');
  return results;
}

// 9Router 自建网关(OpenAI 兼容)。免费模型池, 从 CF 出口无封锁。
// ponytail: 单次调用批量翻10条; 网关响应尾部可能带 SSE 杂质, 用首尾大括号截取容错
async function via9Router(env: Env, descs: string[]): Promise<string[]> {
  const base = env.LLM_BASE_URL;
  if (!base) throw new Error('no LLM_BASE_URL');
  const prompt =
    '将以下每行英文翻译为简体中文, 只输出翻译结果, 保持相同的行数和编号格式:\n' +
    descs.map((d, i) => `${i + 1}. ${d}`).join('\n');
  const res = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(env.LLM_API_KEY ? { Authorization: `Bearer ${env.LLM_API_KEY}` } : {}),
    },
    body: JSON.stringify({
      model: env.LLM_MODEL || '1.freemodel',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 2000,
    }),
  });
  if (!res.ok) throw new Error(`llm ${res.status}`);
  const raw = await res.text();
  const s = raw.indexOf('{');
  const e = raw.lastIndexOf('}');
  if (s < 0 || e <= s) throw new Error('llm bad body');
  const j = JSON.parse(raw.slice(s, e + 1)) as { choices?: { message?: { content?: string } }[] };
  const text = j.choices?.[0]?.message?.content ?? '';
  const map = new Map<number, string>();
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*(\d+)[.、)]\s*(.+)$/);
    if (m) map.set(parseInt(m[1], 10) - 1, m[2].trim());
  }
  const result = descs.map((_, i) => map.get(i) ?? '');
  if (result.filter(Boolean).length < Math.ceil(descs.length / 2)) {
    throw new Error(`llm incomplete (${result.filter(Boolean).length}/${descs.length})`);
  }
  return result;
}

// 谷歌翻译免 key 端点(dict-chrome-ex)。非官方, 随时可能失效——失败即落下一层。
// ponytail: 逐条串行; 429/封禁时靠 MyMemory 兜底
async function viaGoogle(descs: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const d of descs) {
    const url =
      `https://clients5.google.com/translate_a/t?client=dict-chrome-ex&sl=en&tl=zh-CN&q=` +
      encodeURIComponent(d.slice(0, 400));
    const res = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)' } });
    if (!res.ok) throw new Error(`google ${res.status}`);
    const j = (await res.json()) as unknown;
    // 响应形态: ["译文"] 或 [["原文","译文",...]]
    if (Array.isArray(j) && j.length && Array.isArray(j[0])) out.push(String(j[0][1] ?? ''));
    else if (Array.isArray(j) && j.length) out.push(String(j[0]));
    else throw new Error('google bad shape');
  }
  return out;
}

// MyMemory 单条调用(批量=拼接会破坏对齐),匿名额度约5000字符/天,10条短句够用。
// ponytail: 逐条串行,10条×~300ms 可接受;需要提速改 Promise.all 分批。
async function viaMyMemory(descs: string[]): Promise<string[]> {
  const out: string[] = [];
  for (const d of descs) {
    const res = await fetch(
      `https://api.mymemory.translated.net/get?langpair=en|zh-CN&q=${encodeURIComponent(d.slice(0, 400))}`,
    );
    if (!res.ok) throw new Error(`mymemory ${res.status}`);
    const j = (await res.json()) as { responseData?: { translatedText?: string }; responseStatus?: number };
    const t = j.responseData?.translatedText;
    if (!t || /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(t)) throw new Error('mymemory quota');
    out.push(t);
  }
  return out;
}
