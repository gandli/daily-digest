// 压缩搜索索引: 单 KV 键 search:index 存全部条目(压缩后 <25MB KV 值上限),
// /search 一次 get + 内存过滤——替代逐条 get 6076 次(打爆免费版单请求 50 子请求上限)。
// 格式: JSON 数组 [src, name, url, hay(小写预拼接搜索文本), desc(展示, 可选 前120)]。
//   star/bm: url = 原始链接; arch:   url = 存档日期(date), 由 /search 拼 github 链。
export type SearchEntry = [src: string, name: string, url: string, hay: string, desc?: string];

/** 从 library.jsonl 行对象转 SearchEntry */
export function libToEntry(e: {
  src: string; name: string; url: string; desc?: string; folder?: string; tags?: string[]; lang?: string;
}): SearchEntry {
  const tags = (e.tags ?? []).join(',');
  const hay = `${e.name} ${e.desc ?? ''} ${tags} ${e.folder ?? ''} ${e.lang ?? ''}`.toLowerCase();
  return [e.src, e.name, e.url, hay, e.desc?.slice(0, 120)];
}

/** 从 archive:idx 条目转 SearchEntry(存档/X帖)。url 槽存日期。 */
export function archToEntry(e: { repo: string; date: string; desc?: string; descZh?: string }): SearchEntry {
  const d = e.descZh ?? e.desc;
  const hay = `${e.repo} ${d ?? ''} ${e.date}`.toLowerCase();
  return ['arch', e.repo, e.date, hay, d?.slice(0, 120)];
}

export function matchEntries(entries: SearchEntry[], q: string): SearchEntry[] {
  const query = q.toLowerCase().trim();
  if (!query) return [];
  // 多词 AND: 每词都必须在 hay 里(substring 匹配——hay 已是词拼接, 词边界不额外处理)。
  // 排序: 名称含查询词越多越前(名称命中=更精确), 同分稳定。
  const words = query.split(/\s+/).filter(Boolean);
  const scored = entries
    .map((e) => {
      const hay = e[3];
      if (!words.every((w) => hay.includes(w))) return null;
      const name = e[1].toLowerCase();
      return { e, score: words.filter((w) => name.includes(w)).length };
    })
    .filter((x): x is { e: SearchEntry; score: number } => x !== null)
    .sort((a, b) => b.score - a.score);
  return scored.map((x) => x.e);
}