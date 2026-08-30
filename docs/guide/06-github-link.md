### 步骤 1：粘贴 GitHub 仓库链接

在 Telegram 对话框中直接粘贴形如 `https://github.com/owner/repo` 的仓库链接,然后发送给 Bot。例如发送 `https://github.com/antirez/kilo`。

### 步骤 2：首次查询触发抓取

Bot 收到链接后会立即开始处理。如果是首次遇到该仓库,Bot 会向 GitHub API 请求仓库元数据,同时并发调用 deepwiki 与 zread 两个数据源获取项目描述,再生成永久存档记录。整个过程通常在数秒内完成。

### 步骤 3：Bot 返回归档卡片

处理完成后,Bot 会回送一张带描述的归档卡,包含仓库名称、星标数、主语言、所有者、简介、话题标签以及归档链接。例如发送 `https://github.com/antirez/kilo` 后,Bot 会返回:

> antirez/kilo ⭐ 3.2k · #C 👤 antirez 这个仓库实现了经典的文本编辑器, 代码精炼, 适合学习 C 语言。 #trending #c #editor 🗂 <a href=" …

卡片样式参考下图:

![GitHub 仓库链接首次查询返回的归档卡片](assets/06-github-link-r1.png)

### 步骤 4：后续查询走缓存

再次发送同一仓库链接时,Bot 不会重新抓取,而是直接返回已有的归档卡片,并附带 ♻️ 标识表示这是缓存命中。响应速度会比首次快很多。

### 小贴士

- 链接必须是 `https://github.com/owner/repo` 的标准格式,省略协议头(如 `github.com/owner/repo`)或附加查询参数都可能无法被识别。
- 首次查询的耗时取决于 deepwiki 和 zread 的响应速度;若其中一个数据源超时,Bot 仍会基于已有信息返回卡片,只是简介可能稍短。
- 归档卡片会永久保存,即使原仓库改名、设为私有或被删除,之前生成的卡片与链接仍然可访问,适合作为技术调研的参考资料留存。
