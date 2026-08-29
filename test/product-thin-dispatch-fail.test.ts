// runProductThin 缺口: dispatch 失败(非 2xx)→ ⚠️ 而非占位"生成中"。product-thin.test.ts 已覆盖命中/坏JSON/dispatch成功。
import { describe, it, expect } from 'vitest';
import { runProductThin } from '../src/index';

type Call = { url: string; body: any };
const calls: Call[] = [];
let dispatchOk = false; // 控制 /dispatches 返回码
let dispatchCalled = false; // 记录 dispatch 是否被触发

globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input);
  if (url.includes('raw.githubusercontent.com')) {
    return new Response('{}', { status: 404 }); // miss → 触发 dispatch
  }
  if (url.includes('/dispatches')) {
    dispatchCalled = true;
    return new Response('{}', { status: dispatchOk ? 204 : 500 });
  }
  if (url.includes('api.telegram.org')) {
    calls.push({ url, body: JSON.parse(String(init?.body ?? '{}')) });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  }
  return new Response('{}', { status: 200 });
}) as typeof fetch;

const env: any = {
  BOT_TOKEN: 'test', CHAT_ID: '944783507', GH_TOKEN: 'g', GH_ARCHIVE_REPO: 'gandli/daily-digest',
  CACHE: { get: async () => null, put: async () => {}, list: async () => ({ keys: [] }) },
};

const sendTexts = () => calls.filter((c) => c.url.includes('/sendMessage')).map((c) => String(c.body?.text));

describe('runProductThin dispatch 失败', () => {
  it('repository_dispatch 非 2xx → 发 ⚠️ 触发失败提示', async () => {
    dispatchOk = false;
    dispatchCalled = false;
    const n = await runProductThin(env, '944783507');
    expect(n).toBe(0);
    expect(dispatchCalled).toBe(true);
    expect(sendTexts().some((t) => t.includes('⚠️ 今日 Hacker News 酷产品尚未生成且触发失败'))).toBe(true);
    expect(sendTexts().some((t) => t.includes('生成中'))).toBe(false);
  });
});