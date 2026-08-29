# daily-digest · AI Agent Goal Spec

本文件是 agent 可直接执行的验收契约。每条 AC 附验证方法；无法验证的表述不得出现在本文。
状态：v1.5 —— 反映 2026-08-29 已实现功能（新增 /product、存档批量化、卡片序号规则、X article 帖、用户手册自动化管线）。

## Objective

在 Cloudflare Workers 免费层部署名为 `daily-digest` 的 Telegram bot：
- 每日 08:30(Asia/Shanghai) 向白名单 chat 推送 github.com/trending(daily)top10（每仓一条，OG 图 + 中文描述）；
- 同一 Worker 提供命令与链接处理：`/trending`（当日榜单）、`/product`（今日 HN 酷产品）、`/search`（星标/书签/存档全索引搜索）、`/archive`（历史存档分页）、`/help`；
- 任意 GitHub repo / X 帖 / 网页 URL 链接 → 提取中文摘要并**三级存档**（Telegraph → 互联网档案馆 web.archive.org → GitHub md）；
- 每日及每次单仓查询自动存档至本仓 `archive` 分支（KV 缓冲 + Git Data API 批量合并为一个 commit）。

## Deliverables

1. repo `gandli/daily-digest`，main 分支含可 `wrangler deploy` 的 Worker 项目
2. `archive` 分支：`archive/<YYYY>/<YYYY-MM-DD>.md`（digest）；`archive/<YYYY>/<date>-<ms>.md`（X 帖/URL）
3. 已注册 bot 并完成 setWebhook（带 secret_token + `allowed_updates=["message","callback_query"]`）
4. CI：PR 上跑 `tsc --noEmit` + `npm test` + GitGuardian + dry-run；merge 到 main 自动 deploy + 播种 search:index

## Functional Requirements

**命令（webhook `POST /telegram`）**
- F1 `/trending`：读缓存 `digest:<date>` 秒回；无缓存才触发完整管线 `runDigest(env,true)`。当天 trending 固定，不重抓。
- F2 `/search <kw>`：读单键索引 `search:index`（内存过滤 → 命中列表），当页英文描述批量译中，分页 10 条 + inline keyboard 翻页/跳转。
- F3 `/archive [n]`：遍历 `archive:idx:*` 倒序，10 条/页；每条含三链（Telegraph/web.archive/GitHub md）。
- F4 `/help`／空：使用说明 + setMyCommands 幂等注册菜单。
- F5 链接处理：GitHub repo → `lookupRepo`（首次存档，当日已查 `seenToday` 命中回存档三链；单仓卡无 `N/M` 序号）；X 帖 → `archiveTweet`（FxEmbed + 摘要；article 长文直用内嵌标题/正文）；任意 URL → `archiveUrl`（markdown 三级链 + 摘要 + 存档）。
- F6 重发语义（URL）：`shouldReprocess` 三态 —— first(首处理)/retry(上次翻译/描述缺失,重跑)/done(跳过,回存档链接)。`markProcessed` 回填质量 + md stamp。
- F7 验签：`X-Telegram-Bot-Api-Secret-Token` timingSafeEqual，不符立即 403；验签后先 return 200，处理放 `ctx.waitUntil`；chat 白名单外不响应；callback_query（翻页）answerCallbackQuery 必须放 finally。
- F8 webhook `allowed_updates` 必须含 `callback_query`（否则翻页按钮被丢弃）。
- F9 `/product`：读 archive 分支 `product/<date>.json` 秒回产品卡；miss → `repository_dispatch(product-digest)` 触发 Actions 生成并回占位提示。
- F10 卡片序号：`N/M` 仅多条批量渲染（trending/product 推送、`fanoutRepoRefs` 多仓联动）；单条卡不带序号。

**管线**
- F11 sources 注册表：`src/sources/index.ts` 导出 `Source[]`，`SourceItem = { title, desc, url, lang?, extra? }`。
- F12 trending source：`fetchTrending` HTMLRewriter 解析 github.com/trending top10。
- F13 翻译/摘要：`translateBatch` 四级回退（Workers AI → MyMemory → TranSmart → 保留原文）；`summarizeZh` 用 CF `@cf/facebook/bart-large-cnn` 摘要 → m2m100 译中（长文/X 帖）。
- F14 渲染：每仓一条 sendPhoto（OG 图 + caption）；头部日期 + `#digest`；单条 ≤4096。
- F15 cron：`crons:["30 0 * * *"]`，scheduled 执行完整管线。
- F16 缓存：KV `digest:<date>` 存 `{chunks, repos}`（重放带 OG 图）；写失败不影响已发消息。
- F17 存档批量化：三个存档函数写 KV `pend:arc:*` 缓冲；`flushArchivedPending` 经 Git Data API 把缓冲合并为**一个 commit** 推 archive 分支（触发：每日 scheduled 末尾 + webhook 缓冲 ≥20；失败保留缓冲重试；KV 故障回落 Contents API 直推）；`archive:<YYYY>` 分级目录；OG 图入库 `og-images/`。GitHub md 链接最终一致。
- F18 Telegraph：digest 与 X 帖建页后写 `archive:tg:<date>`（digest，每日一条）与 `archive:tg:<stamp>`（X 帖，每帖唯一）；`/archive` 与存档卡优先展示 Telegraph。
- F19 web.archive：存档三链含 `web.archive.org/web/2/<source_url>`（有源 URL 时）。`archiveLinks` helper 统一 Triple 渲染。
- F20 搜索索引：`search:index` 单键压缩索引（seed 脚本从 library.jsonl 生成）；CI deploy 后播种。存档写入时 `indexArchivedItems` 增量维护 `archive:idx:<repo>`。
- F21 用户手册自动化：`scripts/manual/` 场景驱动真实 worker → 合成聊天标注截图 → AI 生成逐步说明（无 key 模板兜底）→ `manual.yml` 在 src/scripts 变更后重生成 `docs/guide/` 并自动提交。

