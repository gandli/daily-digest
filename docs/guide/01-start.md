## 快速开始

本章面向首次使用 daily-digest Bot 的用户,带你从添加到首次使用,只需几分钟即可上手。

### 步骤 1: 启动 Bot 并查看主菜单

在 Telegram 中找到 daily-digest Bot,点击 **Start** 或在输入框中发送 `/start`。Bot 会立即回复一份简洁的使用说明,涵盖所有可用命令与支持的资讯来源,无需登录或授权。

![Bot 启动后回复的 HELP 菜单](assets/01-start-r1.png)

### 步骤 2: 阅读 HELP 菜单内容

Bot 回复的消息以 `📊 daily-digest 使用` 开头,按以下顺序列出命令清单:

- `/gt` — 查询今日 GitHub Trending
- `/hn` — 查询今日 Hacker News 酷产品
- `/ph` — 查询今日 Product Hunt 热门产品
- `/search 关键词` — 查询历史存档
- `/archive` — 浏览历史存档(分页 + 三链)

这份菜单就是 Bot 的全部能力地图。你可以先通读一遍,了解每个命令对应的资讯类型,再根据当日兴趣选择触发。

### 步骤 3: 触发一次内容查询

以最常用的 GitHub Trending 为例:在任意时刻向 Bot 发送 `/gt`。Bot 会抓取当日 GitHub 趋势榜单并以条目形式返回,每条包含项目名称、简介与链接。如果当前不在任何交互流程中,你也可以直接发送任意非命令文本,Bot 会再次显示这份 HELP 菜单,方便随时回顾用法。

### 步骤 4: 探索历史与搜索

想回顾往期内容,可使用 `/search 关键词` 在存档中检索,或发送 `/archive` 进入分页浏览模式,在三链(GitHub / Hacker News / Product Hunt)之间切换查看。

### 小贴士

- **随时调用 HELP**:除了首次 `/start`,任何时候发送普通文本,Bot 都会重发命令清单,作为便携速查表。
- **关键词搜索更高效**:精确查询时建议使用 `/search 关键词` 而非翻阅 `/archive`,后者更适合漫无目的的浏览场景。
- **三链互补**:GitHub 看技术动向,Hacker News 看科技讨论,Product Hunt 看新发布产品,组合使用可获得更完整的每日信息早餐。
