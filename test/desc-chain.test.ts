// 描述解析链测试: 输出必须是中文, 且按 zread → deepwiki → repo描述翻译 顺序兜底。
// 跑法: npx vitest run
import { describe, it, expect } from 'vitest';
import { extractDesc } from '../src/zread';
import { extractDeepwikiOverview } from '../src/deepwiki';

const CJK = (s: string) => (s.match(/[\u4e00-\u9fff]/g) ?? []).length;
const isZh = (s?: string | null) => !!s && CJK(s) > s.length * 0.3;
const payload = (body: string) => 'x'.repeat(30000) + body + '\nSources: foo.md, bar.ts';

// ---------- zread 提取 ----------
describe('extractDesc: zread 中文提取', () => {
  it('英文正文 → 拒绝(null, 触发下一级兜底)', () => {
    const p = payload('\n## Overview\n\nCodex CLI is an open-source coding agent by OpenAI. It runs locally.\n');
    expect(extractDesc(p, 280)).toBeNull();
  });

  it('中文定义句 → 接受且为中文', () => {
    const p = payload('\n## 概览\n\nCodex CLI 是 OpenAI 的开源编码 Agent，可在你的计算机上本地运行。它是一个 Rust 原生系统。\n');
    const d = extractDesc(p, 280);
    expect(d).not.toBeNull();
    expect(isZh(d!)).toBe(true);
  });

  it('编号目录/JS 杂讯 → 跳过', () => {
    const p = payload('\n## 目录\n\n1. [快速开始](2-quick) — 安装说明\n\n## 定位\n\nECC 是一款开源的 Agent 支撑操作系统，它将 AI 编程 Agent 从单打独斗转变为协同工作的工程系统。\n');
    const d = extractDesc(p, 280);
    expect(d).not.toContain('static/chunks');
    expect(isZh(d!)).toBe(true);
  });
});

// ---------- deepwiki 提取(英文, 待翻译) ----------
describe('extractDeepwikiOverview: 英文 overview 提取', () => {
  // 仿 deepwiki RSC payload: Overview 标题 + details 源文件列表 + 正文
  const dwBody = (title: string, desc: string) =>
    `Overview: ${title}\n\n<details>\n<summary>Relevant source files</summary>\n\nThe following files were used:\n\n- [file1.ts](file1.ts)\n- [file2.ts](file2.ts)\n</details>\n\n\n\n${desc}\n\n## How it works`;

  const desc = 'Everything Claude Code (ECC) is a harness-native operator system designed for production-grade agentic work. Originally an Anthropic Hackathon winner, ECC has evolved into a comprehensive suite of 67 agents, 278 skills, and 94 components.';

  it('提取 Overview 正文(纯英文文本)', () => {
    const d = extractDeepwikiOverview(dwBody('Everything Claude Code (ECC)', desc), 400);
    expect(d).not.toBeNull();
    expect(d!).toContain('harness-native operator system');
    expect(d!).not.toContain('Relevant source files'); // 源文件列表剔除
    expect(d!).not.toContain('.ts'); // markdown 链接文本剔除
    expect(d!.length).toBeGreaterThan(40);
  });

  it('超长 → 截断到 maxLen', () => {
    const long = desc + ' And '.repeat(200);
    const d = extractDeepwikiOverview(dwBody('X', long), 120);
    expect(d!.length).toBeLessThanOrEqual(120);
    expect(d!.endsWith('…')).toBe(true);
  });

  it('无 Overview 结构 → null', () => {
    expect(extractDeepwikiOverview('no structure here at all', 400)).toBeNull();
  });

  it('真实结构1(omarchy): 正文在 "## Purpose and Scope" 标题后', () => {
    const payload =
      'x'.repeat(200) + `\nOverview\n\n<details>\n<summary>Relevant source files</summary>\n\n- [a.ts](a.ts)\n</details>\n\n\n\n## Purpose and Scope\n\nThis page provides a high-level introduction to Omarchy, its architecture, core components, and design philosophy. It serves as an entry point for understanding the system.\n\n## Design`;
    const d = extractDeepwikiOverview(payload, 400);
    expect(d).not.toBeNull();
    expect(d!).toContain('high-level introduction to Omarchy');
    expect(d!).not.toContain('Relevant source files');
  });

  it('真实结构2(ECC): 冒号标题紧邻 details, 正文紧跟', () => {
    const payload =
      'y'.repeat(300) + `Overview: Everything Claude Code (ECC)\n\n<details>\n<summary>Relevant source files</summary>\n\nThe following files were used:\n</details>\n\n\n\nEverything Claude Code (ECC) is a harness-native operator system designed for production-grade agentic work. Originally an Anthropic Hackathon winner.\n\n## How it works`;
    const d = extractDeepwikiOverview(payload, 400);
    expect(d).not.toBeNull();
    expect(d!).toContain('harness-native operator system');
  });
});

// ---------- 100% 中文守卫 ----------
import { isChinese } from '../src/translate';

describe('isChinese: 最终输出守卫', () => {

  it('中文描述 → true', () => {
    expect(isChinese('ECC 是一款开源的 Agent 支撑操作系统，它将 AI 编程 Agent 转变为协同系统。')).toBe(true);
  });
  it('纯英文 → false', () => {
    expect(isChinese('The agent harness performance optimization system.')).toBe(false);
  });
  it('短中文(<5字) → false', () => {
    expect(isChinese('你好吗')).toBe(false);
  });
  it('空/null → false', () => {
    expect(isChinese('')).toBe(false);
    expect(isChinese(null)).toBe(false);
    expect(isChinese(undefined)).toBe(false);
  });

  it('translateBatch 回填守卫: 非中文翻译结果不回填(模拟)', () => {
    // 直接验证回填逻辑等价式
    const zh = ['这是中文描述没有问题', ''];           // 第二条翻译失败返回空串
    const items = [{ descZh: undefined, desc: 'English fallback' }, { descZh: undefined, desc: 'Another' }];
    const out = items.map((it, i) => ({ ...it, descZh: isChinese(zh[i]) ? zh[i] : it.descZh ?? undefined }));
    expect(isChinese(out[0].descZh)).toBe(true);   // 中文回填成功
    expect(out[1].descZh).toBeUndefined();          // 空串被拒, 不冒充中文
  });
});
describe('兜底链: 最终输出必须中文', () => {
  const makeItem = (title: string, desc: string) =>
    ({ title, url: `https://github.com/${title}`, stars: '1k', desc, descZh: undefined }) as any;

  it('zread 命中 → 直接用 zread 中文, 不翻译', () => {
    const stub = extractDesc(payload('\n## 概览\n\nCodex CLI 是 OpenAI 的开源编码 Agent，它是一款能在本地运行命令行工具。本文由 zread 提供。\n'), 280);
    expect(stub).toContain('zread');
    expect(isZh(stub!)).toBe(true);
  });

  it('deepwiki 提取成功 → 得到英文(供翻译层转中文)', () => {
    const d = extractDeepwikiOverview(
      `Overview: ECC\n\n<details>\n<summary>Relevant source files</summary>\n\n- [a.ts](a.ts)\n</details>\n\n\n\nECC is a harness-native operator system for production-grade agentic work.\n\n## Details`,
      400,
    );
    expect(d).not.toBeNull();
    // 英文 → 必须由翻译层接手(描述链第2级产出英文, 非中文, 由第3级转中文)
    expect(d!).toContain('harness-native');
  });
});
