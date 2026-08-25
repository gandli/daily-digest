# daily-digest · archive 分支

只放数据：`archive/`(每日存档 md) + `og-images/`(OG 卡图)。代码在 main。

- bot 推送时通过 GitHub Contents API 直接 PUT 到本分支（`src/archive.ts`）
- 本分支无 CI、无代码、无依赖——不要往这里提交 src/
