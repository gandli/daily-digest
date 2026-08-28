import type { Env, SourceItem } from './types';
import { fetchZreadBatch } from './zread';
import { fetchDeepwikiBatch } from './deepwiki';

/** 中文判定: CJK 字符 ≥5 且占比 >30% —— 100% 中文守卫的校验器 */
export function isChinese(s?: string | null): boolean {
  if (!s) return false;
  const cjk = (s.match(/[\u4e00-\u9fff]/g) ?? []).length;
  return cjk >= 5 && cjk > s.length * 0.3;
}

/** 中文主导判定(供"是否需要翻译"决策): 中文字符数 > 英文字母数 且 ≥20 个。
 *  与 isChinese 的区别: isChinese 是"输出必须是中文"的守卫(占比阈值, 含大量代码/URL 的中文正文会被稀释误判);
 *  isZhDominant 是"输入已是中文, 无需翻译"的判据(比字母数, 不受代码/URL 稀释)。 */
export function isZhDominant(s?: string | null): boolean {
  if (!s) return false;
  const zh = (s.match(/[\u4e00-\u9fff]/g) ?? []).length;
  const en = (s.match(/[a-zA-Z]/g) ?? []).length;
  return zh > en && zh >= 20;
}

// free 模型池: minimax-m3 与 dots 均已实测可用; ox-alpha 备用。失败逐模型回退。
const OPENROUTER_MODELS = ['minimax/minimax-m3:free', 'stealth/ox-alpha', 'dots-studio/dots-3-note-preview:free'];

/** OpenRouter 免费模型单次 chat(默认中文输出校验; requireZh=false 收任意输出, 供英文标签生成)。失败/无 key → null。 */
async function openrouterChat(env: Env, system: string, text: string, requireZh = true): Promise<string | null> {
  if (!env.OPENROUTER_API_KEY) return null;
  for (const model of OPENROUTER_MODELS) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://github.com/gandli/daily-digest',
          'X-Title': 'daily-digest',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: text.slice(0, 3000) },
          ],
          temperature: 0.2,
        }),
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) continue;
      const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const out = j.choices?.[0]?.message?.content?.trim() ?? '';
      if (out && out.length > 3 && (!requireZh || isChinese(out))) return out;
    } catch { /* 下一模型 */ }
  }
  return null;
}

