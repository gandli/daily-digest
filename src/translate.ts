import type { Env, SourceItem } from './types';
import { fetchZreadBatch } from './zread';
import { fetchDeepwikiBatch } from './deepwiki';

/** 中文判定: CJK 字符 ≥5 且占比 >30% —— 100% 中文守卫的校验器 */
export function isChinese(s?: string | null): boolean {
  if (!s) return false;
  const cjk = (s.match(/[\u4e00-\u9fff]/g) ?? []).length;
  return cjk >= 5 && cjk > s.length * 0.3;
}

// 描述解析链(按序兜底): zread wiki 中文 → deepwiki 英文 Overview → 翻译成中文 → repo desc 翻译成中文 → 英文原文
export async function resolveDescriptions(env: Env, items: SourceItem[]): Promise<void> {
  // 1. zread wiki 中文(主描述源)——非中文的命中视为无效, 落入下一级
  const wikis = await fetchZreadBatch(items.map((i) => i.title)).catch(() => new Map<string, string>());
  const missing = items.filter((it) => {
    const w = wikis.get(it.title);
    if (w && isChinese(w)) { it.descZh = w; return false; }
    return true;
  });
  console.log(`zread wiki: ${wikis.size}/${items.length}`);

  // 2. deepwiki 英文 Overview(只对 zread 缺失的条目; 翻译交给下面的翻译层)
  // ponytail: Worker 子请求上限50, 全链路(zread+deepwiki+OG图+发送+存档)已近顶——deepwiki 只补至多5条
  let dwHits = 0;
  if (missing.length) {
    const dws = await fetchDeepwikiBatch(missing.slice(0, 5).map((i) => i.title)).catch(() => new Map<string, string>());
    for (const it of missing) {
      const d = dws.get(it.title);
      if (d) { it.desc = d; dwHits++; } // 用 Overview 替换 repo 一句话描述, 再走翻译
    }
    console.log(`deepwiki overview: ${dwHits}/${missing.length}`);
  }

  // 3. 翻译: 没拿到 zread 中文的条目, 全部走翻译链(deepwiki 英文 或 repo 原 desc)
  // translateBatch 返回新数组(不可变回填), 必须写回原 items
  const toTranslate = items.filter((i) => !i.descZh);
  if (toTranslate.length) {
    const done = await translateBatch(env, toTranslate as SourceItem[]);
    for (let i = 0; i < toTranslate.length; i++) {
      toTranslate[i].descZh = done[i].descZh;
    }
  }
}

// 翻译回退链: Workers AI 批量 → TranSmart → Google → MyMemory → 英文原文。任何失败不抛出。
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
      zh = await viaTranSmart(descs);
    } catch (e1) {
      errors.push(`tranSmart: ${String(e1).slice(0, 120)}`);
      try {
        zh = await viaGoogle(descs);
      } catch (e2) {
        errors.push(`google: ${String(e2).slice(0, 120)}`);
        try {
          zh = await viaMyMemory(descs);
        } catch (e3) {
          errors.push(`myMemory: ${String(e3).slice(0, 120)}`);
          zh = null;
        }
      }
    }
  }
  if (!zh) return items; // 英文原文兜底

  // 100% 中文守卫: 非中文槽位逐条用 TranSmart 补翻(WorkersAI m2m100 偶发输出英文)
  const bad = [...new Set(zh!.map((z, i) => (isChinese(z) ? -1 : i)).filter((i) => i >= 0))];
  if (bad.length && bad.length < items.length) {
    try {
      const fix = await viaTranSmart(bad.map((i) => items[i].desc));
      for (let k = 0; k < bad.length; k++) if (isChinese(fix[k])) zh![bad[k]] = fix[k];
    } catch {
      /* TranSmart 也挂则维持守卫拒绝 */
    }
  }

  // 最终守卫: 仍非中文的不回填
  return items.map((it, i) => ({ ...it, descZh: isChinese(zh![i]) ? zh![i] : it.descZh ?? undefined }));
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

// 腾讯交互翻译 TranSmart: 免 key 免注册, 支持批量 text_list。本机+CF出口均实测可用。
// ponytail: 非官方接口, 可能加鉴权——失败即落下一层
async function viaTranSmart(descs: string[]): Promise<string[]> {
  const res = await fetch('https://transmart.qq.com/api/imt', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Referer: 'https://transmart.qq.com/',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126',
    },
    body: JSON.stringify({
      header: { fn: 'auto_translation', session: '', client_key: 'browser-macOS-1724417653-chrome' },
      model: 'api',
      source: { text_list: descs.map((d) => d.slice(0, 500)) },
      source_lang: 'en',
      target_lang: 'zh',
    }),
  });
  if (!res.ok) throw new Error(`transmart ${res.status}`);
  const j = (await res.json()) as {
    auto_translation?: string[];
    header?: { ret_code?: string };
  };
  if (j.header?.ret_code !== 'succ' || !j.auto_translation?.length) {
    throw new Error(`transmart ret=${j.header?.ret_code}`);
  }
  return j.auto_translation;
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
      `https://api.mymemory.translated.net/get?langpair=en|zh-CN&q=${encodeURIComponent(d.slice(0, 400))}&de=daily.digest.bot%40gmail.com`,
    );
    if (!res.ok) throw new Error(`mymemory ${res.status}`);
    const j = (await res.json()) as { responseData?: { translatedText?: string }; responseStatus?: number };
    const t = j.responseData?.translatedText;
    if (!t || /MYMEMORY WARNING|QUERY LENGTH LIMIT/i.test(t)) throw new Error('mymemory quota');
    out.push(t);
  }
  return out;
}
