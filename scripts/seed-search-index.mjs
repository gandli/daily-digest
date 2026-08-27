// 从 data/library.jsonl 生成压缩搜索索引(单KV键 search:index)。纯 node ESM, 无依赖。
// 输出 JSON 数组 [src,name,url,hay,desc]; 写 data/lib-index.json。CI deploy 播种用。
import { readFileSync, writeFileSync } from 'node:fs';

// 英文技术词 → 中文查询词 同义词映射。hay 含英文词时追加中文等价词,
// 让中文搜 "越狱/安全/渗透" 命中英文 desc 条目(免费向量替代, seed 时一次完成, 零运行时成本)。
const SYNONYMS = {
  jailbreak: '越狱',
  security: '安全',
  cybersecurity: '网络安全',
  pentest: '渗透',
  penetration: '渗透',
  hacking: '黑客',
  hack: '黑客',
  vulnerability: '漏洞',
  reverse: '逆向',
  malware: '恶意软件',
  ctf: '夺旗',
  forensic: '取证',
  obfuscation: '混淆',
  cryptography: '密码学',
  exploit: '漏洞利用',
  ransomware: '勒索软件',
  fuzzing: '模糊测试',
  recon: '侦察',
  botnet: '僵尸网络',
  dos: '拒绝服务',
  sql: '数据库',
  machine: '机器学习',
  ai: '人工智能',
  llm: '大模型',
  neural: '神经网络',
  cli: '命令行',
  gui: '图形界面',
  api: '接口',
  database: '数据库',
  deploy: '部署',
  cloud: '云',
  container: '容器',
  docker: '容器',
  kubernetes: '容器编排',
  rust: '编程语言',
  golang: '编程语言',
  python: '编程语言',
  typescript: '编程语言',
  javascript: '编程语言',
  browser: '浏览器',
  extension: '扩展',
  android: '安卓',
  ios: '苹果',
  linux: '操作系统',
  windows: '操作系统',
  macos: '苹果系统',
};

function addSyn(hay) {
  let out = hay;
  for (const [en, zh] of Object.entries(SYNONYMS)) {
    if (hay.includes(en)) out += ` ${zh}`;
  }
  return out;
}

const lines = readFileSync('data/library.jsonl', 'utf8').split('\n').filter(Boolean);
const arr = lines.map((l) => {
  const e = JSON.parse(l);
  const tags = (e.tags ?? []).join(',');
  const hay = addSyn(`${e.name} ${e.desc ?? ''} ${tags} ${e.folder ?? ''} ${e.lang ?? ''}`.toLowerCase());
  return [e.src, e.name, e.url, hay, (e.desc ?? '').slice(0, 120)];
});
writeFileSync('data/lib-index.json', JSON.stringify(arr));
console.log(`entries: ${arr.length}, size: ${(Buffer.byteLength(JSON.stringify(arr)) / 1024 / 1024).toFixed(2)} MB`);