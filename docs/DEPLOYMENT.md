# daily-digest 部署指南

## 0. 前置

| 项 | 说明 |
|---|---|
| Node 22+ | 本地开发/脚本 |
| Cloudflare 账号 | 免费层：Workers · KV · D1 · Vectorize · AI |
| GitHub 账号 | 放仓库与 Actions secrets |
| Telegram Bot | @BotFather 创建，得 `BOT_TOKEN` |

---

## 1. 本地开发（OOTB）

```bash
cp .dev.vars.example .dev.vars   # 填入必选 4 键即可启动
npm ci
npx wrangler dev
```

`.dev.vars` 已被 gitignore，永不提交。

---

## 2. 创建 Cloudflare 资源

`wrangler.jsonc` 中 KV/D1/Vectorize/RateLimit 的 ID 是作者账号私有，**必须替换为自己账号的资源**：

```bash
# 在项目根目录执行（将输出 ID 填入 wrangler.jsonc 对应位置）
npx wrangler kv namespace create CACHE
npx wrangler d1 create daily-digest-archive
npx wrangler vectorize create daily-digest-search --dimensions 384 --metric cosine
# ratelimits 无需 CLI 创建 —— 直接在 wrangler.jsonc 的 ratelimits 段配置即可（namespace_id 是自定整数标识）
```

绑定映射（`wrangler.jsonc`）：

| binding | 类型 | 用途 |
|---|---|---|
| `CACHE` | KV | 索引缓存 / 去重 |
| `DB` | D1 | 归档查询 |
| `VEC` | Vectorize | 语义检索 |
| `RATE_LIMITER` | Rate Limit | 请求限流 |

---

## 3. 配置 Secrets

### 3a. Worker secrets（运行时）

首次部署后设置（或 `npx wrangler secret put <KEY>` 逐个）：

| Key | 必选 | 说明 |
|---|---|---|
| `BOT_TOKEN` | ✅ | Telegram bot token |
| `CHAT_ID` | ✅ | 允许使用 bot 的 chat ID（个人=user id；群=群 id 带 `-`） |
| `WEBHOOK_SECRET` | ✅ | webhook 验签 secret（与 setWebhook secret_token 一致） |
| `GH_TOKEN` | ✅ | GitHub PAT（`contents:write`，写 archive 分支） |
| `TELEGRAPH_TOKEN` | 可选 | Telegraph 匿名 token（digest 建页备份；缺省跳过 Telegraph 链） |
| `OPENROUTER_API_KEY` | 可选 | /hn 深度中文摘要（缺省回退 CF bart） |
| `JINA_API_KEY` | 可选 | URL→markdown 兜底链 |
| `GENEDAI_API_KEY` | 可选 | URL→markdown 兜底链 |
| `CF_ACCOUNT_ID` / `CF_API_TOKEN` | 可选 | Browser Rendering（URL→markdown 兜底） |

### 3b. GitHub Actions repo secrets（CI/CD）

在 repo Settings → Secrets and variables → Actions 添加：

| Secret | 必选 | 用途 |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | ✅ | `wrangler deploy`（需 Workers Scripts:Edit + KV/D1/Vectorize 写权限） |
| `CLOUDFLARE_ACCOUNT_ID` | ✅ | CF 账号 ID |
| `GH_ARCHIVE_REPO` | 可选（variable） | 存档目标仓库 `owner/repo`（缺省 `gandli/daily-digest`） |

> **注意**：`product-digest.yml` 额外用到 `BOT_TOKEN`/`CHAT_ID`/`GH_TOKEN`/`OPENROUTER_API_KEY`/`TELEGRAPH_TOKEN`/`JINA_API_KEY`/`GENEDAI_API_KEY` 等 repo secrets（与 worker secrets 同名，需在 Actions 侧重复配置）。其中 `GH_TOKEN` 在 Actions 中默认用内置 `GITHUB_TOKEN`，如需写外部仓库才单独设。

### 3c. 快速模板（复制即可）

```bash
# Worker secrets
npx wrangler secret put BOT_TOKEN
npx wrangler secret put CHAT_ID
npx wrangler secret put WEBHOOK_SECRET
npx wrangler secret put GH_TOKEN
# 可选
npx wrangler secret put TELEGRAPH_TOKEN
npx wrangler secret put OPENROUTER_API_KEY
npx wrangler secret put JINA_API_KEY
npx wrangler secret put GENEDAI_API_KEY

# GitHub Actions secrets（网页添加，见 3b 表）
```

---

## 4. 部署

```bash
# 本地直接部署
npx wrangler deploy

# 或推 main 触发 CI（自动部署 + 播种 search:index）
git push origin main
```

首次部署后自动播种 `search:index`（由 `data/library.jsonl` 生成）。

---

## 5. 验证

```bash
curl https://<your-worker>.workers.dev/health   # 或项目健康端点
# 手动跑一次 product digest 验证全链路
```
