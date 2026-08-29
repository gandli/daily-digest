# daily-digest · 接口契约 (INTERFACES.md)

基于 src/ 现行代码事实， 非目标态。文件: `src/index.ts` (webhook 入口), `src/notify.ts`, `src/lookup.ts`, `src/archive.ts`。

---

## 1. Telegram 命令 (webhook POST /telegram)

白名单 `CHAT_ID` 内才响应； 验签失败 `403`。

| 命令 | 行为 | 备注 |
|------|------|------|
| `/gt` | 用缓存 `digest:<date>` 秒回； 无缓存触发完整管线 `runDigest(env, true)` | 当天 trending 固定， 不重抓 |
| `/hn` | 读 archive 分支 `product/<date>.json` 秒回产品卡； miss → `repository_dispatch` 触发 Actions 生成并回占位提示 | Actions 完成后直发 TG， 不经 Worker 重管线 |
| `/ph` | Product Hunt 每日热门: 官方 Atom feed 免 key 直拉 top10 → 译中 → 产品卡 (ogUrl 预览); 当日缓存 `ph:<date>` 秒回; 榜单存档 `ph-<date>.md` | 无 Actions, Worker 内完成; 拉取失败 ⚠️ 提示 |
| `/search <关键词>` | 单键索引 `search:index` 内存过滤 → 分页 10 条 + inline keyboard 翻页/跳转 | 描述批量译中 (TranSmart/m2m100) |
| `/archive [页码]` | `archive:idx:*` 遍历倒序 → 10 条/页 + 三链 (Telegraph/web.archive/GitHub md) | 分页 inline keyboard |
| `/help` / 空 | 使用说明 + 注册命令菜单 | 幂等 setMyCommands |
| 任意 GitHub repo 链接 | 首次 → `lookupRepo` 单查+存档； 当日已查 → `replyArchived` 回存档三链 | `seenToday` 去重 (TTL 48h)； 单仓卡无 `N/M` 序号 |
| ≥2 个 GitHub repo 链接(一条消息) | `fanoutRepoRefs` 逐仓发卡(多仓带 `N/M`)； 全部当日已存档 → 回一句话防静默 | 复用 X 帖联动管线(去重/分批防 50 子请求) |
| X 帖链接 (`x.com/<h>/status/<id>`) | `archiveTweet`: FxEmbed 拉元数据 → 摘要 → 存档 | article 长文帖直用内嵌标题； **article 引用帖(text 为 `x.com/i/article` 裸链) → 转 fixupx 公开页提取正文(失败落 fxtwitter.com 同源兜底)并改用 fixupx 展示链接**； 多图 mosaic； 帖内多 repo → `fanoutRepoRefs` 逐仓发卡 (多仓带 `N/M`) |
| 任意网页 URL | `archiveUrl`: markdown 三级链 → 中文摘要 → 存档 | 重发语义: first/retry/done |
| 其余输入 | 帮助提示 | |

**卡片序号**: `N/M` 仅多条批量 (trending/product 推送、多 repo fanout) 显示， 单条卡不带。

**inline keyboard callback_data**:
- 翻页: `arch:pg:<n>` (archive), `sch:<page>:<token>` (search, token→KV 读回 query)
- 导航行: `[⬅ 上一页] [📄 当前/总页] [下一页 ➡]` + 跳转行 `⏮ 1 / ⏭ 中 / ⏭ 末` (>4 页)
- 处理后必 `answerCallbackQuery` (finally 中)， 否则按钮转圈

## 2. HTTP 端点

基址 `https://daily-digest.gandli-digest.workers.dev`

| 端点 | 方法 | 鉴权 | 行为 |
|------|------|------|------|
| `/telegram` | POST | `X-Telegram-Bot-Api-Secret-Token` = `WEBHOOK_SECRET` | TG webhook 入口， 全部命令分派 |
| `/run` | POST | `X-Runner-Token` header = `WEBHOOK_SECRET` | 手动触发完整 digest 管线， 返 `{ok, chunks}`； 错误 token 403； GET 405 |
| `/preview` | GET | 无 (仅 `BOT_TOKEN` 未配置时开放) | 管线自检： 抓取→描述→渲染， 不发消息， 返 JSON |
| `/` | GET | - | 存活探针 (纯文本) |

## 3. KV namespace (`51e73f8381d34b9c95eaebdf4f7d8101`)

Binding `CACHE`。

| 键 | 用途 | 说明 |
|----|------|------|
| `search:index` | 搜索单键压缩索引 | JSON 数组 `[src, name, url, hay, desc]`， seed 脚本生成 |
| `search:q:<token>` | 翻页 query 暂存 | TTL 1h， token=query 确定性哈希 |
| `digest:<date>` | 当日 digest 缓存 | `{chunks, repos}` (重放带 OG 图)， TTL 1d |
| `archive:idx:<repo>` | 存档索引 | `{repo, date, desc, descZh?}`， /search /archive 用 |
| `archive:tg:<date>` | Telegraph 页链接 (日期键) | 每日 digest 建页后写 |
| `archive:tg:<stamp>` | Telegraph 页链接 (X帖时间戳键) | 每帖唯一， 防同日覆盖 |
| `lookup:<date>:<repo>` | 当日已查去重标记 | TTL 48h |
| `lookup:desc:<repo>` | repo 描述缓存 | 7 天内复用， 省翻译/描述子请求 |
| `reproc:<url>` | URL 重发质量记录 | `{ts, translated, descOk, md?}` TTL 7d |
| `pend:arc:<uniq>` | 待写存档缓冲 | `{path, content(base64), encoding, message}`； flush 成功后删除， 失败保留重试 |