## Acceptance Criteria（逐条可验证）

| ID | 断言 | 验证方法 |
|----|------|----------|
| A1 | `wrangler deploy --dry-run` 通过 | CI 绿 |
| A2 | 本地 `curl localhost:8787/__scheduled` 后测试 chat 收到含 `#digest` 的 10 条消息（每仓一条） | wrangler dev 实测 |
| A3 | digest 消息每条有 OG 图 + 中文描述 | 人工检查 |
| A4 | 无伪造 header 的 POST /telegram 返回 403 | curl -i |
| A5 | 白名单外 /trending 无回复 | 第二账号 |
| A6 | 白名单内发 `/trending` 秒回当日内容（缓存命中） | 二次触发无抓取日志 |
| A7 | `/search rust` 返回命中 + 分页，点下一页 editMessage 原地更新 | 真机 |
| A8 | `/archive` 分页 + 翻页按钮工作，条目含三链 | 真机 |
| A9 | 发 GitHub repo 链接首次存档（写 archive:idx + archive md），当日重发回存档三链卡 | 真机 + gh api |
| A10 | 发 X 帖 / 网页 URL → 摘要 + 存档三链；重发 done 回存档链接而非"无需重复" | 真机 |
| A11 | `wrangler tail` 有 callback_query 到达（翻页） | 点按钮后 tail |
| A12 | 连续 7 天 cron 每天恰推送，无漏发无重复 | observability + 聊天记录 |
| A13 | `npm test` 全绿（519+ tests）| CI |
| A14 | `npx vitest run --coverage` 整体语句 ≥90% 且分支 ≥80% | 本地 |
| A15 | 发 `/product` 命中产品卡；当日未生成回"生成中"占位且 Actions 被触发 | 真机 + gh api |
| A16 | 发 X 帖/网页链接后 archive 分支**不立即**新增 commit；flush（cron/≥20）后新增**一个** batch commit 且 pend 键清空 | gh api commits 对比 |
| A17 | 单仓查询卡无 `N/M` 序号；trending 推送各卡带 `i/N` | 真机截图 |

## Constraints

- C1 全免费层：Workers/KV/Workers AI/TranSmart/MyMemory 用量在免费额度内；代码禁止付费服务凭证。
- C2 secrets(BOT_TOKEN/CHAT_ID/GH_TOKEN/WEBHOOK_SECRET/TELEGRAPH_TOKEN 及可选 OPENROUTER_API_KEY/JINA_API_KEY/GENEDAI_API_KEY/CF_ACCOUNT_ID/CF_API_TOKEN)只经 `wrangler secret put`；不得出现在源码/配置/日志。
- C3 流程：所有变更走 feature 分支 PR，squash merge；禁止直推 main。
- C4 新增数据源只允许改 `src/sources/<new>.ts` + `src/sources/index.ts`(+1行)；触碰 translate/render/notify/archive 违反扩展性契约。
- C5 单请求子请求 ≤50（免费版）；search 必须用单键索引，禁止逐键 get。
- C6 前端交互：`answerCallbackQuery` 必须 finally（否则按钮转圈）。

## Out of Scope

多租户、数据库、付费 API、高频推送、语言/时间范围参数、🆕 diff 标记。X 书签源/网页收藏源 → v2 另立 goal。

## Milestones

- M1 骨架 + CI ✓
- M2 管线（trending → 翻译 → 渲染 → 存档）✓
- M3 上线 + 观察期 ✓
- M4 扩展：搜索索引 + X/URL 存档 + 三链 + 分页导航 ✓
- M5 扩展二：/product + 存档批量化 + 卡片序号规则 + X article 帖修复 + 用户手册自动化 ✓
- M6（计划）：描述缓存 refresh 调优、search 翻译结果缓存回索引、archive:idx 补 url 字段