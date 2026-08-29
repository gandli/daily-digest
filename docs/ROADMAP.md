# daily-digest · 开发计划 (ROADMAP.md)

快照 2026-08-29。状态反映真实实现。

## 已完成 ✅

### 核心管线
- [x] cron 每日 08:30 (Asia/Shanghai) 推送 trending top10， 中文描述 + OG 图
- [x] GitHub 星标 + Chrome 书签导入约 6000 条 → `search:index` 单键压缩索引
- [x] Telegraph 每日备份页 + `archive:tg` 索引
- [x] archive 分支存放 md (`archive/<YYYY>/<date>.md`)
- [x] 存档三链: Telegraph → 互联网档案馆 web.archive.org → GitHub md
- [x] `/product` — 今日 HN 酷产品 (archive 分支 JSON 秒回 / repository_dispatch 触发 Actions)
- [x] X article 长文帖: 直用内嵌标题/正文, 不再喂裸链接给 LLM (#151)

### 命令
- [x] `/trending` — 当天固定， 用缓存秒回
- [x] `/product` — 秒回 / dispatch 兜底
- [x] `/search <kw>` — 索引过滤 + 中文描述 + 分页/跳转 keyboard
- [x] `/archive [n]` — 分页列表 + 三链
- [x] `/help`
- [x] GitHub repo / X 帖 / 任意 URL 链接处理（各含 translate + summarize + archive）
- [x] 卡片序号 `N/M` 仅多条批量显示 (trending/product/fanout 多仓)； 单仓卡无序号

### 工程
- [x] CI: tsc + 519+ tests (44 文件) + GitGuardian + dry-run → merge 自动 deploy
- [x] webhook `allowed_updates=["message","callback_query"]` (翻页可用)
- [x] coverage 93%+ 语句/86% 分支 (vitest coverage-v8, 2026-08-29 实测)
- [x] KV 单键索引规避 50 子请求上限 (免费版)
- [x] 存档批量化: KV `pend:arc:*` 缓冲 + Git Data API 单 commit 推 archive 分支 (每日 cron + ≥20 阈值; 失败保留重试; KV 故障回落直推)
- [x] 用户手册自动化管线: e2e 场景驱动真实 worker → 合成聊天标注截图 (Playwright) → AI 生成逐步说明 (无 key 模板兜底) → manual.yml 随代码变更重生成 [docs/guide/](guide/README.md)

## 进行中 🔄

- [ ] 假烟/稽查类目扩展： 待用户拍板具体来源
- [ ] v2: X/网页收藏源 (GOAL Out of Scope 列出， 需另立 goal)
- [ ] 描述缓存 `lookup:desc:` 的 refresh 周期调优

## 待定 / 计划 📋

### 短中期
- [x] 存档索引 `archive:idx` 补 `url` 字段 → repo 重发三链的 web.archive 用真实源 URL (旧记录回落 repo 推断, #160)
- [ ] `/search` 描述翻译结果缓存回索引 (当前每次翻页实时译， 可缓存省额度)
- [ ] 超长摘要输入 (`text.slice(0,2000)`) 分段/分块处理
- [ ] 移动端预览 (LAN 预览已有模式， bot 侧照片展示优化)
- [ ] Playwright Chromium + 手册产物 CI 缓存提速 (当前每次全量装)

### 长期 / 观察
- [ ] 数据源插件式扩展 (C4 契约已约束)
- [ ] 多白名单/多群 (Out of Scope， 需另立)
- [ ] 假烟识别知识库衔接 (`cigarette-code-registration` 灵感仓联动)
- [ ] 手册截图本地 CDP 驱动真 Telegram Web 模式 (需登录态, 仅本地)

## 里程碑进度 (对齐 GOAL.md)

| M | 状态 |
|---|------|
| M1 骨架+CI | ✅ |
| M2 管线打通 | ✅ |
| M3 上线+观察期 | ✅ (稳定运行) |

## 技术债 / 已知

- `search:idx` 播种需 CI deploy 后跑 `seed-search-index.mjs` (已自动化)
- trending 解析绑定 GitHub 页面 DOM 结构， 改版需修选择器
- 网页 `urlToMarkdown` 三级链依赖 CF API + 上游， 偶发失败
- 存档批量化后 GitHub md 链接最终一致 (最长延迟到下次 flush； Telegraph/Wayback 即时)
- 存档并发 flush 无分布式互斥， 极端下同批内容可能重复成两个 commit (内容幂等无害)
- 免费模型池偶发 429 → 手册个别章自动落模板兜底 (下次重生成自愈)