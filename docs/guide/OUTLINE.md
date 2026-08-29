# daily-digest Bot 用户手册 — 章节大纲

> 章节与「核心用户事务」一一对应。每章由 e2e 场景自动驱动：跑场景 → 合成聊天记录截图（带标注）→ AI 生成正文 → 插图。
> 手册随 CI 自动重新生成（`.github/workflows/manual.yml`），与代码同步。

## 1. 快速开始
**事务**：新用户加 Bot、看帮助。用户发 `/start` 或任意非命令文本（不在任何分支时）→ Bot 回 HELP 菜单（命令列表 + 支持的链接类型 + 推送时间）。
**验证**：回复含 `/trending` `/search`、命令菜单已注册（setMyCommands）。

## 2. /trending — 今日 GitHub Trending
**事务**：拉当天 Trending。缓存命中 → 秒回卡片；未命中 → 先回「⏳ 生成中(10-30秒)」占位，后台跑完整管线（抓取→翻译→存档→发卡）。
**验证**：占位提示先发；失败时回「⚠️ 抓取失败」。

## 3. /product — 今日 HN 酷产品
**事务**：读 archive 分支 JSON 秒回产品卡（含 OG 图）；无当日数据 → repository_dispatch 触发 Actions 生成，回提示。
**验证**：命中 → 产品卡+图；miss → 触发生成提示。

## 4. /archive — 历史存档浏览（分页交互）
**事务**：最近存档列表，inline keyboard 翻页（◀️ ▶️），点条目跳转。
**验证**：/archive → 列表+kbd；arch:pg callback → editMessageText 原地翻页；空存档 → 「暂无存档记录」。

## 5. /search 关键词 — 搜索历史存档
**事务**：输入 `/search rust cli` → 内存索引过滤 + 相关度排序 → 结果卡片 + 翻页按钮（sch:page callback，query 存 KV）。
**验证**：无关键词 → 用法提示；有结果 → 卡片；翻页过期 → 「查询过期，请重新 /search」。

## 6. GitHub 仓库链接 → 单仓查询
**事务**：粘贴 `https://github.com/owner/repo` → 已查过 → ♻️ 带描述的归档卡；首次 → 抓 repo 元数据 + deepwiki/zread 描述 + 存档 + 卡片。
**验证**：seenToday 分支与首次查询分支各自的卡片内容。

## 7. X/Twitter 链接 → 帖子存档
**事务**：粘贴 X 帖链接 → FxEmbed v2 拉帖（含多图 mosaic）→ 中文翻译 → Telegraph 页 → 卡片（图/视频/纯文字自适应）。
**验证**：多图帖用 mosaic 拼图；单图 sendPhoto；翻译失败回退原文。

## 8. 任意网页链接 → markdown 存档
**事务**：粘贴普通 URL → 转 markdown → GitHub 存档 + Telegraph 页 → 卡片（标题+摘要+📁三链）。
**验证**：Telegraph 失败不中断；三链齐全。

## 9. 重复链接 — 重发语义
**事务**：重发已处理链接：done → ♻️ 标题+摘要+三链（不重跑）；retry（上次不完整）→ 🔁 提示后重跑；老记录无存档 → 重挂补链。
**验证**：三分支各自的回复文案。

## 10. 每日自动推送（cron）
**事务**：每天 08:30（北京时间）scheduled 触发：新鲜抓取 → 翻译 → 存档 → 推送 + refreshLookupDescriptions/backfillDescriptions 维护任务。
**验证**：scheduled handler 调 runDigest(false) + 两个维护函数。
