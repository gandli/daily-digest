<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="daily-digest — 每日 GitHub Trending 中文摘要 bot,左侧为抓取-描述-翻译-推送管线,右侧为一条 Telegram 消息卡示例">
</p>

<h1 align="center">daily-digest</h1>

<p align="center">
  <a href="README.md">简体中文</a> · <a href="README.en.md">English</a>
</p>

<p align="center">
  <a href="#-命令与消息"><img src="https://img.shields.io/badge/命令-5_个-2b5278" alt="命令数"></a>
  <a href="#-描述获取链"><img src="https://img.shields.io/badge/中文守卫-100%25-2b5278" alt="中文守卫"></a>
  <a href="https://github.com/gandli/daily-digest/actions/workflows/deploy.yml"><img src="https://github.com/gandli/daily-digest/actions/workflows/deploy.yml/badge.svg" alt="CI"></a>
</p>

GitHub Trending → **Telegram 每日中文摘要 bot**。Cloudflare Workers 免费层单项目。

每天 **08:30(北京时间)** 自动推送 top10 仓库——每仓一条消息:OG 卡图 + 星数/语言/**中文描述**/deepwiki·zread 链接/topics 标签;数据同步 commit 到本仓 [archive 分支](https://github.com/gandli/daily-digest/tree/archive)。

## 📱 命令与消息

| 输入 | 行为 |
|---|---|
| `/trending` | 当日榜单(强制全管线,带 OG 图;cron 结果 KV 缓存供内部幂等) |
| `/search <关键词>` | 搜索历史存档(KV 索引,repo 名或中文描述,结果含描述) |
| `/archive` | 历史存档链接(GitHub archive 分支) |
| `/start` `/help` 其他无链接消息 | 使用提示 |
| 含 GitHub 仓库链接 / `owner/repo` 的消息 | 单仓库查询:GitHub API + deepwiki/zread 中文描述 → OG 图卡片回复,并存档(同日去重) |
| 含 X/Twitter 帖子链接的消息 | FxEmbed API 取帖子 → 卡片回复 + **双存档**(archive 分支 + Telegraph 页),媒体直链可显示 |
| 含其他网页链接的消息 | 三级免费链转 markdown 存档,回复带 **OG 图 + 中文摘要 + 存档链接**;内容含 repo 链接时自动联动查询(≤3 个) |

## 🔗 描述获取链

```text
deepwiki 概述(剥模板开场白)
  → zread wiki 中文
    → 翻译回退链(Workers AI m2m100 → TranSmart → Google → MyMemory)
      → GitHub repo 描述(中文直用 / 英文翻译)
```

**100% 中文守卫**:非中文结果一律不渲染。

## 🏗️ 架构

- `src/sources/` 数据源注册表(数组即注册表;新增源=新文件+一行)
- `src/zread.ts` / `src/deepwiki.ts` RSC payload 概述提取
- `src/translate.ts` 四级翻译回退 + isChinese 守卫 + CF Summarization 摘要
- `src/render.ts` Telegram HTML / GitHub markdown / Telegraph nodes 三种渲染
- `src/archive.ts` GitHub Contents API 幂等存档(archive 分支) + Telegraph createPage + 分块 base64 编码
- `src/lookup.ts` 单仓库查询管线(URL 存档/OG 四级图链/repo 联动/去重)
- `src/urlmd.ts` 任意 URL→markdown 三级免费链(Markdown for Agents → AI.toMarkdown → Browser Rendering)
- `src/fxtweet.ts` X/Twitter 帖子存档(FxEmbed 公共 API)
- KV 缓存当日 cron 结果;webhook 验签 timingSafeEqual + chat 白名单;/search 用 KV 存档索引

详见 [`docs/GOAL.md`](docs/GOAL.md)(验收标准 A1–A14)。

## 💻 开发

```bash
npm install
npm run dev        # wrangler dev --test-scheduled
curl http://localhost:8787/__scheduled   # 手动触发 cron 管线
npx tsc --noEmit   # 类型检查
npm test           # vitest 82 用例
```

## 🔑 Secrets(wrangler secret put)

BOT_TOKEN · CHAT_ID · WEBHOOK_SECRET · GH_TOKEN · TELEGRAPH_TOKEN(可选)

## 🚀 部署

PR 合并 main → GitHub Actions 自动 `wrangler deploy`(需 repo secrets CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID)。

## 🗺️ v2 路线

网页收藏源、X 帖子源 —— 各写一个 fetch 函数接入 `src/sources/index.ts` 即可,管线零改动。

---

<p align="center">
  <sub>Cloudflare Workers 免费层 · 无 DB · KV only · 测试 95/95 · CI 自动部署</sub>
</p>
