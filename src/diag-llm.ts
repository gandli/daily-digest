// diag: 腾讯交互翻译 TranSmart 从 CF Workers 出口可用性测试(免 key)
export async function diagnoseLLM(_env: unknown): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  try {
    const r = await fetch('https://transmart.qq.com/api/imt', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        Referer: 'https://transmart.qq.com/',
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126',
      },
      body: JSON.stringify({
        header: { fn: 'auto_translation', session: '', client_key: 'browser-macOS-1724417653-chrome' },
        model: 'api',
        source: { text_list: ['Skills for Real Engineers', 'A fast framework for building web applications'] },
        source_lang: 'en',
        target_lang: 'zh',
      }),
    });
    const j = (await r.json()) as { auto_translation?: string[]; header?: { ret_code?: string } };
    out.tranSmart = {
      status: r.status,
      ret: j.header?.ret_code,
      zh: j.auto_translation?.join(' | ')?.slice(0, 120),
    };
  } catch (e) {
    out.tranSmart = String(e).slice(0, 100);
  }
  return out;
}
