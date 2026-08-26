# daily-digest · 接口契约 (INTERFACES.md)

基于 src/ 现行代码事实， 非目标态。文件: `src/index.ts` (webhook 入口), `src/notify.ts`, `src/lookup.ts`, `src/archive.ts`。

---

## 1. Telegram 命令 (webhook POST /telegram)

白名单 `CHAT_ID` 内才响应； 验签失败 `403`。

| 命令 | 行为 | 备注 |
|------|------|------|
| `/trending` | 用缓存 `digest:<date>` 秒回； 无缓存触发完整管线 `runDigest(env, true)` | 当天 trending 固定， 不重抓 |
| `/search <关键词>` | 单键索引 `search:index` 内存过滤 → 分页 10 条 + inline keyboard 翻页/跳转 | 描述批量译中 (TranSmart/m2m100) |
| `/archive [页码]` | `archive:idx:*` 遍历倒序 → 10 条/页 + 三链 (Telegraph/web.archive/GitHub md) | 分页 inline keyboard |
| `/help` / 空 | 使用说明 + 注册命令菜单 | 幂等 setMyCommands |
| 任意 GitHub repo 链接 | 首次 → `lookupRepo` 单查+存档； 当日已查 → `replyArchived` 回存档三链 | `seenToday` 去重 (TTL 48h) |
| X 帖链接 (`x.com/<h>/status/<id>`) | `archiveTweet`: FxEmbed 拉元数据 → 摘要 → 存档 | |
| 任意网页 URL | `archiveUrl`: markdown 三级链 → 中文摘要 → 存档 | 重发语义: first/retry/done |
| 其余输入 | 帮助提示 | |

**inline keyboard callback_data**:
- 翻页: `arch:pg:<n>` (archive), `sch:<page>:<token>` (search, token→KV 读回 query)
- 导航行: `[⬅ 上一页] [📄 当前/总页] [下一页 ➡]` + 跳转行 `⏮ 1 / ⏭ 中 / ⏭ 末` (>4 页)
- 处理后必 `answerCallbackQuery` (finally 中)， 否则按钮转圈

## 2. HTTP 端点

基址 `https://daily-digest.gandli-digest.workers.dev`

| 端点 | 方法 | 鉴权 | 行为 |
|------|------|------|------|
| `/telegram` | POST | `X-Telegram-Bot-Api-Secret-Token` = `WEBHOOK_SECRET` | TG webhook 入口， 全部命令分派 |
| `/run?cache=0` | GET | `WEBHOOK_SECRET` (URL 参数) | 手动触发完整 digest 管线 (`runDigest`) |
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

## 4. 存档三链 (archiveLinks)

回复存档链接按优先级：
1. **Telegraph** (archive:tg 命中)
2. **互联网档案馆** `web.archive.org/web/2/<url>` (源 URL 可归档时)
3. **GitHub md** `https://github.com/gandli/daily-digest/blob/archive/archive/<YYYY>/<date>.md`

## 5. Secrets (wrangler secret put)

`BOT_TOKEN` · `CHAT_ID` · `WEBHOOK_SECRET` · `GH_TOKEN` · `TELEGRAPH_TOKEN`

## 6. 数据流摘要

```
cron 08:30 ──> runDigest
  fetchTrending(HTMLRewriter) → resolveDescriptions(deepwiki/zread/TranSmart)
  → renderMessage → sendPerRepoMessages(每仓 sendPhoto OG 图)
  → cache digest:<date> + archiveToGitHub + createTelegraphPage
  
webhook ──> /search | /archive | 链接 | /trending
  /search → search:index 过滤 → 译中 → 分页 keyboard
  /archive → archive:idx 倒序 → 三链
  repo链接 → lookupRepo → archiveToGitHub + index
  X/URL → 摘要summarizeZh → 存档
```