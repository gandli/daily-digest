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
      zh = await viaMyMemory(descs);
    } catch (e2) {
      errors.push(`myMemory: ${String(e2).slice(0, 120)}`);
      zh = null;
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
