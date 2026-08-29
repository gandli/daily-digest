// d1.ts 覆盖收口: 三 helper 全分支。纯 stub, 不触网。
import { describe, it, expect, vi } from 'vitest';
import { d1UpsertArchiveIdx, d1PutArchiveFiles, d1ArchivePage } from '../src/d1';

const noDbEnv = {} as never;

describe('d1UpsertArchiveIdx', () => {
  it('DB 未绑定 → 直接返回', async () => {
    await expect(d1UpsertArchiveIdx(noDbEnv, [{ title: 'a/b' } as never], '2026-08-30')).resolves.toBeUndefined();
  });
  it('items 空 → 直接返回', async () => {
    const batch = vi.fn();
    await d1UpsertArchiveIdx({ DB: { batch, prepare: () => {} } } as never, [], '2026-08-30');
    expect(batch).not.toHaveBeenCalled();
  });
  it('正常: upsert 7 参数, topics 逗号连接, 空字段回落 null', async () => {
    const calls: unknown[][] = [];
    const db = {
      prepare: () => ({ bind: (...a: unknown[]) => { calls.push(a); return a; } }),
      batch: async (s: { bind: () => unknown }[]) => { /* noop */ },
    } as never;
    await d1UpsertArchiveIdx({ DB: db } as never, [
      { title: 'Owner/Repo', url: 'u', desc: 'd', descZh: '中文', topics: ['rust', 'ai'] } as never,
      { title: 'Bare' } as never,
    ], '2026-08-30');
    expect(calls).toHaveLength(2);
    expect(calls[0][0]).toBe('owner/repo');
    expect(calls[0][5]).toBe('中文');
    expect(calls[0][6]).toBe('rust,ai');
    expect(calls[1][3]).toBeNull();
  });
  it('batch 抛错 → 静默', async () => {
    const db = { prepare: () => ({ bind: () => [] }), batch: async () => { throw new Error('db down'); } } as never;
    await expect(d1UpsertArchiveIdx({ DB: db } as never, [{ title: 'a/b' } as never], '2026-08-30')).resolves.toBeUndefined();
  });
});

describe('d1PutArchiveFiles', () => {
  it('DB 未绑定 → 直接返回', async () => {
    await expect(d1PutArchiveFiles(noDbEnv, [{ path: 'a.md', content: 'x', message: 'm' }])).resolves.toBeUndefined();
  });
  it('files 空 → 直接返回', async () => {
    const batch = vi.fn();
    await d1PutArchiveFiles({ DB: { batch, prepare: () => {} } } as never, []);
    expect(batch).not.toHaveBeenCalled();
  });
  it('正常: INSERT OR REPLACE 三字段', async () => {
    const calls: unknown[][] = [];
    const db = {
      prepare: () => ({ bind: (...a: unknown[]) => { calls.push(a); return a; } }),
      batch: async (s: unknown[]) => { /* noop */ },
    } as never;
    await d1PutArchiveFiles({ DB: db } as never, [{ path: 'archive/2026/a.md', content: '# hi', message: 'digest: a' }]);
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toBe('# hi');
  });
  it('batch 抛错 → 静默', async () => {
    const db = { prepare: () => ({ bind: () => [] }), batch: async () => { throw new Error('db down'); } } as never;
    await expect(d1PutArchiveFiles({ DB: db } as never, [{ path: 'a', content: 'b', message: 'm' }])).resolves.toBeUndefined();
  });
});

describe('d1ArchivePage', () => {
  it('DB 未绑定 → null', async () => {
    expect(await d1ArchivePage(noDbEnv, 10, 0)).toBeNull();
  });
  it('正常: all + first, 返回 total+rows', async () => {
    const db = {
      prepare: () => ({
        bind: () => ({
          all: async () => ({ results: [{ repo: 'a/b', date: '2026-08-30', url: 'u', summaryZh: '中文', topics: 'rust,ai' }] }),
        }),
        first: async () => ({ n: 3 }),
      }),
    } as never;
    const out = await d1ArchivePage({ DB: db } as never, 10, 0);
    expect(out?.total).toBe(3);
    expect(out?.rows).toHaveLength(1);
    expect(out?.rows[0].summaryZh).toBe('中文');
    expect(out?.rows[0].topics).toBe('rust,ai');
  });
  it('空库 → null', async () => {
    const db = { prepare: () => ({ bind: () => ({ all: async () => ({ results: [] }) }), first: async () => ({ n: 0 }) }) } as never;
    expect(await d1ArchivePage({ DB: db } as never, 10, 0)).toBeNull();
  });
  it('查询抛错 → null', async () => {
    const db = { prepare: () => ({ bind: () => { throw new Error('db down'); } }) } as never;
    expect(await d1ArchivePage({ DB: db } as never, 10, 0)).toBeNull();
  });
});