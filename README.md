# daily-digest

GitHub Trending → Telegram 每日中文摘要 bot。Cloudflare Workers 免费层单项目。

每天 08:30(北京时间)推送一条:`#digest` 标签 + top10 仓库(星数/语言/中文描述/deepwiki 链接)+ Telegraph 存档链接;数据同步 commit 到 [daily-digest-archive](https://github.com/gandli/daily-digest-archive)。

## 命令

| 命令 | 行为 |
|---|---|
| `/trending` | 当日榜单(KV 缓存,当日只抓一次) |
| `/start` `/help` 其他 | 使用提示 |

## 架构

- `src/sources/` 数据源注册表(数组即注册表;新增源=新文件+一行)
- `src/translate.ts` Workers AI → MyMemory → 英文原文 三级回退
- `src/render.ts` Telegram HTML / GitHub markdown / Telegraph nodes 三种渲染
- `src/archive.ts` GitHub Contents API 幂等存档 + Telegraph createPage
- KV 缓存当日结果;webhook 验签 timingSafeEqual + chat 白名单

详见 `docs/GOAL.md`(验收标准 A1–A12)。

## 开发

```bash
npm install
npm run dev        # wrangler dev --test-scheduled
curl http://localhost:8787/__scheduled   # 手动触发 cron 管线
npx tsc --noEmit   # 类型检查
```

## Secrets(wrangler secret put)

BOT_TOKEN · CHAT_ID · WEBHOOK_SECRET · GH_TOKEN · TELEGRAPH_TOKEN(可选)

## 部署

PR 合并 main → GitHub Actions 自动 `wrangler deploy`(需 repo secrets CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID)。

## v2 路线

网页收藏源、X 帖子源 —— 各写一个 fetch 函数接入 `src/sources/index.ts` 即可,管线零改动。
