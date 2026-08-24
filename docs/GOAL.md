# daily-digest · AI Agent Goal Spec

本文件是 agent 可直接执行的验收契约。每条 AC 附验证方法;无法验证的表述不得出现在本文。

## Objective

在 Cloudflare Workers 免费层部署名为 `daily-digest` 的 Telegram bot:
每个自然日 08:30(Asia/Shanghai)向白名单 chat 推送 github.com/trending(daily)top10 的中文摘要(每仓一条,OG 图+中文描述);
同一 Worker 暴露 `/trending` 命令返回当日内容、`/archive` 返回存档链接、任意含 GitHub 仓库链接的消息触发单仓库查询;
每日数据自动 commit 至本仓 `archive` 分支(`archive/<YYYY>/<YYYY-MM-DD>.md`)。

## Deliverables

1. repo `gandli/daily-digest`,main 分支含可 `wrangler deploy` 的 Worker 项目
2. 本仓 `archive` 分支,路径 `archive/<YYYY>/<YYYY-MM-DD>.md`(lookup 查询另存 `archive/<YYYY>/<date>-<ms>.md`)
3. 已注册 bot 并完成 setWebhook(带 secret_token)
4. CI:PR 上跑 `tsc --noEmit` + `wrangler deploy --dry-run`;merge 到 main 自动 deploy

## Functional Requirements

- F1 sources 注册表:`src/sources/index.ts` 导出 `Source[]`;每个 source 实现
  `{ name, tag, fetch(env) => Promise<SourceItem[]> }`,
  `SourceItem = { title, desc, url, lang?, extra? }`
- F2 trending source:`fetchTrending` 抓 `https://github.com/trending`(overall/daily),
  HTMLRewriter 解析,取前 10 条,字段含全名/stars/今日 stars/语言/描述
- F3 翻译:`translateBatch` 单次批量调用 Workers AI;失败降级 MyMemory;再失败保留英文原文;
  任一环节失败不抛出、不中断管线
- F4 渲染:HTML parse_mode;头部 `📊 Daily Digest · <日期>` + 标签 `#digest #d<YYYYMMDD>`;
  每条含序号/`owner/repo`/总星数/今日增量/语言标签(缺失则省略)/中文描述/
  `deepwiki.com/<owner>/<repo>` 链接;单条消息 ≤4096 字符,超限按源拆分多条
- F5 cron:`crons: ["30 0 * * *"]`,scheduled handler 执行完整管线并推送
- F6 webhook:`POST /telegram`;
  a) 校验 `X-Telegram-Bot-Api-Secret-Token`(timingSafeEqual),不符立即 403
  b) 验签后先 return 200,处理逻辑放 `ctx.waitUntil`
  c) chat id 不在白名单 → 不做任何响应动作
  d) `/trending` → KV 命中直接发缓存文本,miss 跑完整管线
  e) 未知输入 → 回复一句使用提示(仅白名单内)
- F7 缓存:KV key `digest:<source>:<YYYY-MM-DD>`,当日有效;写失败不影响已发送的消息
- F8 存档:cron 管线末尾以 Contents API PUT 提交当日 markdown;
  同日重复执行覆盖同一路径(幂等);GH_TOKEN 失败仅记日志,不影响推送
- F9 Telegraph 备份:cron 渲染后先调 `api.telegra.ph/createPage`
  (access_token 经一次性 createAccount 获得,存 secret TELEGRAPH_TOKEN),
  页面内容=全部条目(repo 名超链+中文描述);成功则消息尾部附
  `📁 <page_url>` 且写入当日 markdown;失败静默降级为无链接,不中断推送;
  同日重复执行创建新页可接受(page 幂等不要求)
  消息格式同步:头部不变,尾部追加 📁 链接行;`/trending` 命令同样返回带链接版本

## Acceptance Criteria(逐条可验证)

| ID | 断言 | 验证方法 |
|----|------|----------|
| A1 | `wrangler deploy --dry-run` 通过 | CI 绿 |
| A2 | 本地 `curl http://localhost:8787/__scheduled` 触发后,测试 chat 收到 1 条含 `#digest` 的消息 | wrangler dev --test-scheduled 实测 |
| A3 | 消息含 ≥8 个条目,每条有中文描述与 deepwiki 链接 | 人工/脚本检查消息文本 |
| A4 | 无伪造 header 的 POST /telegram 返回 403 | curl -i 实测 |
| A5 | 白名单外 chat 发 /trending,该 chat 收不到任何回复 | 第二个账号实测 |
| A6 | 白名单内发 /trending,≤15s 内收到与 cron 相同内容 | 秒表实测 |
| A7 | 当日第二次 /trending 不再触发外部抓取(KV 命中) | wrangler tail 无 trending fetch 日志 |
| A8 | archive repo 出现 `archive/trending/<今天>.md`,重复触发 cron 后 git 显示 0 新 commit | gh api 检查 |
| A9 | 断网 MyMemory + 停用 AI binding 的 dry-run 下,消息仍发出且描述为英文原文 | 本地 mock 实测 |
| A11 | cron 推送的消息尾部含 telegra.ph 链接,页面可打开且条目与消息一致 | 浏览器打开实测 |
| A12 | TELEGRAPH_TOKEN 无效时消息照常发出,仅无 📁 链接,tail 有降级日志 | 填错 token 实测 |
| A10 | 连续 7 天每天恰 1 条,无漏发无重复 | observability 面板 + 聊天记录 |
| A13 | 白名单发 X 帖子链接,收到作者/正文/互动数卡片,archive 分支出现 `archive/<YYYY>/<date>-<ms>.md` | 发 x.com/jack/status/20 实测 |
| A14 | 白名单发普通网页链接,收到 ✅ 存档确认;三级链全失败时收到 ❌ 提示 | 发 example.com 与无效 URL 各实测一次 |

## Constraints

- C1 全免费层:Workers/KV/Workers AI 用量在免费额度内;代码中禁止出现付费服务凭证
- C2 secrets(BOT_TOKEN/CHAT_ID/GH_TOKEN/WEBHOOK_SECRET/TELEGRAPH_TOKEN)只经 `wrangler secret put`;
  源码、配置、日志中不得出现其值(CI 加 secret 扫描 grep 检查)
- C3 工作流:所有变更走 feature 分支 PR,squash merge;禁止直推 main
- C4 新增数据源只允许改:`src/sources/<new>.ts`(新文件)+ `src/sources/index.ts`(+1 行);
  触碰 translate/render/notify/archive 即违反扩展性契约(v2 验收时强制检查 diff)

## Out of Scope

多租户、数据库、付费 API、高频推送、语言/时间范围参数、🆕 diff 标记、X 与网页收藏源(v2 另立 goal)。

## Milestones

- M1 骨架:repo + wrangler.jsonc + CI + secrets 就位,A1 绿
- M2 管线:F2→F4 打通,本地 A2/A3/A9 过
- M3 上线:setWebhook + deploy,A4–A8/A11/A12 全过,进入 A10 观察期
