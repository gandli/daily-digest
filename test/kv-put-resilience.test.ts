import { describe, it, expect, vi, beforeEach } from 'vitest';

// KV put 失败(额度429/网络)不得杀 webhook 主路径——回归锁: seenToday/shouldReprocess/markProcessed/runDigest 缓存写
const sendMock = vi.fn();
vi.mock('../src/notify', () => ({
  sendTelegram: (...a: unknown[]) => { sendMock(...a); return Promise.resolve(); },
  sendPerRepoMessages: () => Promise.resolve(),
  sendPhotoOrText: () => Promise.resolve(),
  sendVideoOrText: () => Promise.resolve(),
  registerCommands: () => Promise.resolve(),
}));

const store = new Map<string, string>();
function kvStub(failPut: boolean) {
  return {
    get: (k: string) => Promise.resolve(store.get(k) ?? null),
    put: (k: string, v: string, _o?: unknown) =>
      failPut ? Promise.reject(new Error('KV put() limit exceeded for the day.')) : (store.set(k, v), Promise.resolve()),
    list: ({ prefix }: { prefix: string }) =>
      Promise.resolve({ keys: [...store.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true }),
  };
}
const env = {
  BOT_TOKEN: 't', CHAT_ID: '1',
  CACHE: kvStub(true),
} as any;

describe('KV put 失败不杀主路径', () => {
  beforeEach(() => { sendMock.mockClear(); });

  it('seenToday: put 抛错仍返回 false 并继续处理', async () => {
    const { seenToday } = await import('../src/lookup');
    await expect(seenToday(env, 'x/y')).resolves.toBe(false);
  });

  it('shouldReprocess: put 抛错仍返回 first', async () => {
    const { shouldReprocess } = await import('../src/lookup');
    await expect(shouldReprocess(env, 'https://example.com/a')).resolves.toBe('first');
  });

  it('markProcessed: put 抛错不抛出', async () => {
    const { markProcessed } = await import('../src/lookup');
    await expect(markProcessed(env, 'https://example.com/b', true, true)).resolves.toBeUndefined();
  });

  it('runDigest: 缓存写抛错不影响 digest 完成(走到存档段不炸)', async () => {
    // fetch 源在无网络环境下返回空列表 → 走完管线, 断言不抛且正常返回
    const { runDigest } = await import('../src/index');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await expect(runDigest(env, true)).resolves.toEqual(expect.anything());
    } finally {
      spy.mockRestore();
    }
  });
});
