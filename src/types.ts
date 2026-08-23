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
  LLM_BASE_URL?: string;
  LLM_API_KEY?: string;
  LLM_MODEL?: string;
}

export type SourceItem = {
  title: string; // owner/repo 或条目标题
  url: string;
  desc: string; // 原文描述(翻译前)
  descZh?: string; // 翻译后的中文描述
  lang?: string;
  stars?: number; // 总星数
  starsToday?: number; // 今日新增
};

export type Source = {
  name: string; // 存档目录名: trending
  tag: string; // 消息标签: #trending
  fetch: (env: Env) => Promise<SourceItem[]>;
};
