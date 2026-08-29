// archive 分支历史索引: 扫描全部 md 文件, 按内容分类(X 帖/repo/网页/digest)生成 archive/README.md。
// 解决历史"日期-毫秒"文件名不可辨识的问题; 不重命名(archive:idx.date 与文件名强绑定, 重命名需迁移 KV, 零破坏优先)。
// 用法: npx tsx scripts/archive-index.mts  (可重跑, 幂等刷新 README)
import { execSync } from 'node:child_process';
import { writeFileSync, rmSync } from 'node:fs';

const WORK = '/tmp/archive-index-work';
execSync('git fetch origin archive', { stdio: 'inherit' });
rmSync(WORK, { recursive: true, force: true });
execSync(`git worktree add --detach ${WORK} origin/archive`, { stdio: 'pipe' });

try {
  const files = execSync(`git -C ${WORK} ls-tree -r --name-only HEAD archive/`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 })
    .split('\n')
    .filter((f) => f.endsWith('.md'))
    .sort();

  const rows: string[] = [];
  for (const f of files) {
    const body = execSync(`git -C ${WORK} show HEAD:${f}`, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 });
    const head = body.split('\n', 1)[0] ?? '';
    const base = f.replace(/^archive\//, '');
    let type = 'digest';
    let id = base.replace(/\.md$/, '');
    if (/^# X Post · @/.test(head)) {
      type = 'X 帖';
      id = head.match(/^# X Post · @(\S+)/)?.[1] ?? id;
    } else if (/^# Web Archive · /.test(head)) {
      type = '网页';
      id = head.match(/^# Web Archive · (\S+)/)?.[1] ?? id;
    } else {
      // repo 查询单条卡(#165 新格式头=repo·日期; 旧格式头=日期, repo 在首行加粗链接里)
      const repo = body.match(/\*\*\[([^\]]+)\]\(/)?.[1];
      if (repo) {
        type = 'repo';
        id = repo;
      }
    }
    rows.push(`| ${base} | ${type} | ${id} |`);
  }

  const readme = [
    '# archive 分支索引',
    '',
    '> 由 `scripts/archive-index.mts` 生成(重跑刷新)。文件名: digest=纯日期; X 帖/网页/repo=日期-ms(历史)或 repo 标识(新)。',
    '> 内容按行可检索: Cmd/Ctrl+F 搜 repo 名或 handle 即可定位存档文件。',
    '',
    '| 文件 | 类型 | 标识 |',
    '|---|---|---|',
    ...rows,
    '',
  ].join('\n');
  writeFileSync(`${WORK}/README.md`, readme);
  execSync(`git -C ${WORK} add README.md`, { stdio: 'pipe' });
  execSync(`git -C ${WORK} commit -m 'docs: 全量存档索引(按内容分类, 可检索)'`, { stdio: 'pipe' });
  execSync(`git -C ${WORK} push origin HEAD:archive`, { stdio: 'inherit' });
  console.log(`index done: ${rows.length} 个 md 文件已入 README.md`);
} finally {
  rmSync(WORK, { recursive: true, force: true });
  execSync('git worktree prune', { stdio: 'pipe' });
}
