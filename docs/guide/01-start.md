### 步骤 1: 添加 Bot 并发送 /start

在 Telegram 中找到 daily-digest Bot 并点击「Start」,或在对话框中手动输入 `/start` 并发送。

Bot 收到后会立即回复一条欢迎与使用说明的消息,内容包含:

- 📊 **daily-digest 使用** 标题
- **命令列表**:`/trending`(今日 GitHub Trending)、`/product`(今日 HN 酷产品)、`/search 关键词`(搜索历史存档)、`/archive`(历史存档,分页+三链)
- **支持的链接类型**:GitHub 仓库链接 → 单仓查询存档

![\/start 命令返回的 HELP 菜单](assets/01-start-r1.png)

### 步骤 2: 查阅命令说明

阅读 Bot 回复的完整内容,确认自己需要的命令已涵盖。若你想看今日热门,可选 `/trending` 或 `/product`;若想按关键词检索,使用 `/search 关键词`;若想翻阅历史推送,使用 `/archive`;若手头正好有一个 GitHub 仓库链接,可以直接把它粘贴到对话框中。

### 步骤 3: 选择下一步操作

根据步骤 1 中获得的能力列表,选择对应的命令或链接继续与 Bot 交互。例如发送 `/trending` 获取今日 GitHub Trending 榜单,或粘贴一个 GitHub 仓库链接触发单仓存档查询。

## 小贴士

- 任意非命令文本只要不在某个特定分支的处理逻辑中,Bot 同样会回 HELP 菜单,因此忘记命令时随便发一句话也能再次看到帮助。
- GitHub 仓库链接必须为完整的 `https://github.com/owner/repo` 形式,粘贴后 Bot 会自动识别并匹配「单仓查询存档」分支。
- 命令与参数之间请使用空格分隔,例如 `/search rust` 而非 `/search:rust`,以避免解析失败。