## 4. 存档三链 (archiveLinks) 与批量化

回复存档链接按优先级：
1. **Telegraph** (archive:tg 命中， 即时生效)
2. **互联网档案馆** `web.archive.org/web/2/<url>` (源 URL 可归档时， 即时生效)
3. **GitHub md** `https://github.com/gandli/daily-digest/blob/archive/archive/<YYYY>/<date>.md` (**最终一致**: 见下)

**存档批量化**: 三个存档函数 (`archiveToGitHub` / `archiveDatedToGitHub` / `archiveOgImage`) 不再逐文件 PUT， 而是写 KV `pend:arc:*` 缓冲； `flushArchivedPending()` 经 **Git Data API** (ref→blobs→tree→commit→ref) 把缓冲合并为**一个 commit** 推 archive 分支 (单批 ≤40 文件)。触发: 每日 `scheduled()` 末尾 + webhook 侧缓冲 ≥20 条机会性触发。成功才删键， 失败保留重试； ref 409 重取 base 重建； KV 故障回落 Contents API 直推。**因此 GitHub md 链接最长延迟到下次 flush 才生效**。

**文件名**: digest `archive/<YYYY>/<date>.md` (同日覆盖)； X 帖/URL `archive/<YYYY>/<date>-<ms>.md`； **repo 查询 `archive/<YYYY>/<repo 以 __ 替换 / >-<date>-<ms>.md`**(内容头同含 repo 名, 分支上可直接辨识)。年份目录一律取北京日期年(旧纯日期与新前缀名兼容, `yearOf()` 统一推导)。

### 响应内容契约 (卡型 × 字段矩阵)

统一三段式: 标题直链(中文优先) / 中文正文(📝 摘要) / 标签行 / 存档链。语义定案:
- **中文**: 翻译失败保留原文， 不机翻凑数 (isChinese 守卫 + 四级回退)
- **OG 图**: 尽力附图 (OG→s2 四级链)， sendPhoto 失败降纯文字， 不为图牺牲卡片
- **Telegraph**: 低频单发建页 (单仓查询/网页/X 帖/digest)； 多仓 fanout **不建** (批量子请求预算， 两链)
- **Wayback**: 发卡时 fire-and-forget 请求 `web.archive.org/save/<url>` 主动触发快照 (`saveToWayback`)； digest 批量时段不触发 (子请求预算)
- **标题来源链** (网页): og:title → md 首个 heading → md 首行非结构文本 → host； 命中垃圾标题(URL/域名/导航样板/纯日期)或非中文且有 OPENROUTER_API_KEY → LLM 生成 (喂正文前 600 字)。X 帖: article.title → fixupx 页首标题 → generateTitleZh(正文)

| 卡型 | 标题直链 | 中文正文 | 标签 | OG 图 | Telegraph | Wayback | GitHub md | 子请求预算 |
|------|---------|---------|------|------|-----------|---------|-----------|-----------|
| digest 推送 (/gt·cron) | ✓ | ✓ | ✓ | ✓ sendPhoto | ✓ 建页 | ✓ 链接 | ✓ 批量 | ~40/日管线 |
| /gt 当日重放 | ✓ | ✓ | ✓ | ✗ 纯文本 | ✗ | ✗ | ✓ | 1 |
| 单仓查询 | ✓ | ✓ | ✓ | ✓ | ✓ 建页 | ✓ save | ✓ 缓冲 | ~9 |
| 多仓联动 fanout | ✓ | ✓ | ✓ | ✓ | ✗ 两链 | ✓ save | ✓ 缓冲 | 3×N (≤40) |
| 网页存档 | ✓ | ✓ | ✓ | ✓ | ✓ 建页 | ✓ save | ✓ 缓冲 | ~10 |
| X 帖 | ✓ | ✓ | ✓ | ✓ mosaic/原图/预览 | ✓ 建页 | ✓ save | ✓ 缓冲 | ~12 |
| 重发回执 | ✓ | ✓ 摘要 | ✗ | ✗ | 读历史键 | ✓ 链接 | ✓ | 2 |

新增卡型必须按本矩阵声明必有/可有字段， 并核对子请求预算 (免费层单请求 ≤50)。

## 5. Secrets (wrangler secret put)

`BOT_TOKEN` · `CHAT_ID` · `WEBHOOK_SECRET` · `GH_TOKEN` · `TELEGRAPH_TOKEN`

可选: `OPENROUTER_API_KEY` (/hn 深度摘要 + 手册 AI 正文) · `JINA_API_KEY` / `GENEDAI_API_KEY` (URL→markdown 兜底) · `CF_ACCOUNT_ID` / `CF_API_TOKEN` (Browser Rendering)

## 6. 数据流摘要

```
cron 08:30 ──> scheduled
  runDigest: fetchTrending(HTMLRewriter) → resolveDescriptions(deepwiki/zread/TranSmart)
    → renderMessage → sendPerRepoMessages(每仓 sendPhoto OG 图)
    → cache digest:<date> + 存档缓冲 + createTelegraphPage
  refreshLookupDescriptions / backfillDescriptions
  flushArchivedPending: pend:arc:* → Git Data API 一个 commit → archive 分支

webhook ──> /hn | /search | /archive | 链接 | /gt
  /hn → archive 分支 product JSON 秒回； miss → repository_dispatch
  /search → search:index 过滤 → 译中 → 分页 keyboard
  /archive → archive:idx 倒序 → 三链
  repo链接 → lookupRepo → 存档缓冲 + index
  X/URL → 摘要summarizeZh → 存档缓冲
  缓冲 ≥20 → waitUntil flushArchivedPending
```