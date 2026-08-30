# [v0.0.1](https://github.com/gandli/daily-digest/compare/v0.0.1) (2026-08-26)
### Features

* **/search:** 结果当页英文描述批量译中(translateBatch)——用户要求所有项目带中文描述; 失败保原文明示 (#72); 结果分页换 inline keyboard 翻页(sch:page:query), 替代截断提示; 删弃用 done() (#56)
* **/trending:** 缓存存 {chunks, repos}, 重放用 sendPerRepoMessages 带 OG 图——修复缓存命中只纯文字无图 (#65); 当天 trending 固定, 改用缓存(useCache=true)不必每次重抓; cron 已存 digest:<date>, 二次起秒回 (#62)
* **library:** GitHub 星标 + Chrome 书签导入管线 (#47)
* **lookup:** 当日重复查询回存档数据而非提示已查询过 — 读 archive:idx 索引回描述+存档链接+OG图, 索引缺失才落旧提示 (#52)
* **search:** /search 支持搜索导入的星标/书签库 (#48)
* **undefined:** 自动化 changelog — GitHub Action 用 conventional-changelog 在 main push 时更新 CHANGELOG.md 并提交回 main (#77); 存档回摘要行标注📝摘要(区别于翻译); 加 summarizeZh 自检回归锁(CF bart-large-cnn 摘要→m2m100 译中调用链) (#67); 重发存档回传 telegraph 优先 + done 无 md 时重归档取回存档链接, 不再'无需重复' (#66); X 帖视频 sendVideo 内嵌播放(mp4 直链+supports_streaming), 失败逐级落缩略图卡/纯文字 (#43); X 帖翻译首选 FxEmbed /zh-cn 内嵌翻译(Grok), 空则落四级链 (#41); X 帖卡片必带图——photo直链/video缩略图/帖内repo OG图/s2 favicon 四级配图 (#40); extractOgImage 对齐 open-graph-scraper 字段覆盖 (#38); URL 重发语义——未翻译/缺描述时重发自动重跑全管线 (#31); X 帖正文翻译成中文(原文+译文双段呈现) (#30); 网页存档回复必含图——四级图链 og:image → twitter:image → apple-touch-icon/favicon → Google s2 (#28); 网页存档 OG 图保底——缺 og:image 时回退 favicon/apple-touch-icon (#26); 网页非中文内容翻译成中文 + 存档回复统一三行式格式 (#25); /search 描述接入 CF Summarization(X帖+网页) (#24); /search 菜单项 + X 帖子 Telegraph 存档 + URL 内容 repo 链接联动 (#20); URL 存档回复带 OG 图(sendPhoto, caption=确认+存档链接) (#19); URL/X 帖子存档确认消息附 GitHub 存档链接 (#18); X/Twitter post archive via FxEmbed API (#13); any-URL to markdown archive (3-tier free chain: Markdown-for-Agents → AI.toMarkdown → Browser Rendering) (#12); lookup dedup (KV daily) + desc cache/sync (7d TTL) + og-images dir on archive branch + /search command (#9); README beautify (hero SVG + badges + structure) + archive/Telegraph OG images (URL refs, zero subrequests); 55→57 tests (#8); strip deepwiki template opening (This page provides... intro to X) → use real description after it; verified ai-hedge-fund/QtScrcpy/open-design; lookup fallback to GitHub repo desc translation when zread/deepwiki have no index (new repos); zh desc used directly; +2 tests; GitHub link → single-repo lookup (desc via zread/deepwiki/translate + OG image + archive); extractRepo +7 tests; bot command menu (setMyCommands: /trending /help /archive) + /help /archive handlers; zread extractor prefers Overview/概览 section (highest priority), then repo-name def, then longest; +overview test; desc must come from zread/deepwiki only (skip desc when both miss) + render skip; +5 tests (shape/obligation/render); merge archive into main repo (archive/ dir), default GH_ARCHIVE_REPO=gandli/daily-digest; zread serial rate-limit (anti-throttle) + 15s timeout; deepwiki 45s; desc resolver chain (zread zh -> deepwiki en overview -> translate zh) + TG-side OG fetch to fit subrequest budget; zread wiki desc as primary description, translation as fallback only; HTML layered layout; HTML parse_mode with layered layout (title/desc/wiki/tags) - back from MarkdownV2; MarkdownV2 formatting + repo topics as tags (first 4 repos, subrequest budget); per-repo message with OG image as photo + full entry as caption (fallback to text); one message per project (header on first, N/M prefix, footer on last); zread wiki desc in Chinese (Accept-Language zh-CN + definition-sentence extractor); zread.ai web wiki descriptions (RSC payload scrape, no key) - deep desc per repo; zread.ai links alongside deepwiki (TG message + markdown archive); OG image album per repo (sendMediaGroup, retry-with-drop on WEBPAGE_CURL_FAILED); TranSmart translation layer (chain: AI→TranSmart→Google→MyMemory→EN); /run secured by token; /run manual trigger (test-period, closed once WEBHOOK_SECRET set); wire TranSmart-era secrets; add 9Router LLM translation layer (opt-in via LLM_BASE_URL secret, off by default); daily-digest v1 - trending digest pipeline (#1)
* **分页导航:** 上下页增加页码指示(📄 当前/总页) + 快捷跳转行(首页/中间/末页, >4页显示); /archive 与 /search 同构 (#70)
* **存档三链:** 新增 web.archive.org 互联网档案馆兜底快照; 回复链接按 Telegraph → web.archive → GitHub md 优先级展示(archiveLinks helper) (#68)
* **存档三链全覆盖:** replyArchived/renderArchivePage/URL重建回复均改 archiveLinks——repo 用 github.com/<repo> 拼 web.archive, 统一 Telegraph→web.archive→GitHub md 三链 (#69)

### Bug Fixes

* **/archive:** 翻页 callback 的 answerCallbackQuery 放 finally——中间抛错(重复点击 message not modified/KV 抖动)时答收回不到, 按钮永不消转圈 (#55)
* **/lookup:** replyArchived 索引缺失时 re-lookup 归档返回存档信息, 不再回旧提示'已查询过'——保持用户硬性要求(已查过且归档失败的 repo 重发应得存档数据) (#61)
* **/search:** 翻页 query 存 KV(search:q:<token>) 而非塞 callback_data——callback_data 64B 上限致长 query 截断解码残缺, 翻页失效。token=query 确定哈希, 短且幂等 (#59)
* **/search /trending:** 修复命令无响应 + /archive 分页/Telegraph/年份支持 (#53)
* **/trending:** 去掉误加的 25s 描述链 deadline——它掐断 zread 链致 descZh 全空(消息无描述)+发送循环预算内终止(只发8条)。cron 同款链路已验证 10/10 全中文描述, 与 cron 一致跑完整链 (#58); 自调 /run 被 CF 拦(Worker→自身 workers.dev 橙云 1003/1042)→改直调 runDigest, 描述链给 25s deadline, 超时省略描述照发 (#57)
* **P1-1:** btoa spread stack overflow on large buffers -> chunked encodeBase64 (#14)
* **P1-2:** /run token moved from URL query to POST X-Runner-Token header (CWE-598) (#15)
* **audit:** P1-A Telegraph 中文守卫 + P1-B lookup 网络错误回复用户; cleanup 死代码/诊断日志/文件名误报; +5 tests (#2)
* **ci:** seed search:index 加 --remote——前次写入本地非生产, /search 仍报索引未初始化 (#54)
* **kv:** KV put 失败不再杀 webhook 主路径 (#49)
* **lookup:** indexArchivedItems 提前到 archive try/catch 外, 避免 OG 图抓取失败导致索引永远缺失形成 seenToday 死循环
* **og:** 相对路径 ../og-images → ../../og-images — md 在 archive/<year>/ 下, 原路径解析到 archive/archive/og-images 404 (#51)
* **search:** 用法/帮助文案去掉 <关键词> 尖括号 — Telegram HTML 模式下被当未闭合标签打 400 (#50)
* **telegraph:** X 帖 archive:tg 键用完整 stamp(含ms)防同日多条互覆盖——digest 日期键, X帖时间戳键 (#63)
* **undefined:** favicon 兜底拒收 ICO 格式(TG sendPhoto 仅 JPG/PNG/WebP), 跳过留给 s2 保底必返 PNG (#39); repo OG 图改走自家 og-images 存档域优先——官方 githubassets 对 TG 出口 IP 池限 100req/IP 易耗尽致 sendPhoto 失败降纯文字 (#37); 🌐中文翻译段从未发出——主卡片在翻译前已发, zhLine 计算后未拼进任何消息 (#36); 移除🀄 emoji, 翻译段标签改用 🌐 (#35); X 帖卡片残余英文中文化——媒体标签(图片/视频/GIF) + 时间戳转北京时间 YYYY-MM-DD HH:mm (#34); X 帖确认卡摘要强制中文(短帖直译/长帖摘要后校验), 索引 descZh 同步回填 (#33); extractOgImage 加固——secure_url/twitter:image:src 变体 + &amp; 实体解码 + 协议相对 // + 相对路径拒绝 (#27); /search 结果附描述行 (#23); 审计 v2——/search 链接补年目录 + stamp 单次计算 + X帖 repo 联动 (#22); /search uses KV archive index (code search can't see non-default branches) (#11); lookup prefers deepwiki overview (reliable clean summary) over zread which may pick架构 section; +debug log; zread extractor picks 概述 section over 架构概览 — relax def-verb for overview blocks + handle ##/正文同块; +tests; /trending forces full pipeline (useCache=false) so messages include OG images; /help now replies with HELP content (was registering menu only); zread extractor prefers definition paragraph containing repo name (was picking longest/minor-subsystem block, e.g. hermes skills/curator text); deepwiki extractor regex stale (page structure changed 2026-08) - 7/7 real repos now extract EN overview; +2 real-structure tests; archive to dedicated 'archive' branch (readd branch param lost in merge churn); rm temp workflows, stray archive dir; descZh writeback to original items (translateBatch returns new array) + TranSmart repair pass for non-Chinese slots; OG album - worker downloads images, multipart attach:// upload (TG fetch was rate-limited); unescape HTML entities from scraped descriptions before re-escaping (omarchy '&'); switch Workers AI to m2m100-1.2b (llama-3.1 deprecated 2026-05); translate errors surfaced via /preview; fail-closed webhook when WEBHOOK_SECRET unset; real KV namespace id
* **url 重发:** done 状态回存储档链接而非'无需重复'——markProcessed 存 md stamp, 重发拼 .md 存档链接 (#64)
* **zread:** 慢响应适配 — 75s 超时 + 504 重试 (#46)
* **存档链接:** 精简重复 emoji——统一单个 📎 前缀, 键名改纯文字(Telegraph/互联网档案馆/GitHub md), 去掉每链一个图标 (#71)

### Refactors

* **undefined:** shouldReprocess 三态化(first/retry/done) + done 明确提示 (#32); archive to dedicated 'archive' branch (main stays code-only) + ARCHIVE.md pointer; drop 9Router layer; chain = Workers AI → Google → MyMemory(+email quota) → EN fallback

# [v0.0.2](https://github.com/gandli/daily-digest/compare/v0.0.2) (2026-08-26)
### Features

* **/archive:** 每条标题指向原链接(https://github.com/repo); replyArchived 标题同款 (#89)
* **/archive 排版:** 每条多行结构化(标题/📝摘要/🏷标签/📎三链); archive:idx 存 topics 供标签; replyArchived 同款加标签 (#83)
* **/help:** 排版分组优化——命令/链接分区 + <b>加粗标题 + 空行间隔, 更易读 (#85)
* **/product:** 深摘要分块续跑——遍历全部未缓存 url, KV命中直接读, 未命中每请求最多2篇生成, 其余下次 /product 续跑累积补全全部10篇; 打破单请求30s墙钟限 (#114); 摘要加引文(💬 原文核心句, zeli 式) + 深度摘要结果存档 KV(7天)防重抓重生成; summarizeZhDeep 返回 {summaryZh,quote} (#107); 加 Telegraph 独立存档页(archive:tg:product:<date>) + 三链首项 Telegraph 优先——对齐 trending (#101); 空正文条目拉 url 正文 → CF summarize 中文摘要(分批2防子请求爆); 无url/失败回退标题翻译 (#98); 每条补中文描述(标题翻译) + 领域标签(topicsFromTitle) + 渲染📝描述/标签——修复 HN 条目无描述/翻译/摘要/标签 (#97); HN 源扫描范围 30→60 个 top 凑满 10 条(Show HN/GitHub 在 top 占比不高, 30 常不足 10) (#94)
* **/product OG:** GitHub repo → GitHub OG 卡; 非 GitHub 网页 → 抓页面 og:image 作封面; 保留自托管→官方 retry (#99)
* **/product 摘要:** url 正文截断 2000→6000 字符——让 OpenRouter 吸收性能细节, 摘要对齐 zeli 质量(实测 LatticeDB 含 0.13μs/0.83ms 等指标) (#106)
* **/trending:** 每 repo 消息底部加存档三链(Telegraph·Wayback·GitHub md); renderMessage 加 archiveRepo 参数 (#86)
* **X帖嵌套文章:** 利用 tweet.article.blocks 全文存档——嵌套文章(x.com/i/article/...)不再只存链接; md+Telegraph含标题+正文; articleToText 提取纯文本 (#116)
* **fanout:** X帖多repo用精简卡(标题+GitHub描述+图+链接)——每repo~2子请求全并发9≈18<50, 单请求全出9个; 完整lookupRepo(5-6子请求×9>50铁超)只用于单repo查询; 仍索引/search (#118)
* **typing:** 慢命令(/trending /product /archive /search + URL/repo 查询)收到即显示'正在输入…'(sendChatAction)——低成本高回报, 处理 2-30s 用户知道在跑; /help即时跳过 (#119)
* **undefined:** /product OpenRouter 深度中文摘要(回退 CF bart) (#102); /archive 项目间空行间隔; 存档三链第三项统一 'Archive'(原'GitHub md'); /product(HN酷产品)每条补三链——所有项目/帖子/网页都有三链 (#88); /product 命令 — HN 新产品/开源项目源, 仿 trending 独立推送/缓存/存档, 不与 digest 合并; CF Summarization 中文摘要; cron 每日推送 (#82); 每日低速增量补星标仓缺/未译描述 — backfillDescriptions(cron, 每天40条, deepwiki→译中→lookup:desc); /search 渲染优先取 lookup:desc 覆盖 (#80)
* **urlmd:** 加 markdown.new 免 key 兜底(覆盖 JS 动态页)——URL→markdown 七级链可靠 (#112); 加 md.genedai.me reader(有 key) 作 Jina 失败兜底——URL→markdown 多服务可靠; key 存 CF secret (#111); Jina Reader r.jina.ai 优先 URL→markdown(有 key)——干净 markdown 去导航噪声, 通用覆盖普通官网; key 存 CF secret (#110)
* **预览:** sendPerRepoMessages 降级路径开链接预览 + link_preview_options.url 指定核心链接(ogUrl)——每条消息稳定预览可预览目标(GitHub/repo/官网) (#115)

### Bug Fixes

* **/product:** 深摘要单篇硬10s超时(必带)——七级url链+OpenRouter慢致30s waitUntil爆, 汇总缓存不落(响应差根因); 超时落标题翻译保缓存/主卡必达 (#113); 深度摘要 4→2 篇 —— 4篇(OpenRouter+urlToMarkdown+Telegraph)仍踩30s waitUntil限致缓存不落; 2篇≈10s保缓存/主卡必达 (#105); 深度摘要只做前4篇——全量10篇(OpenRouter+urlToMarkdown)超30s waitUntil限致缓存永不落/主卡不发; 前4篇≈20s保功能 (#104)
* **/product 10条:** HN 源改 Algolia search_by_date tags=story,show_hn——一次拿当日 Show HN 新品, 替代逐条扫 topstories(前60可能0条, 凑不满10) (#95)
* **/product 深度摘要:** openrouter/free 随机路由语言不稳→固定中文模型候选按序尝试(minimax-m3→ox-alpha→dots-3); 实测出 zeli 级摘要+引文; 单点429多模型兜底 (#108)
* **CI:** deploy.yml 加 workflow_dispatch 逃生门——GH 对未完成 PR CI 的 squash merge 去重跳过 main push CI(部署不跑), 手动 dispatch 补部署; deploy job 支持 dispatch 触发 (#120)
* **undefined:** X帖多repo fanout 中断可续跑(成功才置seen) (#117); repo 联动分批串行(3/批)全量解析 + 主卡不阻塞——串行单waitUntil超时截断后半repo, 并发超50子请求, 分批折中保全部 (#92); X/网页内容 repo 联动全量解析(去 3 条上限→10); 顺序 await 防 50 子请求爆——修复 X 帖只解析部分 repo (#91); extractRepo 剥离 .git 克隆后缀——修复 https://github.com/apple/container.git 误判为 apple/container.git 的 404 bug (#90)
* **urlmd:** 加方法4 HTML 剥文本兜底(viaHtmlStrip)——普通非 CF 官网(DBLift/Typebase)三级链全失败(Browser Rendering 未配置)致深摘要无正文; HTML 剥 nav/script/tag 取正文; urlToMarkdown 不再 throw 返回空串, lookup 加空串守卫 (#109)
* **存档三链:** 去 📎 双 emoji 前缀 + 互联网档案馆→Wayback 短名——三链行精简 (#84)

### Refactors

* **undefined:** OpenRouter model auto-beta → free(万能免费路由, 自动选可用免费模型) (#103); /search 菜单说明与 HELP 完全对齐(去 '/search 关键词' 后缀) (#100); setMyCommands 菜单说明与 HELP 对齐(去掉获取/查看动词, /search 补命令示例) (#96); product 菜单/标题文案 'HN 新品/开源' → 'HN 酷产品' (#87)

# [v0.1.0](https://github.com/gandli/daily-digest/compare/v0.1.0) (2026-08-30)
### Features

* **card:** trending 序号 + Telegraph 匿名兜底 + product og 图 (#148); og实体图+底部三链+AI标签+Telegraph预览 (#135)
* **desc:** deepwiki 描述统一为 zread 风格项目介绍句式 (#139)
* **link:** fanout repo 卡升级为完整三段式对齐 product/trending (#130)
* **og:** Telegram 当图床 — og 图上传 TG 存 file_id 复用, 免存 GitHub (#133)
* **product:** Telegraph 标题 LLM 生成 (#144); Worker /product 瘦身 — fetch JSON 秒回 + dispatch 兜底 (#124); Actions 重管线 — product-digest.yml + scripts/product-digest.ts (#123); zeli 风格卡片 — 标题下显示作者 by + 相对时间 (#122)
* **repo:** repo 卡加 codewiki 链接, 三 wiki 链接齐全 (#132)
* **search:** 词 AND 匹配 + 名称相关度排序 (#149)
* **tweet:** Telegraph 页标题用 LLM 帖子标题 (#140)
* **undefined:** 三命令当日缓存补全——/hn 加 Worker 缓存+pending 标记, /gt 重放带 OG 图; 三命令当日缓存补全——/hn 加 Worker 缓存+pending 标记, /gt 重放带 OG 图; 三命令当日缓存补全——/hn 加 Worker 缓存+pending 标记, /gt 重放带 OG 图; 短命令唯一切换 + PH GraphQL 对齐 Decohack + 覆盖率 97/92/90 + 安全加固 (#169); 短命令别名 /gt /hn(菜单只展示短名, 长命令永久兼容) (#168); /ph Product Hunt 每日热门(feed 免 key 直拉 + 译中 + 产品卡 + 当日缓存 + 榜单存档) (#167); 无标题/烂标题的网页存档用 LLM 生成标题 + 标题来源链 (#166); archive 分支全量索引脚本(历史日期命名文件按内容分类可检索); article 引用帖提取源双域名兜底(fixupx → fxtwitter) (#164); 单仓卡补 Telegraph 建页 + Wayback 主动保存 + 响应内容契约矩阵 (#162); 一条消息含多个 GitHub repo 链接 → 逐仓 fanout 发卡(N/M 序号) (#161); 存档批量化推送(KV 缓冲+Git Data API) + 卡片序号仅多条批量显示 (#158); 用户手册自动化管线: e2e 场景驱动 + 标注截图 + AI 正文 + CI 重生成 (#156); archiveUrl 普通 URL 存档也创建 Telegraph 页 (#153); FxEmbed v2 API + 多图 mosaic 拼图 (#152)
* **ux:** Trending LLM 标题 + repo 卡作者/日期 + 搜索同义词 (#143)

### Bug Fixes

* **card:** wiki 三链移到倒数第二行(存档前) + fanout 描述优先 wiki (#136)
* **cards:** 标题与正文空行间隔 + wiki链接/tags/三链段空行统一 (#134); 标题/引文中文 + 串行顺序 + Telegraph 匿名建号 + trending 对齐 + changelog 仅 tag 触发 (#125)
* **ci:** changelog workflow checkout main——tag 事件 detached HEAD 无法 push (#172)
* **link:** 发链接响应卡片统一到 repo 卡三段结构 (#128); 发链接响应卡片标题可点, 对齐 product 卡三段结构 (#127)
* **product:** 并发化 urlToMarkdown + sendPerRepoMessages 绕 waitUntil 30s 墙 (#121)
* **search:** X 帖增量写入 search:index (#141)
* **test:** 日期依赖测试改用 today() 动态生成 lookup 缓存 key
* **translate:** 技术语境翻译 prompt — LLM 保留为'大语言模型', 不误译'法学硕士' (#137)
* **tweet:** 长正文翻译失败 + fxZh 被 isChinese 误判弃用 (#138); 非中文原文 → 中文替换, 移除 🌐 翻译块 (#131); 回复卡+确认卡合并成一张对齐 product 卡 (#129)
* **undefined:** 提示文案命名对齐(GitHub Trending/Hacker News 酷产品)+标点统一; 提示文案命名对齐(GitHub Trending/Hacker News 酷产品)+标点统一; 提示文案命名对齐(GitHub Trending/Hacker News 酷产品)+标点统一; 提示文案命名对齐(GitHub Trending/Hacker News 酷产品)+标点统一; 提示文案命名对齐(GitHub Trending/Hacker News 酷产品)+标点统一; 提示文案命名对齐(GitHub Trending/Hacker News 酷产品)+标点统一; 存档索引标题提取收紧——X 帖取正文首行(跳过元数据/链接行), 网页剥 title:/description: 前缀与导航样板; 存档索引标题提取收紧——X 帖取正文首行(跳过元数据/链接行), 网页剥 title:/description: 前缀与导航样板; repo 存档文件名/内容头带 repo 标识(纯日期名不可辨识, 疑似丢失) (#165); X article 引用帖(text 为裸 x.com/i/article 链)→ 转 fixupx 提取正文 (#163); isChinese 门槛 5→4 修复 4 字纯中文误判 + 补两处行为锁定用例 (#159); X article 帖卡片标题/正文/标签喂裸链接导致 LLM 拒绝语 (#151); 重复链接卡片回具体内容(标题+摘要)而非梗概 (#154)
* **webhook:** 删 Daily Digest 报头前缀, Telegraph title 直用日期 (#142)

### Refactors

* **audit:** esc 去重 + 删死代码 (#145)
* **review:** 删 Source 抽象 + sendVideoOrText 死代码 (#146)

# [v0.2.0](https://github.com/gandli/daily-digest/compare/v0.2.0) (2026-08-30)
### Features

* **scheduled:** 08:30 cron 追加 Product Hunt 每日自动推送 + 覆盖率收口
* **webhook:** X 帖重发去重 — done 回缓存卡片, 不重建管线
* **wrangler:** 恢复 D1+Vectorize binding — 资源已创建

### Bug Fixes

* **archive:** D1 backfill + flush诊断 + scheduled优先刷存档 (#180)
* **archiveUrl:** Telegraph 页加中文翻译段(摘要) 置顶 (#189)
* **lookup:** 多repo精简卡全并发, 去deepwiki/翻译/索引, 防30s时限砍断 (#184); fanoutRepoRefs 分批串行, 防子请求超限丢尾部 repo (#183)
* **translate:** isChinese 排除日文假名, 防日文透传不翻译 (#182)
* **undefined:** GH_ARCHIVE_REPO 消毒正则删 / 导致 archive 全 404(回归) (#191)
* **vec:** 语义补页加相似度阈值(0.55), 防低分噪声污染 /search (#181)
* **wrangler:** 摘除 D1 binding — DB 在 CF 账号不存在, 阻塞 deploy; 摘除 Vectorize binding — index 不存在阻塞 deploy

