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

  it('优先含仓库名的定义段(修复: 不误选次要子系统长段)', () => {
    // 模拟 hermes-agent: 长"技能是…策展器是…"段(非目标) + 含 "hermes" 的较短定义段(目标)
    const p = payload(
      '\n## 核心机制\n\n' +
        '技能 是程序性记忆——可复用的、Agent 编写的工作流，存储为 Markdown 提示词文件。复杂任务之后，Agent 可以自主创建技能。策展器 是一个后台辅助模型任务，定期审查 Agent 创建的技能，固定有用的技能，归档过时的技能，并合并重复项。技能在使用中自我改进。\n\n' +
        '## 概览\n\nHermes Agent 是一款开源 AI 智能体框架，它是一款能在本地运行命令行工具。Hermes 由 Nous Research 团队开发。\n',
    );
    const d = extractDesc(p, 280, 'hermes'); // subject = 仓库名首段(hermes-agent→hermes), 同真人调用
    expect(d).not.toBeNull();
    expect(d!).toContain('Hermes Agent');   // 选中含仓库名的定义段
    expect(d!).not.toContain('策展器');      // 不误选次要子系统长段
  });

  it('无 subject 命中 → 概览段仍优先(即使非最长)', () => {
    const p = payload('\n## 概览\n\nCodex CLI 是 OpenAI 的开源编码 Agent，可在你的计算机上本地运行。\n\n## 进阶\n\nCodex CLI 也是一款极强大的终端工具，它集成了众多高级功能并且支持插件扩展机制，同时还有良好的文档与社区支持。\n');
    const d = extractDesc(p, 280, 'somerepo'); // 无任何块含 somerepo
    expect(d).not.toBeNull();
    expect(d!).toContain('开源编码 Agent'); // 概览段优先(即使"终端工具"更长)
  });

  it('无"概览/概述"标题 → 退回较长定义段', () => {
    const p = payload('\n## 原理\n\nCodex CLI 是 OpenAI 的开源编码 Agent，可在你的计算机上本地运行。\n\n## 进阶\n\nCodex CLI 也是一款极强大的终端工具，它集成了众多高级功能并且支持插件扩展机制，同时还有良好的文档与社区支持。\n');
    const d = extractDesc(p, 280);
    expect(d).not.toBeNull();
    expect(d!).toContain('终端工具'); // 无概览段, 退化选较长定义
  });

  it('优先"概览/Overview"标题后的概述段', () => {
    // 概览标题后的概述段 vs 更长的原理段 → 应取概览段
    const p = payload(
      '\n## 原理\n\nECC 这一整套系统融合了极其复杂的多级架构设计与高度耦合的模块化组件，涵盖了指令流水线、智能体编排、技能库里数十种工具的协调调度以及底层无状态内核的高并发处理机制，构成一个纵深防御式的工程实现。\n\n' +
        '## 概览\n\nECC 是一款开源的 Agent 支撑操作系统，它将 AI 编程 Agent 从单打独斗转变为协同工作的工程系统。\n',
    );
    const d = extractDesc(p, 280);
    expect(d).not.toBeNull();
    expect(d!).toContain('Agent 支撑操作系统'); // 概览段优先(即使更短)
    expect(d!).not.toContain('纵深防御');        // 不误选更长的原理段
  });

  it('标题与正文同块: "## 概述\n正文" 也能提取, 且优先于架构概览', () => {
    // 用户报错场景: vorssaint-utils —— ## 概述 与正文同块; 架构概览作独立块稍长
    const p = payload(
      '## 概述\n\n' +
        'Vorssaint 是一款原生 macOS 菜单栏实用工具，它将一系列付费 Mac 工具整合为一个免费应用。该应用完全使用 Swift 编写，驻留在菜单栏图标之后，提供音量控制、系统监控、窗口管理等功能。\n\n' +
        '## 架构概览\n\n' +
        'Vorssaint 作为一款 LSUIElement 辅助应用运行，它没有 Dock 栏图标也没有主窗口，整个用户界面由一个菜单栏状态项承载，遵循带有 Combine 发布者的单例服务模式，每个功能管理器都是全局共享的可观察对象。\n',
    );
    const d = extractDesc(p, 280);
    expect(d).not.toBeNull();
    expect(d!).toContain('菜单栏实用工具');  // 选中概述段
    expect(d!).not.toContain('LSUIElement'); // 不误选架构概览段
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
    expect(d!).toContain('its architecture, core components'); // 模板开场白已剥离, 取逗号后描述
    expect(d!).not.toContain('Relevant source files');
    expect(d!).not.toContain('high-level introduction to'); // 模板句被移除
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
