import type { Env, SourceItem } from './types';

// 翻译回退链: Workers AI 批量 → MyMemory → 英文原文。任何失败不抛出。
export async function translateBatch(env: Env, items: SourceItem[]): Promise<SourceItem[]> {
  const descs = items.map((i) => i.desc).filter(Boolean);
  if (!descs.length) return items;

  let zh: string[] | null = null;
  try {
    zh = await viaWorkersAI(env, descs);
  } catch {
    try {
      zh = await viaMyMemory(descs);
    } catch {
      zh = null;
    }
  }
  if (!zh) return items; // 英文原文兜底

  return items.map((it, i) => ({ ...it, descZh: zh[i] || it.desc }));
}

async function viaWorkersAI(env: Env, descs: string[]): Promise<string[]> {
  const prompt =
    `Translate each numbered English line to Simplified Chinese. ` +
    `Output ONLY the same number of lines, format "N. translation", no extra text.\n` +
    descs.map((d, i) => `${i + 1}. ${d}`).join('\n');
  const out = (await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
    messages: [{ role: 'user', content: prompt }],
    max_tokens: 2048,
  })) as { response?: string };
  const lines = (out.response ?? '').split('\n').filter(Boolean);
  const map = new Map<number, string>();
  for (const l of lines) {
    const m = l.match(/^(\d+)[.、]\s*(.+)$/);
    if (m) map.set(parseInt(m[1], 10) - 1, m[2].trim());
  }
  const result = descs.map((_, i) => map.get(i) ?? '');
  if (result.filter(Boolean).length < Math.ceil(descs.length / 2)) throw new Error('AI translate incomplete');
  return result;
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
