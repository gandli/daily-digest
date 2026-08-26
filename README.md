<h1 align="center">daily-digest</h1>

<p align="center">
  <a href="README.en.md">English</a> · <a href="README.md">简体中文</a>
</p>

<p align="center">
  <a href="#-命令与消息"><img src="https://img.shields.io/badge/命令-5_个-2b5278" alt="命令数"></a>
  <a href="#-描述获取链"><img src="https://img.shields.io/badge/中文守卫-100%25-2b5278" alt="中文守卫"></a>
  <a href="https://github.com/gandli/daily-digest/actions/workflows/deploy.yml"><img src="https://github.com/gandli/daily-digest/actions/workflows/deploy.yml/badge.svg" alt="CI"></a>
</p>

<p align="center">
  <img src="./assets/readme/hero.svg" width="100%" alt="daily-digest — 每日 GitHub Trending 中文摘要 bot,左侧为抓取-描述-翻译-推送管线,右侧为一条 Telegram 消息卡示例">
</p>

GitHub Trending → **Telegram 每日中文摘要 bot**。Cloudflare Workers 免费层单项目。

每天 **08:30(北京时间)** 自动推送 top10 仓库——每仓一条消息:OG 卡图 + 星数/语言/**中文描述**/deepwiki·zread 链接/topics 标签;数据同步 commit 到本仓 [archive 分支](https://github.com/gandli/daily-digest/tree/archive)。

## 📱 命令与消息

| 输入 | 行为 |
|---|---|
| `/trending` | 当日榜单(cron 已抓取,读 `digest:<date>` 缓存秒回;当天 trending 固定不重抓) |
| `/search <关键词>` | 全索引搜索(星标/书签/存档 6000+ 条),结果当页英文描述批量译中,分页 + inline keyboard 翻页/跳转 |
| `/archive [页码]` | 历史存档分页列表,每条约**存档三链**(Telegraph → 互联网档案馆 web.archive.org → GitHub md) |
| `/start` `/help` 其他 | 使用提示 + 命令菜单注册 |
| 含 GitHub 仓库链接 | 单仓库查询 + 中文描述 → OG 卡;当日已查回存档三链卡;存档 archive 分支 |
| 含 X/Twitter 链接 | FxEmbed 取帖 → **中文摘要 + 三级存档**(Telegraph/互联网档案馆/GitHub md) |
| 含其他网页链接 | markdown 三级链 → **中文摘要(summarizeZh)** → 三级存档;重发 done 回存档链接而非"已处理过" |

## 🔗 描述获取链

```text
deepwiki 概述(剥模板开场白)
  → zread wiki 中文
    → 翻译回退链(Workers AI m2m100 → TranSmart → Google → MyMemory)
      → GitHub repo 描述(中文直用 / 英文翻译)
```

**100% 中文守卫**:非中文结果一律不渲染。

## 📦 存档三链

所有链接(网页 / X 帖 / repo)归档后回**三级存档链接**,按优先级展示:
1. **Telegraph** — 长文备份页(每日 digest 与 X 帖各自建页)
2. **互联网档案馆** `web.archive.org` — 兜底快照(`web/2/<url>` 自动定位最近版本)
3. **GitHub md** — archive 分支 markdown 原文

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

详见 [`docs/GOAL.md`](docs/GOAL.md)(验收标准 A1–A14)。接口/命令/KV 键详表见 [`docs/INTERFACES.md`](docs/INTERFACES.md)， 开发进度见 [`docs/ROADMAP.md`](docs/ROADMAP.md)， 架构/数据流/时序图见 [`docs/diagrams/*.mmd`](docs/diagrams/)。

## 💻 开发

```bash
npm install
npm run dev        # wrangler dev --test-scheduled
curl http://localhost:8787/__scheduled   # 手动触发 cron 管线
npx tsc --noEmit   # 类型检查
npm test           # vitest 139 用例(coverage ≥45%)
npm test -- --coverage  # 覆盖率报告
```

## 🔑 Secrets(wrangler secret put)

BOT_TOKEN · CHAT_ID · WEBHOOK_SECRET · GH_TOKEN · TELEGRAPH_TOKEN(可选)

## 🚀 部署

PR 合并 main → GitHub Actions 自动 `wrangler deploy`(需 repo secrets CLOUDFLARE_API_TOKEN / CLOUDFLARE_ACCOUNT_ID)。部署后自动播种 search:index(脚本从 library.jsonl 生成)。

main push 另触发 changelog workflow 自动更新 [CHANGELOG.md](CHANGELOG.md)(conventional-changelog 按 squash PR title 分组)。

## 📚 文档

- [`docs/GOAL.md`](docs/GOAL.md) — 验收契约(A1–A14,FR/AC/Milestones)
- [`docs/INTERFACES.md`](docs/INTERFACES.md) — 命令 / HTTP 端点 / KV 键全表
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — 开发计划与进度
- [`docs/diagrams/`](docs/diagrams/) — 架构 / 时序 / 数据流图(mmd+png+svg)

## 🗺️ 路线

- 短期:描述缓存 refresh 调优、search 翻译结果缓存回索引、archive:idx 补 url 字段(repo 重发三链更精确)
- 长线:网页收藏源 / X 帖子源 —— 各一个 fetch 函数接入 `src/sources/index.ts` 即可,管线零改动

---

<p align="center">
  <sub>Cloudflare Workers 免费层 · 无 DB · KV only · 139 tests · CI 自动部署 · changelog 自动生成</sub>
</p>
