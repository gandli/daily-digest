# 每日自动推送(cron)

本章介绍如何启用并使用 Bot 的每日自动推送功能。开启后,Bot 会在每天 **08:30(北京时间)** 准时执行抓取、翻译、存档、推送一整套流程,并顺带完成 `refreshLookupDescriptions` 与 `backfillDescriptions` 等维护任务,你无需任何手动操作即可在早晨收到当天的精选仓库摘要。

### 步骤 1:订阅每日推送

在 Bot 对话中发送命令 `⏰ 每天 08:30(北京时间)自动推送`,向 Bot 注册 cron 定时任务。Bot 内部会立即在调度器中写入一条规则,触发时间为每天 08:30(Asia/Shanghai 时区)。

### 步骤 2:等待首次自动触发

注册成功后,你不需要再做任何事。Bot 会在下一个 08:30 自动唤醒,按顺序执行:
1. 抓取当日 GitHub Trending 仓库;
2. 翻译仓库描述为中文;
3. 归档到历史记录;
4. 推送当天的摘要消息;
5. 顺带运行 `refreshLookupDescriptions` 与 `backfillDescriptions` 维护任务。

### 步骤 3:查看每日推送结果

次日 08:30 后回到与 Bot 的对话,你将看到一条带序号的摘要消息,格式为 `n/total <owner>/<repo> ⭐ <stars> 👤 <author> <中文简介> #标签 <归档链接>`。下面是真实推送样例:

> 1/2 antirez/kilo ⭐ 3.2k 👤 antirez 这个仓库实现了经典的文本编辑器,代码精炼,适合学习 C 语言。#trending #c #editor 🗂 <a
> 2/2 sharkdp/bat ⭐ 50.0k 👤 sharkdp 这个仓库实现了经典的文本编辑器,代码精炼,适合学习 C 语言。#trending 🗂 <a href="https:

![每日自动推送示例](assets/10-cron-r1.png)

### 步骤 4:阅读与跳转

每条消息末尾的 `<a href="https:…>` 链接即该仓库的归档详情页,点击即可在浏览器中查看完整翻译、标签以及历史归档。

### 步骤 5:取消订阅(如需)

如需停止每日推送,发送 `停止每日推送` 命令,Bot 会从调度器中移除该 cron 规则,后续不再自动触发,但已归档的历史记录会保留。

## 小贴士

- **时区固定为北京时间**:Bot 内部使用 `Asia/Shanghai` 时区,无论你身处何地,触发时间均为 UTC 00:30。
- **维护任务静默运行**:`refreshLookupDescriptions` 与 `backfillDescriptions` 不会单独发送消息,你只会在每日摘要中看到抓取与翻译的结果。
- **首次推送可能略有延迟**:若 08:30 时上游抓取较慢,Bot 会在抓取完成后立即推送,通常不超过几分钟。
