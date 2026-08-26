# [](https://github.com/gandli/daily-digest/compare/v0.0.1...v) (2026-08-26)


### Bug Fixes

* **/product 10条:** HN 源改 Algolia search_by_date tags=story,show_hn——一次拿当日 Show HN 新品, 替代逐条扫 topstories(前60可能0条, 凑不满10) ([#95](https://github.com/gandli/daily-digest/issues/95)) ([3f9340a](https://github.com/gandli/daily-digest/commit/3f9340a4411b74820a544a49a4578a2f3b5f2fbc))
* extractRepo 剥离 .git 克隆后缀——修复 https://github.com/apple/container.git 误判为 apple/container.git 的 404 bug ([#90](https://github.com/gandli/daily-digest/issues/90)) ([014296d](https://github.com/gandli/daily-digest/commit/014296d2f03d8b6dd8cdcd9e9058c68372b2eb60))
* repo 联动分批串行(3/批)全量解析 + 主卡不阻塞——串行单waitUntil超时截断后半repo, 并发超50子请求, 分批折中保全部 ([#92](https://github.com/gandli/daily-digest/issues/92)) ([a03e301](https://github.com/gandli/daily-digest/commit/a03e301969c0b7768c7e57fc642c4c609368f68e))
* X/网页内容 repo 联动全量解析(去 3 条上限→10); 顺序 await 防 50 子请求爆——修复 X 帖只解析部分 repo ([#91](https://github.com/gandli/daily-digest/issues/91)) ([35f9f93](https://github.com/gandli/daily-digest/commit/35f9f93e1077bb05a23e45b75660111ed63e73a9))
* **存档三链:** 去 📎 双 emoji 前缀 + 互联网档案馆→Wayback 短名——三链行精简 ([#84](https://github.com/gandli/daily-digest/issues/84)) ([3e33454](https://github.com/gandli/daily-digest/commit/3e33454c2f7782b4c26372c64095ac494a7d8d56))


### Features

* **/archive 排版:** 每条多行结构化(标题/📝摘要/🏷标签/📎三链); archive:idx 存 topics 供标签; replyArchived 同款加标签 ([#83](https://github.com/gandli/daily-digest/issues/83)) ([e89a46a](https://github.com/gandli/daily-digest/commit/e89a46a86a154a02188bd7a852309e258d1c7c48))
* /archive 项目间空行间隔; 存档三链第三项统一 'Archive'(原'GitHub md'); /product(HN酷产品)每条补三链——所有项目/帖子/网页都有三链 ([#88](https://github.com/gandli/daily-digest/issues/88)) ([d0d5716](https://github.com/gandli/daily-digest/commit/d0d5716c12b090d154b61601719cb7cb1bb9b9b2))
* **/archive:** 每条标题指向原链接(https://github.com/repo); replyArchived 标题同款 ([#89](https://github.com/gandli/daily-digest/issues/89)) ([2d63284](https://github.com/gandli/daily-digest/commit/2d63284a2de91a3aaa74c287390f5fa880d43f95))
* **/help:** 排版分组优化——命令/链接分区 + <b>加粗标题 + 空行间隔, 更易读 ([#85](https://github.com/gandli/daily-digest/issues/85)) ([0db75dc](https://github.com/gandli/daily-digest/commit/0db75dca73e49a3ff6f0debac953a1b13abfa292))
* **/product OG:** GitHub repo → GitHub OG 卡; 非 GitHub 网页 → 抓页面 og:image 作封面; 保留自托管→官方 retry ([#99](https://github.com/gandli/daily-digest/issues/99)) ([e0314ba](https://github.com/gandli/daily-digest/commit/e0314baf3ac273406d9ef42cf37ea67103ca24d3))
* /product 命令 — HN 新产品/开源项目源, 仿 trending 独立推送/缓存/存档, 不与 digest 合并; CF Summarization 中文摘要; cron 每日推送 ([#82](https://github.com/gandli/daily-digest/issues/82)) ([93414b5](https://github.com/gandli/daily-digest/commit/93414b5371d092e660b811e1381a4e67eda6dcd7))
* **/product:** HN 源扫描范围 30→60 个 top 凑满 10 条(Show HN/GitHub 在 top 占比不高, 30 常不足 10) ([#94](https://github.com/gandli/daily-digest/issues/94)) ([8235fe6](https://github.com/gandli/daily-digest/commit/8235fe663f2ae74b85589f70286a77725c8e1594))
* **/product:** 加 Telegraph 独立存档页(archive:tg:product:<date>) + 三链首项 Telegraph 优先——对齐 trending ([#101](https://github.com/gandli/daily-digest/issues/101)) ([2205850](https://github.com/gandli/daily-digest/commit/2205850b94b22b7772ab59d08be908587415cea0))
* **/product:** 每条补中文描述(标题翻译) + 领域标签(topicsFromTitle) + 渲染📝描述/标签——修复 HN 条目无描述/翻译/摘要/标签 ([#97](https://github.com/gandli/daily-digest/issues/97)) ([f9f3e5b](https://github.com/gandli/daily-digest/commit/f9f3e5bc837afe839b18235d63dd2d3e259d6c91))
* **/product:** 空正文条目拉 url 正文 → CF summarize 中文摘要(分批2防子请求爆); 无url/失败回退标题翻译 ([#98](https://github.com/gandli/daily-digest/issues/98)) ([2f31fc1](https://github.com/gandli/daily-digest/commit/2f31fc1905f719f4cbfb8c98ef13f50d2089fd6a))
* **/trending:** 每 repo 消息底部加存档三链(Telegraph·Wayback·GitHub md); renderMessage 加 archiveRepo 参数 ([#86](https://github.com/gandli/daily-digest/issues/86)) ([dd76788](https://github.com/gandli/daily-digest/commit/dd76788d143c7ecf96369fc999783f947266887d))
* 每日低速增量补星标仓缺/未译描述 — backfillDescriptions(cron, 每天40条, deepwiki→译中→lookup:desc); /search 渲染优先取 lookup:desc 覆盖 ([#80](https://github.com/gandli/daily-digest/issues/80)) ([1f22f77](https://github.com/gandli/daily-digest/commit/1f22f778f9c8ad99d2b8cacd8cbbb93ffec7d9d5))
# [](https://github.com/gandli/daily-digest/compare/v0.0.1...v) (2026-08-26)


### Bug Fixes

* **/product 10条:** HN 源改 Algolia search_by_date tags=story,show_hn——一次拿当日 Show HN 新品, 替代逐条扫 topstories(前60可能0条, 凑不满10) ([#95](https://github.com/gandli/daily-digest/issues/95)) ([3f9340a](https://github.com/gandli/daily-digest/commit/3f9340a4411b74820a544a49a4578a2f3b5f2fbc))
* extractRepo 剥离 .git 克隆后缀——修复 https://github.com/apple/container.git 误判为 apple/container.git 的 404 bug ([#90](https://github.com/gandli/daily-digest/issues/90)) ([014296d](https://github.com/gandli/daily-digest/commit/014296d2f03d8b6dd8cdcd9e9058c68372b2eb60))
* repo 联动分批串行(3/批)全量解析 + 主卡不阻塞——串行单waitUntil超时截断后半repo, 并发超50子请求, 分批折中保全部 ([#92](https://github.com/gandli/daily-digest/issues/92)) ([a03e301](https://github.com/gandli/daily-digest/commit/a03e301969c0b7768c7e57fc642c4c609368f68e))
* X/网页内容 repo 联动全量解析(去 3 条上限→10); 顺序 await 防 50 子请求爆——修复 X 帖只解析部分 repo ([#91](https://github.com/gandli/daily-digest/issues/91)) ([35f9f93](https://github.com/gandli/daily-digest/commit/35f9f93e1077bb05a23e45b75660111ed63e73a9))
* **存档三链:** 去 📎 双 emoji 前缀 + 互联网档案馆→Wayback 短名——三链行精简 ([#84](https://github.com/gandli/daily-digest/issues/84)) ([3e33454](https://github.com/gandli/daily-digest/commit/3e33454c2f7782b4c26372c64095ac494a7d8d56))


### Features

* **/archive 排版:** 每条多行结构化(标题/📝摘要/🏷标签/📎三链); archive:idx 存 topics 供标签; replyArchived 同款加标签 ([#83](https://github.com/gandli/daily-digest/issues/83)) ([e89a46a](https://github.com/gandli/daily-digest/commit/e89a46a86a154a02188bd7a852309e258d1c7c48))
* /archive 项目间空行间隔; 存档三链第三项统一 'Archive'(原'GitHub md'); /product(HN酷产品)每条补三链——所有项目/帖子/网页都有三链 ([#88](https://github.com/gandli/daily-digest/issues/88)) ([d0d5716](https://github.com/gandli/daily-digest/commit/d0d5716c12b090d154b61601719cb7cb1bb9b9b2))
* **/archive:** 每条标题指向原链接(https://github.com/repo); replyArchived 标题同款 ([#89](https://github.com/gandli/daily-digest/issues/89)) ([2d63284](https://github.com/gandli/daily-digest/commit/2d63284a2de91a3aaa74c287390f5fa880d43f95))
* **/help:** 排版分组优化——命令/链接分区 + <b>加粗标题 + 空行间隔, 更易读 ([#85](https://github.com/gandli/daily-digest/issues/85)) ([0db75dc](https://github.com/gandli/daily-digest/commit/0db75dca73e49a3ff6f0debac953a1b13abfa292))
* **/product OG:** GitHub repo → GitHub OG 卡; 非 GitHub 网页 → 抓页面 og:image 作封面; 保留自托管→官方 retry ([#99](https://github.com/gandli/daily-digest/issues/99)) ([e0314ba](https://github.com/gandli/daily-digest/commit/e0314baf3ac273406d9ef42cf37ea67103ca24d3))
* /product 命令 — HN 新产品/开源项目源, 仿 trending 独立推送/缓存/存档, 不与 digest 合并; CF Summarization 中文摘要; cron 每日推送 ([#82](https://github.com/gandli/daily-digest/issues/82)) ([93414b5](https://github.com/gandli/daily-digest/commit/93414b5371d092e660b811e1381a4e67eda6dcd7))
* **/product:** HN 源扫描范围 30→60 个 top 凑满 10 条(Show HN/GitHub 在 top 占比不高, 30 常不足 10) ([#94](https://github.com/gandli/daily-digest/issues/94)) ([8235fe6](https://github.com/gandli/daily-digest/commit/8235fe663f2ae74b85589f70286a77725c8e1594))
* **/product:** 每条补中文描述(标题翻译) + 领域标签(topicsFromTitle) + 渲染📝描述/标签——修复 HN 条目无描述/翻译/摘要/标签 ([#97](https://github.com/gandli/daily-digest/issues/97)) ([f9f3e5b](https://github.com/gandli/daily-digest/commit/f9f3e5bc837afe839b18235d63dd2d3e259d6c91))
* **/product:** 空正文条目拉 url 正文 → CF summarize 中文摘要(分批2防子请求爆); 无url/失败回退标题翻译 ([#98](https://github.com/gandli/daily-digest/issues/98)) ([2f31fc1](https://github.com/gandli/daily-digest/commit/2f31fc1905f719f4cbfb8c98ef13f50d2089fd6a))
* **/trending:** 每 repo 消息底部加存档三链(Telegraph·Wayback·GitHub md); renderMessage 加 archiveRepo 参数 ([#86](https://github.com/gandli/daily-digest/issues/86)) ([dd76788](https://github.com/gandli/daily-digest/commit/dd76788d143c7ecf96369fc999783f947266887d))
* 每日低速增量补星标仓缺/未译描述 — backfillDescriptions(cron, 每天40条, deepwiki→译中→lookup:desc); /search 渲染优先取 lookup:desc 覆盖 ([#80](https://github.com/gandli/daily-digest/issues/80)) ([1f22f77](https://github.com/gandli/daily-digest/commit/1f22f778f9c8ad99d2b8cacd8cbbb93ffec7d9d5))
# [](https://github.com/gandli/daily-digest/compare/v0.0.1...v) (2026-08-26)


### Bug Fixes

* **/product 10条:** HN 源改 Algolia search_by_date tags=story,show_hn——一次拿当日 Show HN 新品, 替代逐条扫 topstories(前60可能0条, 凑不满10) ([#95](https://github.com/gandli/daily-digest/issues/95)) ([3f9340a](https://github.com/gandli/daily-digest/commit/3f9340a4411b74820a544a49a4578a2f3b5f2fbc))
* extractRepo 剥离 .git 克隆后缀——修复 https://github.com/apple/container.git 误判为 apple/container.git 的 404 bug ([#90](https://github.com/gandli/daily-digest/issues/90)) ([014296d](https://github.com/gandli/daily-digest/commit/014296d2f03d8b6dd8cdcd9e9058c68372b2eb60))
* repo 联动分批串行(3/批)全量解析 + 主卡不阻塞——串行单waitUntil超时截断后半repo, 并发超50子请求, 分批折中保全部 ([#92](https://github.com/gandli/daily-digest/issues/92)) ([a03e301](https://github.com/gandli/daily-digest/commit/a03e301969c0b7768c7e57fc642c4c609368f68e))
* X/网页内容 repo 联动全量解析(去 3 条上限→10); 顺序 await 防 50 子请求爆——修复 X 帖只解析部分 repo ([#91](https://github.com/gandli/daily-digest/issues/91)) ([35f9f93](https://github.com/gandli/daily-digest/commit/35f9f93e1077bb05a23e45b75660111ed63e73a9))
* **存档三链:** 去 📎 双 emoji 前缀 + 互联网档案馆→Wayback 短名——三链行精简 ([#84](https://github.com/gandli/daily-digest/issues/84)) ([3e33454](https://github.com/gandli/daily-digest/commit/3e33454c2f7782b4c26372c64095ac494a7d8d56))


### Features

* **/archive 排版:** 每条多行结构化(标题/📝摘要/🏷标签/📎三链); archive:idx 存 topics 供标签; replyArchived 同款加标签 ([#83](https://github.com/gandli/daily-digest/issues/83)) ([e89a46a](https://github.com/gandli/daily-digest/commit/e89a46a86a154a02188bd7a852309e258d1c7c48))
* /archive 项目间空行间隔; 存档三链第三项统一 'Archive'(原'GitHub md'); /product(HN酷产品)每条补三链——所有项目/帖子/网页都有三链 ([#88](https://github.com/gandli/daily-digest/issues/88)) ([d0d5716](https://github.com/gandli/daily-digest/commit/d0d5716c12b090d154b61601719cb7cb1bb9b9b2))
* **/archive:** 每条标题指向原链接(https://github.com/repo); replyArchived 标题同款 ([#89](https://github.com/gandli/daily-digest/issues/89)) ([2d63284](https://github.com/gandli/daily-digest/commit/2d63284a2de91a3aaa74c287390f5fa880d43f95))
* **/help:** 排版分组优化——命令/链接分区 + <b>加粗标题 + 空行间隔, 更易读 ([#85](https://github.com/gandli/daily-digest/issues/85)) ([0db75dc](https://github.com/gandli/daily-digest/commit/0db75dca73e49a3ff6f0debac953a1b13abfa292))
* **/product OG:** GitHub repo → GitHub OG 卡; 非 GitHub 网页 → 抓页面 og:image 作封面; 保留自托管→官方 retry ([#99](https://github.com/gandli/daily-digest/issues/99)) ([e0314ba](https://github.com/gandli/daily-digest/commit/e0314baf3ac273406d9ef42cf37ea67103ca24d3))
* /product 命令 — HN 新产品/开源项目源, 仿 trending 独立推送/缓存/存档, 不与 digest 合并; CF Summarization 中文摘要; cron 每日推送 ([#82](https://github.com/gandli/daily-digest/issues/82)) ([93414b5](https://github.com/gandli/daily-digest/commit/93414b5371d092e660b811e1381a4e67eda6dcd7))
* **/product:** HN 源扫描范围 30→60 个 top 凑满 10 条(Show HN/GitHub 在 top 占比不高, 30 常不足 10) ([#94](https://github.com/gandli/daily-digest/issues/94)) ([8235fe6](https://github.com/gandli/daily-digest/commit/8235fe663f2ae74b85589f70286a77725c8e1594))
* **/product:** 每条补中文描述(标题翻译) + 领域标签(topicsFromTitle) + 渲染📝描述/标签——修复 HN 条目无描述/翻译/摘要/标签 ([#97](https://github.com/gandli/daily-digest/issues/97)) ([f9f3e5b](https://github.com/gandli/daily-digest/commit/f9f3e5bc837afe839b18235d63dd2d3e259d6c91))
* **/product:** 空正文条目拉 url 正文 → CF summarize 中文摘要(分批2防子请求爆); 无url/失败回退标题翻译 ([#98](https://github.com/gandli/daily-digest/issues/98)) ([2f31fc1](https://github.com/gandli/daily-digest/commit/2f31fc1905f719f4cbfb8c98ef13f50d2089fd6a))
* **/trending:** 每 repo 消息底部加存档三链(Telegraph·Wayback·GitHub md); renderMessage 加 archiveRepo 参数 ([#86](https://github.com/gandli/daily-digest/issues/86)) ([dd76788](https://github.com/gandli/daily-digest/commit/dd76788d143c7ecf96369fc999783f947266887d))
* 每日低速增量补星标仓缺/未译描述 — backfillDescriptions(cron, 每天40条, deepwiki→译中→lookup:desc); /search 渲染优先取 lookup:desc 覆盖 ([#80](https://github.com/gandli/daily-digest/issues/80)) ([1f22f77](https://github.com/gandli/daily-digest/commit/1f22f778f9c8ad99d2b8cacd8cbbb93ffec7d9d5))
# [](https://github.com/gandli/daily-digest/compare/v0.0.1...v) (2026-08-26)


### Bug Fixes

* **/product 10条:** HN 源改 Algolia search_by_date tags=story,show_hn——一次拿当日 Show HN 新品, 替代逐条扫 topstories(前60可能0条, 凑不满10) ([#95](https://github.com/gandli/daily-digest/issues/95)) ([3f9340a](https://github.com/gandli/daily-digest/commit/3f9340a4411b74820a544a49a4578a2f3b5f2fbc))
* extractRepo 剥离 .git 克隆后缀——修复 https://github.com/apple/container.git 误判为 apple/container.git 的 404 bug ([#90](https://github.com/gandli/daily-digest/issues/90)) ([014296d](https://github.com/gandli/daily-digest/commit/014296d2f03d8b6dd8cdcd9e9058c68372b2eb60))
* repo 联动分批串行(3/批)全量解析 + 主卡不阻塞——串行单waitUntil超时截断后半repo, 并发超50子请求, 分批折中保全部 ([#92](https://github.com/gandli/daily-digest/issues/92)) ([a03e301](https://github.com/gandli/daily-digest/commit/a03e301969c0b7768c7e57fc642c4c609368f68e))
* X/网页内容 repo 联动全量解析(去 3 条上限→10); 顺序 await 防 50 子请求爆——修复 X 帖只解析部分 repo ([#91](https://github.com/gandli/daily-digest/issues/91)) ([35f9f93](https://github.com/gandli/daily-digest/commit/35f9f93e1077bb05a23e45b75660111ed63e73a9))
* **存档三链:** 去 📎 双 emoji 前缀 + 互联网档案馆→Wayback 短名——三链行精简 ([#84](https://github.com/gandli/daily-digest/issues/84)) ([3e33454](https://github.com/gandli/daily-digest/commit/3e33454c2f7782b4c26372c64095ac494a7d8d56))


### Features

* **/archive 排版:** 每条多行结构化(标题/📝摘要/🏷标签/📎三链); archive:idx 存 topics 供标签; replyArchived 同款加标签 ([#83](https://github.com/gandli/daily-digest/issues/83)) ([e89a46a](https://github.com/gandli/daily-digest/commit/e89a46a86a154a02188bd7a852309e258d1c7c48))
* /archive 项目间空行间隔; 存档三链第三项统一 'Archive'(原'GitHub md'); /product(HN酷产品)每条补三链——所有项目/帖子/网页都有三链 ([#88](https://github.com/gandli/daily-digest/issues/88)) ([d0d5716](https://github.com/gandli/daily-digest/commit/d0d5716c12b090d154b61601719cb7cb1bb9b9b2))
* **/archive:** 每条标题指向原链接(https://github.com/repo); replyArchived 标题同款 ([#89](https://github.com/gandli/daily-digest/issues/89)) ([2d63284](https://github.com/gandli/daily-digest/commit/2d63284a2de91a3aaa74c287390f5fa880d43f95))
* **/help:** 排版分组优化——命令/链接分区 + <b>加粗标题 + 空行间隔, 更易读 ([#85](https://github.com/gandli/daily-digest/issues/85)) ([0db75dc](https://github.com/gandli/daily-digest/commit/0db75dca73e49a3ff6f0debac953a1b13abfa292))
* /product 命令 — HN 新产品/开源项目源, 仿 trending 独立推送/缓存/存档, 不与 digest 合并; CF Summarization 中文摘要; cron 每日推送 ([#82](https://github.com/gandli/daily-digest/issues/82)) ([93414b5](https://github.com/gandli/daily-digest/commit/93414b5371d092e660b811e1381a4e67eda6dcd7))
* **/product:** HN 源扫描范围 30→60 个 top 凑满 10 条(Show HN/GitHub 在 top 占比不高, 30 常不足 10) ([#94](https://github.com/gandli/daily-digest/issues/94)) ([8235fe6](https://github.com/gandli/daily-digest/commit/8235fe663f2ae74b85589f70286a77725c8e1594))
* **/product:** 每条补中文描述(标题翻译) + 领域标签(topicsFromTitle) + 渲染📝描述/标签——修复 HN 条目无描述/翻译/摘要/标签 ([#97](https://github.com/gandli/daily-digest/issues/97)) ([f9f3e5b](https://github.com/gandli/daily-digest/commit/f9f3e5bc837afe839b18235d63dd2d3e259d6c91))
* **/product:** 空正文条目拉 url 正文 → CF summarize 中文摘要(分批2防子请求爆); 无url/失败回退标题翻译 ([#98](https://github.com/gandli/daily-digest/issues/98)) ([2f31fc1](https://github.com/gandli/daily-digest/commit/2f31fc1905f719f4cbfb8c98ef13f50d2089fd6a))
* **/trending:** 每 repo 消息底部加存档三链(Telegraph·Wayback·GitHub md); renderMessage 加 archiveRepo 参数 ([#86](https://github.com/gandli/daily-digest/issues/86)) ([dd76788](https://github.com/gandli/daily-digest/commit/dd76788d143c7ecf96369fc999783f947266887d))
* 每日低速增量补星标仓缺/未译描述 — backfillDescriptions(cron, 每天40条, deepwiki→译中→lookup:desc); /search 渲染优先取 lookup:desc 覆盖 ([#80](https://github.com/gandli/daily-digest/issues/80)) ([1f22f77](https://github.com/gandli/daily-digest/commit/1f22f778f9c8ad99d2b8cacd8cbbb93ffec7d9d5))
# [](https://github.com/gandli/daily-digest/compare/v0.0.1...v) (2026-08-26)


### Bug Fixes

* **/product 10条:** HN 源改 Algolia search_by_date tags=story,show_hn——一次拿当日 Show HN 新品, 替代逐条扫 topstories(前60可能0条, 凑不满10) ([#95](https://github.com/gandli/daily-digest/issues/95)) ([3f9340a](https://github.com/gandli/daily-digest/commit/3f9340a4411b74820a544a49a4578a2f3b5f2fbc))
* extractRepo 剥离 .git 克隆后缀——修复 https://github.com/apple/container.git 误判为 apple/container.git 的 404 bug ([#90](https://github.com/gandli/daily-digest/issues/90)) ([014296d](https://github.com/gandli/daily-digest/commit/014296d2f03d8b6dd8cdcd9e9058c68372b2eb60))
* repo 联动分批串行(3/批)全量解析 + 主卡不阻塞——串行单waitUntil超时截断后半repo, 并发超50子请求, 分批折中保全部 ([#92](https://github.com/gandli/daily-digest/issues/92)) ([a03e301](https://github.com/gandli/daily-digest/commit/a03e301969c0b7768c7e57fc642c4c609368f68e))
* X/网页内容 repo 联动全量解析(去 3 条上限→10); 顺序 await 防 50 子请求爆——修复 X 帖只解析部分 repo ([#91](https://github.com/gandli/daily-digest/issues/91)) ([35f9f93](https://github.com/gandli/daily-digest/commit/35f9f93e1077bb05a23e45b75660111ed63e73a9))
* **存档三链:** 去 📎 双 emoji 前缀 + 互联网档案馆→Wayback 短名——三链行精简 ([#84](https://github.com/gandli/daily-digest/issues/84)) ([3e33454](https://github.com/gandli/daily-digest/commit/3e33454c2f7782b4c26372c64095ac494a7d8d56))


### Features

* **/archive 排版:** 每条多行结构化(标题/📝摘要/🏷标签/📎三链); archive:idx 存 topics 供标签; replyArchived 同款加标签 ([#83](https://github.com/gandli/daily-digest/issues/83)) ([e89a46a](https://github.com/gandli/daily-digest/commit/e89a46a86a154a02188bd7a852309e258d1c7c48))
* /archive 项目间空行间隔; 存档三链第三项统一 'Archive'(原'GitHub md'); /product(HN酷产品)每条补三链——所有项目/帖子/网页都有三链 ([#88](https://github.com/gandli/daily-digest/issues/88)) ([d0d5716](https://github.com/gandli/daily-digest/commit/d0d5716c12b090d154b61601719cb7cb1bb9b9b2))
* **/archive:** 每条标题指向原链接(https://github.com/repo); replyArchived 标题同款 ([#89](https://github.com/gandli/daily-digest/issues/89)) ([2d63284](https://github.com/gandli/daily-digest/commit/2d63284a2de91a3aaa74c287390f5fa880d43f95))
* **/help:** 排版分组优化——命令/链接分区 + <b>加粗标题 + 空行间隔, 更易读 ([#85](https://github.com/gandli/daily-digest/issues/85)) ([0db75dc](https://github.com/gandli/daily-digest/commit/0db75dca73e49a3ff6f0debac953a1b13abfa292))
* /product 命令 — HN 新产品/开源项目源, 仿 trending 独立推送/缓存/存档, 不与 digest 合并; CF Summarization 中文摘要; cron 每日推送 ([#82](https://github.com/gandli/daily-digest/issues/82)) ([93414b5](https://github.com/gandli/daily-digest/commit/93414b5371d092e660b811e1381a4e67eda6dcd7))
* **/product:** HN 源扫描范围 30→60 个 top 凑满 10 条(Show HN/GitHub 在 top 占比不高, 30 常不足 10) ([#94](https://github.com/gandli/daily-digest/issues/94)) ([8235fe6](https://github.com/gandli/daily-digest/commit/8235fe663f2ae74b85589f70286a77725c8e1594))
* **/product:** 每条补中文描述(标题翻译) + 领域标签(topicsFromTitle) + 渲染📝描述/标签——修复 HN 条目无描述/翻译/摘要/标签 ([#97](https://github.com/gandli/daily-digest/issues/97)) ([f9f3e5b](https://github.com/gandli/daily-digest/commit/f9f3e5bc837afe839b18235d63dd2d3e259d6c91))
* **/trending:** 每 repo 消息底部加存档三链(Telegraph·Wayback·GitHub md); renderMessage 加 archiveRepo 参数 ([#86](https://github.com/gandli/daily-digest/issues/86)) ([dd76788](https://github.com/gandli/daily-digest/commit/dd76788d143c7ecf96369fc999783f947266887d))
* 每日低速增量补星标仓缺/未译描述 — backfillDescriptions(cron, 每天40条, deepwiki→译中→lookup:desc); /search 渲染优先取 lookup:desc 覆盖 ([#80](https://github.com/gandli/daily-digest/issues/80)) ([1f22f77](https://github.com/gandli/daily-digest/commit/1f22f778f9c8ad99d2b8cacd8cbbb93ffec7d9d5))
# [](https://github.com/gandli/daily-digest/compare/v0.0.1...v) (2026-08-26)


### Bug Fixes

* **/product 10条:** HN 源改 Algolia search_by_date tags=story,show_hn——一次拿当日 Show HN 新品, 替代逐条扫 topstories(前60可能0条, 凑不满10) ([#95](https://github.com/gandli/daily-digest/issues/95)) ([3f9340a](https://github.com/gandli/daily-digest/commit/3f9340a4411b74820a544a49a4578a2f3b5f2fbc))
* extractRepo 剥离 .git 克隆后缀——修复 https://github.com/apple/container.git 误判为 apple/container.git 的 404 bug ([#90](https://github.com/gandli/daily-digest/issues/90)) ([014296d](https://github.com/gandli/daily-digest/commit/014296d2f03d8b6dd8cdcd9e9058c68372b2eb60))
* repo 联动分批串行(3/批)全量解析 + 主卡不阻塞——串行单waitUntil超时截断后半repo, 并发超50子请求, 分批折中保全部 ([#92](https://github.com/gandli/daily-digest/issues/92)) ([a03e301](https://github.com/gandli/daily-digest/commit/a03e301969c0b7768c7e57fc642c4c609368f68e))
* X/网页内容 repo 联动全量解析(去 3 条上限→10); 顺序 await 防 50 子请求爆——修复 X 帖只解析部分 repo ([#91](https://github.com/gandli/daily-digest/issues/91)) ([35f9f93](https://github.com/gandli/daily-digest/commit/35f9f93e1077bb05a23e45b75660111ed63e73a9))
* **存档三链:** 去 📎 双 emoji 前缀 + 互联网档案馆→Wayback 短名——三链行精简 ([#84](https://github.com/gandli/daily-digest/issues/84)) ([3e33454](https://github.com/gandli/daily-digest/commit/3e33454c2f7782b4c26372c64095ac494a7d8d56))


### Features

* **/archive 排版:** 每条多行结构化(标题/📝摘要/🏷标签/📎三链); archive:idx 存 topics 供标签; replyArchived 同款加标签 ([#83](https://github.com/gandli/daily-digest/issues/83)) ([e89a46a](https://github.com/gandli/daily-digest/commit/e89a46a86a154a02188bd7a852309e258d1c7c48))
* /archive 项目间空行间隔; 存档三链第三项统一 'Archive'(原'GitHub md'); /product(HN酷产品)每条补三链——所有项目/帖子/网页都有三链 ([#88](https://github.com/gandli/daily-digest/issues/88)) ([d0d5716](https://github.com/gandli/daily-digest/commit/d0d5716c12b090d154b61601719cb7cb1bb9b9b2))
* **/archive:** 每条标题指向原链接(https://github.com/repo); replyArchived 标题同款 ([#89](https://github.com/gandli/daily-digest/issues/89)) ([2d63284](https://github.com/gandli/daily-digest/commit/2d63284a2de91a3aaa74c287390f5fa880d43f95))
* **/help:** 排版分组优化——命令/链接分区 + <b>加粗标题 + 空行间隔, 更易读 ([#85](https://github.com/gandli/daily-digest/issues/85)) ([0db75dc](https://github.com/gandli/daily-digest/commit/0db75dca73e49a3ff6f0debac953a1b13abfa292))
* /product 命令 — HN 新产品/开源项目源, 仿 trending 独立推送/缓存/存档, 不与 digest 合并; CF Summarization 中文摘要; cron 每日推送 ([#82](https://github.com/gandli/daily-digest/issues/82)) ([93414b5](https://github.com/gandli/daily-digest/commit/93414b5371d092e660b811e1381a4e67eda6dcd7))
* **/product:** HN 源扫描范围 30→60 个 top 凑满 10 条(Show HN/GitHub 在 top 占比不高, 30 常不足 10) ([#94](https://github.com/gandli/daily-digest/issues/94)) ([8235fe6](https://github.com/gandli/daily-digest/commit/8235fe663f2ae74b85589f70286a77725c8e1594))
* **/trending:** 每 repo 消息底部加存档三链(Telegraph·Wayback·GitHub md); renderMessage 加 archiveRepo 参数 ([#86](https://github.com/gandli/daily-digest/issues/86)) ([dd76788](https://github.com/gandli/daily-digest/commit/dd76788d143c7ecf96369fc999783f947266887d))
* 每日低速增量补星标仓缺/未译描述 — backfillDescriptions(cron, 每天40条, deepwiki→译中→lookup:desc); /search 渲染优先取 lookup:desc 覆盖 ([#80](https://github.com/gandli/daily-digest/issues/80)) ([1f22f77](https://github.com/gandli/daily-digest/commit/1f22f778f9c8ad99d2b8cacd8cbbb93ffec7d9d5))
# [](https://github.com/gandli/daily-digest/compare/v0.0.1...v) (2026-08-26)


### Bug Fixes

* **/product 10条:** HN 源改 Algolia search_by_date tags=story,show_hn——一次拿当日 Show HN 新品, 替代逐条扫 topstories(前60可能0条, 凑不满10) ([#95](https://github.com/gandli/daily-digest/issues/95)) ([3f9340a](https://github.com/gandli/daily-digest/commit/3f9340a4411b74820a544a49a4578a2f3b5f2fbc))
* extractRepo 剥离 .git 克隆后缀——修复 https://github.com/apple/container.git 误判为 apple/container.git 的 404 bug ([#90](https://github.com/gandli/daily-digest/issues/90)) ([014296d](https://github.com/gandli/daily-digest/commit/014296d2f03d8b6dd8cdcd9e9058c68372b2eb60))
* repo 联动分批串行(3/批)全量解析 + 主卡不阻塞——串行单waitUntil超时截断后半repo, 并发超50子请求, 分批折中保全部 ([#92](https://github.com/gandli/daily-digest/issues/92)) ([a03e301](https://github.com/gandli/daily-digest/commit/a03e301969c0b7768c7e57fc642c4c609368f68e))
* X/网页内容 repo 联动全量解析(去 3 条上限→10); 顺序 await 防 50 子请求爆——修复 X 帖只解析部分 repo ([#91](https://github.com/gandli/daily-digest/issues/91)) ([35f9f93](https://github.com/gandli/daily-digest/commit/35f9f93e1077bb05a23e45b75660111ed63e73a9))
* **存档三链:** 去 📎 双 emoji 前缀 + 互联网档案馆→Wayback 短名——三链行精简 ([#84](https://github.com/gandli/daily-digest/issues/84)) ([3e33454](https://github.com/gandli/daily-digest/commit/3e33454c2f7782b4c26372c64095ac494a7d8d56))


### Features

* **/archive 排版:** 每条多行结构化(标题/📝摘要/🏷标签/📎三链); archive:idx 存 topics 供标签; replyArchived 同款加标签 ([#83](https://github.com/gandli/daily-digest/issues/83)) ([e89a46a](https://github.com/gandli/daily-digest/commit/e89a46a86a154a02188bd7a852309e258d1c7c48))
* /archive 项目间空行间隔; 存档三链第三项统一 'Archive'(原'GitHub md'); /product(HN酷产品)每条补三链——所有项目/帖子/网页都有三链 ([#88](https://github.com/gandli/daily-digest/issues/88)) ([d0d5716](https://github.com/gandli/daily-digest/commit/d0d5716c12b090d154b61601719cb7cb1bb9b9b2))
* **/archive:** 每条标题指向原链接(https://github.com/repo); replyArchived 标题同款 ([#89](https://github.com/gandli/daily-digest/issues/89)) ([2d63284](https://github.com/gandli/daily-digest/commit/2d63284a2de91a3aaa74c287390f5fa880d43f95))
* **/help:** 排版分组优化——命令/链接分区 + <b>加粗标题 + 空行间隔, 更易读 ([#85](https://github.com/gandli/daily-digest/issues/85)) ([0db75dc](https://github.com/gandli/daily-digest/commit/0db75dca73e49a3ff6f0debac953a1b13abfa292))
* /product 命令 — HN 新产品/开源项目源, 仿 trending 独立推送/缓存/存档, 不与 digest 合并; CF Summarization 中文摘要; cron 每日推送 ([#82](https://github.com/gandli/daily-digest/issues/82)) ([93414b5](https://github.com/gandli/daily-digest/commit/93414b5371d092e660b811e1381a4e67eda6dcd7))
* **/product:** HN 源扫描范围 30→60 个 top 凑满 10 条(Show HN/GitHub 在 top 占比不高, 30 常不足 10) ([#94](https://github.com/gandli/daily-digest/issues/94)) ([8235fe6](https://github.com/gandli/daily-digest/commit/8235fe663f2ae74b85589f70286a77725c8e1594))
* **/trending:** 每 repo 消息底部加存档三链(Telegraph·Wayback·GitHub md); renderMessage 加 archiveRepo 参数 ([#86](https://github.com/gandli/daily-digest/issues/86)) ([dd76788](https://github.com/gandli/daily-digest/commit/dd76788d143c7ecf96369fc999783f947266887d))
* 每日低速增量补星标仓缺/未译描述 — backfillDescriptions(cron, 每天40条, deepwiki→译中→lookup:desc); /search 渲染优先取 lookup:desc 覆盖 ([#80](https://github.com/gandli/daily-digest/issues/80)) ([1f22f77](https://github.com/gandli/daily-digest/commit/1f22f778f9c8ad99d2b8cacd8cbbb93ffec7d9d5))
# [](https://github.com/gandli/daily-digest/compare/v0.0.1...v) (2026-08-26)


### Bug Fixes

* extractRepo 剥离 .git 克隆后缀——修复 https://github.com/apple/container.git 误判为 apple/container.git 的 404 bug ([#90](https://github.com/gandli/daily-digest/issues/90)) ([014296d](https://github.com/gandli/daily-digest/commit/014296d2f03d8b6dd8cdcd9e9058c68372b2eb60))
* repo 联动分批串行(3/批)全量解析 + 主卡不阻塞——串行单waitUntil超时截断后半repo, 并发超50子请求, 分批折中保全部 ([#92](https://github.com/gandli/daily-digest/issues/92)) ([a03e301](https://github.com/gandli/daily-digest/commit/a03e301969c0b7768c7e57fc642c4c609368f68e))
* X/网页内容 repo 联动全量解析(去 3 条上限→10); 顺序 await 防 50 子请求爆——修复 X 帖只解析部分 repo ([#91](https://github.com/gandli/daily-digest/issues/91)) ([35f9f93](https://github.com/gandli/daily-digest/commit/35f9f93e1077bb05a23e45b75660111ed63e73a9))
* **存档三链:** 去 📎 双 emoji 前缀 + 互联网档案馆→Wayback 短名——三链行精简 ([#84](https://github.com/gandli/daily-digest/issues/84)) ([3e33454](https://github.com/gandli/daily-digest/commit/3e33454c2f7782b4c26372c64095ac494a7d8d56))


### Features

* **/archive 排版:** 每条多行结构化(标题/📝摘要/🏷标签/📎三链); archive:idx 存 topics 供标签; replyArchived 同款加标签 ([#83](https://github.com/gandli/daily-digest/issues/83)) ([e89a46a](https://github.com/gandli/daily-digest/commit/e89a46a86a154a02188bd7a852309e258d1c7c48))
* /archive 项目间空行间隔; 存档三链第三项统一 'Archive'(原'GitHub md'); /product(HN酷产品)每条补三链——所有项目/帖子/网页都有三链 ([#88](https://github.com/gandli/daily-digest/issues/88)) ([d0d5716](https://github.com/gandli/daily-digest/commit/d0d5716c12b090d154b61601719cb7cb1bb9b9b2))
* **/archive:** 每条标题指向原链接(https://github.com/repo); replyArchived 标题同款 ([#89](https://github.com/gandli/daily-digest/issues/89)) ([2d63284](https://github.com/gandli/daily-digest/commit/2d63284a2de91a3aaa74c287390f5fa880d43f95))
* **/help:** 排版分组优化——命令/链接分区 + <b>加粗标题 + 空行间隔, 更易读 ([#85](https://github.com/gandli/daily-digest/issues/85)) ([0db75dc](https://github.com/gandli/daily-digest/commit/0db75dca73e49a3ff6f0debac953a1b13abfa292))
* /product 命令 — HN 新产品/开源项目源, 仿 trending 独立推送/缓存/存档, 不与 digest 合并; CF Summarization 中文摘要; cron 每日推送 ([#82](https://github.com/gandli/daily-digest/issues/82)) ([93414b5](https://github.com/gandli/daily-digest/commit/93414b5371d092e660b811e1381a4e67eda6dcd7))
* **/product:** HN 源扫描范围 30→60 个 top 凑满 10 条(Show HN/GitHub 在 top 占比不高, 30 常不足 10) ([#94](https://github.com/gandli/daily-digest/issues/94)) ([8235fe6](https://github.com/gandli/daily-digest/commit/8235fe663f2ae74b85589f70286a77725c8e1594))
* **/trending:** 每 repo 消息底部加存档三链(Telegraph·Wayback·GitHub md); renderMessage 加 archiveRepo 参数 ([#86](https://github.com/gandli/daily-digest/issues/86)) ([dd76788](https://github.com/gandli/daily-digest/commit/dd76788d143c7ecf96369fc999783f947266887d))
* 每日低速增量补星标仓缺/未译描述 — backfillDescriptions(cron, 每天40条, deepwiki→译中→lookup:desc); /search 渲染优先取 lookup:desc 覆盖 ([#80](https://github.com/gandli/daily-digest/issues/80)) ([1f22f77](https://github.com/gandli/daily-digest/commit/1f22f778f9c8ad99d2b8cacd8cbbb93ffec7d9d5))
# [](https://github.com/gandli/daily-digest/compare/v0.0.1...v) (2026-08-26)


### Bug Fixes

* extractRepo 剥离 .git 克隆后缀——修复 https://github.com/apple/container.git 误判为 apple/container.git 的 404 bug ([#90](https://github.com/gandli/daily-digest/issues/90)) ([014296d](https://github.com/gandli/daily-digest/commit/014296d2f03d8b6dd8cdcd9e9058c68372b2eb60))
* repo 联动分批串行(3/批)全量解析 + 主卡不阻塞——串行单waitUntil超时截断后半repo, 并发超50子请求, 分批折中保全部 ([#92](https://github.com/gandli/daily-digest/issues/92)) ([a03e301](https://github.com/gandli/daily-digest/commit/a03e301969c0b7768c7e57fc642c4c609368f68e))
* X/网页内容 repo 联动全量解析(去 3 条上限→10); 顺序 await 防 50 子请求爆——修复 X 帖只解析部分 repo ([#91](https://github.com/gandli/daily-digest/issues/91)) ([35f9f93](https://github.com/gandli/daily-digest/commit/35f9f93e1077bb05a23e45b75660111ed63e73a9))
* **存档三链:** 去 📎 双 emoji 前缀 + 互联网档案馆→Wayback 短名——三链行精简 ([#84](https://github.com/gandli/daily-digest/issues/84)) ([3e33454](https://github.com/gandli/daily-digest/commit/3e33454c2f7782b4c26372c64095ac494a7d8d56))


### Features

* **/archive 排版:** 每条多行结构化(标题/📝摘要/🏷标签/📎三链); archive:idx 存 topics 供标签; replyArchived 同款加标签 ([#83](https://github.com/gandli/daily-digest/issues/83)) ([e89a46a](https://github.com/gandli/daily-digest/commit/e89a46a86a154a02188bd7a852309e258d1c7c48))
* /archive 项目间空行间隔; 存档三链第三项统一 'Archive'(原'GitHub md'); /product(HN酷产品)每条补三链——所有项目/帖子/网页都有三链 ([#88](https://github.com/gandli/daily-digest/issues/88)) ([d0d5716](https://github.com/gandli/daily-digest/commit/d0d5716c12b090d154b61601719cb7cb1bb9b9b2))
* **/archive:** 每条标题指向原链接(https://github.com/repo); replyArchived 标题同款 ([#89](https://github.com/gandli/daily-digest/issues/89)) ([2d63284](https://github.com/gandli/daily-digest/commit/2d63284a2de91a3aaa74c287390f5fa880d43f95))
* **/help:** 排版分组优化——命令/链接分区 + <b>加粗标题 + 空行间隔, 更易读 ([#85](https://github.com/gandli/daily-digest/issues/85)) ([0db75dc](https://github.com/gandli/daily-digest/commit/0db75dca73e49a3ff6f0debac953a1b13abfa292))
* /product 命令 — HN 新产品/开源项目源, 仿 trending 独立推送/缓存/存档, 不与 digest 合并; CF Summarization 中文摘要; cron 每日推送 ([#82](https://github.com/gandli/daily-digest/issues/82)) ([93414b5](https://github.com/gandli/daily-digest/commit/93414b5371d092e660b811e1381a4e67eda6dcd7))
* **/trending:** 每 repo 消息底部加存档三链(Telegraph·Wayback·GitHub md); renderMessage 加 archiveRepo 参数 ([#86](https://github.com/gandli/daily-digest/issues/86)) ([dd76788](https://github.com/gandli/daily-digest/commit/dd76788d143c7ecf96369fc999783f947266887d))
* 每日低速增量补星标仓缺/未译描述 — backfillDescriptions(cron, 每天40条, deepwiki→译中→lookup:desc); /search 渲染优先取 lookup:desc 覆盖 ([#80](https://github.com/gandli/daily-digest/issues/80)) ([1f22f77](https://github.com/gandli/daily-digest/commit/1f22f778f9c8ad99d2b8cacd8cbbb93ffec7d9d5))
# [](https://github.com/gandli/daily-digest/compare/v0.0.1...v) (2026-08-26)


### Bug Fixes

* extractRepo 剥离 .git 克隆后缀——修复 https://github.com/apple/container.git 误判为 apple/container.git 的 404 bug ([#90](https://github.com/gandli/daily-digest/issues/90)) ([014296d](https://github.com/gandli/daily-digest/commit/014296d2f03d8b6dd8cdcd9e9058c68372b2eb60))
* repo 联动分批串行(3/批)全量解析 + 主卡不阻塞——串行单waitUntil超时截断后半repo, 并发超50子请求, 分批折中保全部 ([#92](https://github.com/gandli/daily-digest/issues/92)) ([a03e301](https://github.com/gandli/daily-digest/commit/a03e301969c0b7768c7e57fc642c4c609368f68e))
* X/网页内容 repo 联动全量解析(去 3 条上限→10); 顺序 await 防 50 子请求爆——修复 X 帖只解析部分 repo ([#91](https://github.com/gandli/daily-digest/issues/91)) ([35f9f93](https://github.com/gandli/daily-digest/commit/35f9f93e1077bb05a23e45b75660111ed63e73a9))
* **存档三链:** 去 📎 双 emoji 前缀 + 互联网档案馆→Wayback 短名——三链行精简 ([#84](https://github.com/gandli/daily-digest/issues/84)) ([3e33454](https://github.com/gandli/daily-digest/commit/3e33454c2f7782b4c26372c64095ac494a7d8d56))


### Features

* **/archive 排版:** 每条多行结构化(标题/📝摘要/🏷标签/📎三链); archive:idx 存 topics 供标签; replyArchived 同款加标签 ([#83](https://github.com/gandli/daily-digest/issues/83)) ([e89a46a](https://github.com/gandli/daily-digest/commit/e89a46a86a154a02188bd7a852309e258d1c7c48))
* /archive 项目间空行间隔; 存档三链第三项统一 'Archive'(原'GitHub md'); /product(HN酷产品)每条补三链——所有项目/帖子/网页都有三链 ([#88](https://github.com/gandli/daily-digest/issues/88)) ([d0d5716](https://github.com/gandli/daily-digest/commit/d0d5716c12b090d154b61601719cb7cb1bb9b9b2))
* **/archive:** 每条标题指向原链接(https://github.com/repo); replyArchived 标题同款 ([#89](https://github.com/gandli/daily-digest/issues/89)) ([2d63284](https://github.com/gandli/daily-digest/commit/2d63284a2de91a3aaa74c287390f5fa880d43f95))
* **/help:** 排版分组优化——命令/链接分区 + <b>加粗标题 + 空行间隔, 更易读 ([#85](https://github.com/gandli/daily-digest/issues/85)) ([0db75dc](https://github.com/gandli/daily-digest/commit/0db75dca73e49a3ff6f0debac953a1b13abfa292))
* /product 命令 — HN 新产品/开源项目源, 仿 trending 独立推送/缓存/存档, 不与 digest 合并; CF Summarization 中文摘要; cron 每日推送 ([#82](https://github.com/gandli/daily-digest/issues/82)) ([93414b5](https://github.com/gandli/daily-digest/commit/93414b5371d092e660b811e1381a4e67eda6dcd7))
* **/trending:** 每 repo 消息底部加存档三链(Telegraph·Wayback·GitHub md); renderMessage 加 archiveRepo 参数 ([#86](https://github.com/gandli/daily-digest/issues/86)) ([dd76788](https://github.com/gandli/daily-digest/commit/dd76788d143c7ecf96369fc999783f947266887d))
* 每日低速增量补星标仓缺/未译描述 — backfillDescriptions(cron, 每天40条, deepwiki→译中→lookup:desc); /search 渲染优先取 lookup:desc 覆盖 ([#80](https://github.com/gandli/daily-digest/issues/80)) ([1f22f77](https://github.com/gandli/daily-digest/commit/1f22f778f9c8ad99d2b8cacd8cbbb93ffec7d9d5))
# [](https://github.com/gandli/daily-digest/compare/v0.0.1...v) (2026-08-26)


### Bug Fixes

* extractRepo 剥离 .git 克隆后缀——修复 https://github.com/apple/container.git 误判为 apple/container.git 的 404 bug ([#90](https://github.com/gandli/daily-digest/issues/90)) ([014296d](https://github.com/gandli/daily-digest/commit/014296d2f03d8b6dd8cdcd9e9058c68372b2eb60))
* X/网页内容 repo 联动全量解析(去 3 条上限→10); 顺序 await 防 50 子请求爆——修复 X 帖只解析部分 repo ([#91](https://github.com/gandli/daily-digest/issues/91)) ([35f9f93](https://github.com/gandli/daily-digest/commit/35f9f93e1077bb05a23e45b75660111ed63e73a9))
* **存档三链:** 去 📎 双 emoji 前缀 + 互联网档案馆→Wayback 短名——三链行精简 ([#84](https://github.com/gandli/daily-digest/issues/84)) ([3e33454](https://github.com/gandli/daily-digest/commit/3e33454c2f7782b4c26372c64095ac494a7d8d56))


### Features

* **/archive 排版:** 每条多行结构化(标题/📝摘要/🏷标签/📎三链); archive:idx 存 topics 供标签; replyArchived 同款加标签 ([#83](https://github.com/gandli/daily-digest/issues/83)) ([e89a46a](https://github.com/gandli/daily-digest/commit/e89a46a86a154a02188bd7a852309e258d1c7c48))
* /archive 项目间空行间隔; 存档三链第三项统一 'Archive'(原'GitHub md'); /product(HN酷产品)每条补三链——所有项目/帖子/网页都有三链 ([#88](https://github.com/gandli/daily-digest/issues/88)) ([d0d5716](https://github.com/gandli/daily-digest/commit/d0d5716c12b090d154b61601719cb7cb1bb9b9b2))
* **/archive:** 每条标题指向原链接(https://github.com/repo); replyArchived 标题同款 ([#89](https://github.com/gandli/daily-digest/issues/89)) ([2d63284](https://github.com/gandli/daily-digest/commit/2d63284a2de91a3aaa74c287390f5fa880d43f95))
* **/help:** 排版分组优化——命令/链接分区 + <b>加粗标题 + 空行间隔, 更易读 ([#85](https://github.com/gandli/daily-digest/issues/85)) ([0db75dc](https://github.com/gandli/daily-digest/commit/0db75dca73e49a3ff6f0debac953a1b13abfa292))
* /product 命令 — HN 新产品/开源项目源, 仿 trending 独立推送/缓存/存档, 不与 digest 合并; CF Summarization 中文摘要; cron 每日推送 ([#82](https://github.com/gandli/daily-digest/issues/82)) ([93414b5](https://github.com/gandli/daily-digest/commit/93414b5371d092e660b811e1381a4e67eda6dcd7))
* **/trending:** 每 repo 消息底部加存档三链(Telegraph·Wayback·GitHub md); renderMessage 加 archiveRepo 参数 ([#86](https://github.com/gandli/daily-digest/issues/86)) ([dd76788](https://github.com/gandli/daily-digest/commit/dd76788d143c7ecf96369fc999783f947266887d))
* 每日低速增量补星标仓缺/未译描述 — backfillDescriptions(cron, 每天40条, deepwiki→译中→lookup:desc); /search 渲染优先取 lookup:desc 覆盖 ([#80](https://github.com/gandli/daily-digest/issues/80)) ([1f22f77](https://github.com/gandli/daily-digest/commit/1f22f778f9c8ad99d2b8cacd8cbbb93ffec7d9d5))
# [](https://github.com/gandli/daily-digest/compare/v0.0.1...v) (2026-08-26)


### Bug Fixes

* extractRepo 剥离 .git 克隆后缀——修复 https://github.com/apple/container.git 误判为 apple/container.git 的 404 bug ([#90](https://github.com/gandli/daily-digest/issues/90)) ([014296d](https://github.com/gandli/daily-digest/commit/014296d2f03d8b6dd8cdcd9e9058c68372b2eb60))
* **存档三链:** 去 📎 双 emoji 前缀 + 互联网档案馆→Wayback 短名——三链行精简 ([#84](https://github.com/gandli/daily-digest/issues/84)) ([3e33454](https://github.com/gandli/daily-digest/commit/3e33454c2f7782b4c26372c64095ac494a7d8d56))


### Features

* **/archive 排版:** 每条多行结构化(标题/📝摘要/🏷标签/📎三链); archive:idx 存 topics 供标签; replyArchived 同款加标签 ([#83](https://github.com/gandli/daily-digest/issues/83)) ([e89a46a](https://github.com/gandli/daily-digest/commit/e89a46a86a154a02188bd7a852309e258d1c7c48))
* /archive 项目间空行间隔; 存档三链第三项统一 'Archive'(原'GitHub md'); /product(HN酷产品)每条补三链——所有项目/帖子/网页都有三链 ([#88](https://github.com/gandli/daily-digest/issues/88)) ([d0d5716](https://github.com/gandli/daily-digest/commit/d0d5716c12b090d154b61601719cb7cb1bb9b9b2))
* **/archive:** 每条标题指向原链接(https://github.com/repo); replyArchived 标题同款 ([#89](https://github.com/gandli/daily-digest/issues/89)) ([2d63284](https://github.com/gandli/daily-digest/commit/2d63284a2de91a3aaa74c287390f5fa880d43f95))
* **/help:** 排版分组优化——命令/链接分区 + <b>加粗标题 + 空行间隔, 更易读 ([#85](https://github.com/gandli/daily-digest/issues/85)) ([0db75dc](https://github.com/gandli/daily-digest/commit/0db75dca73e49a3ff6f0debac953a1b13abfa292))
* /product 命令 — HN 新产品/开源项目源, 仿 trending 独立推送/缓存/存档, 不与 digest 合并; CF Summarization 中文摘要; cron 每日推送 ([#82](https://github.com/gandli/daily-digest/issues/82)) ([93414b5](https://github.com/gandli/daily-digest/commit/93414b5371d092e660b811e1381a4e67eda6dcd7))
* **/trending:** 每 repo 消息底部加存档三链(Telegraph·Wayback·GitHub md); renderMessage 加 archiveRepo 参数 ([#86](https://github.com/gandli/daily-digest/issues/86)) ([dd76788](https://github.com/gandli/daily-digest/commit/dd76788d143c7ecf96369fc999783f947266887d))
* 每日低速增量补星标仓缺/未译描述 — backfillDescriptions(cron, 每天40条, deepwiki→译中→lookup:desc); /search 渲染优先取 lookup:desc 覆盖 ([#80](https://github.com/gandli/daily-digest/issues/80)) ([1f22f77](https://github.com/gandli/daily-digest/commit/1f22f778f9c8ad99d2b8cacd8cbbb93ffec7d9d5))
# [](https://github.com/gandli/daily-digest/compare/v0.0.1...v) (2026-08-26)


### Bug Fixes

* **存档三链:** 去 📎 双 emoji 前缀 + 互联网档案馆→Wayback 短名——三链行精简 ([#84](https://github.com/gandli/daily-digest/issues/84)) ([3e33454](https://github.com/gandli/daily-digest/commit/3e33454c2f7782b4c26372c64095ac494a7d8d56))


### Features

* **/archive 排版:** 每条多行结构化(标题/📝摘要/🏷标签/📎三链); archive:idx 存 topics 供标签; replyArchived 同款加标签 ([#83](https://github.com/gandli/daily-digest/issues/83)) ([e89a46a](https://github.com/gandli/daily-digest/commit/e89a46a86a154a02188bd7a852309e258d1c7c48))
* /archive 项目间空行间隔; 存档三链第三项统一 'Archive'(原'GitHub md'); /product(HN酷产品)每条补三链——所有项目/帖子/网页都有三链 ([#88](https://github.com/gandli/daily-digest/issues/88)) ([d0d5716](https://github.com/gandli/daily-digest/commit/d0d5716c12b090d154b61601719cb7cb1bb9b9b2))
* **/archive:** 每条标题指向原链接(https://github.com/repo); replyArchived 标题同款 ([#89](https://github.com/gandli/daily-digest/issues/89)) ([2d63284](https://github.com/gandli/daily-digest/commit/2d63284a2de91a3aaa74c287390f5fa880d43f95))
* **/help:** 排版分组优化——命令/链接分区 + <b>加粗标题 + 空行间隔, 更易读 ([#85](https://github.com/gandli/daily-digest/issues/85)) ([0db75dc](https://github.com/gandli/daily-digest/commit/0db75dca73e49a3ff6f0debac953a1b13abfa292))
* /product 命令 — HN 新产品/开源项目源, 仿 trending 独立推送/缓存/存档, 不与 digest 合并; CF Summarization 中文摘要; cron 每日推送 ([#82](https://github.com/gandli/daily-digest/issues/82)) ([93414b5](https://github.com/gandli/daily-digest/commit/93414b5371d092e660b811e1381a4e67eda6dcd7))
* **/trending:** 每 repo 消息底部加存档三链(Telegraph·Wayback·GitHub md); renderMessage 加 archiveRepo 参数 ([#86](https://github.com/gandli/daily-digest/issues/86)) ([dd76788](https://github.com/gandli/daily-digest/commit/dd76788d143c7ecf96369fc999783f947266887d))
* 每日低速增量补星标仓缺/未译描述 — backfillDescriptions(cron, 每天40条, deepwiki→译中→lookup:desc); /search 渲染优先取 lookup:desc 覆盖 ([#80](https://github.com/gandli/daily-digest/issues/80)) ([1f22f77](https://github.com/gandli/daily-digest/commit/1f22f778f9c8ad99d2b8cacd8cbbb93ffec7d9d5))
# [](https://github.com/gandli/daily-digest/compare/v0.0.1...v) (2026-08-26)


### Bug Fixes

* **存档三链:** 去 📎 双 emoji 前缀 + 互联网档案馆→Wayback 短名——三链行精简 ([#84](https://github.com/gandli/daily-digest/issues/84)) ([3e33454](https://github.com/gandli/daily-digest/commit/3e33454c2f7782b4c26372c64095ac494a7d8d56))


### Features

* **/archive 排版:** 每条多行结构化(标题/📝摘要/🏷标签/📎三链); archive:idx 存 topics 供标签; replyArchived 同款加标签 ([#83](https://github.com/gandli/daily-digest/issues/83)) ([e89a46a](https://github.com/gandli/daily-digest/commit/e89a46a86a154a02188bd7a852309e258d1c7c48))
* /archive 项目间空行间隔; 存档三链第三项统一 'Archive'(原'GitHub md'); /product(HN酷产品)每条补三链——所有项目/帖子/网页都有三链 ([#88](https://github.com/gandli/daily-digest/issues/88)) ([d0d5716](https://github.com/gandli/daily-digest/commit/d0d5716c12b090d154b61601719cb7cb1bb9b9b2))
* **/help:** 排版分组优化——命令/链接分区 + <b>加粗标题 + 空行间隔, 更易读 ([#85](https://github.com/gandli/daily-digest/issues/85)) ([0db75dc](https://github.com/gandli/daily-digest/commit/0db75dca73e49a3ff6f0debac953a1b13abfa292))
* /product 命令 — HN 新产品/开源项目源, 仿 trending 独立推送/缓存/存档, 不与 digest 合并; CF Summarization 中文摘要; cron 每日推送 ([#82](https://github.com/gandli/daily-digest/issues/82)) ([93414b5](https://github.com/gandli/daily-digest/commit/93414b5371d092e660b811e1381a4e67eda6dcd7))
* **/trending:** 每 repo 消息底部加存档三链(Telegraph·Wayback·GitHub md); renderMessage 加 archiveRepo 参数 ([#86](https://github.com/gandli/daily-digest/issues/86)) ([dd76788](https://github.com/gandli/daily-digest/commit/dd76788d143c7ecf96369fc999783f947266887d))
* 每日低速增量补星标仓缺/未译描述 — backfillDescriptions(cron, 每天40条, deepwiki→译中→lookup:desc); /search 渲染优先取 lookup:desc 覆盖 ([#80](https://github.com/gandli/daily-digest/issues/80)) ([1f22f77](https://github.com/gandli/daily-digest/commit/1f22f778f9c8ad99d2b8cacd8cbbb93ffec7d9d5))
# [](https://github.com/gandli/daily-digest/compare/v0.0.1...v) (2026-08-26)


### Bug Fixes

* **存档三链:** 去 📎 双 emoji 前缀 + 互联网档案馆→Wayback 短名——三链行精简 ([#84](https://github.com/gandli/daily-digest/issues/84)) ([3e33454](https://github.com/gandli/daily-digest/commit/3e33454c2f7782b4c26372c64095ac494a7d8d56))


### Features

* **/archive 排版:** 每条多行结构化(标题/📝摘要/🏷标签/📎三链); archive:idx 存 topics 供标签; replyArchived 同款加标签 ([#83](https://github.com/gandli/daily-digest/issues/83)) ([e89a46a](https://github.com/gandli/daily-digest/commit/e89a46a86a154a02188bd7a852309e258d1c7c48))
* **/help:** 排版分组优化——命令/链接分区 + <b>加粗标题 + 空行间隔, 更易读 ([#85](https://github.com/gandli/daily-digest/issues/85)) ([0db75dc](https://github.com/gandli/daily-digest/commit/0db75dca73e49a3ff6f0debac953a1b13abfa292))
* /product 命令 — HN 新产品/开源项目源, 仿 trending 独立推送/缓存/存档, 不与 digest 合并; CF Summarization 中文摘要; cron 每日推送 ([#82](https://github.com/gandli/daily-digest/issues/82)) ([93414b5](https://github.com/gandli/daily-digest/commit/93414b5371d092e660b811e1381a4e67eda6dcd7))
* **/trending:** 每 repo 消息底部加存档三链(Telegraph·Wayback·GitHub md); renderMessage 加 archiveRepo 参数 ([#86](https://github.com/gandli/daily-digest/issues/86)) ([dd76788](https://github.com/gandli/daily-digest/commit/dd76788d143c7ecf96369fc999783f947266887d))
* 每日低速增量补星标仓缺/未译描述 — backfillDescriptions(cron, 每天40条, deepwiki→译中→lookup:desc); /search 渲染优先取 lookup:desc 覆盖 ([#80](https://github.com/gandli/daily-digest/issues/80)) ([1f22f77](https://github.com/gandli/daily-digest/commit/1f22f778f9c8ad99d2b8cacd8cbbb93ffec7d9d5))
# [](https://github.com/gandli/daily-digest/compare/v0.0.1...v) (2026-08-26)


### Bug Fixes

* **存档三链:** 去 📎 双 emoji 前缀 + 互联网档案馆→Wayback 短名——三链行精简 ([#84](https://github.com/gandli/daily-digest/issues/84)) ([3e33454](https://github.com/gandli/daily-digest/commit/3e33454c2f7782b4c26372c64095ac494a7d8d56))


### Features

* **/archive 排版:** 每条多行结构化(标题/📝摘要/🏷标签/📎三链); archive:idx 存 topics 供标签; replyArchived 同款加标签 ([#83](https://github.com/gandli/daily-digest/issues/83)) ([e89a46a](https://github.com/gandli/daily-digest/commit/e89a46a86a154a02188bd7a852309e258d1c7c48))
* **/help:** 排版分组优化——命令/链接分区 + <b>加粗标题 + 空行间隔, 更易读 ([#85](https://github.com/gandli/daily-digest/issues/85)) ([0db75dc](https://github.com/gandli/daily-digest/commit/0db75dca73e49a3ff6f0debac953a1b13abfa292))
* /product 命令 — HN 新产品/开源项目源, 仿 trending 独立推送/缓存/存档, 不与 digest 合并; CF Summarization 中文摘要; cron 每日推送 ([#82](https://github.com/gandli/daily-digest/issues/82)) ([93414b5](https://github.com/gandli/daily-digest/commit/93414b5371d092e660b811e1381a4e67eda6dcd7))
* **/trending:** 每 repo 消息底部加存档三链(Telegraph·Wayback·GitHub md); renderMessage 加 archiveRepo 参数 ([#86](https://github.com/gandli/daily-digest/issues/86)) ([dd76788](https://github.com/gandli/daily-digest/commit/dd76788d143c7ecf96369fc999783f947266887d))
* 每日低速增量补星标仓缺/未译描述 — backfillDescriptions(cron, 每天40条, deepwiki→译中→lookup:desc); /search 渲染优先取 lookup:desc 覆盖 ([#80](https://github.com/gandli/daily-digest/issues/80)) ([1f22f77](https://github.com/gandli/daily-digest/commit/1f22f778f9c8ad99d2b8cacd8cbbb93ffec7d9d5))
# [](https://github.com/gandli/daily-digest/compare/v0.0.1...v) (2026-08-26)


### Bug Fixes

* **存档三链:** 去 📎 双 emoji 前缀 + 互联网档案馆→Wayback 短名——三链行精简 ([#84](https://github.com/gandli/daily-digest/issues/84)) ([3e33454](https://github.com/gandli/daily-digest/commit/3e33454c2f7782b4c26372c64095ac494a7d8d56))


### Features

* **/archive 排版:** 每条多行结构化(标题/📝摘要/🏷标签/📎三链); archive:idx 存 topics 供标签; replyArchived 同款加标签 ([#83](https://github.com/gandli/daily-digest/issues/83)) ([e89a46a](https://github.com/gandli/daily-digest/commit/e89a46a86a154a02188bd7a852309e258d1c7c48))
* **/help:** 排版分组优化——命令/链接分区 + <b>加粗标题 + 空行间隔, 更易读 ([#85](https://github.com/gandli/daily-digest/issues/85)) ([0db75dc](https://github.com/gandli/daily-digest/commit/0db75dca73e49a3ff6f0debac953a1b13abfa292))
* /product 命令 — HN 新产品/开源项目源, 仿 trending 独立推送/缓存/存档, 不与 digest 合并; CF Summarization 中文摘要; cron 每日推送 ([#82](https://github.com/gandli/daily-digest/issues/82)) ([93414b5](https://github.com/gandli/daily-digest/commit/93414b5371d092e660b811e1381a4e67eda6dcd7))
* 每日低速增量补星标仓缺/未译描述 — backfillDescriptions(cron, 每天40条, deepwiki→译中→lookup:desc); /search 渲染优先取 lookup:desc 覆盖 ([#80](https://github.com/gandli/daily-digest/issues/80)) ([1f22f77](https://github.com/gandli/daily-digest/commit/1f22f778f9c8ad99d2b8cacd8cbbb93ffec7d9d5))
# [](https://github.com/gandli/daily-digest/compare/v0.0.1...v) (2026-08-26)


### Bug Fixes

* **存档三链:** 去 📎 双 emoji 前缀 + 互联网档案馆→Wayback 短名——三链行精简 ([#84](https://github.com/gandli/daily-digest/issues/84)) ([3e33454](https://github.com/gandli/daily-digest/commit/3e33454c2f7782b4c26372c64095ac494a7d8d56))


### Features

* **/archive 排版:** 每条多行结构化(标题/📝摘要/🏷标签/📎三链); archive:idx 存 topics 供标签; replyArchived 同款加标签 ([#83](https://github.com/gandli/daily-digest/issues/83)) ([e89a46a](https://github.com/gandli/daily-digest/commit/e89a46a86a154a02188bd7a852309e258d1c7c48))
* /product 命令 — HN 新产品/开源项目源, 仿 trending 独立推送/缓存/存档, 不与 digest 合并; CF Summarization 中文摘要; cron 每日推送 ([#82](https://github.com/gandli/daily-digest/issues/82)) ([93414b5](https://github.com/gandli/daily-digest/commit/93414b5371d092e660b811e1381a4e67eda6dcd7))
* 每日低速增量补星标仓缺/未译描述 — backfillDescriptions(cron, 每天40条, deepwiki→译中→lookup:desc); /search 渲染优先取 lookup:desc 覆盖 ([#80](https://github.com/gandli/daily-digest/issues/80)) ([1f22f77](https://github.com/gandli/daily-digest/commit/1f22f778f9c8ad99d2b8cacd8cbbb93ffec7d9d5))
# [](https://github.com/gandli/daily-digest/compare/v0.0.1...v) (2026-08-26)


### Features

* **/archive 排版:** 每条多行结构化(标题/📝摘要/🏷标签/📎三链); archive:idx 存 topics 供标签; replyArchived 同款加标签 ([#83](https://github.com/gandli/daily-digest/issues/83)) ([e89a46a](https://github.com/gandli/daily-digest/commit/e89a46a86a154a02188bd7a852309e258d1c7c48))
* /product 命令 — HN 新产品/开源项目源, 仿 trending 独立推送/缓存/存档, 不与 digest 合并; CF Summarization 中文摘要; cron 每日推送 ([#82](https://github.com/gandli/daily-digest/issues/82)) ([93414b5](https://github.com/gandli/daily-digest/commit/93414b5371d092e660b811e1381a4e67eda6dcd7))
* 每日低速增量补星标仓缺/未译描述 — backfillDescriptions(cron, 每天40条, deepwiki→译中→lookup:desc); /search 渲染优先取 lookup:desc 覆盖 ([#80](https://github.com/gandli/daily-digest/issues/80)) ([1f22f77](https://github.com/gandli/daily-digest/commit/1f22f778f9c8ad99d2b8cacd8cbbb93ffec7d9d5))
# [](https://github.com/gandli/daily-digest/compare/v0.0.1...v) (2026-08-26)


### Features

* /product 命令 — HN 新产品/开源项目源, 仿 trending 独立推送/缓存/存档, 不与 digest 合并; CF Summarization 中文摘要; cron 每日推送 ([#82](https://github.com/gandli/daily-digest/issues/82)) ([93414b5](https://github.com/gandli/daily-digest/commit/93414b5371d092e660b811e1381a4e67eda6dcd7))
* 每日低速增量补星标仓缺/未译描述 — backfillDescriptions(cron, 每天40条, deepwiki→译中→lookup:desc); /search 渲染优先取 lookup:desc 覆盖 ([#80](https://github.com/gandli/daily-digest/issues/80)) ([1f22f77](https://github.com/gandli/daily-digest/commit/1f22f778f9c8ad99d2b8cacd8cbbb93ffec7d9d5))
# [](https://github.com/gandli/daily-digest/compare/v0.0.1...v) (2026-08-26)


### Features

* 每日低速增量补星标仓缺/未译描述 — backfillDescriptions(cron, 每天40条, deepwiki→译中→lookup:desc); /search 渲染优先取 lookup:desc 覆盖 ([#80](https://github.com/gandli/daily-digest/issues/80)) ([1f22f77](https://github.com/gandli/daily-digest/commit/1f22f778f9c8ad99d2b8cacd8cbbb93ffec7d9d5))
# [](https://github.com/gandli/daily-digest/compare/v0.0.1...v) (2026-08-26)


### Features

* 每日低速增量补星标仓缺/未译描述 — backfillDescriptions(cron, 每天40条, deepwiki→译中→lookup:desc); /search 渲染优先取 lookup:desc 覆盖 ([#80](https://github.com/gandli/daily-digest/issues/80)) ([1f22f77](https://github.com/gandli/daily-digest/commit/1f22f778f9c8ad99d2b8cacd8cbbb93ffec7d9d5))
# [](https://github.com/gandli/daily-digest/compare/v0.0.1...v) (2026-08-26)
# [](https://github.com/gandli/daily-digest/compare/v0.0.1...v) (2026-08-26)
#  (2026-08-26)


### Bug Fixes

* **/archive:** 翻页 callback 的 answerCallbackQuery 放 finally——中间抛错(重复点击 message not modified/KV 抖动)时答收回不到, 按钮永不消转圈 ([#55](https://github.com/gandli/daily-digest/issues/55)) ([11a8a40](https://github.com/gandli/daily-digest/commit/11a8a40bb5d0731c0ff3130647028305be7ee4ad))
* /help now replies with HELP content (was registering menu only) ([a104244](https://github.com/gandli/daily-digest/commit/a104244893d17e0eff57f21bc74836a204ce6ebe))
* **/lookup:** replyArchived 索引缺失时 re-lookup 归档返回存档信息, 不再回旧提示'已查询过'——保持用户硬性要求(已查过且归档失败的 repo 重发应得存档数据) ([#61](https://github.com/gandli/daily-digest/issues/61)) ([59c0053](https://github.com/gandli/daily-digest/commit/59c0053b8bc297ca4581bd900cc2e9eb4c04f32a))
* **/search /trending:** 修复命令无响应 + /archive 分页/Telegraph/年份支持 ([#53](https://github.com/gandli/daily-digest/issues/53)) ([5212406](https://github.com/gandli/daily-digest/commit/521240670a4ecab758b7a884ed5ef4f800c2c6e8))
* /search uses KV archive index (code search can't see non-default branches) ([#11](https://github.com/gandli/daily-digest/issues/11)) ([e9fdf93](https://github.com/gandli/daily-digest/commit/e9fdf93ded06f790104ab244940af5b6160bdfc9))
* /search 结果附描述行 ([#23](https://github.com/gandli/daily-digest/issues/23)) ([2de1852](https://github.com/gandli/daily-digest/commit/2de18526562b672296eb79d2c3efa6e63d0b1f92))
* **/search:** 翻页 query 存 KV(search:q:<token>) 而非塞 callback_data——callback_data 64B 上限致长 query 截断解码残缺, 翻页失效。token=query 确定哈希, 短且幂等 ([#59](https://github.com/gandli/daily-digest/issues/59)) ([91bde83](https://github.com/gandli/daily-digest/commit/91bde8311389c28dc33055e6efbf9c40e00eab1d))
* /trending forces full pipeline (useCache=false) so messages include OG images ([eb3ce72](https://github.com/gandli/daily-digest/commit/eb3ce726a885f865f02bf6199638910614929aa7))
* **/trending:** 去掉误加的 25s 描述链 deadline——它掐断 zread 链致 descZh 全空(消息无描述)+发送循环预算内终止(只发8条)。cron 同款链路已验证 10/10 全中文描述, 与 cron 一致跑完整链 ([#58](https://github.com/gandli/daily-digest/issues/58)) ([208288a](https://github.com/gandli/daily-digest/commit/208288ab7cbc7975cbc71fe9f71126787be48627))
* **/trending:** 自调 /run 被 CF 拦(Worker→自身 workers.dev 橙云 1003/1042)→改直调 runDigest, 描述链给 25s deadline, 超时省略描述照发 ([#57](https://github.com/gandli/daily-digest/issues/57)) ([4c4d168](https://github.com/gandli/daily-digest/commit/4c4d168c6ed28692f5b07cffe2a6bddb566e7fe4))
* 🌐中文翻译段从未发出——主卡片在翻译前已发, zhLine 计算后未拼进任何消息 ([#36](https://github.com/gandli/daily-digest/issues/36)) ([1892948](https://github.com/gandli/daily-digest/commit/18929482867faf3306d8bf0a45848bf025593d07))
* archive to dedicated 'archive' branch (readd branch param lost in merge churn); rm temp workflows, stray archive dir ([3e5a5c9](https://github.com/gandli/daily-digest/commit/3e5a5c92ee4afb829fc3ca9afe1122d8923c414f))
* **audit:** P1-A Telegraph 中文守卫 + P1-B lookup 网络错误回复用户; cleanup 死代码/诊断日志/文件名误报; +5 tests ([#2](https://github.com/gandli/daily-digest/issues/2)) ([476c39b](https://github.com/gandli/daily-digest/commit/476c39b24f8e6beec8e3d8805428ae6fc4d8c375))
* **ci:** seed search:index 加 --remote——前次写入本地非生产, /search 仍报索引未初始化 ([#54](https://github.com/gandli/daily-digest/issues/54)) ([729dc90](https://github.com/gandli/daily-digest/commit/729dc90bb662ede0b78494c33bc554f8f2acaccc))
* deepwiki extractor regex stale (page structure changed 2026-08) - 7/7 real repos now extract EN overview; +2 real-structure tests ([1d3bfad](https://github.com/gandli/daily-digest/commit/1d3bfad76a7cbaf55f252ddec90ece9d990b69e1))
* descZh writeback to original items (translateBatch returns new array) + TranSmart repair pass for non-Chinese slots ([2351236](https://github.com/gandli/daily-digest/commit/23512368ffe4df5287f7d25b253fb290c5be82db))
* extractOgImage 加固——secure_url/twitter:image:src 变体 + &amp; 实体解码 + 协议相对 // + 相对路径拒绝 ([#27](https://github.com/gandli/daily-digest/issues/27)) ([ca7d41d](https://github.com/gandli/daily-digest/commit/ca7d41ddc056cd008b7fd29cffb5337b6cc2150b))
* fail-closed webhook when WEBHOOK_SECRET unset; real KV namespace id ([637a3c3](https://github.com/gandli/daily-digest/commit/637a3c3a77e99074760aeea7f7200ec4c402e64a))
* favicon 兜底拒收 ICO 格式(TG sendPhoto 仅 JPG/PNG/WebP), 跳过留给 s2 保底必返 PNG ([#39](https://github.com/gandli/daily-digest/issues/39)) ([3dd6440](https://github.com/gandli/daily-digest/commit/3dd64404ceaa3715d4aa6bf75237d4900f3fc216))
* **kv:** KV put 失败不再杀 webhook 主路径 ([#49](https://github.com/gandli/daily-digest/issues/49)) ([81a8819](https://github.com/gandli/daily-digest/commit/81a8819cc04194cf551197bb5c63d9d1f89b40f3))
* lookup prefers deepwiki overview (reliable clean summary) over zread which may pick架构 section; +debug log ([513837a](https://github.com/gandli/daily-digest/commit/513837ac12f0f6905f34abd66e4121a71bf2eecb))
* **lookup:** indexArchivedItems 提前到 archive try/catch 外, 避免 OG 图抓取失败导致索引永远缺失形成 seenToday 死循环 ([316c78f](https://github.com/gandli/daily-digest/commit/316c78f538e15f17d4f59f6a4cfb4c154bd34956))
* OG album - worker downloads images, multipart attach:// upload (TG fetch was rate-limited) ([b19be5b](https://github.com/gandli/daily-digest/commit/b19be5b67f6bc60d59f284932c1800b37d0f0eb6))
* **og:** 相对路径 ../og-images → ../../og-images — md 在 archive/<year>/ 下, 原路径解析到 archive/archive/og-images 404 ([#51](https://github.com/gandli/daily-digest/issues/51)) ([3cc785b](https://github.com/gandli/daily-digest/commit/3cc785b5a0b277d0f62e75d17659696f8945e816))
* **P1-1:** btoa spread stack overflow on large buffers -> chunked encodeBase64 ([#14](https://github.com/gandli/daily-digest/issues/14)) ([7380da4](https://github.com/gandli/daily-digest/commit/7380da4ed20dd2e115c16a6f37bb6f8bec252073))
* **P1-2:** /run token moved from URL query to POST X-Runner-Token header (CWE-598) ([#15](https://github.com/gandli/daily-digest/issues/15)) ([0bf125c](https://github.com/gandli/daily-digest/commit/0bf125c081aa87a21ec4fc7fea46ac926987e6b2))
* repo OG 图改走自家 og-images 存档域优先——官方 githubassets 对 TG 出口 IP 池限 100req/IP 易耗尽致 sendPhoto 失败降纯文字 ([#37](https://github.com/gandli/daily-digest/issues/37)) ([6bb9416](https://github.com/gandli/daily-digest/commit/6bb9416e3c1db69d22e20c3f93bb53b609a15383))
* **search:** 用法/帮助文案去掉 <关键词> 尖括号 — Telegram HTML 模式下被当未闭合标签打 400 ([#50](https://github.com/gandli/daily-digest/issues/50)) ([a21047d](https://github.com/gandli/daily-digest/commit/a21047ddd21ae1c1e71fd7eff75b62c4f302e261))
* switch Workers AI to m2m100-1.2b (llama-3.1 deprecated 2026-05); translate errors surfaced via /preview ([8cc8620](https://github.com/gandli/daily-digest/commit/8cc8620b2f0c480e28b7ccbbc1a324ca379aa786))
* **telegraph:** X 帖 archive:tg 键用完整 stamp(含ms)防同日多条互覆盖——digest 日期键, X帖时间戳键 ([#63](https://github.com/gandli/daily-digest/issues/63)) ([cd0f5be](https://github.com/gandli/daily-digest/commit/cd0f5be28e6f600736d390ff494b56ace41825b3))
* unescape HTML entities from scraped descriptions before re-escaping (omarchy '&') ([d9da3b8](https://github.com/gandli/daily-digest/commit/d9da3b80ac046127be5287fd6bdaaca962329c1b))
* **url 重发:** done 状态回存储档链接而非'无需重复'——markProcessed 存 md stamp, 重发拼 .md 存档链接 ([#64](https://github.com/gandli/daily-digest/issues/64)) ([d07f701](https://github.com/gandli/daily-digest/commit/d07f70101acdd553f880a6c124e15c40fca4ed64))
* X 帖卡片残余英文中文化——媒体标签(图片/视频/GIF) + 时间戳转北京时间 YYYY-MM-DD HH:mm ([#34](https://github.com/gandli/daily-digest/issues/34)) ([77059c4](https://github.com/gandli/daily-digest/commit/77059c48bc4737bb2e9c7cc8c3ee9c5ecd79210c))
* X 帖确认卡摘要强制中文(短帖直译/长帖摘要后校验), 索引 descZh 同步回填 ([#33](https://github.com/gandli/daily-digest/issues/33)) ([6adda35](https://github.com/gandli/daily-digest/commit/6adda359951b52cdaa59d75d3ff601ebd449b71f))
* zread extractor picks 概述 section over 架构概览 — relax def-verb for overview blocks + handle ##/正文同块; +tests ([cbc928e](https://github.com/gandli/daily-digest/commit/cbc928ec2bba379195e11294bedb4c6fd3d6e1f2))
* zread extractor prefers definition paragraph containing repo name (was picking longest/minor-subsystem block, e.g. hermes skills/curator text) ([d855dfb](https://github.com/gandli/daily-digest/commit/d855dfb555c6097c788e160f390abedf2e68f8c2))
* **zread:** 慢响应适配 — 75s 超时 + 504 重试 ([#46](https://github.com/gandli/daily-digest/issues/46)) ([ef0ddd3](https://github.com/gandli/daily-digest/commit/ef0ddd31df7567eeaed03f34278776a491b888db))
* **存档链接:** 精简重复 emoji——统一单个 📎 前缀, 键名改纯文字(Telegraph/互联网档案馆/GitHub md), 去掉每链一个图标 ([#71](https://github.com/gandli/daily-digest/issues/71)) ([9929ea2](https://github.com/gandli/daily-digest/commit/9929ea2070e7da4bb263a4be5b871f96253133af))
* 审计 v2——/search 链接补年目录 + stamp 单次计算 + X帖 repo 联动 ([#22](https://github.com/gandli/daily-digest/issues/22)) ([3419009](https://github.com/gandli/daily-digest/commit/341900918792abc1b8706d127f3cae7e21f0291b))
* 移除🀄 emoji, 翻译段标签改用 🌐 ([#35](https://github.com/gandli/daily-digest/issues/35)) ([8a88740](https://github.com/gandli/daily-digest/commit/8a887400eb643f3367a76c8d8d46e2f07be423a0))


### Features

* /run manual trigger (test-period, closed once WEBHOOK_SECRET set); wire TranSmart-era secrets ([9d73be9](https://github.com/gandli/daily-digest/commit/9d73be9f61506d7eae559b7cc5c9f177b9457fca))
* /search 描述接入 CF Summarization(X帖+网页) ([#24](https://github.com/gandli/daily-digest/issues/24)) ([fab833e](https://github.com/gandli/daily-digest/commit/fab833e360a778627c7ce949c6bc696e8b68c253))
* /search 菜单项 + X 帖子 Telegraph 存档 + URL 内容 repo 链接联动 ([#20](https://github.com/gandli/daily-digest/issues/20)) ([f06209e](https://github.com/gandli/daily-digest/commit/f06209e0de32f4734b425e88e4384a73f1e9b342))
* **/search:** 结果分页换 inline keyboard 翻页(sch:page:query), 替代截断提示; 删弃用 done() ([#56](https://github.com/gandli/daily-digest/issues/56)) ([2c71b66](https://github.com/gandli/daily-digest/commit/2c71b66a8a7f15205de0fb21248adfafd9e75e5a))
* **/search:** 结果当页英文描述批量译中(translateBatch)——用户要求所有项目带中文描述; 失败保原文明示 ([#72](https://github.com/gandli/daily-digest/issues/72)) ([e003b9a](https://github.com/gandli/daily-digest/commit/e003b9ae2af81a56e52f6a1554dc9dbba54e5807))
* **/trending:** 当天 trending 固定, 改用缓存(useCache=true)不必每次重抓; cron 已存 digest:<date>, 二次起秒回 ([#62](https://github.com/gandli/daily-digest/issues/62)) ([5987e2e](https://github.com/gandli/daily-digest/commit/5987e2e30cbf1355032d8c28cbfaab3e60137bd8))
* **/trending:** 缓存存 {chunks, repos}, 重放用 sendPerRepoMessages 带 OG 图——修复缓存命中只纯文字无图 ([#65](https://github.com/gandli/daily-digest/issues/65)) ([507bcde](https://github.com/gandli/daily-digest/commit/507bcdee12baf40913d9685f11047d98af6c2f04))
* add 9Router LLM translation layer (opt-in via LLM_BASE_URL secret, off by default) ([a39a900](https://github.com/gandli/daily-digest/commit/a39a900cc59bcfb57ddd9b43b7900dc5fcd52ce9))
* any-URL to markdown archive (3-tier free chain: Markdown-for-Agents → AI.toMarkdown → Browser Rendering) ([#12](https://github.com/gandli/daily-digest/issues/12)) ([352c342](https://github.com/gandli/daily-digest/commit/352c342a19cd2b47441e0e98be3a6d01325330aa))
* bot command menu (setMyCommands: /trending /help /archive) + /help /archive handlers ([c314097](https://github.com/gandli/daily-digest/commit/c3140973eff397448dee6581bf04fdf5e690d775))
* daily-digest v1 - trending digest pipeline ([#1](https://github.com/gandli/daily-digest/issues/1)) ([da2d119](https://github.com/gandli/daily-digest/commit/da2d119721afc8d3ab1d5a17d084bd3f28427f2e))
* desc must come from zread/deepwiki only (skip desc when both miss) + render skip; +5 tests (shape/obligation/render) ([846614b](https://github.com/gandli/daily-digest/commit/846614bab7ed2c194d0d48e55715a8f7c2123eb9))
* desc resolver chain (zread zh -> deepwiki en overview -> translate zh) + TG-side OG fetch to fit subrequest budget ([01009a6](https://github.com/gandli/daily-digest/commit/01009a67fea685d49b1bd5254f509f5bb7e5f8ad))
* extractOgImage 对齐 open-graph-scraper 字段覆盖 ([#38](https://github.com/gandli/daily-digest/issues/38)) ([7a55e92](https://github.com/gandli/daily-digest/commit/7a55e927b5bb8c3aec0d2594e1cac1154ab66a76))
* GitHub link → single-repo lookup (desc via zread/deepwiki/translate + OG image + archive); extractRepo +7 tests ([bbbbc91](https://github.com/gandli/daily-digest/commit/bbbbc9105df1e56222d5b564d6b9f383c66d87f3))
* HTML parse_mode with layered layout (title/desc/wiki/tags) - back from MarkdownV2 ([487061d](https://github.com/gandli/daily-digest/commit/487061d2492a6fc779b10dc26ed39ef1d4587614))
* **library:** GitHub 星标 + Chrome 书签导入管线 ([#47](https://github.com/gandli/daily-digest/issues/47)) ([b7af796](https://github.com/gandli/daily-digest/commit/b7af796b88885b26cda6a5f4312a65283e1b9580))
* lookup dedup (KV daily) + desc cache/sync (7d TTL) + og-images dir on archive branch + /search command ([#9](https://github.com/gandli/daily-digest/issues/9)) ([e269be9](https://github.com/gandli/daily-digest/commit/e269be91e2868c45573fa8de0d1dffefe41ad97e))
* lookup fallback to GitHub repo desc translation when zread/deepwiki have no index (new repos); zh desc used directly; +2 tests ([0c1acc6](https://github.com/gandli/daily-digest/commit/0c1acc66cd926e17a19e28ac8576c056745e8a00))
* **lookup:** 当日重复查询回存档数据而非提示已查询过 — 读 archive:idx 索引回描述+存档链接+OG图, 索引缺失才落旧提示 ([#52](https://github.com/gandli/daily-digest/issues/52)) ([0531873](https://github.com/gandli/daily-digest/commit/0531873aeb5e25820697b5ea22a4cd6959c66e3e))
* MarkdownV2 formatting + repo topics as tags (first 4 repos, subrequest budget) ([80f217d](https://github.com/gandli/daily-digest/commit/80f217d0f7fb988a7c446c608d7339756ae3e286))
* merge archive into main repo (archive/ dir), default GH_ARCHIVE_REPO=gandli/daily-digest; zread serial rate-limit (anti-throttle) + 15s timeout; deepwiki 45s ([5f9de24](https://github.com/gandli/daily-digest/commit/5f9de241bd74dbe5bedcd8cd4a378a20d23b3485))
* OG image album per repo (sendMediaGroup, retry-with-drop on WEBPAGE_CURL_FAILED) ([38f7566](https://github.com/gandli/daily-digest/commit/38f7566784e86da95218f5c6cfb0b596695c3c15))
* one message per project (header on first, N/M prefix, footer on last) ([f816800](https://github.com/gandli/daily-digest/commit/f8168002c09e3d18fbae9b34ef410f1c870b14eb))
* per-repo message with OG image as photo + full entry as caption (fallback to text) ([e8be520](https://github.com/gandli/daily-digest/commit/e8be520b53abee2a0acc7e4f18722afd30680a7d))
* README beautify (hero SVG + badges + structure) + archive/Telegraph OG images (URL refs, zero subrequests); 55→57 tests ([#8](https://github.com/gandli/daily-digest/issues/8)) ([712405d](https://github.com/gandli/daily-digest/commit/712405d34edfce10a54b5118ee790d86ced9d0fa))
* **search:** /search 支持搜索导入的星标/书签库 ([#48](https://github.com/gandli/daily-digest/issues/48)) ([67e8a7b](https://github.com/gandli/daily-digest/commit/67e8a7b14babec1856bac9474a02dd61c01bcefa))
* strip deepwiki template opening (This page provides... intro to X) → use real description after it; verified ai-hedge-fund/QtScrcpy/open-design ([4fa740e](https://github.com/gandli/daily-digest/commit/4fa740e03c8fedb2323ba23414fc4ce83e35d93f))
* TranSmart translation layer (chain: AI→TranSmart→Google→MyMemory→EN); /run secured by token ([e582c33](https://github.com/gandli/daily-digest/commit/e582c33ac3cca8790e57e030b19ebd717b081f40))
* URL 存档回复带 OG 图(sendPhoto, caption=确认+存档链接) ([#19](https://github.com/gandli/daily-digest/issues/19)) ([710c5da](https://github.com/gandli/daily-digest/commit/710c5da371362a953ec6f897d33a31282e9e52dc))
* URL 重发语义——未翻译/缺描述时重发自动重跑全管线 ([#31](https://github.com/gandli/daily-digest/issues/31)) ([9817525](https://github.com/gandli/daily-digest/commit/98175254f6741a4c1ac57fbd3b5be62477c09a63))
* URL/X 帖子存档确认消息附 GitHub 存档链接 ([#18](https://github.com/gandli/daily-digest/issues/18)) ([7888d4f](https://github.com/gandli/daily-digest/commit/7888d4fa76bb1a260d20c43b61d517a37db203df))
* X 帖卡片必带图——photo直链/video缩略图/帖内repo OG图/s2 favicon 四级配图 ([#40](https://github.com/gandli/daily-digest/issues/40)) ([c29aa9f](https://github.com/gandli/daily-digest/commit/c29aa9f059e13ee917702059e3167d87f3ce5749))
* X 帖正文翻译成中文(原文+译文双段呈现) ([#30](https://github.com/gandli/daily-digest/issues/30)) ([d158217](https://github.com/gandli/daily-digest/commit/d158217c5b96e496e5238b24cef794933f85db64))
* X 帖视频 sendVideo 内嵌播放(mp4 直链+supports_streaming), 失败逐级落缩略图卡/纯文字 ([#43](https://github.com/gandli/daily-digest/issues/43)) ([ee2ab13](https://github.com/gandli/daily-digest/commit/ee2ab137f11952496ce8c4fde145efa125b728d4))
* X 帖翻译首选 FxEmbed /zh-cn 内嵌翻译(Grok), 空则落四级链 ([#41](https://github.com/gandli/daily-digest/issues/41)) ([bfb58d7](https://github.com/gandli/daily-digest/commit/bfb58d71e61ea3d492cfe709e8d041f0a5d351f3))
* X/Twitter post archive via FxEmbed API ([#13](https://github.com/gandli/daily-digest/issues/13)) ([2dfd42d](https://github.com/gandli/daily-digest/commit/2dfd42dc1c67c7b2f4e062407bad53ddcba91d1b))
* zread extractor prefers Overview/概览 section (highest priority), then repo-name def, then longest; +overview test ([3e906e8](https://github.com/gandli/daily-digest/commit/3e906e8f1ee39b70b5962215856eb3ffd3c23567))
* zread wiki desc as primary description, translation as fallback only; HTML layered layout ([a9536af](https://github.com/gandli/daily-digest/commit/a9536afbcf9287a89c00c9044282638d1050a532))
* zread wiki desc in Chinese (Accept-Language zh-CN + definition-sentence extractor) ([0fd9199](https://github.com/gandli/daily-digest/commit/0fd9199e49599e76735e68fa710f0f3870800af7))
* zread.ai links alongside deepwiki (TG message + markdown archive) ([dbb578a](https://github.com/gandli/daily-digest/commit/dbb578a4f688ac2603314b642d61a8ce8fdcbec1))
* zread.ai web wiki descriptions (RSC payload scrape, no key) - deep desc per repo ([20effa3](https://github.com/gandli/daily-digest/commit/20effa35caa46d367edbced5b4622343dcf8f4f4))
* **分页导航:** 上下页增加页码指示(📄 当前/总页) + 快捷跳转行(首页/中间/末页, >4页显示); /archive 与 /search 同构 ([#70](https://github.com/gandli/daily-digest/issues/70)) ([39fc413](https://github.com/gandli/daily-digest/commit/39fc4135327e39a9ea6e1ff5f55e9eabba308208))
* **存档三链全覆盖:** replyArchived/renderArchivePage/URL重建回复均改 archiveLinks——repo 用 github.com/<repo> 拼 web.archive, 统一 Telegraph→web.archive→GitHub md 三链 ([#69](https://github.com/gandli/daily-digest/issues/69)) ([6482cd0](https://github.com/gandli/daily-digest/commit/6482cd0561beda7de240b0455ae9a7dcd8aea3a2))
* **存档三链:** 新增 web.archive.org 互联网档案馆兜底快照; 回复链接按 Telegraph → web.archive → GitHub md 优先级展示(archiveLinks helper) ([#68](https://github.com/gandli/daily-digest/issues/68)) ([4ba157b](https://github.com/gandli/daily-digest/commit/4ba157bd15bd133a748e8dad84a4750f2a2c144c))
* 存档回摘要行标注📝摘要(区别于翻译); 加 summarizeZh 自检回归锁(CF bart-large-cnn 摘要→m2m100 译中调用链) ([#67](https://github.com/gandli/daily-digest/issues/67)) ([6ef5638](https://github.com/gandli/daily-digest/commit/6ef5638b6ee541239a196b4b5a8fa62674f1a4ee))
* 网页存档 OG 图保底——缺 og:image 时回退 favicon/apple-touch-icon ([#26](https://github.com/gandli/daily-digest/issues/26)) ([b0a7c26](https://github.com/gandli/daily-digest/commit/b0a7c2645e6362b131b6b4e0dc313687b1ffd432))
* 网页存档回复必含图——四级图链 og:image → twitter:image → apple-touch-icon/favicon → Google s2 ([#28](https://github.com/gandli/daily-digest/issues/28)) ([38d631f](https://github.com/gandli/daily-digest/commit/38d631f3d9cff06aba7c48160068d5c598412f9a))
* 网页非中文内容翻译成中文 + 存档回复统一三行式格式 ([#25](https://github.com/gandli/daily-digest/issues/25)) ([245c7d9](https://github.com/gandli/daily-digest/commit/245c7d981ba6a83dd555d9ead34c8553c7ff3f2e))
* 自动化 changelog — GitHub Action 用 conventional-changelog 在 main push 时更新 CHANGELOG.md 并提交回 main ([#77](https://github.com/gandli/daily-digest/issues/77)) ([3de8076](https://github.com/gandli/daily-digest/commit/3de8076a18422898a67cc22cf40b4c20b5ccb3e4))
* 重发存档回传 telegraph 优先 + done 无 md 时重归档取回存档链接, 不再'无需重复' ([#66](https://github.com/gandli/daily-digest/issues/66)) ([4056847](https://github.com/gandli/daily-digest/commit/4056847cb56cfa33c55fe5380b82aa0227d33c50))
#  (2026-08-26)


### Bug Fixes

* **/archive:** 翻页 callback 的 answerCallbackQuery 放 finally——中间抛错(重复点击 message not modified/KV 抖动)时答收回不到, 按钮永不消转圈 ([#55](https://github.com/gandli/daily-digest/issues/55)) ([11a8a40](https://github.com/gandli/daily-digest/commit/11a8a40bb5d0731c0ff3130647028305be7ee4ad))
* /help now replies with HELP content (was registering menu only) ([a104244](https://github.com/gandli/daily-digest/commit/a104244893d17e0eff57f21bc74836a204ce6ebe))
* **/lookup:** replyArchived 索引缺失时 re-lookup 归档返回存档信息, 不再回旧提示'已查询过'——保持用户硬性要求(已查过且归档失败的 repo 重发应得存档数据) ([#61](https://github.com/gandli/daily-digest/issues/61)) ([59c0053](https://github.com/gandli/daily-digest/commit/59c0053b8bc297ca4581bd900cc2e9eb4c04f32a))
* **/search /trending:** 修复命令无响应 + /archive 分页/Telegraph/年份支持 ([#53](https://github.com/gandli/daily-digest/issues/53)) ([5212406](https://github.com/gandli/daily-digest/commit/521240670a4ecab758b7a884ed5ef4f800c2c6e8))
* /search uses KV archive index (code search can't see non-default branches) ([#11](https://github.com/gandli/daily-digest/issues/11)) ([e9fdf93](https://github.com/gandli/daily-digest/commit/e9fdf93ded06f790104ab244940af5b6160bdfc9))
* /search 结果附描述行 ([#23](https://github.com/gandli/daily-digest/issues/23)) ([2de1852](https://github.com/gandli/daily-digest/commit/2de18526562b672296eb79d2c3efa6e63d0b1f92))
* **/search:** 翻页 query 存 KV(search:q:<token>) 而非塞 callback_data——callback_data 64B 上限致长 query 截断解码残缺, 翻页失效。token=query 确定哈希, 短且幂等 ([#59](https://github.com/gandli/daily-digest/issues/59)) ([91bde83](https://github.com/gandli/daily-digest/commit/91bde8311389c28dc33055e6efbf9c40e00eab1d))
* /trending forces full pipeline (useCache=false) so messages include OG images ([eb3ce72](https://github.com/gandli/daily-digest/commit/eb3ce726a885f865f02bf6199638910614929aa7))
* **/trending:** 去掉误加的 25s 描述链 deadline——它掐断 zread 链致 descZh 全空(消息无描述)+发送循环预算内终止(只发8条)。cron 同款链路已验证 10/10 全中文描述, 与 cron 一致跑完整链 ([#58](https://github.com/gandli/daily-digest/issues/58)) ([208288a](https://github.com/gandli/daily-digest/commit/208288ab7cbc7975cbc71fe9f71126787be48627))
* **/trending:** 自调 /run 被 CF 拦(Worker→自身 workers.dev 橙云 1003/1042)→改直调 runDigest, 描述链给 25s deadline, 超时省略描述照发 ([#57](https://github.com/gandli/daily-digest/issues/57)) ([4c4d168](https://github.com/gandli/daily-digest/commit/4c4d168c6ed28692f5b07cffe2a6bddb566e7fe4))
* 🌐中文翻译段从未发出——主卡片在翻译前已发, zhLine 计算后未拼进任何消息 ([#36](https://github.com/gandli/daily-digest/issues/36)) ([1892948](https://github.com/gandli/daily-digest/commit/18929482867faf3306d8bf0a45848bf025593d07))
* archive to dedicated 'archive' branch (readd branch param lost in merge churn); rm temp workflows, stray archive dir ([3e5a5c9](https://github.com/gandli/daily-digest/commit/3e5a5c92ee4afb829fc3ca9afe1122d8923c414f))
* **audit:** P1-A Telegraph 中文守卫 + P1-B lookup 网络错误回复用户; cleanup 死代码/诊断日志/文件名误报; +5 tests ([#2](https://github.com/gandli/daily-digest/issues/2)) ([476c39b](https://github.com/gandli/daily-digest/commit/476c39b24f8e6beec8e3d8805428ae6fc4d8c375))
* **ci:** seed search:index 加 --remote——前次写入本地非生产, /search 仍报索引未初始化 ([#54](https://github.com/gandli/daily-digest/issues/54)) ([729dc90](https://github.com/gandli/daily-digest/commit/729dc90bb662ede0b78494c33bc554f8f2acaccc))
* deepwiki extractor regex stale (page structure changed 2026-08) - 7/7 real repos now extract EN overview; +2 real-structure tests ([1d3bfad](https://github.com/gandli/daily-digest/commit/1d3bfad76a7cbaf55f252ddec90ece9d990b69e1))
* descZh writeback to original items (translateBatch returns new array) + TranSmart repair pass for non-Chinese slots ([2351236](https://github.com/gandli/daily-digest/commit/23512368ffe4df5287f7d25b253fb290c5be82db))
* extractOgImage 加固——secure_url/twitter:image:src 变体 + &amp; 实体解码 + 协议相对 // + 相对路径拒绝 ([#27](https://github.com/gandli/daily-digest/issues/27)) ([ca7d41d](https://github.com/gandli/daily-digest/commit/ca7d41ddc056cd008b7fd29cffb5337b6cc2150b))
* fail-closed webhook when WEBHOOK_SECRET unset; real KV namespace id ([637a3c3](https://github.com/gandli/daily-digest/commit/637a3c3a77e99074760aeea7f7200ec4c402e64a))
* favicon 兜底拒收 ICO 格式(TG sendPhoto 仅 JPG/PNG/WebP), 跳过留给 s2 保底必返 PNG ([#39](https://github.com/gandli/daily-digest/issues/39)) ([3dd6440](https://github.com/gandli/daily-digest/commit/3dd64404ceaa3715d4aa6bf75237d4900f3fc216))
* **kv:** KV put 失败不再杀 webhook 主路径 ([#49](https://github.com/gandli/daily-digest/issues/49)) ([81a8819](https://github.com/gandli/daily-digest/commit/81a8819cc04194cf551197bb5c63d9d1f89b40f3))
* lookup prefers deepwiki overview (reliable clean summary) over zread which may pick架构 section; +debug log ([513837a](https://github.com/gandli/daily-digest/commit/513837ac12f0f6905f34abd66e4121a71bf2eecb))
* **lookup:** indexArchivedItems 提前到 archive try/catch 外, 避免 OG 图抓取失败导致索引永远缺失形成 seenToday 死循环 ([316c78f](https://github.com/gandli/daily-digest/commit/316c78f538e15f17d4f59f6a4cfb4c154bd34956))
* OG album - worker downloads images, multipart attach:// upload (TG fetch was rate-limited) ([b19be5b](https://github.com/gandli/daily-digest/commit/b19be5b67f6bc60d59f284932c1800b37d0f0eb6))
* **og:** 相对路径 ../og-images → ../../og-images — md 在 archive/<year>/ 下, 原路径解析到 archive/archive/og-images 404 ([#51](https://github.com/gandli/daily-digest/issues/51)) ([3cc785b](https://github.com/gandli/daily-digest/commit/3cc785b5a0b277d0f62e75d17659696f8945e816))
* **P1-1:** btoa spread stack overflow on large buffers -> chunked encodeBase64 ([#14](https://github.com/gandli/daily-digest/issues/14)) ([7380da4](https://github.com/gandli/daily-digest/commit/7380da4ed20dd2e115c16a6f37bb6f8bec252073))
* **P1-2:** /run token moved from URL query to POST X-Runner-Token header (CWE-598) ([#15](https://github.com/gandli/daily-digest/issues/15)) ([0bf125c](https://github.com/gandli/daily-digest/commit/0bf125c081aa87a21ec4fc7fea46ac926987e6b2))
* repo OG 图改走自家 og-images 存档域优先——官方 githubassets 对 TG 出口 IP 池限 100req/IP 易耗尽致 sendPhoto 失败降纯文字 ([#37](https://github.com/gandli/daily-digest/issues/37)) ([6bb9416](https://github.com/gandli/daily-digest/commit/6bb9416e3c1db69d22e20c3f93bb53b609a15383))
* **search:** 用法/帮助文案去掉 <关键词> 尖括号 — Telegram HTML 模式下被当未闭合标签打 400 ([#50](https://github.com/gandli/daily-digest/issues/50)) ([a21047d](https://github.com/gandli/daily-digest/commit/a21047ddd21ae1c1e71fd7eff75b62c4f302e261))
* switch Workers AI to m2m100-1.2b (llama-3.1 deprecated 2026-05); translate errors surfaced via /preview ([8cc8620](https://github.com/gandli/daily-digest/commit/8cc8620b2f0c480e28b7ccbbc1a324ca379aa786))
* **telegraph:** X 帖 archive:tg 键用完整 stamp(含ms)防同日多条互覆盖——digest 日期键, X帖时间戳键 ([#63](https://github.com/gandli/daily-digest/issues/63)) ([cd0f5be](https://github.com/gandli/daily-digest/commit/cd0f5be28e6f600736d390ff494b56ace41825b3))
* unescape HTML entities from scraped descriptions before re-escaping (omarchy '&') ([d9da3b8](https://github.com/gandli/daily-digest/commit/d9da3b80ac046127be5287fd6bdaaca962329c1b))
* **url 重发:** done 状态回存储档链接而非'无需重复'——markProcessed 存 md stamp, 重发拼 .md 存档链接 ([#64](https://github.com/gandli/daily-digest/issues/64)) ([d07f701](https://github.com/gandli/daily-digest/commit/d07f70101acdd553f880a6c124e15c40fca4ed64))
* X 帖卡片残余英文中文化——媒体标签(图片/视频/GIF) + 时间戳转北京时间 YYYY-MM-DD HH:mm ([#34](https://github.com/gandli/daily-digest/issues/34)) ([77059c4](https://github.com/gandli/daily-digest/commit/77059c48bc4737bb2e9c7cc8c3ee9c5ecd79210c))
* X 帖确认卡摘要强制中文(短帖直译/长帖摘要后校验), 索引 descZh 同步回填 ([#33](https://github.com/gandli/daily-digest/issues/33)) ([6adda35](https://github.com/gandli/daily-digest/commit/6adda359951b52cdaa59d75d3ff601ebd449b71f))
* zread extractor picks 概述 section over 架构概览 — relax def-verb for overview blocks + handle ##/正文同块; +tests ([cbc928e](https://github.com/gandli/daily-digest/commit/cbc928ec2bba379195e11294bedb4c6fd3d6e1f2))
* zread extractor prefers definition paragraph containing repo name (was picking longest/minor-subsystem block, e.g. hermes skills/curator text) ([d855dfb](https://github.com/gandli/daily-digest/commit/d855dfb555c6097c788e160f390abedf2e68f8c2))
* **zread:** 慢响应适配 — 75s 超时 + 504 重试 ([#46](https://github.com/gandli/daily-digest/issues/46)) ([ef0ddd3](https://github.com/gandli/daily-digest/commit/ef0ddd31df7567eeaed03f34278776a491b888db))
* **存档链接:** 精简重复 emoji——统一单个 📎 前缀, 键名改纯文字(Telegraph/互联网档案馆/GitHub md), 去掉每链一个图标 ([#71](https://github.com/gandli/daily-digest/issues/71)) ([9929ea2](https://github.com/gandli/daily-digest/commit/9929ea2070e7da4bb263a4be5b871f96253133af))
* 审计 v2——/search 链接补年目录 + stamp 单次计算 + X帖 repo 联动 ([#22](https://github.com/gandli/daily-digest/issues/22)) ([3419009](https://github.com/gandli/daily-digest/commit/341900918792abc1b8706d127f3cae7e21f0291b))
* 移除🀄 emoji, 翻译段标签改用 🌐 ([#35](https://github.com/gandli/daily-digest/issues/35)) ([8a88740](https://github.com/gandli/daily-digest/commit/8a887400eb643f3367a76c8d8d46e2f07be423a0))


### Features

* /run manual trigger (test-period, closed once WEBHOOK_SECRET set); wire TranSmart-era secrets ([9d73be9](https://github.com/gandli/daily-digest/commit/9d73be9f61506d7eae559b7cc5c9f177b9457fca))
* /search 描述接入 CF Summarization(X帖+网页) ([#24](https://github.com/gandli/daily-digest/issues/24)) ([fab833e](https://github.com/gandli/daily-digest/commit/fab833e360a778627c7ce949c6bc696e8b68c253))
* /search 菜单项 + X 帖子 Telegraph 存档 + URL 内容 repo 链接联动 ([#20](https://github.com/gandli/daily-digest/issues/20)) ([f06209e](https://github.com/gandli/daily-digest/commit/f06209e0de32f4734b425e88e4384a73f1e9b342))
* **/search:** 结果分页换 inline keyboard 翻页(sch:page:query), 替代截断提示; 删弃用 done() ([#56](https://github.com/gandli/daily-digest/issues/56)) ([2c71b66](https://github.com/gandli/daily-digest/commit/2c71b66a8a7f15205de0fb21248adfafd9e75e5a))
* **/search:** 结果当页英文描述批量译中(translateBatch)——用户要求所有项目带中文描述; 失败保原文明示 ([#72](https://github.com/gandli/daily-digest/issues/72)) ([e003b9a](https://github.com/gandli/daily-digest/commit/e003b9ae2af81a56e52f6a1554dc9dbba54e5807))
* **/trending:** 当天 trending 固定, 改用缓存(useCache=true)不必每次重抓; cron 已存 digest:<date>, 二次起秒回 ([#62](https://github.com/gandli/daily-digest/issues/62)) ([5987e2e](https://github.com/gandli/daily-digest/commit/5987e2e30cbf1355032d8c28cbfaab3e60137bd8))
* **/trending:** 缓存存 {chunks, repos}, 重放用 sendPerRepoMessages 带 OG 图——修复缓存命中只纯文字无图 ([#65](https://github.com/gandli/daily-digest/issues/65)) ([507bcde](https://github.com/gandli/daily-digest/commit/507bcdee12baf40913d9685f11047d98af6c2f04))
* add 9Router LLM translation layer (opt-in via LLM_BASE_URL secret, off by default) ([a39a900](https://github.com/gandli/daily-digest/commit/a39a900cc59bcfb57ddd9b43b7900dc5fcd52ce9))
* any-URL to markdown archive (3-tier free chain: Markdown-for-Agents → AI.toMarkdown → Browser Rendering) ([#12](https://github.com/gandli/daily-digest/issues/12)) ([352c342](https://github.com/gandli/daily-digest/commit/352c342a19cd2b47441e0e98be3a6d01325330aa))
* bot command menu (setMyCommands: /trending /help /archive) + /help /archive handlers ([c314097](https://github.com/gandli/daily-digest/commit/c3140973eff397448dee6581bf04fdf5e690d775))
* daily-digest v1 - trending digest pipeline ([#1](https://github.com/gandli/daily-digest/issues/1)) ([da2d119](https://github.com/gandli/daily-digest/commit/da2d119721afc8d3ab1d5a17d084bd3f28427f2e))
* desc must come from zread/deepwiki only (skip desc when both miss) + render skip; +5 tests (shape/obligation/render) ([846614b](https://github.com/gandli/daily-digest/commit/846614bab7ed2c194d0d48e55715a8f7c2123eb9))
* desc resolver chain (zread zh -> deepwiki en overview -> translate zh) + TG-side OG fetch to fit subrequest budget ([01009a6](https://github.com/gandli/daily-digest/commit/01009a67fea685d49b1bd5254f509f5bb7e5f8ad))
* extractOgImage 对齐 open-graph-scraper 字段覆盖 ([#38](https://github.com/gandli/daily-digest/issues/38)) ([7a55e92](https://github.com/gandli/daily-digest/commit/7a55e927b5bb8c3aec0d2594e1cac1154ab66a76))
* GitHub link → single-repo lookup (desc via zread/deepwiki/translate + OG image + archive); extractRepo +7 tests ([bbbbc91](https://github.com/gandli/daily-digest/commit/bbbbc9105df1e56222d5b564d6b9f383c66d87f3))
* HTML parse_mode with layered layout (title/desc/wiki/tags) - back from MarkdownV2 ([487061d](https://github.com/gandli/daily-digest/commit/487061d2492a6fc779b10dc26ed39ef1d4587614))
* **library:** GitHub 星标 + Chrome 书签导入管线 ([#47](https://github.com/gandli/daily-digest/issues/47)) ([b7af796](https://github.com/gandli/daily-digest/commit/b7af796b88885b26cda6a5f4312a65283e1b9580))
* lookup dedup (KV daily) + desc cache/sync (7d TTL) + og-images dir on archive branch + /search command ([#9](https://github.com/gandli/daily-digest/issues/9)) ([e269be9](https://github.com/gandli/daily-digest/commit/e269be91e2868c45573fa8de0d1dffefe41ad97e))
* lookup fallback to GitHub repo desc translation when zread/deepwiki have no index (new repos); zh desc used directly; +2 tests ([0c1acc6](https://github.com/gandli/daily-digest/commit/0c1acc66cd926e17a19e28ac8576c056745e8a00))
* **lookup:** 当日重复查询回存档数据而非提示已查询过 — 读 archive:idx 索引回描述+存档链接+OG图, 索引缺失才落旧提示 ([#52](https://github.com/gandli/daily-digest/issues/52)) ([0531873](https://github.com/gandli/daily-digest/commit/0531873aeb5e25820697b5ea22a4cd6959c66e3e))
* MarkdownV2 formatting + repo topics as tags (first 4 repos, subrequest budget) ([80f217d](https://github.com/gandli/daily-digest/commit/80f217d0f7fb988a7c446c608d7339756ae3e286))
* merge archive into main repo (archive/ dir), default GH_ARCHIVE_REPO=gandli/daily-digest; zread serial rate-limit (anti-throttle) + 15s timeout; deepwiki 45s ([5f9de24](https://github.com/gandli/daily-digest/commit/5f9de241bd74dbe5bedcd8cd4a378a20d23b3485))
* OG image album per repo (sendMediaGroup, retry-with-drop on WEBPAGE_CURL_FAILED) ([38f7566](https://github.com/gandli/daily-digest/commit/38f7566784e86da95218f5c6cfb0b596695c3c15))
* one message per project (header on first, N/M prefix, footer on last) ([f816800](https://github.com/gandli/daily-digest/commit/f8168002c09e3d18fbae9b34ef410f1c870b14eb))
* per-repo message with OG image as photo + full entry as caption (fallback to text) ([e8be520](https://github.com/gandli/daily-digest/commit/e8be520b53abee2a0acc7e4f18722afd30680a7d))
* README beautify (hero SVG + badges + structure) + archive/Telegraph OG images (URL refs, zero subrequests); 55→57 tests ([#8](https://github.com/gandli/daily-digest/issues/8)) ([712405d](https://github.com/gandli/daily-digest/commit/712405d34edfce10a54b5118ee790d86ced9d0fa))
* **search:** /search 支持搜索导入的星标/书签库 ([#48](https://github.com/gandli/daily-digest/issues/48)) ([67e8a7b](https://github.com/gandli/daily-digest/commit/67e8a7b14babec1856bac9474a02dd61c01bcefa))
* strip deepwiki template opening (This page provides... intro to X) → use real description after it; verified ai-hedge-fund/QtScrcpy/open-design ([4fa740e](https://github.com/gandli/daily-digest/commit/4fa740e03c8fedb2323ba23414fc4ce83e35d93f))
* TranSmart translation layer (chain: AI→TranSmart→Google→MyMemory→EN); /run secured by token ([e582c33](https://github.com/gandli/daily-digest/commit/e582c33ac3cca8790e57e030b19ebd717b081f40))
* URL 存档回复带 OG 图(sendPhoto, caption=确认+存档链接) ([#19](https://github.com/gandli/daily-digest/issues/19)) ([710c5da](https://github.com/gandli/daily-digest/commit/710c5da371362a953ec6f897d33a31282e9e52dc))
* URL 重发语义——未翻译/缺描述时重发自动重跑全管线 ([#31](https://github.com/gandli/daily-digest/issues/31)) ([9817525](https://github.com/gandli/daily-digest/commit/98175254f6741a4c1ac57fbd3b5be62477c09a63))
* URL/X 帖子存档确认消息附 GitHub 存档链接 ([#18](https://github.com/gandli/daily-digest/issues/18)) ([7888d4f](https://github.com/gandli/daily-digest/commit/7888d4fa76bb1a260d20c43b61d517a37db203df))
* X 帖卡片必带图——photo直链/video缩略图/帖内repo OG图/s2 favicon 四级配图 ([#40](https://github.com/gandli/daily-digest/issues/40)) ([c29aa9f](https://github.com/gandli/daily-digest/commit/c29aa9f059e13ee917702059e3167d87f3ce5749))
* X 帖正文翻译成中文(原文+译文双段呈现) ([#30](https://github.com/gandli/daily-digest/issues/30)) ([d158217](https://github.com/gandli/daily-digest/commit/d158217c5b96e496e5238b24cef794933f85db64))
* X 帖视频 sendVideo 内嵌播放(mp4 直链+supports_streaming), 失败逐级落缩略图卡/纯文字 ([#43](https://github.com/gandli/daily-digest/issues/43)) ([ee2ab13](https://github.com/gandli/daily-digest/commit/ee2ab137f11952496ce8c4fde145efa125b728d4))
* X 帖翻译首选 FxEmbed /zh-cn 内嵌翻译(Grok), 空则落四级链 ([#41](https://github.com/gandli/daily-digest/issues/41)) ([bfb58d7](https://github.com/gandli/daily-digest/commit/bfb58d71e61ea3d492cfe709e8d041f0a5d351f3))
* X/Twitter post archive via FxEmbed API ([#13](https://github.com/gandli/daily-digest/issues/13)) ([2dfd42d](https://github.com/gandli/daily-digest/commit/2dfd42dc1c67c7b2f4e062407bad53ddcba91d1b))
* zread extractor prefers Overview/概览 section (highest priority), then repo-name def, then longest; +overview test ([3e906e8](https://github.com/gandli/daily-digest/commit/3e906e8f1ee39b70b5962215856eb3ffd3c23567))
* zread wiki desc as primary description, translation as fallback only; HTML layered layout ([a9536af](https://github.com/gandli/daily-digest/commit/a9536afbcf9287a89c00c9044282638d1050a532))
* zread wiki desc in Chinese (Accept-Language zh-CN + definition-sentence extractor) ([0fd9199](https://github.com/gandli/daily-digest/commit/0fd9199e49599e76735e68fa710f0f3870800af7))
* zread.ai links alongside deepwiki (TG message + markdown archive) ([dbb578a](https://github.com/gandli/daily-digest/commit/dbb578a4f688ac2603314b642d61a8ce8fdcbec1))
* zread.ai web wiki descriptions (RSC payload scrape, no key) - deep desc per repo ([20effa3](https://github.com/gandli/daily-digest/commit/20effa35caa46d367edbced5b4622343dcf8f4f4))
* **分页导航:** 上下页增加页码指示(📄 当前/总页) + 快捷跳转行(首页/中间/末页, >4页显示); /archive 与 /search 同构 ([#70](https://github.com/gandli/daily-digest/issues/70)) ([39fc413](https://github.com/gandli/daily-digest/commit/39fc4135327e39a9ea6e1ff5f55e9eabba308208))
* **存档三链全覆盖:** replyArchived/renderArchivePage/URL重建回复均改 archiveLinks——repo 用 github.com/<repo> 拼 web.archive, 统一 Telegraph→web.archive→GitHub md 三链 ([#69](https://github.com/gandli/daily-digest/issues/69)) ([6482cd0](https://github.com/gandli/daily-digest/commit/6482cd0561beda7de240b0455ae9a7dcd8aea3a2))
* **存档三链:** 新增 web.archive.org 互联网档案馆兜底快照; 回复链接按 Telegraph → web.archive → GitHub md 优先级展示(archiveLinks helper) ([#68](https://github.com/gandli/daily-digest/issues/68)) ([4ba157b](https://github.com/gandli/daily-digest/commit/4ba157bd15bd133a748e8dad84a4750f2a2c144c))
* 存档回摘要行标注📝摘要(区别于翻译); 加 summarizeZh 自检回归锁(CF bart-large-cnn 摘要→m2m100 译中调用链) ([#67](https://github.com/gandli/daily-digest/issues/67)) ([6ef5638](https://github.com/gandli/daily-digest/commit/6ef5638b6ee541239a196b4b5a8fa62674f1a4ee))
* 网页存档 OG 图保底——缺 og:image 时回退 favicon/apple-touch-icon ([#26](https://github.com/gandli/daily-digest/issues/26)) ([b0a7c26](https://github.com/gandli/daily-digest/commit/b0a7c2645e6362b131b6b4e0dc313687b1ffd432))
* 网页存档回复必含图——四级图链 og:image → twitter:image → apple-touch-icon/favicon → Google s2 ([#28](https://github.com/gandli/daily-digest/issues/28)) ([38d631f](https://github.com/gandli/daily-digest/commit/38d631f3d9cff06aba7c48160068d5c598412f9a))
* 网页非中文内容翻译成中文 + 存档回复统一三行式格式 ([#25](https://github.com/gandli/daily-digest/issues/25)) ([245c7d9](https://github.com/gandli/daily-digest/commit/245c7d981ba6a83dd555d9ead34c8553c7ff3f2e))
* 重发存档回传 telegraph 优先 + done 无 md 时重归档取回存档链接, 不再'无需重复' ([#66](https://github.com/gandli/daily-digest/issues/66)) ([4056847](https://github.com/gandli/daily-digest/commit/4056847cb56cfa33c55fe5380b82aa0227d33c50))