/** 由正文生成中文标题(LLM)。失败/无 key → null。 */
export async function generateTitleZh(env: Env, text: string): Promise<string | null> {
  const out = await openrouterChat(
    env,
    '你是标题编辑。根据给定内容生成简短、点题的简体中文标题(≤20字), 直接输出标题, 不要引号, 不要 markdown, 不要解释。禁止输出"标题:"、"标题："等前缀。',
    text,
  );
  if (!out) return null;
  return out.replace(/^标题[:：]\s*/, '').replace(/^["'`“”]+|["'`“”]+$/g, '').slice(0, 20);
}

/** 由正文生成领域标签(LLM)。返回空格分隔的英文/数字标签(带#), ≤4个。失败/无 key → null。 */
export async function generateTagsZh(env: Env, text: string): Promise<string[] | null> {
  if (!env.OPENROUTER_API_KEY) return null;
  const out = await openrouterChat(
    env,
    '你是标签编辑。根据给定内容生成 2-4 个领域标签, 中文或英文小写均可, 反映主题。用空格分隔, 不带#。只输出标签词, 不要解释。',
    text,
    false, // 标签是英文 → 不能过中文守卫, 否则永远 null
  );
  if (!out) return null;
  // 标签允许中英混合(血糖/cgm/机器学习), 词界: 连续非空白非#串
  const tags = out.match(/[^\s#]+/g) ?? [];
  const cleaned = tags
    .map((t) => t.replace(/^#+|#+$/g, '').replace(/[.,;、。,;::""''()（）]/g, '').trim())
    .filter((t) => t.length >= 2 && t.length <= 20 && !/^\d+$/.test(t));
  // 去重 + 截 4
  return [...new Set(cleaned)].slice(0, 4);
}

// 描述解析链(按序兜底): zread wiki 中文 → deepwiki 英文 Overview → 翻译成中文 → 英文原文。
// 用户要求: 必须来自 zread 或 deepwiki。两者都未命中 → 该条不显示描述(诚实降级), 不硬凑 repo 一句话。
export async function resolveDescriptions(env: Env, items: SourceItem[]): Promise<void> {
  // 1. zread wiki 中文(主描述源)——非中文的命中视为无效, 落入下一级
  const wikis = await fetchZreadBatch(items.map((i) => i.title)).catch(() => new Map<string, string>());
  const missing = items.filter((it) => {
    const w = wikis.get(it.title);
    if (w && isChinese(w)) { it.descZh = w; return false; }
    return true;
  });
  console.log(`zread wiki: ${wikis.size}/${items.length}`);

  // 2. deepwiki 英文 Overview(只对 zread 缺失的条目; 翻译交给下面第3步)
  // ponytail: Worker 子请求上限50, 全链路已近顶——deepwiki 只补至多5条
  const dwHit = new Set<string>();
  if (missing.length) {
    const dws = await fetchDeepwikiBatch(missing.slice(0, 5).map((i) => i.title)).catch(() => new Map<string, string>());
    for (const it of missing) {
      const d = dws.get(it.title);
      if (d) { it.desc = d; dwHit.add(it.title); } // 用 Overview 替换: 标记为待翻译的 deepwiki 英文
    }
    console.log(`deepwiki overview: ${dwHit.size}/${missing.length}`);
  }

  // 3. 只翻译 deepwiki 英文条目(zread 与 deepwiki 都缺的 → descZh 留空, 不硬凑 repo 一句话)
  // 句式统一: deepwiki 是文档视角("This document introduces..."), 统一改写为 zread 风格"某某项目是一个/由…构建的…"句式
  const STYLE =
    '改写为项目介绍(仿百科条目, 2-3句, 信息量足): 第1句以"<项目名>是一个…"或"<项目名>是由<作者>构建的…"开头, 点明项目定位与用途; 后续句补充技术底座/关键特性/差异化亮点(从原文提取, 不编造)。删除: "This document/本文档/该文档"等文档视角措辞、URL/链接、(README.md:11-19)等文件行号引用、括号内来源标注。仍只输出中文译文, 不解释。';
  const toTranslate = items.filter((i) => !i.descZh && dwHit.has(i.title));
  for (const it of toTranslate) {
    it.descZh = (await translateTextZh(env, it.desc!, STYLE).catch(() => null)) ?? undefined;
  }
}

// 翻译回退链: Workers AI 批量 → TranSmart → Google → MyMemory → 英文原文。任何失败不抛出。
export async function translateBatch(
  env: Env,
  items: SourceItem[],
  errors: string[] = [],
): Promise<SourceItem[]> {
  // pos 映射: 记录非空 desc 在原数组的下标——翻译数组始终与 pos 对齐,
  // 空 desc 项(未来调用方可能出现)不会造成 filter(Boolean) 压缩错位
  const pos = items.map((it, i) => (it.desc ? i : -1)).filter((i) => i >= 0);
  const descs = pos.map((i) => items[i].desc!);
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

  // 100% 中文守卫: 非中文槽位逐条用 TranSmart 补翻(WorkersAI m2m100 偶发输出英文)。
  // ponytail: 补翻直接用 TranSmart 而非重试 WorkersAI——同一引擎对同句大概率再吐英文; 全批垃圾也补(1个子请求封顶)
  const bad = [...new Set(zh!.map((z, i) => (isChinese(z) ? -1 : i)).filter((i) => i >= 0))];
  if (bad.length) {
    try {
      const fix = await viaTranSmart(bad.map((i) => descs[i]));
      for (let k = 0; k < bad.length; k++) if (isChinese(fix[k])) zh![bad[k]] = fix[k];
    } catch {
      /* TranSmart 也挂则维持守卫拒绝 */
    }
  }

  // 最终守卫: 仍非中文的不回填(空 desc 项原样透传)
  return items.map((it, i) => {
    const j = pos.indexOf(i);
    return { ...it, descZh: j >= 0 && isChinese(zh![j]) ? zh![j] : it.descZh ?? undefined };
  });
}

/** 单条文本 → OpenRouter 免费模型中文翻译(短超时)。失败/无 key → null(调用方落四级链)。
 *  styleExtra: 追加句式要求(如 deepwiki 描述统一"某某项目是…"视角)。 */
async function translateZhOpenRouter(env: Env, text: string, styleExtra?: string): Promise<string | null> {
  if (!env.OPENROUTER_API_KEY) return null;
  for (const model of OPENROUTER_MODELS) {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
          'HTTP-Referer': 'https://github.com/gandli/daily-digest',
          'X-Title': 'daily-digest',
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: '你是专业翻译，面向软件/开发/科技文档的中文翻译。把给定文本翻译成自然流畅的简体中文，直接输出译文，不要解释，不要 markdown。注意：这是技术语境，术语要按软件开发含义理解——常见技术缩写保留英文(如 AI、API、LLM(大语言模型)、SDK、CLI、repo、GitHub、CPU、GPU)；企业/机构名不译。避免把专业缩写误译为人类学位的同形词(如 LLM=大语言模型，不是法学硕士)。' + (styleExtra ? `\n${styleExtra}` : '') },
            { role: 'user', content: text.slice(0, 3000) },
          ],
          temperature: 0.2,
        }),
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) continue;
      const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const out = j.choices?.[0]?.message?.content?.trim() ?? '';
      if (out && out.length > 3 && isChinese(out)) return out;
    } catch { /* 下一模型 */ }
  }
  return null;
}

