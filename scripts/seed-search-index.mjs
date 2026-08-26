// 从 data/library.jsonl 生成压缩搜索索引(单KV键 search:index)。纯 node ESM, 无依赖。
// 输出 JSON 数组 [src,name,url,hay,desc]; 写 data/lib-index.json。CI deploy 播种用。
import { readFileSync, writeFileSync } from 'node:fs';

const lines = readFileSync('data/library.jsonl', 'utf8').split('\n').filter(Boolean);
const arr = lines.map((l) => {
  const e = JSON.parse(l);
  const tags = (e.tags ?? []).join(',');
  const hay = `${e.name} ${e.desc ?? ''} ${tags} ${e.folder ?? ''} ${e.lang ?? ''}`.toLowerCase();
  return [e.src, e.name, e.url, hay, (e.desc ?? '').slice(0, 120)];
});
writeFileSync('data/lib-index.json', JSON.stringify(arr));
console.log(`entries: ${arr.length}, size: ${(Buffer.byteLength(JSON.stringify(arr)) / 1024 / 1024).toFixed(2)} MB`);