# data/ — 辅助数据与工具

## 文件用途

| 文件 | 用途 |
|------|------|
| `gen-snapshot.py` | 读 `library.jsonl` → 生成库目录快照 markdown（按语言/文件夹分组） |
| `retry-bulk-put.ts` | 将 `kv-bulk.json` 分批写入生产 KV（配额重置后重试用） |
| `kv-bulk.json` | 示例键值数据（单条 bookmark 键） |
| `lib-index.json` | 库索引（自动生成，不手改） |
| `library.jsonl` | GitHub 星标 + Chrome 书签合并数据（`src/ingest/` 管道产出） |

## 非关键路径

这些文件仅供离线维护和一次性迁移，不参与 CI 或 Worker 运行时。