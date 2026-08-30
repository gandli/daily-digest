# AGENTS.md — AI Deployment Instructions

> 本文件供 AI Agent（Cursor / Devin / GitHub Copilot / Hermes 等）读取。
> 人类读者请看 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) 与 [README.md](README.md)。
> 纯技术指令，无 UI 描述、无徽章、无废话。

## 项目概览

- 类型: Cloudflare Worker（TypeScript，`src/index.ts` 入口）
- 运行时: Workers runtime（`nodejs_compat`），cron 每日 08:30 (Asia/Shanghai)
- 依赖: KV（CACHE）· D1（DB）· Vectorize（VEC）· RateLimit（RATE_LIMITER）· Workers AI
- 脚本: `scripts/`（product-digest、manual、seed-search-index、import-library）
- 测试: Vitest（`npm test`）· 覆盖率 100% 语句（`npm run coverage`）
- 类型: `tsc --noEmit` 必须 0 错误（tsconfig 已开 noUnusedLocals/Parameters）

## AI 执行部署 — 标准流程

### 1. 本地开发（验证环境可用）

```bash
cp .dev.vars.example .dev.vars   # 填入 BOT_TOKEN / CHAT_ID / WEBHOOK_SECRET / GH_TOKEN 四个必选键
npm ci
npm test                          # 841 tests 全绿
npx tsc --noEmit                  # 0 错误
npx wrangler dev                  # 本地起 worker
```

### 2. Cloudflare 资源（首次部署必做）

`wrangler.jsonc` 中 KV/D1/Vectorize/RateLimit 的 ID 是作者私有，**必须替换为部署者账号的资源**：

```bash
npx wrangler kv namespace create CACHE
npx wrangler d1 create daily-digest-archive
npx wrangler vectorize create daily-digest-search --dimensions 384 --metric cosine
# ratelimits 无需 CLI 创建 —— 直接在 wrangler.jsonc 的 ratelimits 段配置（namespace_id 是自定整数标识）
```

将输出 ID 回填 `wrangler.jsonc` 对应 binding（CACHE / DB / VEC / RATE_LIMITER）。

### 3. Secrets（两层）

**Worker secrets**（`npx wrangler secret put <KEY>`，必选 4 + 可选 5）：

| Key | 必选 | 用途 |
|---|---|---|
| `BOT_TOKEN` | ✅ | Telegram bot token |
| `CHAT_ID` | ✅ | 允许的 chat ID |
| `WEBHOOK_SECRET` | ✅ | webhook 验签 |
| `GH_TOKEN` | ✅ | GitHub PAT（contents:write，写 archive 分支） |
| `TELEGRAPH_TOKEN` | 可选 | Telegraph 备份 |
| `OPENROUTER_API_KEY` | 可选 | /hn 深度摘要 |
| `JINA_API_KEY` | 可选 | URL→markdown |
| `GENEDAI_API_KEY` | 可选 | URL→markdown |
| `CF_ACCOUNT_ID` / `CF_API_TOKEN` | 可选 | Browser Rendering |

**GitHub Actions repo secrets**（repo Settings → Secrets and variables）：

| Secret | 必选 | 用途 |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | ✅ | wrangler deploy |
| `CLOUDFLARE_ACCOUNT_ID` | ✅ | CF 账号 ID |
| `GH_ARCHIVE_REPO` | 可选（variable） | 存档目标 `owner/repo`（缺省 gandli/daily-digest） |

> product-digest.yml / manual.yml 额外使用 `BOT_TOKEN`/`CHAT_ID`/`GH_TOKEN`/`OPENROUTER_API_KEY`/`TELEGRAPH_TOKEN`/`JINA_API_KEY`/`GENEDAI_API_KEY` 同名 repo secrets（与 worker secrets 分开配置）。

### 4. 部署

```bash
npx wrangler deploy                        # 本地直部署
# 或：PR 合并 main → GitHub Actions 自动部署 + 播种 search:index
```

### 5. 验证

```bash
# 健康检查 + 手动触发一次 digest 验证全链路
curl https://<worker>.workers.dev/
```

## 工程约束（AI 必读）

- **Git 工作流**: 所有代码更改必须 feature 分支 → PR → 审查 → squash merge。**禁止直推 main**。
- **测试**: 改代码必跑 `npm test` + `npx tsc --noEmit`，保持 841 tests 全绿、覆盖率不降。
- **Secrets**: `.dev.vars` 已 gitignore，永不提交；不得在代码/文档中硬编码真实值。
- **文档**: `docs/guide/` 与 CHANGELOG.md 为自动生成，勿手改。

## 相关文件索引

| 文件 | 用途 |
|---|---|
| `docs/DEPLOYMENT.md` | 人类可读的完整部署指南 |
| `.dev.vars.example` | 本地 env 模板（含全部键注释） |
| `wrangler.jsonc` | Worker 配置 + 资源绑定 |
| `src/types.ts` | Env 接口（secrets 键名权威定义） |
| `.github/workflows/` | CI（check+deploy）/ product-digest / manual / changelog |
