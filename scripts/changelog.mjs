#!/usr/bin/env node
// 重建 CHANGELOG.md — 替代坏掉的 conventional-changelog-cli@5.0.0
// 坏因: git-raw-commits 与新版 git 不兼容 → 每段空 header + 重复标题堆积
// 逻辑: 按 tag 区间扫 conventional commits(feat/fix/refactor/perf), 组 版本段; 未发布提交归 Unreleased
// 幂等: 从零重建, 无重复; 只认 feat/fix/refactor/perf(省略 docs/chore/test/style)

import { execSync } from 'node:child_process';

const tags = execSync(`git tag --sort=v:refname`, { encoding: 'utf8' }).split('\n').filter(Boolean);
const tagDate = (t) => execSync(`git log -1 --format='%ad' --date=short ${t}`, { encoding: 'utf8' }).trim();
const TYPE_EMOJI = { feat: '✨', fix: '🐛', refactor: '♻️', perf: '⚡' };
const SECTION = { feat: '### Features', fix: '### Bug Fixes', refactor: '### Refactors', perf: '### Performance' };

const commitLines = (range) => {
  try {
    // range 含 'root' 视为单参: git log <ref> (该 ref 全部祖先, 无 parent 限制)
    const arg = range.startsWith('root') ? range.replace('root..', '') : range;
    return execSync(`git log ${arg} --format='%ad|%s' --date=short`, { encoding: 'utf8' })
      .split('\n').filter(Boolean);
  } catch { return []; }
};

const parse = (lines) => {
  const out = {};
  for (const l of lines) {
    const [date, subj] = l.split('|');
    const m = subj.match(/^(feat|fix|refactor|perf)(?:\(([^)]+)\))?: (.+)/);
    if (!m) continue;
    const [, type, scope, desc] = m;
    (out[type] ??= []).push({ scope, desc, date, short: subj.slice(0, 60) });
  }
  return out;
};

const groupBy = (list, key) => {
  const o = {};
  for (const it of list) (o[it[key]] ??= []).push(it);
  return o;
};

const render = (groups) => {
  let s = '';
  for (const t of Object.keys(SECTION)) {
    const items = groups[t] ?? [];
    if (!items.length) continue;
    s += `\n${SECTION[t]}\n\n`;
    const byScope = groupBy(items, 'scope');
    for (const g of Object.keys(byScope).sort()) {
      s += `* **${g}:** ${byScope[g].map((i) => i.desc).join('; ')}\n`;
    }
  }
  return s;
};

const verSection = (range, ver, date) => {
  const groups = parse(commitLines(range));
  const body = render(groups);
  return `# [${ver}](https://github.com/gandli/daily-digest/compare/${ver}) (${date})${body}\n`;
};

const lines = [];
// Unreleased: 最新 tag 之后(feat/fix) 的提交
const latest = tags[tags.length - 1];
const un = parse(commitLines(`${latest}..HEAD`));
const unBody = render(un);
if (unBody) lines.push(`# [Unreleased]${unBody}\n`);

// 历史段: 新→旧。首段 = 第一个 tag 的全部祖先
lines.push(verSection(`root..${tags[0]}`, tags[0], tagDate(tags[0])));
for (let i = 1; i < tags.length; i++) {
  lines.push(verSection(`${tags[i - 1]}..${tags[i]}`, tags[i], tagDate(tags[i])));
}

const out = lines.join('');
process.stdout.write(out);