/** 单段文本 → 中文(X 帖正文用; 复用四级链, 全挂返回 null)。styleExtra: 追加句式要求。 */
export async function translateTextZh(env: Env, text: string, styleExtra?: string): Promise<string | null> {
  if (!text.trim() || isChinese(text)) return text || null;
  // OpenRouter 免费模型中文翻译优先(有 key), 失败落四级链
  const or = await translateZhOpenRouter(env, text, styleExtra).catch(() => null);
  if (or) return or;
  const out = await translateBatch(env, [{ title: 'x', url: '', desc: text } as SourceItem]);
  return out[0]?.descZh ?? null;
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

/**
 * 长文(网页/X 帖)→ 中文摘要, 用于 /search 描述。
 * CF Summarization 模型(bart-ledger)出英文要点 → m2m100 译中。失败返回 null(调用方回退原文截断)。
 */
export async function summarizeZh(env: Env, text: string): Promise<string | null> {
  // OpenRouter 免费模型深度中文摘要优先(zeli 级, 有 key 时), 失败/无 key 回落 CF bart
  const deep = await summarizeZhDeep(env, text).catch(() => null);
  if (deep?.summaryZh) return deep.summaryZh;
  try {
    const sum = (await env.AI.run('@cf/facebook/bart-large-cnn', { input_text: text.slice(0, 2000), max_length: 120 })) as {
      summary?: string;
    };
    if (!sum.summary) return null;
    const zh = (await viaWorkersAI(env, [sum.summary]))[0];
    return isChinese(zh) ? zh : null;
  } catch {
    return null;
  }
}

// 单条长文 → OpenRouter 免费模型深度中文摘要(zeli 风格: 背景/功能/亮点/场景) + 一句原文引文。
// 中文稳定免费模型候选按序尝试(minimax-m3→ox-alpha→dots-3)。必须带 HTTP-Referer + X-Title 头(否则 402)。
// 输出约定: 第一段中文摘要, 末尾 QUOTE: 后跟一句原文英文核心句(zeli 引文风格)。
// 失败/无 key/额度满 → 返回 null(调用方回退 CF bart summarizeZh)。
// 模型候选(top OPENROUTER_MODELS 顶部定义): 中文稳定免费模型, 单点可能 429 限流 → 多模型兜底。
export type DeepSummary = { summaryZh: string; quote?: string };
export async function summarizeZhDeep(env: Env, article: string): Promise<DeepSummary | null> {
  if (!env.OPENROUTER_API_KEY) return null;
  for (const model of OPENROUTER_MODELS) {
    const out = await oneShot(env, model, article);
    if (out) return out;
  }
  return null;
}
async function oneShot(env: Env, model: string, article: string): Promise<DeepSummary | null> {
  try {
    const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Authorization: `Bearer ${env.OPENROUTER_API_KEY}`,
        'HTTP-Referer': 'https://github.com/gandli/daily-digest',
        'X-Title': 'daily-digest',
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: '你是科技产品分析员。用中文输出 4-6 句深度摘要：背景、核心功能、亮点(含具体性能数字)、适用场景。然后另起一行以"QUOTE: "开头给出原文中最有代表性的一句英文原句(不加引号)。不要开场白，不要 markdown。' },
          { role: 'user', content: `请用中文总结这篇产品文章：\n\n${article.slice(0, 6000)}` },
        ],
        temperature: 0.4,
      }),
    });
    if (!res.ok) return null;
    const j = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const out = j.choices?.[0]?.message?.content?.trim() ?? '';
    const qm = out.match(/QUOTE:\s*(.{10,160})/i);
    const summaryZh = qm ? out.slice(0, qm.index).trim() : out;
    if (!summaryZh || summaryZh.length < 10 || !isChinese(summaryZh)) return null;
    return { summaryZh, quote: qm?.[1]?.trim().slice(0, 160) };
  } catch {
    return null;
  }
}
