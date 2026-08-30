## /product — 今日 HN 酷产品

`/product`(命令别名 `/hn`)为你带来每日精选的 Hacker News 高分产品。Bot 会先从 archive 分支读取当日 JSON,如尚未生成则触发 GitHub Actions 工作流,几分钟后自动推送产品卡。

### 步骤 1: 发起查询

在 Bot 对话中发送 `/product` 或 `/hn`。

Bot 立即响应,提示数据正在准备:

> ⏳ 今日 Hacker News 酷产品生成中(约 2-5 分钟), 完成后自动推送。

若当日 archive 分支已有 JSON,Bot 会直接返回产品卡(跳到步骤 3);若尚未生成,则进入等待。

![首次请求后 Bot 的等待提示](assets/03-product-r1.png)

### 步骤 2: 等待 Actions 触发

首次调用后,Bot 通过 `repository_dispatch` 事件唤醒 GitHub Actions。该工作流抓取 Hacker News 当日高分条目、筛选产品类项目、生成结构化 JSON 并提交到 archive 分支,通常耗时 2 至 5 分钟。期间你可以正常进行其他操作,无需重复触发。

### 步骤 3: 接收产品卡

工作流完成后,Bot 主动推送产品卡消息:

> 🚀 2026-08-30 Linear — 快得离谱的项目管理工具
> 👤 by karkarpathy · about 3 hours ago
> 📝 一款以速度著称的产品规划与 issue 跟踪工具。
> 💬 "Linear is purpose-built to be fast…"

卡片包含日期、产品名、一句话简介、作者、HN 热度时间以及 OG 预览图。

![Bot 推送的产品卡详情](assets/03-product-r2.png)

### 步骤 4: 查看与互动

点开消息中的 OG 图可查看产品截图;若对产品感兴趣,直接访问 Hacker News 讨论串围观评论。卡片会被缓存到 archive 分支,后续 `/product` 重复调用时秒回。

- **小贴士**
  - 等待期间可继续其他对话,完成后 Bot 会自动推送,无需再次输入命令。
  - 若 5 分钟后仍未推送,可再发一次 `/product`,Bot 会读取 archive 分支的缓存 JSON 直接返回。
  - 想查看历史产品?访问仓库 archive 分根浏览 `data/` 目录下的日期文件即可。
