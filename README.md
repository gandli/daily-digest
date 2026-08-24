# daily-digest

GitHub Trending → Telegram 每日中文摘要 bot。Cloudflare Workers 免费层单项目。

每天 08:30(北京时间)推送 top10 仓库(每仓一条:OG 卡图 + 星数/语言/中文描述/deepwiki·zread 链接/topics 标签),头条带 `#digest` 标签,末条带 Telegraph 存档链接;数据同步 commit 到本仓 [archive 分支](https://github.com/gandli/daily-digest/tree/archive)。

## 命令与消息

| 输入 | 行为 |
|---|---|
| `/trending` | 当日榜单(强制全管线,带 OG 图;cron 结果 KV 缓存供内部幂等) |
| `/archive` | 历史存档链接(GitHub archive 分支) |
| `/start` `/help` 其他无链接消息 | 使用提示 |
| 含 GitHub 仓库链接/`owner/repo` 的消息 | 单仓库查询:GitHub API + deepwiki/zread 中文描述 → OG 图卡片回复,并存档 |

## 描述获取链

deepwiki 概述(剥模板开场白) → zread wiki 中文 → 翻译回退链(Workers AI m2m100 → TranSmart → Google → MyMemory) → GitHub repo 描述(中文直用/英文翻译)。100% 中文守卫:非中文结果不渲染。

## 架构

- `src/sources/` 数据源注册表(数组即注册表;新增源=新文件+一行)
- `src/zread.ts` / `src/deepwiki.ts` RSC payload 概述提取
- `src/translate.ts` 四级翻译回退 + isChinese 守卫
- `src/render.ts` Telegram HTML / GitHub markdown / Telegraph nodes 三种渲染
- `src/archive.ts` GitHub Contents API 幂等存档(archive 分支) + Telegraph createPage
- `src/lookup.ts` 单仓库查询命令管线
- KV 缓存当日 cron 结果;webhook 验签 timingSafeEqual + chat 白名单

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
