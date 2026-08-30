### /product — 今日 HN 酷产品

本节介绍 `/product`(亦即 `/hn`)命令的完整使用流程:从发起请求,到读取缓存秒回产品卡,再到无数据时自动触发 GitHub Actions 重新生成,一气呵成。

### 步骤 1: 发起请求

在 Bot 对话框中输入 `/product` 或其别名 `/hn`,向 Bot 索取今日 Hacker News 酷产品卡片。Bot 会立刻识别命令并查询 `archive` 分支上的当日 JSON 数据:

- 若命中缓存,直接渲染产品卡回复(跳转步骤 3);
- 若当日尚无数据,则进入步骤 2 的生成流程。

### 步骤 2: 等待生成(首次或无缓存时)

当 archive 分支未找到当日 JSON 时,Bot 通过 `repository_dispatch` 事件触发 GitHub Actions 工作流,异步拉取并解析 Hacker News 当日热门产品,最终写入 archive 分支。Bot 会立即给出提示:

> ⏳ 今日 Hacker News 酷产品生成中(约 2-5 分钟), 完成后自动推送。

此时无需重复发起请求,只要保持与 Bot 的会话即可,工作流完成后 Bot 会主动推送结果。如下图所示:

![首次请求时,Bot 提示生成中](assets/03-product-r1.png)

### 步骤 3: 接收产品卡

GitHub Actions 完成后,Bot 自动推送当日产品卡。卡片包含产品标题、发布者、发布时间、产品简介以及 Open Graph 封面图,信息一目了然。典型回复样式如下:

> 🚀 2026-08-30 Linear — 快得离谱的项目管理工具
> 👤 by karpathy · about 3 hours ago
> 📝 一款以速度著称的产品规划与 issue 跟踪工具。

实际推送效果如下图所示:

![生成完成后,Bot 自动推送产品卡](assets/03-product-r2.png)

卡片中包含的 OG 图会由 Bot 直接读取 archive 中的图片资源并展示,无需额外点击。

### 小贴士

- 看到"生成中"提示后,请耐心等待 2-5 分钟,Bot 会主动推送结果,**不必重复发送 `/product`**,以免重复触发 Actions。
- 命令同时支持 `/product` 与 `/hn` 两种写法,可任选顺手的别名使用。
- 若等待超过 10 分钟仍未收到推送,可发送 `/product` 再次请求一次;此时大概率会直接命中 archive 缓存秒回。
