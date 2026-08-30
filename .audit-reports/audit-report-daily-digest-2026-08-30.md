# 审计白皮书 · daily-digest

- 日期: 2026-08-30
- 提交: main @ 64adc19
- 模式: full (Deep Scan)
- 范围: src/ scripts/ .github/ data/ docs/ 全部
- 综合评分: **86 / B+**
- 技术债估算: **~5.5 人时**（P0 0.5h + P1 2h + P2 3h）

## 评分维度

| 维度 | 分 | 依据 |
|---|---|---|
| 测试 | 9.5 | 841 tests / 57 files, 语句 100% / 函数 100% / 行 100% / 分支 94.28% |
| 稳定性 | 8.5 | 三级降级链 + 多级缓存 + 幂等 pending 标记; 但 archive 静默吞错 |
| 安全 | 8.0 | webhook 常量时验签 + 白名单 fail-closed + secret scan CI; workflow env 泄露面大 |
| 架构 | 8.5 | 模块边界清晰 (archive/lookup/translate/urlmd 单职责), 无循环依赖 |
| 可维护性 | 7.5 | 无 lint、19 处 `as any`、部分 console 截断堆栈 |
| 文档 | 8.5 | 双语文 README + 自动生成手册 + ROADMAP/GOAL/INTERFACES |
| 治理 | 7.0 | dependabot + CHANGELOG 自动化; 缺 SECURITY/CONTRIBUTING/CODEOWNERS, workflow pin 不统一 |

## Issue 清单

### P0（阻断）

**P0-1 · workflow 注入全部 secrets + 硬编码 repo 名**
- 路径: `.github/workflows/product-digest.yml:20-26`
- 代码: `BOT_TOKEN: ${{ secrets.BOT_TOKEN }}` × 7 + `GH_ARCHIVE_REPO: gandli/daily-digest`
- 问题: 7 个 secrets 全量注入 job env（GH_TOKEN 实际未用——脚本走 `env.GH_TOKEN` 但 GITHUB_TOKEN 自动注入）；`GH_ARCHIVE_REPO` 硬编码，改仓库名要改 workflow（#191 回归与此同源）
- 修复: secrets 收窄到实际用到的（脚本只读 env 变量，保留但注释用途）；`GH_ARCHIVE_REPO` 用 `${{ vars.GH_ARCHIVE_REPO || 'gandli/daily-digest' }}`
- 回归测试: 无（workflow 静态文件，人工 review）
- 工作量: 30min

### P1（严重）

**P1-1 · actions 未 SHA pin（同仓库其他 workflow 已 pin）**
- 路径: `.github/workflows/product-digest.yml:29,33`
- 代码: `actions/checkout@v4` / `actions/setup-node@v4`
- 问题: tag 引用可被 move 到恶意 commit; 同仓库 deploy.yml 已用 `3d3c42e5...` pin，不一致
- 修复: 换成 deploy.yml 同款 SHA pin
- 工作量: 15min

**P1-2 · archiveToGitHub 吞错（void 返回）**
- 路径: `src/archive.ts:92` (`export async function archiveToGitHub...: Promise<void>`), L81 `if (!res.ok) console.error(...)`
- 问题: 失败只 console.error 不返回状态; 调用方 (lookup.ts:277/445, index.ts:430, ph.ts:130) 无从感知 → 存档静默丢（#191 即此类静默）
- 修复: 返回 `Promise<boolean>`; 调用方关键路径失败时 `console.warn` + 不阻塞主流程
- 回归测试: 现有 archive 测试补断言返回值
- 工作量: 1h

**P1-3 · console.error 截断堆栈**
- 路径: `src/archive.ts:58,84,124,183` 等 `String(e).slice(0, 80)`
- 问题: 丢失调用栈与错误上下文, 线上排障只能看 80 字符
- 修复: `(e instanceof Error ? e.stack ?? String(e) : String(e))`
- 回归测试: 无需（纯日志路径）
- 工作量: 30min

**P1-4 · CACHE stub 无隔离声明**
- 路径: `scripts/product-digest.ts:32-37`
- 问题: Actions 端 CACHE 全 no-op 且无注释说明「Actions 不写 Worker KV」; 与 #191 教训同源（Actions/Worker 状态割裂）
- 修复: 注释声明隔离边界
- 工作量: 5min

### P2（优化）

| # | 项 | 位置 | 工作量 |
|---|---|---|---|
| P2-1 | `as any` 19 处（runner.ts 12 + import-library.ts 6） | scripts/ | 1h |
| P2-2 | 零 lint 配置（无 eslint / lint script） | package.json | 1.5h |
| P2-3 | 缺 SECURITY.md / CONTRIBUTING.md / CODEOWNERS | 根目录 | 30min |
| P2-4 | 治理文件与 workflow pin 统一 | .github/ | 15min |
| P2-5 | data/ 下 `gen-snapshot.py`/`retry-bulk-put.ts`/`kv-bulk.json` 用途未文档化 | data/ | 15min |

## 验证基线

- `npx tsc --noEmit`: 0 错误
- `npx vitest run`: 841 passed (57 files)
- `npm audit --omit=dev`: 0 vulnerabilities
- coverage: 语句 100% / 函数 100% / 行 100% / 分支 94.28%
