// buildRssFromArchive: archive 分支 digest md → RSS feed 惰性重建
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { Env } from '../src/types';
import { buildRssFromArchive } from '../src/index';

const md = `# 2026-08-30

1. **[Show HN: Bolnee-Chat](https://github.com/AniketWathore/bolnee-chat)** ⭐ 1
   - BolneeChat 是一款面向企业网站的自托管 RAG 聊天机器人平台。

   <img src="https://opengraph.githubassets.com/1/x" width="400" alt="x OG 卡">
2. **[show/hn: token linter](https://github.com/ritenv/tokensift)** ⭐ 2
   - 第二项描述。

---

由 daily-digest bot 自动生成
`;

function envWith(): Env {
  return { GH_TOKEN: 'test-token', GH_ARCHIVE_REPO: 'gandli/daily-digest', CACHE: {} } as unknown as Env;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildRssFromArchive', () => {
  it('拉取 archive 分支 digest md → 重建含条目 RSS feed', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ content: Buffer.from(md).toString('base64') }), { status: 200 }),
    );
    const feed = await buildRssFromArchive(envWith());
    expect(feed).toBeTruthy();
    expect(feed).toContain('Bolnee-Chat');
    expect(feed).toContain('tokensift');
    expect(feed).toContain('BolneeChat 是一款');
    // 不出现图片行
    expect(feed).not.toContain('<img');
  });

  it('网络失败 → null', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('nope', { status: 404 }));
    const feed = await buildRssFromArchive(envWith());
    expect(feed).toBeNull();
  });

  it('md 无条目 → null', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ content: btoa('# 2026-08-30\n\n---\n') }), { status: 200 }),
    );
    const feed = await buildRssFromArchive(envWith());
    expect(feed).toBeNull();
  });
});
