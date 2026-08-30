### 每日自动推送（cron）

本章节说明 Bot 的定时推送功能：每天北京时间 08:30，Bot 会自动执行抓取、翻译、存档、推送等流程，并在推送完成后运行 `refreshLookupDescriptions` / `backfillDescriptions` 维护任务来更新描述库。

### 步骤 1：等待定时触发

用户无需任何操作。每天 08:30（北京时间），Bot 的调度器自动触发本次推送事务。事务内部按顺序执行：

1. 新鲜抓取——从 GitHub Trending 等数据源拉取当日热门仓库。
2. 翻译——为每个仓库生成中文简介。
3. 存档——将抓取结果写入历史归档。
4. 推送——把整理好的消息推送给订阅用户。
5. 维护任务——异步运行 `refreshLookupDescriptions` 与 `backfillDescriptions`，刷新描述缓存并补齐缺失项。

### 步骤 2：接收推送消息

Bot 会按 `序号/总数 仓库名 ⭐ 星标数 👤 作者 简介 #标签` 的格式逐条推送当日热门仓库。例如本轮 e2e 测试中真实产生的两条记录：

> 1/2 antirez/kilo ⭐ 3.2k 👤 antirez 这个仓库实现了经典的文本编辑器，代码精炼，适合学习 C 语言。 #trending #c #editor 🗂 <a href="…">…</a>
>
> 2/2 sharkdp/bat ⭐ 50.0k 👤 sharkdp 这个仓库实现了经典的文本编辑器，代码精炼，适合学习 C 语言。 #trending 🗂 <a href="…">…</a>

完整推送效果如下截图所示：

![每天 08:30 自动推送的 GitHub Trending 列表](assets/10-cron-r1.png)

### 步骤 3：关注附加提示

当某些外部数据源（如 Product Hunt）不可用时，Bot 会在推送末尾追加一条警告消息，便于用户了解信息覆盖情况：

> ⚠️ Product Hunt 拉取失败，请稍后再试。

该提示说明本次 Product Hunt 部分抓取失败，GitHub Trending 推送不受影响，后续可手动重试或等待下一次 cron 触发。

### 小贴士

- **无需手动执行**：cron 推送由调度器在后台自动触发，用户只要保持与 Bot 的对话即可按时收到消息，无需发送任何指令。
- **失败重试策略**：若看到类似「Product Hunt 拉取失败」的提示，无需立即操作；维护任务会在后台持续补齐描述，GitHub Trending 仍会按时推送。
- **描述维护是隐式的**：`refreshLookupDescriptions` 与 `backfillDescriptions` 不直接面向用户，但它们保证下次推送的简介更准确、更完整，长时间使用 Bot 会感受到翻译质量逐步提升。
