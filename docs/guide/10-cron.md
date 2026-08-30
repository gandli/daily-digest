### 每日自动推送（cron）

本章节介绍 Bot 每天 08:30（北京时间）由调度任务自动触发的完整流程。整个过程无需用户手动干预，Bot 会按照「抓取 → 翻译 → 存档 → 推送」四步顺序执行，并在合适时机运行 `refreshLookupDescriptions` 与 `backfillDescriptions` 等维护任务。

### 步骤 1：等待定时触发

用户在每天 08:30（北京时间）之前无需执行任何操作。Bot 的 `scheduled` 触发器会在指定时间自动唤醒，开始执行当天的推送任务。

### 步骤 2：抓取新鲜项目并翻译

Bot 会自动抓取当天的 GitHub Trending 与 Product Hunt 新鲜数据，并对仓库描述进行中文翻译。

### 步骤 3：存档与维护

抓取与翻译完成后，Bot 会将内容写入归档数据库，并依次执行 `refreshLookupDescriptions`（刷新描述缓存）与 `backfillDescriptions`（回填缺失描述）这两项维护任务，确保历史数据与查询索引保持一致。

### 步骤 4：自动推送结果

完成上述步骤后，Bot 会向用户主动推送当天的精选项目。例如，下面是一次真实的推送结果：

> 1/2 antirez/kilo ⭐ 3.2k 👤 antirez 这个仓库实现了经典的文本编辑器，代码精炼，适合学习 C 语言。 #trending #c #editor 🗂 <a …</br>
> 2/2 sharkdp/bat ⭐ 50.0k 👤 sharkdp 这个仓库实现了经典的文本编辑器，代码精炼，适合学习 C 语言。 #trending 🗂 <a href="https:…

由于推送由定时任务自动完成，截图来自触发后的实际频道消息：

![每天 08:30 自动推送的真实频道消息](assets/10-cron-r1.png)

### 步骤 5：处理可能的异常

如果当日部分外部数据源（例如 Product Hunt）不可用，Bot 会在推送末尾追加一行警告提示，例如：

> ⚠️ Product Hunt 拉取失败，请稍后再试。

此时 GitHub 推送部分仍然正常送达，失败的数据源会在下一次 cron 触发时自动重试，无需用户手动修复。

### 小贴士

- 定时推送使用的是 **北京时间 08:30**，若你身处其他时区，可根据自身作息估算消息到达时间。
- 当看到类似「⚠️ XXX 拉取失败」的提示时，不必立即处理，等待下一次自动触发即可；若连续多次失败再向管理员反馈。
- 每日推送内容会自动存档并被 `refreshLookupDescriptions` / `backfillDescriptions` 维护，因此随时可通过 `每日 GitHub Trending` 等手动指令回溯历史。
