/// <reference types="@cloudflare/workers-types" />

// ponytail: 手写最小 Env,部署后跑 `wrangler types` 生成的替换本文件即可。
// binding 与 wrangler.jsonc 保持一致:AI / CACHE + secrets。
export interface Env {
  AI: Ai;
  CACHE: KVNamespace;
  BOT_TOKEN: string;
  CHAT_ID: string;
  WEBHOOK_SECRET: string;
  GH_TOKEN: string;
  TELEGRAPH_TOKEN?: string;
  GH_ARCHIVE_REPO?: string;
  CF_ACCOUNT_ID?: string; // Browser Rendering /markdown 兜底用(可选, 缺省跳过该级)
  CF_API_TOKEN?: string; // 同上, 需 Browser Rendering - Edit 权限
  OPENROUTER_API_KEY?: string; // OpenRouter 免费模型做 /product 深度中文摘要(可选, 缺省回退 CF bart)
  JINA_API_KEY?: string; // Jina Reader (r.jina.ai) URL→markdown(可选, 有则优先; 干净 markdown 去导航噪声)
  GENEDAI_API_KEY?: string; // md.genedai.me URL→markdown(可选; Jina 失败时的另一兜底)
}

export type SourceItem = {
  title: string; // owner/repo 或条目标题
  url: string;
  desc: string; // 原文描述(翻译前)
  descZh?: string; // 主描述: zread wiki 中文优先, 缺失时翻译兜底
  topics?: string[]; // GitHub repo topics(前4个做标签)
  quote?: string; // 深度摘要附带的原文核心句(zeli 引文风格)
  lang?: string;
  stars?: number; // 总星数
  starsToday?: number; // 今日新增
  author?: string; // HN 用户名(zeli 风格展示)
  createdAt?: string; // ISO 时间(zeli 风格: about X hours ago)
};

export type Source = {
  name: string; // 存档目录名: trending
  tag: string; // 消息标签: #trending
  fetch: (env: Env) => Promise<SourceItem[]>;
};
