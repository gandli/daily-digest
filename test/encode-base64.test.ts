// P1-1 回归: encodeBase64 大输入不炸 + bit-exact 等价(spread 版在 >~125K 元素即 RangeError)
import { describe, it, expect } from 'vitest';
import { encodeBase64 } from '../src/archive';

describe('encodeBase64: 分块编码', () => {
  it('小输入与 btoa 直编一致', () => {
    const buf = new TextEncoder().encode('hello 中文 🎉');
    expect(encodeBase64(buf)).toBe(btoa(String.fromCharCode(...buf)));
  });
  it('240KB(中文 80K 字符场景) 不抛 RangeError 且可逆', () => {
    const buf = new Uint8Array(240_000);
    for (let i = 0; i < buf.length; i++) buf[i] = i % 256; // 全字节域覆盖
    const b64 = encodeBase64(buf); // spread 版此处必崩
    const back = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    expect(back).toEqual(buf);
  });
});
