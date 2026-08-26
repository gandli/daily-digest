# daily-digest · 开发计划 (ROADMAP.md)

快照 2026-08-26。状态反映真实实现。

## 已完成 ✅

### 核心管线
- [x] cron 每日 08:30 (Asia/Shanghai) 推送 trending top10， 中文描述 + OG 图
- [x] GitHub 星标 + Chrome 书签导入约 6000 条 → `search:index` 单键压缩索引
- [x] Telegraph 每日备份页 + `archive:tg` 索引
- [x] archive 分支存放 md (`archive/<YYYY>/<date>.md`)
- [x] 存档三链: Telegraph → 互联网档案馆 web.archive.org → GitHub md

### 命令
- [x] `/trending` — 当天固定， 用缓存秒回
- [x] `/search <kw>` — 索引过滤 + 中文描述 + 分页/跳转 keyboard
- [x] `/archive [n]` — 分页列表 + 三链
- [x] `/help`
- [x] GitHub repo / X 帖 / 任意 URL 链接处理（各含 translate + summarize + archive）

### 工程
- [x] CI: tsc + 139 tests + GitGuardian + dry-run → merge 自动 deploy
- [x] webhook `allowed_updates=["message","callback_query"]` (翻页可用)
- [x] coverage 48%+ (vitest coverage-v8)
- [x] KV 单键索引规避 50 子请求上限 (免费版)

## 进行中 🔄

- [ ] 假烟/稽查类目扩展： 待用户拍板具体来源
- [ ] v2: X/网页收藏源 (GOAL Out of Scope 列出， 需另立 goal)
- [ ] 描述缓存 `lookup:desc:` 的 refresh 周期调优

## 待定 / 计划 📋

### 短中期
- [ ] 存档索引 `archive:idx` 补 `url` 字段 → repo 重发三链的 web.archive 更精确 (当前用 github.com/<repo> 推断)
- [ ] `/search` 描述翻译结果缓存回索引 (当前每次翻页实时译， 可缓存省额度)
- [ ] 超长摘要输入 (`text.slice(0,2000)`) 分段/分块处理
- [ ] 移动端预览 (LAN 预览已有模式， bot 侧照片展示优化)

### 长期 / 观察
- [ ] 数据源插件式扩展 (C4 契约已约束)
- [ ] 多白名单/多群 (Out of Scope， 需另立)
- [ ] 假烟识别知识库衔接 (`cigarette-code-registration` 灵感仓联动)

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