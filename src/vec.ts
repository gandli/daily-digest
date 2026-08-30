import type { Env, SourceItem } from './types';

/**
 * Vectorize 语义检索(增强层): /search 主路径仍是子串 AND 匹配, 语义只在子串命中不足时补页。
 * 嵌入模型 @cf/baai/bge-m3(1024 维, 中英混合)与索引 daily-digest-search 维度一致——换模型必须重建索引。
 * 全部失败静默; VEC/AI 未绑定直接跳过, 行为与旧版一致。子请求预算: 每次调用 2 个(1 AI + 1 VEC)。
 */

const EMBED_MODEL = '@cf/baai/bge-m3';
// Vectorize id 上限 96 字节; 超长标题回落确定性哈希(32bit 碰撞概率在千级条目下可忽略)
const MAX_ID_BYTES = 90;

const hash36 = (s: string): string => {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return 'h' + h.toString(36);
};

const vecId = (name: string): string => {
  const lower = name.toLowerCase();
  return Buffer.byteLength(lower) <= MAX_ID_BYTES ? lower : hash36(lower);
};

type EmbedResult = { data?: number[][] };

/** indexArchivedItems 的镜像写: 条目(name+中文描述优先)嵌入后 upsert, id=name 小写幂等覆盖。 */
export async function vecUpsertItems(env: Env, items: SourceItem[]): Promise<void> {
  if (!env.VEC || !env.AI || !items.length) return;
  try {
    const texts = items.map((it) => `${it.title} ${it.descZh ?? it.desc ?? ''}`.slice(0, 2000));
    const r = (await env.AI.run(EMBED_MODEL, { text: texts })) as EmbedResult;
    const vectors = r?.data;
    if (!vectors?.length || vectors.length !== items.length) return;
    await env.VEC.upsert(
      items.map((it, i) => ({
        id: vecId(it.title),
        values: vectors[i],
        metadata: { src: 'arch', name: it.title, url: it.url ?? '' },
      })),
    );
  } catch (e) {
    console.error('vec upsert failed', String(e).slice(0, 80));
  }
}

// bge-m3 cosine 相关度阈值: 实测噪声区 0.28-0.46, 相关查询常 ≥0.55。低于阈值当无补充(防无关条目污染 /search 页)。
const MIN_SCORE = 0.55;

export type VecHit = { name: string; url: string; score: number };

/** 语义检索: query 嵌入后 topK 查询, 过滤低分噪声。失败/未绑定返回 [](调用方当作无补充)。 */
export async function vecSearch(env: Env, query: string, topK = 30): Promise<VecHit[]> {
  if (!env.VEC || !env.AI) return [];
  try {
    const r = (await env.AI.run(EMBED_MODEL, { text: [query] })) as EmbedResult;
    const vector = r?.data?.[0];
    if (!vector) return [];
    const res = await env.VEC.query(vector, { topK, returnMetadata: 'all' });
    return (res.matches ?? [])
      .filter((m): m is typeof m & { metadata: { name: string; url?: string } } => typeof m.metadata?.name === 'string' && m.score >= MIN_SCORE)
      .map((m) => ({ name: m.metadata.name, url: m.metadata.url ?? '', score: m.score }));
  } catch (e) {
    console.error('vec search failed', String(e).slice(0, 80));
    return [];
  }
}
